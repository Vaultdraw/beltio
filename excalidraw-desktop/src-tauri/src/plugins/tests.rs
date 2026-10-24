use super::{consent, install, manifest, scan, scheme};
use scan::{Index, Roots, Source};
use std::{fs, path::{Path, PathBuf}, time::Instant};
use super::{clear_restart, RESTART_PENDING};
use std::sync::atomic::Ordering;
use tempfile::tempdir;

const APP: &str = "0.1.0";
const SAMPLE: &str = r#"
id = "hello-command"
name = "Hello"
version = "0.1.0"
api = 0
min_app = "0.1.0"
main = "main.js"
description = "Says hello"
author = "you"
activation = ["onStartupFinished"]

[[contributes.commands]]
id = "hello"
title = "Hello: say hello"
keys = ["Mod+Alt+H"]
when = ["vaultOpen"]

[[contributes.panels]]
id = "notes"
title = "Notes"
icon = "note"
group = "bottom"

[[contributes.settings]]
key = "greeting"
type = "string"
title = "Greeting"
default = "Hello"
"#;

fn minimal(id: &str) -> String {
    format!("id = \"{id}\"\nname = \"N\"\nversion = \"1.0.0\"\napi = 0\nmain = \"main.js\"\n")
}

fn with(extra: &str) -> String {
    format!("{}{extra}", minimal("my-plugin"))
}

fn bad(text: &str, needle: &str) {
    let e = manifest::parse(text).expect_err(text);
    assert!(e.to_lowercase().contains(&needle.to_lowercase()), "{e:?} should mention {needle:?}");
}

fn make_plugin(root: &Path, folder: &str, manifest_text: &str) -> PathBuf {
    let dir = root.join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.toml"), manifest_text).unwrap();
    fs::write(dir.join("main.js"), "export default {};").unwrap();
    dir
}

// ---- manifest ----

#[test]
fn valid_manifest_parses_with_defaults() {
    let m = manifest::parse(SAMPLE).unwrap();
    assert_eq!(m.id, "hello-command");
    assert_eq!(m.min_app.as_deref(), Some("0.1.0"));
    let c = &m.contributes.commands[0];
    assert_eq!((c.keys.clone(), c.when.clone(), c.palette), (vec!["Mod+Alt+H".to_string()], vec!["vaultOpen".to_string()], true));
    assert_eq!(m.contributes.panels[0].group, manifest::Group::Bottom);
    assert_eq!(m.contributes.settings.len(), 1);
    let min = manifest::parse(&minimal("ab")).unwrap();
    assert!(min.activation.is_empty() && min.contributes.commands.is_empty());
    let p = manifest::parse(&with("[[contributes.panels]]\nid = \"p\"\ntitle = \"P\"\n")).unwrap();
    assert_eq!((p.contributes.panels[0].group, p.contributes.panels[0].icon.clone()), (manifest::Group::Top, None));
}

#[test]
fn json_shape_matches_contract() {
    let v = serde_json::to_value(manifest::parse(SAMPLE).unwrap()).unwrap();
    assert_eq!(v["minApp"], "0.1.0");
    assert_eq!(v["contributes"]["panels"][0]["group"], "bottom");
    assert_eq!(v["contributes"]["commands"][0]["palette"], true);
}

#[test]
fn invalid_ids() {
    for id in ["a", "-ab", "Ab", "a_b", "a.b", "", &"a".repeat(40)] {
        bad(&minimal(id), "id");
    }
    for id in ["ab", "0a", "a-b-c", &"a".repeat(39)] {
        manifest::parse(&minimal(id)).unwrap();
    }
}

#[test]
fn invalid_versions_api_and_main() {
    bad(&minimal("ab").replace("1.0.0", "1.0"), "version");
    bad(&with("").replace("api = 0", "api = \"0\""), "api");
    bad(&with("").replace("api = 0", "api = 0.5"), "api");
    bad(&format!("{}min_app = \"x\"\n", minimal("ab")), "min_app");
    for main in ["../x.js", "/abs.js", "a\\\\b.js", "a//b.js", "./x.js", "", "C:/x.js", "a/../b.js"] {
        bad(&minimal("ab").replace("main.js", main), "main");
    }
    bad(&minimal("ab").replace("main.js", "a\\u0000b.js"), "main");
    manifest::parse(&minimal("ab").replace("main.js", "dist/main.js")).unwrap();
}

