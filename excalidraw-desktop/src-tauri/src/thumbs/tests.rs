use super::*;
use std::{collections::HashSet, time::Instant};
use tempfile::tempdir;

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
const RV: u32 = 1;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    vt: Arc<VaultThumbs>,
}

fn fixture() -> Fixture {
    let dir = tempdir().unwrap();
    let root = dir.path().join("vault");
    let state = dir.path().join("state");
    fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let vt = VaultThumbs::new(root.clone(), &state);
    Fixture { _dir: dir, root, state, vt }
}

impl Fixture {
    fn draw(&self, name: &str, content: &str) {
        let p = self.root.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
    fn lookup(&self, paths: &[&str]) -> Vec<ThumbLookup> {
        let p: Vec<String> = paths.iter().map(|s| s.to_string()).collect();
        self.vt.lookup(&p, RV, RV).unwrap().items
    }
    fn rev(&self, name: &str) -> String {
        self.lookup(&[name])[0].rev.clone().unwrap()
    }
    fn put_png(&self, name: &str, rev: &str) -> Result<PutResult> {
        self.vt.put(name, rev, Kind::Png, RV, PNG)
    }
    fn manifest_rev(&self, name: &str) -> Option<String> {
        let mut i = self.vt.lock().unwrap();
        self.vt.manifest(&mut i).entries.get(name).map(|e| e.rev.clone())
    }
}

#[test]
fn lazy_no_dirs_before_first_use() {
    let f = fixture();
    assert!(!f.state.exists());
    let _ = ThumbsService::default();
    assert!(!f.state.exists());
    // A lookup of a missing drawing still creates nothing.
    assert_eq!(f.lookup(&["nope.excalidraw"])[0].state, ThumbState::Missing);
    assert!(!f.state.exists());
}

#[test]
fn lookup_states() {
    let f = fixture();
    f.draw("a.excalidraw", "{\"a\":1}");
    f.draw("note.txt", "x");
    fs::create_dir_all(f.root.join(".excalidraw-vault")).unwrap();
    f.draw(".excalidraw-vault/x.excalidraw", "{}");
    let r = f.lookup(&["a.excalidraw", "gone.excalidraw", "note.txt", ".excalidraw-vault/x.excalidraw", "../x.excalidraw"]);
    assert_eq!(r[0].state, ThumbState::Miss);
    assert!(r[0].rev.is_some());
    for i in r.iter().skip(1) {
        assert_eq!(*i, ThumbLookup { rev: None, state: ThumbState::Missing });
    }
    let rev = r[0].rev.clone().unwrap();
    f.put_png("a.excalidraw", &rev).unwrap();
    assert_eq!(f.lookup(&["a.excalidraw"])[0].state, ThumbState::Hit);
    // A fail marker for another render version does not count; the same one does.
    f.draw("b.excalidraw", "{\"b\":1}");
    let brev = f.rev("b.excalidraw");
    f.vt.put("b.excalidraw", &brev, Kind::Fail, 2, &[]).unwrap();
    assert_eq!(f.lookup(&["b.excalidraw"])[0].state, ThumbState::Miss);
    f.vt.put("b.excalidraw", &brev, Kind::Fail, RV, &[]).unwrap();
    assert_eq!(f.lookup(&["b.excalidraw"])[0].state, ThumbState::Failed);
}

#[test]
fn fail_markers_have_their_own_version() {
    // A new fail-marker generation retries old markers; cached PNGs still hit.
    let f = fixture();
    f.draw("a.excalidraw", "{\"a\":1}");
    f.draw("b.excalidraw", "{\"b\":1}");
    let arev = f.rev("a.excalidraw");
    let brev = f.rev("b.excalidraw");
    f.put_png("a.excalidraw", &arev).unwrap();
    f.vt.put("b.excalidraw", &brev, Kind::Fail, RV, &[]).unwrap();
    let names = vec!["a.excalidraw".to_string(), "b.excalidraw".to_string()];
    let states = |fv| f.vt.lookup(&names, RV, fv).unwrap().items.into_iter().map(|i| i.state).collect::<Vec<_>>();
    assert_eq!(states(RV), vec![ThumbState::Hit, ThumbState::Failed]);
    assert_eq!(states(RV + 1000), vec![ThumbState::Hit, ThumbState::Miss]);
    f.vt.put("b.excalidraw", &brev, Kind::Fail, RV + 1000, &[]).unwrap();
    assert_eq!(states(RV + 1000), vec![ThumbState::Hit, ThumbState::Failed]);
}

#[test]
fn lookup_rejects_too_many_paths_and_keeps_order() {
    let f = fixture();
    let many: Vec<String> = (0..501).map(|i| format!("{i}.excalidraw")).collect();
    assert!(f.vt.lookup(&many, RV, RV).is_err());
    f.draw("a.excalidraw", "1");
    let r = f.lookup(&["x.excalidraw", "a.excalidraw", "y.excalidraw"]);
    assert_eq!(r[0].state, ThumbState::Missing);
    assert_eq!(r[1].state, ThumbState::Miss);
    assert_eq!(r[2].state, ThumbState::Missing);
}

#[test]
fn rehash_budget_then_pending() {
    let f = fixture();
    let names: Vec<String> = (0..70).map(|i| format!("d{i}.excalidraw")).collect();
    for (i, n) in names.iter().enumerate() {
        f.draw(n, &format!("{{\"i\":{i}}}"));
    }
    let first = f.vt.lookup(&names, RV, RV).unwrap().items;
    let pending = first.iter().filter(|i| i.state == ThumbState::Pending).count();
    assert_eq!(pending, 6);
    assert!(first[..64].iter().all(|i| i.state == ThumbState::Miss && i.rev.is_some()));
    assert!(first[64..].iter().all(|i| i.rev.is_none()));
    // Second call: the 64 are gated by the manifest (no budget used), the rest get hashed.
    let second = f.vt.lookup(&names, RV, RV).unwrap().items;
    assert!(second.iter().all(|i| i.state == ThumbState::Miss && i.rev.is_some()));
}

#[test]
fn rename_reuses_and_edit_invalidates() {
    let f = fixture();
    f.draw("a.excalidraw", "{\"v\":1}");
    let rev = f.rev("a.excalidraw");
    f.put_png("a.excalidraw", &rev).unwrap();
    fs::rename(f.root.join("a.excalidraw"), f.root.join("renamed.excalidraw")).unwrap();
    let r = f.lookup(&["renamed.excalidraw", "a.excalidraw"]);
    assert_eq!(r[0], ThumbLookup { rev: Some(rev.clone()), state: ThumbState::Hit });
    assert_eq!(r[1].state, ThumbState::Missing);
    // Edit (different size so the stat gate trips even within one mtime tick).
    f.draw("renamed.excalidraw", "{\"v\":2,\"more\":true}");
    let r = f.lookup(&["renamed.excalidraw"]);
    assert_ne!(r[0].rev.as_deref(), Some(rev.as_str()));
    assert_eq!(r[0].state, ThumbState::Miss);
}

#[test]
fn same_size_edit_with_new_mtime_rehashes() {
    let f = fixture();
    f.draw("a.excalidraw", "{\"v\":1}");
    let rev = f.rev("a.excalidraw");
    std::thread::sleep(Duration::from_millis(20));
    f.draw("a.excalidraw", "{\"v\":2}");
    assert_ne!(f.rev("a.excalidraw"), rev);
}

#[test]
fn put_validation() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    let up = rev.to_uppercase();
    for bad in [&up[..], "abc", &"g".repeat(64), &format!("{}/", &rev[..63]), "../../etc"] {
        assert!(f.put_png("a.excalidraw", bad).is_err(), "{bad}");
    }
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Png, RV, b"not a png at all").is_err());
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Png, RV, &[]).is_err());
    let mut big = PNG.to_vec();
    big.resize(store::MAX_PNG_BYTES + 1, 0);
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Png, RV, &big).is_err());
    let mut ok = PNG.to_vec();
    ok.resize(store::MAX_PNG_BYTES, 0);
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Png, RV, &ok).is_ok());
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Fail, RV, b"x").is_err());
    assert!(store::parse_kind("jpeg").is_err());
    // Nothing invalid was written.
    assert!(!png_path(&f.vt.cache, &"0".repeat(64), RV).exists());
}

