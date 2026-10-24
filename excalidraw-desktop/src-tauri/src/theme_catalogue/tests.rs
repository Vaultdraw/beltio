use super::*;
use crate::network::test_server::{start, Resp};
use std::sync::atomic::Ordering;
use tempfile::tempdir;

const ALLOW: &str = "[network]\nallow_themes = true\n";
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

fn dirs_in(root: &Path, consent: Option<&str>) -> config::Dirs {
    let d = config::Dirs { config: root.join("config"), state: root.join("state") };
    fs::create_dir_all(&d.config).unwrap();
    if let Some(text) = consent {
        fs::write(d.config.join("config.toml"), text).unwrap();
    }
    d
}

fn code<T>(r: Result<T>) -> String {
    r.err().map(|e| e.code).unwrap_or_default()
}

#[test]
fn consent_refused_before_any_request() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some("[network]\nallow_themes = false\n"));
    let (base, hits) = start(|_| Resp::ok("{}"));
    assert!(index_in(&d, &format!("{base}/index.json"), 1000).is_err());
    assert!(preview_in(&d, &format!("{base}/a.png"), 1000, 10).is_err());
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[test]
fn index_fetch_caches_and_refetch_keeps_file() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, hits) = start(|_| Resp::ok("\u{FEFF}{\"themes\":[]}"));
    let url = format!("{base}/index.json");
    assert!(cached_in(&d).is_none());
    let a = index_in(&d, &url, u64::MAX).unwrap();
    assert_eq!(a.json, "{\"themes\":[]}");
    assert_eq!(a.url, url);
    assert_eq!(cached_in(&d).unwrap(), a);
    let file = cache_dir(&d).join(INDEX_FILE);
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000);
    fs::File::options().write(true).open(&file).unwrap().set_modified(old).unwrap();
    let mut meta = read_meta(&cache_dir(&d)).unwrap();
    meta.fetched_at = 5;
    write_meta(&cache_dir(&d), &meta).unwrap();
    let b = index_in(&d, &url, 1000).unwrap();
    assert_eq!(b.sha256, a.sha256);
    assert!(b.fetched_at > 5);
    assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), old, "index.json untouched");
    assert_eq!(cached_in(&d).unwrap().fetched_at, b.fetched_at);
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[test]
fn invalid_json_refused_and_cache_untouched() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, _) = start(|p| match p {
        "/good" => Resp::ok("{\"a\":1}"),
        "/arr" => Resp::ok("[1]"),
        "/bin" => Resp::ok(vec![0xFF, 0xFE, 0x00]),
        _ => Resp::ok("{nope"),
    });
    let good = index_in(&d, &format!("{base}/good"), 1000).unwrap();
    for p in ["bad", "arr", "bin"] {
        assert_eq!(code(index_in(&d, &format!("{base}/{p}"), 1000)), "INVALID_FILE", "{p}");
    }
    assert_eq!(cached_in(&d).unwrap(), good);
}

#[test]
fn too_large_refused() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, _) = start(|_| Resp::ok(format!("{{\"x\":\"{}\"}}", "a".repeat(3000))));
    assert!(index_in(&d, &format!("{base}/i"), 100).is_err());
    assert!(cached_in(&d).is_none());
}

#[test]
fn preview_cached_without_network_or_consent() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, hits) = start(|_| Resp::ok(PNG));
    let url = format!("{base}/p.png");
    assert_eq!(preview_in(&d, &url, 1000, 10).unwrap(), PNG);
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    fs::write(d.config.join("config.toml"), "[network]\nallow_themes = false\n").unwrap();
    assert_eq!(preview_in(&d, &url, 1000, 10).unwrap(), PNG);
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn preview_rejects_svg_and_garbage() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, _) = start(|p| match p {
        "/svg" => Resp::ok("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
        _ => Resp::ok("garbage"),
    });
    for p in ["svg", "x"] {
        assert_eq!(code(preview_in(&d, &format!("{base}/{p}"), 1000, 10)), "INVALID_FILE");
    }
    assert!(!cache_dir(&d).join(PREVIEWS_DIR).exists() || fs::read_dir(cache_dir(&d).join(PREVIEWS_DIR)).unwrap().count() == 0);
}

#[test]
fn image_magic() {
    assert!(image_kind(PNG));
    assert!(image_kind(&[0xFF, 0xD8, 0xFF, 0xE0]));
    assert!(image_kind(b"RIFF\0\0\0\0WEBPVP8 "));
    assert!(!image_kind(b"RIFF\0\0\0\0WAVEfmt "));
    assert!(!image_kind(b""));
}

#[test]
fn prune_keeps_newest() {
    let tmp = tempdir().unwrap();
    let dir = tmp.path();
    for i in 0..5u64 {
        let p = dir.join(format!("f{i}"));
        fs::write(&p, "x").unwrap();
        let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i);
        fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
    }
    fs::write(dir.join(".tmp-x"), "x").unwrap();
    prune_dir(dir, 2);
    let mut left: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    left.sort();
    assert_eq!(left, vec![".tmp-x", "f3", "f4"]);
}

#[cfg(unix)]
#[test]
fn symlinked_cache_dir_refused() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    fs::create_dir_all(&d.state).unwrap();
    let target = tmp.path().join("elsewhere");
    fs::create_dir(&target).unwrap();
    std::os::unix::fs::symlink(&target, cache_dir(&d)).unwrap();
    let (base, _) = start(|_| Resp::ok("{}"));
    assert!(index_in(&d, &format!("{base}/i"), 1000).is_err());
    assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
}

#[test]
fn preview_cache_evicts_the_least_recently_used() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let (base, hits) = start(|_| Resp::ok(PNG));
    let url = |n: &str| format!("{base}/{n}.png");
    let file = |n: &str| cache_dir(&d).join(PREVIEWS_DIR).join(theme_install::sha256_hex(url(n).as_bytes()));
    let age = |n: &str, secs: u64| {
        let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(secs);
        fs::File::options().write(true).open(file(n)).unwrap().set_modified(t).unwrap();
    };
    preview_in(&d, &url("a"), 1000, 2).unwrap();
    preview_in(&d, &url("b"), 1000, 2).unwrap();
    // a was written first (older), b later; then a is used again, so b is now the oldest use.
    age("a", 1000);
    age("b", 2000);
    preview_in(&d, &url("a"), 1000, 2).unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 2, "a came from the cache");
    preview_in(&d, &url("c"), 1000, 2).unwrap();
    assert!(file("a").exists(), "a was used last, so it stays");
    assert!(!file("b").exists(), "b is the least recently used");
    assert!(file("c").exists());
}