#[test]
fn contribution_limits_and_ids() {
    let cmds = |n: usize| (0..n).map(|i| format!("[[contributes.commands]]\nid = \"c{i}\"\ntitle = \"T\"\n")).collect::<String>();
    manifest::parse(&with(&cmds(200))).unwrap();
    bad(&with(&cmds(201)), "too many");
    let panels = (0..21).map(|i| format!("[[contributes.panels]]\nid = \"p{i}\"\ntitle = \"T\"\n")).collect::<String>();
    bad(&with(&panels), "too many");
    let settings = (0..101).map(|i| format!("[[contributes.settings]]\nkey = \"k{i}\"\ntype = \"bool\"\n")).collect::<String>();
    bad(&with(&settings), "too many");
    bad(&with(&format!("[[contributes.commands]]\nid = \"a\"\ntitle = \"{}\"\n", "x".repeat(201))), "title");
    bad(&with("[[contributes.commands]]\nid = \"a\"\ntitle = \"T\"\n[[contributes.commands]]\nid = \"a\"\ntitle = \"U\"\n"), "duplicate");
    bad(&with("[[contributes.panels]]\nid = \"a\"\ntitle = \"T\"\n[[contributes.panels]]\nid = \"a\"\ntitle = \"U\"\n"), "duplicate");
    for id in ["1a", "a b", "a.b", "", &"a".repeat(65)] {
        bad(&with(&format!("[[contributes.commands]]\nid = \"{id}\"\ntitle = \"T\"\n")), "id");
    }
    bad(&with("[[contributes.panels]]\nid = \"a\"\ntitle = \"T\"\ngroup = \"left\"\n"), "left");
    bad(&with("[[contributes.settings]]\ntype = \"bool\"\n"), "key");
    bad(&with("[[contributes.settings]]\nkey = \"k\"\n"), "type");
    bad(&with("[[contributes.commands]]\nid = \"a\"\ntitle = \"T\"\nkeys = \"Mod+A\"\n"), "keys");
}

#[test]
fn activation_entries() {
    manifest::parse(&with("activation = [\"onStartupFinished\"]\n").replace("api = 0\n", "api = 0\n")).ok();
    bad(&format!("{}activation = [\"onCommand\"]\n", minimal("ab")), "activation");
}

#[test]
fn malformed_oversize_unknown_and_extension_tables() {
    assert!(manifest::parse("id = ").is_err());
    bad(&format!("{}# {}", minimal("ab"), "x".repeat(70_000)), "64 KB");
    bad(&format!("{}surprise = 1\n", minimal("ab")), "surprise");
    bad(&format!("{}[contributes.extra]\na = 1\n", minimal("ab")), "extra");
    manifest::parse(&format!("{}[x-future]\nanything = [1, 2]\n", minimal("ab"))).unwrap();
    bad(&format!("{}x-future = 1\n", minimal("ab")), "x-future");
}

#[test]
fn compatibility() {
    let m = manifest::parse(SAMPLE).unwrap();
    assert_eq!(manifest::compatibility(&m, "0.1.0"), (true, None));
    assert_eq!(manifest::compatibility(&m, "0.0.9"), (false, Some("Needs app \u{2265} 0.1.0".into())));
    let mut v1 = m.clone();
    v1.api = 1;
    assert_eq!(manifest::compatibility(&v1, "9.0.0"), (false, Some("Plugin API 1 is not supported".into())));
    let mut none = m;
    none.min_app = None;
    assert!(manifest::compatibility(&none, "0.0.1").0);
}

// ---- scan ----

fn roots(tmp: &Path) -> Roots {
    Roots { user: tmp.join("cfg/plugins"), bundled: Some(tmp.join("res/plugins")) }
}

#[test]
fn scan_missing_roots_is_empty_and_creates_user_root() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let s = scan::scan(&r, None, APP);
    assert!(s.list.plugins.is_empty() && s.list.errors.is_empty() && s.index.is_empty());
    assert!(r.user.is_dir());
}