#[test]
fn put_returns_url_and_manifest_only_when_current() {
    let f = fixture();
    f.draw("a.excalidraw", "{\"v\":1}");
    let rev = f.rev("a.excalidraw");
    let url = f.put_png("a.excalidraw", &rev).unwrap().url.unwrap();
    assert_eq!(url, format!("vdthumb://localhost/{}/{rev}.v{RV}.png", f.vt.vault_id));
    assert!(f.vt.put("a.excalidraw", &rev, Kind::Fail, RV, &[]).unwrap().url.is_none());
    // A stale revision (file changed since render): the file is kept, the manifest is not updated.
    f.draw("b.excalidraw", "{\"b\":1}");
    let stale = "ab".repeat(32);
    f.put_png("b.excalidraw", &stale).unwrap();
    assert!(png_path(&f.vt.cache, &stale, RV).is_file());
    assert_eq!(f.manifest_rev("b.excalidraw"), None);
    // Put for a path the manifest never saw, with the current rev, adopts it.
    f.draw("c.excalidraw", "{\"c\":1}");
    let crev = crate::current_revision(&f.root.join("c.excalidraw")).unwrap().unwrap();
    f.put_png("c.excalidraw", &crev).unwrap();
    assert_eq!(f.manifest_rev("c.excalidraw"), Some(crev));
    // A path that is not a drawing or escapes the vault is just a content-addressed write.
    f.put_png("../evil.excalidraw", &"cd".repeat(32)).unwrap();
}

