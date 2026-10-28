use super::*;
use crate::network::test_server::{start, Resp};
use crate::plugins::zip::testzip::build;
use std::sync::atomic::Ordering;
use tempfile::tempdir;

const ALLOW: &str = "[network]\nallow_plugins = true\n";

fn manifest(id: &str, version: &str, perms: &str) -> String {
    format!("id = \"{id}\"\nname = \"Demo\"\nversion = \"{version}\"\napi = 0\nmain = \"main.js\"\nactivation = []\npermissions = [{perms}]\n")
}

fn package(id: &str, version: &str, perms: &str) -> Vec<u8> {
    build(&[("main.js", b"export default {}", false), ("plugin.toml", manifest(id, version, perms).as_bytes(), false)])
}

fn entry_for(bytes: &[u8], id: &str, version: &str, perms: &[&str]) -> Entry {
    Entry {
        id: id.into(),
        version: version.into(),
        sha256: theme_install::sha256_hex(bytes),
        url: "demo.zip".into(),
        permissions: perms.iter().map(|s| s.to_string()).collect(),
    }
}

fn code<T>(r: Result<T>) -> String {
    r.err().map(|e| e.code).unwrap_or_default()
}

#[test]
fn installs_and_updates() {
    let tmp = tempdir().unwrap();
    let (user, scratch) = (tmp.path().join("plugins"), tmp.path().join("tmp"));
    let v1 = package("demo", "1.0.0", "\"vault.read\"");
    let info = install_bytes(&user, &scratch, &v1, &entry_for(&v1, "demo", "1.0.0", &["vault.read"]), "0.1.0", &HashSet::new()).unwrap();
    assert_eq!(info.manifest.version, "1.0.0");
    assert!(user.join("demo/main.js").is_file());
    let v2 = package("demo", "1.1.0", "\"vault.read\"");
    let info = install_bytes(&user, &scratch, &v2, &entry_for(&v2, "demo", "1.1.0", &["vault.read"]), "0.1.0", &HashSet::new()).unwrap();
    assert_eq!(info.manifest.version, "1.1.0");
    assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0, "scratch is cleaned");
}

#[test]
fn refuses_a_package_with_an_official_id() {
    let tmp = tempdir().unwrap();
    let (user, scratch) = (tmp.path().join("plugins"), tmp.path().join("tmp"));
    let official: HashSet<String> = ["graph".to_string()].into();
    let pkg = package("graph", "1.0.0", "");
    let entry = entry_for(&pkg, "graph", "1.0.0", &[]);
    assert_eq!(code(install_bytes(&user, &scratch, &pkg, &entry, "0.1.0", &official)), "NAME_COLLISION");
    assert!(!user.join("graph").exists());
}

#[test]
fn refuses_a_changed_package() {
    let tmp = tempdir().unwrap();
    let (user, scratch) = (tmp.path().join("plugins"), tmp.path().join("tmp"));
    let good = package("demo", "1.0.0", "");
    let mut entry = entry_for(&good, "demo", "1.0.0", &[]);
    let other = package("demo", "1.0.0", "\"vault.read\"");
    assert_eq!(code(install_bytes(&user, &scratch, &other, &entry, "0.1.0", &HashSet::new())), "HASH_MISMATCH");
    // Right hash, wrong claims about what is inside.
    entry.id = "other".into();
    assert_eq!(code(install_bytes(&user, &scratch, &good, &entry, "0.1.0", &HashSet::new())), "INVALID_FILE");
    let entry = entry_for(&good, "demo", "2.0.0", &[]);
    assert_eq!(code(install_bytes(&user, &scratch, &good, &entry, "0.1.0", &HashSet::new())), "INVALID_FILE");
    let entry = entry_for(&other, "demo", "1.0.0", &[]);
    let msg = install_bytes(&user, &scratch, &other, &entry, "0.1.0", &HashSet::new()).err().unwrap().message;
    assert!(msg.contains("permissions"));
    assert!(!user.join("demo").exists());
}

fn dirs_in(root: &Path, consent: Option<&str>) -> config::Dirs {
    let d = config::Dirs { config: root.join("config"), state: root.join("state") };
    fs::create_dir_all(&d.config).unwrap();
    if let Some(text) = consent {
        fs::write(d.config.join("config.toml"), text).unwrap();
    }
    d
}

#[test]
fn downloads_from_the_cached_list_with_consent() {
    let tmp = tempdir().unwrap();
    let d = dirs_in(tmp.path(), Some(ALLOW));
    let zip_bytes = package("demo", "1.0.0", "\"vault.read\"");
    let sha = theme_install::sha256_hex(&zip_bytes);
    let index = format!(
        "{{\"schema\":1,\"plugins\":[{{\"id\":\"demo\",\"version\":\"1.0.0\",\"sha256\":\"{sha}\",\"url\":\"demo.zip\",\"permissions\":[\"vault.read\"]}}]}}"
    );
    let zb = zip_bytes.clone();
    let (base, hits) = start(move |path| if path.ends_with("index.json") { Resp::ok(index.clone()) } else { Resp::ok(zb.clone()) });
    let user = tmp.path().join("plugins");
    assert_eq!(code(download_and_install(&d, &user, "demo", "0.1.0", &HashSet::new())), "NOT_FOUND", "no list yet");
    cat::index_for(&d, KIND, &format!("{base}/index.json"), 100_000).unwrap();
    let info = download_and_install(&d, &user, "demo", "0.1.0", &HashSet::new()).unwrap();
    assert_eq!(info.manifest.id, "demo");
    assert_eq!(code(download_and_install(&d, &user, "missing", "0.1.0", &HashSet::new())), "NOT_FOUND");
    assert!(hits.load(Ordering::SeqCst) >= 2);
}

#[test]
fn no_consent_no_request() {
    let tmp = tempdir().unwrap();
    for consent in [None, Some("[network]\nallow_plugins = false\n"), Some("[network]\nallow_themes = true\n")] {
        let d = dirs_in(&tmp.path().join(format!("{}", consent.map_or(0, str::len))), consent);
        let (base, hits) = start(|_| Resp::ok("{}"));
        assert!(cat::index_for(&d, KIND, &format!("{base}/index.json"), 1000).is_err());
        assert!(download_and_install(&d, &tmp.path().join("p"), "demo", "0.1.0", &HashSet::new()).is_err());
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }
}