#[test]
fn scan_finds_plugins_errors_and_skips_symlinks() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(&r.user, "good", &minimal("good"));
    make_plugin(&r.user, "broken", "id = ");
    let nm = make_plugin(&r.user, "no-main", &minimal("no-main"));
    fs::remove_file(nm.join("main.js")).unwrap();
    fs::create_dir_all(r.user.join("empty")).unwrap();
    make_plugin(&r.user, ".hidden", &minimal("hidden"));
    let outside = make_plugin(tmp.path(), "outside", &minimal("outside"));
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, r.user.join("linked")).unwrap();
    let s = scan::scan(&r, None, APP);
    let ids: Vec<_> = s.list.plugins.iter().map(|p| p.manifest.id.as_str()).collect();
    assert_eq!(ids, ["good"]);
    assert_eq!(s.list.errors.len(), 3, "{:?}", s.list.errors);
    assert!(s.list.errors.iter().any(|e| e.dir.ends_with("no-main") && e.message.contains("main")));
    let p = &s.list.plugins[0];
    assert_eq!((p.main_bytes, p.source, p.compatible), (18, Source::User, true));
    assert!(s.index.contains_key("good"));
}

#[test]
fn scan_main_must_be_regular_file_inside() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let d = make_plugin(&r.user, "p", &minimal("p-one"));
    fs::remove_file(d.join("main.js")).unwrap();
    fs::write(tmp.path().join("evil.js"), "x").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(tmp.path().join("evil.js"), d.join("main.js")).unwrap();
    let s = scan::scan(&r, None, APP);
    assert!(s.list.plugins.is_empty());
    assert!(s.list.errors[0].message.contains("regular file"), "{:?}", s.list.errors);
}

#[test]
fn duplicate_ids_user_wins_over_bundled_and_second_user_errors() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(&r.user, "a", &minimal("same"));
    make_plugin(&r.user, "b", &minimal("same"));
    make_plugin(r.bundled.as_ref().unwrap(), "c", &minimal("same"));
    make_plugin(r.bundled.as_ref().unwrap(), "d", &minimal("only-bundled"));
    let s = scan::scan(&r, None, APP);
    assert_eq!(s.list.plugins.len(), 2);
    assert_eq!(s.index["same"].source, Source::User);
    assert!(s.index["same"].dir.ends_with("a"));
    assert_eq!(s.index["only-bundled"].source, Source::Bundled);
    assert_eq!(s.list.errors.len(), 1);
    assert!(s.list.errors[0].dir.ends_with("b") && s.list.errors[0].message.contains("Duplicate"));
}

#[test]
fn incompatible_plugin_is_listed_with_a_problem() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(&r.user, "p", &format!("{}min_app = \"9.0.0\"\n", minimal("p-one")));
    let s = scan::scan(&r, None, APP);
    assert_eq!(s.list.plugins[0].problem.as_deref(), Some("Needs app \u{2265} 9.0.0"));
    assert!(!s.list.plugins[0].compatible);
}

#[test]
fn warm_scan_uses_cache_and_changes_invalidate_it() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let cache = tmp.path().join("state/plugins-cache.json");
    let d = make_plugin(&r.user, "p", &minimal("p-one"));
    make_plugin(&r.user, "q", &minimal("q-one"));
    assert_eq!(scan::scan(&r, Some(&cache), APP).parsed, 2);
    assert!(cache.is_file());
    let warm = scan::scan(&r, Some(&cache), APP);
    assert_eq!((warm.parsed, warm.list.plugins.len()), (0, 2));
    fs::write(d.join("plugin.toml"), format!("{}description = \"changed\"\n", minimal("p-one"))).unwrap();
    let s = scan::scan(&r, Some(&cache), APP);
    assert_eq!(s.parsed, 1);
    assert_eq!(s.list.plugins.iter().find(|p| p.manifest.id == "p-one").unwrap().manifest.description.as_deref(), Some("changed"));
    // A different app version drops the cache.
    assert_eq!(scan::scan(&r, Some(&cache), "9.9.9").parsed, 2);
    // A corrupt cache is ignored.
    fs::write(&cache, "{nope").unwrap();
    assert_eq!(scan::scan(&r, Some(&cache), APP).parsed, 2);
}

#[test]
fn warm_scan_still_notices_a_deleted_main() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let cache = tmp.path().join("c.json");
    let d = make_plugin(&r.user, "p", &minimal("p-one"));
    scan::scan(&r, Some(&cache), APP);
    fs::remove_file(d.join("main.js")).unwrap();
    let s = scan::scan(&r, Some(&cache), APP);
    assert!(s.list.plugins.is_empty() && s.list.errors.len() == 1);
}

// ---- scheme ----

struct Site {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    index: Index,
}