#[test]
fn failed_flush_stays_dirty_and_retries() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    f.put_png("a.excalidraw", &rev).unwrap();
    // A directory where the manifest file goes makes the atomic rename fail.
    let manifest = f.vt.cache.join("manifest.json");
    let _ = fs::remove_file(&manifest);
    fs::create_dir_all(&manifest).unwrap();
    assert!(f.vt.flush().is_err());
    assert!(f.vt.lock().unwrap().dirty);
    fs::remove_dir_all(&manifest).unwrap();
    f.vt.flush().unwrap();
    assert!(manifest.is_file());
    assert!(!f.vt.lock().unwrap().dirty);
}

#[test]
fn atomic_writes_leave_no_temp_files() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    for _ in 0..5 {
        f.put_png("a.excalidraw", &rev).unwrap();
    }
    f.vt.flush().unwrap();
    let mut stack = vec![f.vt.cache.clone()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let n = p.file_name().unwrap().to_string_lossy().into_owned();
                assert!(!n.ends_with(".tmp"), "{n}");
            }
        }
    }
    assert_eq!(fs::read(png_path(&f.vt.cache, &rev, RV)).unwrap(), PNG);
}

#[test]
fn manifest_persists_and_reloads() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    f.vt.flush().unwrap();
    assert!(f.vt.cache.join("manifest.json").is_file());
    let again = VaultThumbs::new(f.root.clone(), &f.state);
    let mut i = again.lock().unwrap();
    assert_eq!(again.manifest(&mut i).entries.get("a.excalidraw").unwrap().rev, rev);
    drop(i);
    // Corrupt manifest = empty, not an error.
    fs::write(f.vt.cache.join("manifest.json"), b"{nope").unwrap();
    let third = VaultThumbs::new(f.root.clone(), &f.state);
    let mut i = third.lock().unwrap();
    assert!(third.manifest(&mut i).entries.is_empty());
}

#[test]
fn clear_removes_cache_and_manifest() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    f.put_png("a.excalidraw", &rev).unwrap();
    f.vt.flush().unwrap();
    f.vt.clear().unwrap();
    assert!(!f.vt.cache.exists());
    assert_eq!(f.manifest_rev("a.excalidraw"), None);
    f.vt.clear().unwrap(); // idempotent
}

fn seed(cache: &Path, rev_byte: u8, size: usize, name_ext: &str) -> String {
    let rev = format!("{rev_byte:02x}").repeat(32);
    let p = cache.join(&rev[..2]).join(format!("{rev}{name_ext}"));
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, vec![7u8; size]).unwrap();
    rev
}

#[test]
fn gc_orphans_first_then_oldest_down_to_90_percent() {
    let dir = tempdir().unwrap();
    let cache = dir.path();
    let kept_old = seed(cache, 1, 400, &format!(".v{RV}.png"));
    std::thread::sleep(Duration::from_millis(15));
    let orphan = seed(cache, 2, 400, &format!(".v{RV}.png"));
    std::thread::sleep(Duration::from_millis(15));
    let kept_new = seed(cache, 3, 400, &format!(".v{RV}.png"));
    let orphan_fail = seed(cache, 4, 0, ".v1.fail");
    let live_fail = seed(cache, 5, 0, ".v1.fail");
    fs::write(cache.join("01").join(".9-9.tmp"), b"junk").unwrap();
    let refs: HashSet<String> = [kept_old.clone(), kept_new.clone(), live_fail.clone()].into();
    // Cap 1000: 1200 total -> over; target 900 -> only the orphan has to go.
    let left = gc::run(cache, &refs, 1000, Duration::ZERO);
    assert_eq!(left, 800);
    assert!(!png_path(cache, &orphan, RV).exists());
    assert!(png_path(cache, &kept_old, RV).exists() && png_path(cache, &kept_new, RV).exists());
    assert!(!fail_path(cache, &orphan_fail, 1).exists());
    assert!(fail_path(cache, &live_fail, 1).exists());
    assert!(!cache.join("01").join(".9-9.tmp").exists());
    // Still over a tighter cap: the oldest referenced file goes next.
    let left = gc::run(cache, &refs, 500, Duration::ZERO);
    assert_eq!(left, 400);
    assert!(!png_path(cache, &kept_old, RV).exists() && png_path(cache, &kept_new, RV).exists());
}