fn site() -> Site {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let d = make_plugin(&r.user, "hello", &minimal("hello"));
    fs::create_dir_all(d.join("assets")).unwrap();
    fs::write(d.join("assets/a.css"), "body{}").unwrap();
    fs::write(d.join("data.txt"), "t").unwrap();
    fs::write(tmp.path().join("secret.js"), "secret").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(tmp.path().join("secret.js"), d.join("leak.js")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(tmp.path(), d.join("up")).unwrap();
    let index = scan::scan(&r, None, APP).index;
    Site { root: d, index, _tmp: tmp }
}

fn status(s: &Site, path: &str) -> u16 {
    scheme::respond("GET", None, path, &s.index).status().as_u16()
}

#[test]
fn serves_allowed_files_with_headers() {
    let s = site();
    let r = scheme::respond("GET", Some("tauri://localhost"), "/hello/main.js", &s.index);
    assert_eq!(r.status(), 200);
    assert_eq!(r.body().as_ref(), b"export default {};");
    let h = r.headers();
    assert_eq!(h["content-type"], "text/javascript; charset=utf-8");
    assert_eq!(h["access-control-allow-origin"], "tauri://localhost");
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(h["cache-control"], "no-cache");
    assert_eq!(status(&s, "/hello/assets/a.css"), 200);
    let foreign = scheme::respond("GET", Some("https://evil.example"), "/hello/main.js", &s.index);
    assert!(foreign.headers().get("access-control-allow-origin").is_none());
    assert!(scheme::respond("GET", None, "/hello/main.js", &s.index).headers().get("access-control-allow-origin").is_none());
}

#[test]
fn rejects_traversal_and_bad_paths() {
    let s = site();
    for p in [
        "/hello/../secret.js", "/hello/%2e%2e/secret.js", "/hello/%2E%2E/secret.js", "/hello/%252e%252e/secret.js",
        "/hello/a/../main.js", "/hello/./main.js", "/hello//main.js", "/hello/..%2fsecret.js", "/hello/a%5cb.js",
        "/hello/main.js%00", "/hello/a\\b.js", "/hello/%00", "/hello/", "/hello", "/", "", "/hello/%zz.js", "/hello/C:/x.js",
    ] {
        assert_eq!(status(&s, p), 400, "{p}");
    }
}

#[test]
fn unknown_id_missing_file_and_refused_files() {
    let s = site();
    assert_eq!(status(&s, "/nope/main.js"), 404);
    assert_eq!(status(&s, "/Hello/main.js"), 400);
    assert_eq!(status(&s, "/hello/missing.js"), 404);
    assert_eq!(status(&s, "/hello/plugin.toml"), 403);
    assert_eq!(status(&s, "/hello/PLUGIN.TOML"), 403);
    assert_eq!(status(&s, "/hello/data.txt"), 403);
    assert_eq!(status(&s, "/hello/assets"), 403);
}

#[cfg(unix)]
#[test]
fn symlinks_are_refused() {
    let s = site();
    assert_eq!(status(&s, "/hello/leak.js"), 403);
    assert_eq!(status(&s, "/hello/up/secret.js"), 403);
}

#[test]
fn oversize_file_refused() {
    let s = site();
    let f = fs::File::create(s.root.join("big.js")).unwrap();
    f.set_len(scheme::MAX_FILE_BYTES + 1).unwrap();
    assert_eq!(status(&s, "/hello/big.js"), 413);
}

#[test]
fn mime_table() {
    for (name, mime) in [
        ("a.js", "text/javascript; charset=utf-8"), ("a.MJS", "text/javascript; charset=utf-8"), ("a.css", "text/css; charset=utf-8"),
        ("a.json", "application/json"), ("a.js.map", "application/json"), ("a.png", "image/png"), ("a.svg", "image/svg+xml"),
        ("a.woff2", "font/woff2"), ("a.wasm", "application/wasm"),
    ] {
        assert_eq!(scheme::mime_for(name), Some(mime), "{name}");
    }
    for name in ["a.toml", "a.html", "a.exe", "noext", "a."] {
        assert_eq!(scheme::mime_for(name), None, "{name}");
    }
}

#[test]
fn options_and_methods() {
    let s = site();
    let o = scheme::respond("OPTIONS", Some("http://vdplugin.localhost"), "/hello/main.js", &s.index);
    assert_eq!(o.status(), 204);
    assert_eq!(o.headers()["access-control-allow-origin"], "http://vdplugin.localhost");
    assert!(o.headers().contains_key("access-control-allow-methods"));
    for m in ["POST", "PUT", "DELETE", "HEAD", "PATCH"] {
        assert_eq!(scheme::respond(m, None, "/hello/main.js", &s.index).status(), 405, "{m}");
    }
}

// ---- install ----

fn source_folder(tmp: &Path, name: &str, id: &str) -> PathBuf {
    let d = make_plugin(tmp, name, &minimal(id));
    fs::create_dir_all(d.join("lib")).unwrap();
    fs::write(d.join("lib/util.js"), "u").unwrap();
    d
}

fn list_names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

#[test]
fn install_copies_and_skips_unwanted_entries() {
    let tmp = tempdir().unwrap();
    let src = source_folder(tmp.path(), "src", "inst-one");
    fs::create_dir_all(src.join(".git")).unwrap();
    fs::write(src.join(".git/HEAD"), "x").unwrap();
    fs::create_dir_all(src.join("node_modules/dep")).unwrap();
    fs::write(src.join(".env"), "SECRET").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(tmp.path().join("src/main.js"), src.join("link.js")).unwrap();
    let user = tmp.path().join("cfg/plugins");
    let info = install::install_folder(&user, &src, APP).unwrap();
    assert_eq!((info.manifest.id.as_str(), info.source), ("inst-one", Source::User));
    assert_eq!(list_names(&user), ["inst-one"]);
    assert_eq!(list_names(&user.join("inst-one")), ["lib", "main.js", "plugin.toml"]);
}

#[test]
fn install_replaces_same_id_and_refuses_other_folder() {
    let tmp = tempdir().unwrap();
    let src = source_folder(tmp.path(), "src", "inst-one");
    let user = tmp.path().join("cfg/plugins");
    install::install_folder(&user, &src, APP).unwrap();
    fs::write(src.join("main.js"), "export default { v: 2 };").unwrap();
    fs::remove_file(src.join("lib/util.js")).unwrap();
    install::install_folder(&user, &src, APP).unwrap();
    assert_eq!(fs::read_to_string(user.join("inst-one/main.js")).unwrap(), "export default { v: 2 };");
    assert!(!user.join("inst-one/lib/util.js").exists());
    assert_eq!(list_names(&user), ["inst-one"]);
    // A different plugin sitting in the folder named after the id is not overwritten.
    fs::remove_dir_all(user.join("inst-one")).unwrap();
    make_plugin(&user, "inst-one", &minimal("another"));
    let e = install::install_folder(&user, &src, APP).unwrap_err();
    assert_eq!(e.code, "NAME_COLLISION");
    assert_eq!(list_names(&user), ["inst-one"]);
}

#[test]
fn install_validates_first_and_cleans_staging() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let bad_src = make_plugin(tmp.path(), "bad", "id = ");
    assert!(install::install_folder(&user, &bad_src, APP).is_err());
    assert!(!user.exists() || list_names(&user).is_empty());
    // main inside a skipped folder fails after copy; staging must be removed.
    let hidden = make_plugin(tmp.path(), "hid", &minimal("hid-one").replace("main.js", ".dist/main.js"));
    fs::remove_file(hidden.join("main.js")).unwrap();
    fs::create_dir_all(hidden.join(".dist")).unwrap();
    fs::write(hidden.join(".dist/main.js"), "x").unwrap();
    assert!(install::install_folder(&user, &hidden, APP).is_err());
    assert!(list_names(&user).is_empty(), "{:?}", list_names(&user));
}

#[test]
fn install_caps() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let many = source_folder(tmp.path(), "many", "many-one");
    for i in 0..2000 {
        fs::write(many.join(format!("f{i}.js")), "").unwrap();
    }
    assert!(install::install_folder(&user, &many, APP).unwrap_err().message.contains("too large"));
    let big = source_folder(tmp.path(), "big", "big-one");
    fs::File::create(big.join("huge.js")).unwrap().set_len(21 * 1024 * 1024).unwrap();
    assert!(install::install_folder(&user, &big, APP).unwrap_err().message.contains("20 MB"));
    let total = source_folder(tmp.path(), "total", "total-one");
    for i in 0..3 {
        fs::File::create(total.join(format!("p{i}.js"))).unwrap().set_len(19 * 1024 * 1024).unwrap();
    }
    assert!(install::install_folder(&user, &total, APP).unwrap_err().message.contains("too large"));
    assert!(list_names(&user).is_empty(), "{:?}", list_names(&user));
}

#[test]
fn uninstall_only_direct_children_of_user_root() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let src = source_folder(tmp.path(), "src", "gone-one");
    install::install_folder(&user, &src, APP).unwrap();
    let outside = make_plugin(tmp.path(), "outside", &minimal("out-one"));
    assert!(install::uninstall_dir(&user, &outside).is_err());
    assert!(outside.exists());
    assert!(install::uninstall_dir(&user, &user).is_err());
    let nested = user.join("gone-one/lib");
    assert!(install::uninstall_dir(&user, &nested).is_err());
    assert!(install::uninstall_dir(&user, &user.join("gone-one/../../outside")).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, user.join("sneaky")).unwrap();
        assert!(install::uninstall_dir(&user, &user.join("sneaky")).is_err());
        assert!(outside.exists());
    }
    install::uninstall_dir(&user, &user.join("gone-one")).unwrap();
    assert!(!user.join("gone-one").exists());
}