#[test]
fn gc_keeps_young_files_and_noop_under_cap() {
    let dir = tempdir().unwrap();
    let rev = seed(dir.path(), 9, 500, &format!(".v{RV}.png"));
    assert_eq!(gc::run(dir.path(), &HashSet::new(), 1000, Duration::ZERO), 500);
    assert_eq!(gc::run(dir.path(), &HashSet::new(), 100, Duration::from_secs(60)), 500);
    assert!(png_path(dir.path(), &rev, RV).exists());
}

#[test]
fn put_over_cap_triggers_background_gc() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("v");
    fs::create_dir_all(&root).unwrap();
    let state = dir.path().join("s");
    let mut vt = VaultThumbs::new(root.canonicalize().unwrap(), &state);
    {
        let m = Arc::get_mut(&mut vt).unwrap();
        m.cap = std::sync::atomic::AtomicU64::new(300);
        m.gc_min_age = Duration::ZERO;
    }
    let big = |n: usize| {
        let mut b = PNG.to_vec();
        b.resize(n, 0);
        b
    };
    for i in 0..5u8 {
        let rev = format!("{:02x}", i + 1).repeat(32);
        vt.put("x.excalidraw", &rev, Kind::Png, RV, &big(100)).unwrap();
        std::thread::sleep(Duration::from_millis(10));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let idle = !vt.lock().unwrap().gc_running;
        if idle && gc::dir_size(&vt.cache) <= 300 {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("gc did not bring the cache under the cap: {}", gc::dir_size(&vt.cache));
}

#[test]
fn scheme_validation() {
    let dir = tempdir().unwrap();
    let state = dir.path();
    let vid = "0123456789abcdef";
    let rev = "ab".repeat(32);
    let cache = cache_dir(state, vid);
    store::write_atomic(&png_path(&cache, &rev, RV), PNG).unwrap();
    let ok = format!("/{vid}/{rev}.v{RV}.png");
    assert_eq!(scheme::read(state, &ok).unwrap(), PNG);
    assert_eq!(scheme::parse(&ok), Some((vid, rev.as_str(), RV)));
    let bad = [
        format!("/{vid}/../{rev}.png"),
        format!("/{vid}/%2e%2e/{rev}.png"),
        format!("/%2e%2e/{rev}.png"),
        format!("/{vid}/{}.png", rev.to_uppercase()),
        format!("/{}/{rev}.png", vid.to_uppercase()),
        format!("/{vid}/{}.png", &rev[..62]),
        format!("/{vid}/{rev}a.png"),
        format!("/{}/{rev}.png", &vid[..15]),
        format!("/{vid}/{rev}.jpg"),
        format!("/{vid}/{rev}.png/"),
        format!("/{vid}/"),
        format!("/{vid}"),
        "/".to_string(),
        "".to_string(),
        format!("{vid}/{rev}.png"),
        format!("/{vid}/{}/{rev}.png", &rev[..2]),
        format!("/{vid}/{rev}.png"), // pre-v2 unversioned name
        format!("/{vid}/{rev}.v.png"),
        format!("/{vid}/{rev}.v2x.png"),
        format!("/{vid}/{rev}.v-1.png"),
        format!("/{vid}/{rev}.v+2.png"),
        format!("/{vid}/{rev}.v1234567890.png"),
        format!("/{vid}/{rev}.v2/../x.png"),
        format!("/{vid}/{rev}.v2.v3.png"),
    ];
    for b in &bad {
        assert!(scheme::read(state, b).is_none(), "{b}");
        assert!(scheme::resolve(state, b).is_none(), "{b}");
    }
    // Valid names with no file: 404; a directory is never listed or served.
    assert!(scheme::read(state, &format!("/{vid}/{}.v{RV}.png", "cd".repeat(32))).is_none());
    assert_eq!(scheme::response(None).status(), 404);
    let r = scheme::response(Some(PNG.to_vec()));
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["content-type"], "image/png");
    assert_eq!(r.headers()["cache-control"], "public, max-age=31536000, immutable");
}