#[test]
fn uninstall_refuses_bundled_and_unknown() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(r.bundled.as_ref().unwrap(), "b", &minimal("bund-one"));
    let s = scan::scan(&r, None, APP);
    assert!(install::uninstall(&r.user, s.index.get("bund-one")).is_err());
    assert_eq!(install::uninstall(&r.user, s.index.get("zzz")).unwrap_err().code, "NOT_FOUND");
    assert!(r.bundled.unwrap().join("b").exists());
}

// ---- state ----

#[test]
fn state_round_trip_and_tolerant_reader() {
    use super::state;
    let tmp = tempdir().unwrap();
    let dir = tmp.path().join("state");
    assert!(state::load(&dir).is_empty());
    state::set_host_disabled(&dir, "ab", Some("3 errors".into())).unwrap();
    state::set_host_disabled(&dir, "cd", Some("x".into())).unwrap();
    assert_eq!(state::load(&dir)["ab"], "3 errors");
    state::set_host_disabled(&dir, "ab", None).unwrap();
    assert_eq!(state::load(&dir).len(), 1);
    assert!(state::set_host_disabled(&dir, "../x", None).is_err());
    fs::write(dir.join("plugins-state.json"), "{broken").unwrap();
    assert!(state::load(&dir).is_empty());
    fs::write(dir.join("plugins-state.json"), "{}").unwrap();
    assert!(state::load(&dir).is_empty());
    assert!(list_names(&dir).iter().all(|n| !n.contains("tmp")));
}

// ---- perf (ignored) ----

#[test]
#[ignore]
fn perf_scan_50_plugins() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    let cache = tmp.path().join("state/plugins-cache.json");
    for i in 0..50 {
        let mut t = minimal(&format!("perf-{i}"));
        for c in 0..3 {
            t.push_str(&format!("[[contributes.commands]]\nid = \"c{c}\"\ntitle = \"Command {c}\"\nkeys = [\"Mod+Alt+{c}\"]\nwhen = [\"vaultOpen\"]\n"));
        }
        t.push_str("[[contributes.panels]]\nid = \"p\"\ntitle = \"Panel\"\nicon = \"note\"\n");
        for s in 0..4 {
            t.push_str(&format!("[[contributes.settings]]\nkey = \"s{s}\"\ntype = \"string\"\ntitle = \"S\"\ndefault = \"v\"\n"));
        }
        make_plugin(&r.user, &format!("perf-{i}"), &t);
    }
    let t = Instant::now();
    let cold = scan::scan(&r, Some(&cache), APP);
    println!("cold scan: {:.2} ms (internal {:.2} ms, parsed {})", t.elapsed().as_secs_f64() * 1e3, cold.list.scan_ms, cold.parsed);
    for n in 0..3 {
        let t = Instant::now();
        let warm = scan::scan(&r, Some(&cache), APP);
        println!("warm scan {n}: {:.2} ms (internal {:.2} ms, parsed {})", t.elapsed().as_secs_f64() * 1e3, warm.list.scan_ms, warm.parsed);
    }
}

#[test]
fn smoke_fixture_manifests_parse() {
    for id in ["smoke-hello", "smoke-panel"] {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../src/smoke/plugins/{id}/plugin.toml"));
        let m = manifest::parse(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(m.id, id);
    }
}

#[test]
fn dev_flag_defaults_to_false_and_parses() {
    assert!(!manifest::parse(&minimal("plain")).unwrap().dev);
    let dev = format!("{}dev = true\n", minimal("devp"));
    assert!(manifest::parse(&dev).unwrap().dev);
    assert!(manifest::parse(&format!("{}dev = \"yes\"\n", minimal("bad"))).is_err());
}

/// Every plugin.toml shipped as an example, smoke plugin or e2e fixture must
/// pass the real manifest parser. Missing folders are skipped.
#[test]
fn shipped_plugin_manifests_parse() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repo root");
    let parents = [
        "sdk/examples",
        "excalidraw-desktop/src/smoke/plugins",
        "excalidraw-desktop/e2e/fixtures/plugins",
    ];
    let mut failures = Vec::new();
    for parent in parents {
        let Ok(entries) = fs::read_dir(root.join(parent)) else {
            continue;
        };
        for entry in entries.flatten() {
            let file = entry.path().join("plugin.toml");
            let Ok(text) = fs::read_to_string(&file) else {
                continue;
            };
            if let Err(e) = manifest::parse(&text) {
                failures.push(format!("{}: {e}", file.display()));
            }
        }
    }
    assert!(failures.is_empty(), "invalid manifests:\n{}", failures.join("\n"));
}

#[test]
fn a_cancelled_restart_is_forgotten() {
    RESTART_PENDING.store(true, Ordering::SeqCst);
    assert!(clear_restart());
    assert!(!RESTART_PENDING.load(Ordering::SeqCst));
    assert!(!clear_restart(), "nothing left to cancel");
}

// ---- Manifest corpus shared with the plugin SDK command line tool ----

fn corpus_dir(sub: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sdk/api/test/manifests").join(sub)
}

/// `(file name, text, code header, rust header)` for every `.toml` in a corpus folder.
fn corpus_files(sub: &str) -> Vec<(String, String, String, String)> {
    let mut out = Vec::new();
    for e in fs::read_dir(corpus_dir(sub)).expect("corpus folder") {
        let p = e.unwrap().path();
        if p.extension().is_none_or(|x| x != "toml") {
            continue;
        }
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        let text = fs::read_to_string(&p).unwrap();
        let header = |key: &str| {
            text.lines()
                .take_while(|l| l.starts_with('#'))
                .find_map(|l| l.strip_prefix(key))
                .map(|v| v.trim().to_string())
                .unwrap_or_else(|| panic!("{name}: missing header '{key}'"))
        };
        let (code, rust) = (header("# code:"), header("# rust:"));
        out.push((name, text, code, rust));
    }
    out
}

#[test]
fn manifest_corpus_ok_files_parse() {
    let files = corpus_files("ok");
    assert!(!files.is_empty(), "ok corpus is empty");
    for (name, text, code, rust) in files {
        assert_eq!(code, "none", "{name}: ok files use '# code: none'");
        assert_eq!(rust, "ok", "{name}: ok files use '# rust: ok'");
        if let Err(e) = manifest::parse(&text) {
            panic!("{name}: should parse but failed: {e}");
        }
    }
}

#[test]
fn manifest_corpus_bad_files_match_expectation() {
    let files = corpus_files("bad");
    assert!(!files.is_empty(), "bad corpus is empty");
    for (name, text, code, rust) in files {
        assert!(!code.is_empty() && code != "none", "{name}: bad files need a real code");
        let parsed = manifest::parse(&text);
        if rust == "ok" {
            assert!(parsed.is_ok(), "{name}: Rust should accept it, got {:?}", parsed.err());
        } else if let Some(want) = rust.strip_prefix("compat ") {
            let m = parsed.unwrap_or_else(|e| panic!("{name}: should parse, got {e}"));
            let (ok, problem) = manifest::compatibility(&m, APP);
            let problem = problem.unwrap_or_default();
            assert!(!ok, "{name}: should be incompatible");
            assert!(problem.to_lowercase().contains(&want.to_lowercase()), "{name}: '{problem}' lacks '{want}'");
        } else {
            let err = parsed.err().unwrap_or_else(|| panic!("{name}: Rust should reject it"));
            assert!(err.to_lowercase().contains(&rust.to_lowercase()), "{name}: '{err}' lacks '{rust}'");
        }
    }
}