#[test]
fn symlinked_drawing_is_missing() {
    #[cfg(unix)]
    {
        let f = fixture();
        f.draw("real.excalidraw", "1");
        std::os::unix::fs::symlink(f.root.join("real.excalidraw"), f.root.join("link.excalidraw")).unwrap();
        assert_eq!(f.lookup(&["link.excalidraw"])[0].state, ThumbState::Missing);
    }
}

#[test]
fn lookup_json_shape() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let r = f.vt.lookup(&["a.excalidraw".into(), "z.excalidraw".into()], RV, RV).unwrap();
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["vaultId"].as_str().unwrap().len(), 16);
    assert_eq!(v["items"][0]["state"], "miss");
    assert_eq!(v["items"][1]["state"], "missing");
    assert!(v["items"][1]["rev"].is_null());
}

/// Quick latency check: `cargo test --release thumbs::tests::bench -- --ignored --nocapture`.
#[test]
#[ignore]
fn bench_lookup_100_warm() {
    let f = fixture();
    let names: Vec<String> = (0..100).map(|i| format!("sub/d{i}.excalidraw")).collect();
    for n in &names {
        f.draw(n, &format!("{{\"n\":\"{n}\"}}"));
    }
    f.vt.lookup(&names, RV, RV).unwrap();
    let mut times = Vec::new();
    for _ in 0..30 {
        let t = Instant::now();
        f.vt.lookup(&names, RV, RV).unwrap();
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    eprintln!("lookup 100 warm: p50 {:.2} ms, p95 {:.2} ms", times[15], times[28]);
}

#[test]
fn new_render_version_replaces_old_renderings_of_the_revision() {
    let f = fixture();
    f.draw("a.excalidraw", "1");
    let rev = f.rev("a.excalidraw");
    // A pre-v2 thumbnail (`<rev>.png`) and an older version are on disk.
    let legacy = f.vt.cache.join(&rev[..2]).join(format!("{rev}.png"));
    store::write_atomic(&legacy, PNG).unwrap();
    f.vt.put("a.excalidraw", &rev, Kind::Png, RV, PNG).unwrap();
    let lookup = |v| f.vt.lookup(&["a.excalidraw".to_string()], v, v).unwrap().items.remove(0).state;
    assert_eq!(lookup(RV), ThumbState::Hit);
    assert_eq!(lookup(RV + 1), ThumbState::Miss, "another version renders again");
    let url = f.vt.put("a.excalidraw", &rev, Kind::Png, RV + 1, PNG).unwrap().url.unwrap();
    assert!(url.ends_with(&format!("{rev}.v{}.png", RV + 1)));
    assert!(!legacy.exists() && !png_path(&f.vt.cache, &rev, RV).exists());
    assert!(png_path(&f.vt.cache, &rev, RV + 1).is_file());
    assert_eq!(lookup(RV + 1), ThumbState::Hit);
    // Fail markers are not touched by a PNG write.
    f.vt.put("b.excalidraw", &"ef".repeat(32), Kind::Fail, RV, &[]).unwrap();
    f.vt.put("b.excalidraw", &"ef".repeat(32), Kind::Png, RV, PNG).unwrap();
    assert!(fail_path(&f.vt.cache, &"ef".repeat(32), RV).exists());
}

#[test]
fn cap_defaults_and_follows_a_valid_setting_only() {
    use std::sync::atomic::Ordering::Relaxed;
    let dir = tempdir().unwrap();
    let root = dir.path().join("v");
    fs::create_dir_all(&root).unwrap();
    let vt = VaultThumbs::new(root.canonicalize().unwrap(), &dir.path().join("s"));
    assert_eq!(vt.cap.load(Relaxed), 128 * 1024 * 1024, "default unchanged");
    vt.set_cap_mb(64);
    assert_eq!(vt.cap.load(Relaxed), 64 * 1024 * 1024);
    for bad in [0, 7, 8193, u64::MAX] {
        vt.set_cap_mb(bad);
        assert_eq!(vt.cap.load(Relaxed), 64 * 1024 * 1024, "{bad} is ignored");
    }
    vt.set_cap_mb(8);
    assert_eq!(vt.cap.load(Relaxed), 8 * 1024 * 1024);
}