#[test]
fn manifest_corpus_example_plugins_parse() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sdk/examples");
    let mut n = 0;
    for e in fs::read_dir(&root).expect("sdk/examples") {
        let p = e.unwrap().path().join("plugin.toml");
        if let Ok(text) = fs::read_to_string(&p) {
            n += 1;
            if let Err(err) = manifest::parse(&text) {
                panic!("{}: {err}", p.display());
            }
        }
    }
    assert!(n >= 5, "expected the five example manifests, found {n}");
}

// ---- permissions and the consent record ----

fn perms(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn permissions_default_to_none_and_parse() {
    assert!(manifest::parse(&minimal("plain")).unwrap().permissions.is_empty());
    let m = manifest::parse(&with("permissions = [\"vault.read\", \"vault.write\"]\n")).unwrap();
    assert_eq!(m.permissions, perms(&["vault.read", "vault.write"]));
    let json = serde_json::to_value(&m).unwrap();
    assert_eq!(json["permissions"], serde_json::json!(["vault.read", "vault.write"]));
}

#[test]
fn permission_rules() {
    bad(&with("permissions = [\"vault.delete\"]\n"), "unknown permission");
    for reserved in ["net", "secret", "control"] {
        bad(&with(&format!("permissions = [\"{reserved}\"]\n")), "reserved");
    }
    bad(&with("permissions = [\"vault.read\", \"vault.read\"]\n"), "duplicate permission");
    let nine = vec!["\"vault.read\""; 9].join(", ");
    bad(&with(&format!("permissions = [{nine}]\n")), "too many permissions");
    bad(&with("permissions = \"vault.read\"\n"), "permissions");
}

#[test]
fn old_scan_cache_entries_without_permissions_still_load() {
    let json = serde_json::to_value(manifest::parse(&minimal("plain")).unwrap()).unwrap();
    let mut old = json.clone();
    old.as_object_mut().unwrap().remove("permissions");
    let m: manifest::Manifest = serde_json::from_value(old).unwrap();
    assert!(m.permissions.is_empty());
}

#[test]
fn review_compares_declared_with_confirmed() {
    use consent::ReviewState::{Notice, Ok, Review};
    let r = |declared: &[&str], confirmed: Option<&[&str]>, bundled| {
        let c = confirmed.map(perms);
        consent::review(&perms(declared), c.as_ref(), bundled)
    };
    assert_eq!(r(&[], None, false).state, Ok, "nothing declared needs no record");
    assert_eq!(r(&["vault.read"], Some(&["vault.read"]), false).state, Ok);
    assert_eq!(r(&["vault.read"], Some(&["vault.read", "vault.write"]), false).state, Ok, "fewer is fine");
    let n = r(&["vault.read"], None, false);
    assert_eq!((n.state, n.added), (Notice, perms(&["vault.read"])), "a new read permission is a notice");
    let w = r(&["vault.read", "vault.write"], Some(&["vault.read"]), false);
    assert_eq!((w.state, w.added), (Review, perms(&["vault.write"])), "an added write needs review");
    assert_eq!(r(&["vault.write"], None, false).state, Review, "never confirmed counts as nothing confirmed");
    assert_eq!(r(&["vault.write"], None, true).state, Ok, "bundled plugins need no prompt");
}

#[test]
fn consent_record_round_trips_and_tolerates_damage() {
    let dir = tempdir().unwrap();
    let state = dir.path();
    assert!(consent::load(state).is_empty(), "missing file");
    consent::confirm(state, "demo-plugin", &perms(&["vault.write"])).unwrap();
    consent::confirm(state, "other", &perms(&[])).unwrap();
    let rec = consent::load(state);
    assert_eq!(rec["demo-plugin"], perms(&["vault.write"]));
    assert_eq!(rec["other"], Vec::<String>::new());
    consent::confirm(state, "demo-plugin", &perms(&["vault.read"])).unwrap();
    assert_eq!(consent::load(state)["demo-plugin"], perms(&["vault.read"]), "a confirm replaces the set");
    consent::forget(state, "demo-plugin").unwrap();
    consent::forget(state, "never-there").unwrap();
    assert!(!consent::load(state).contains_key("demo-plugin"));
    assert!(consent::confirm(state, "../evil", &[]).is_err(), "ids are validated");
    fs::write(state.join("plugin-consent.json"), "{ not json").unwrap();
    assert!(consent::load(state).is_empty(), "corrupt file means nothing confirmed");
}
