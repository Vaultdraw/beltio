use super::{consent, install, manifest, scan, scheme};
use scan::{Index, Roots, Source};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, time::Instant};
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
fn duplicate_user_ids_error_and_a_user_plugin_cannot_take_a_bundled_id() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(&r.user, "a", &minimal("same"));
    make_plugin(&r.user, "b", &minimal("same"));
    make_plugin(&r.user, "x", &minimal("official"));
    make_plugin(r.bundled.as_ref().unwrap(), "o", &minimal("official"));
    let s = scan::scan(&r, None, APP);
    assert_eq!(s.list.plugins.len(), 2);
    assert_eq!(s.index["official"].source, Source::Bundled, "the official plugin stays");
    assert!(s.index["official"].dir.ends_with("o"));
    assert_eq!(s.index["same"].source, Source::User);
    assert!(s.index["same"].dir.ends_with("a"));
    assert_eq!(s.list.errors.len(), 2, "{:?}", s.list.errors);
    let err = |dir: &str| s.list.errors.iter().find(|e| e.dir.ends_with(dir)).unwrap().message.clone();
    assert!(err("b").contains("Duplicate"));
    assert!(err("x").contains("official plugin id"), "{}", err("x"));
}

#[test]
fn a_dev_plugin_may_shadow_a_bundled_one() {
    let tmp = tempdir().unwrap();
    let r = roots(tmp.path());
    make_plugin(&r.user, "mine", &format!("{}dev = true\n", minimal("official")));
    make_plugin(r.bundled.as_ref().unwrap(), "o", &minimal("official"));
    make_plugin(r.bundled.as_ref().unwrap(), "p", &minimal("other"));
    let s = scan::scan(&r, None, APP);
    assert_eq!(s.list.plugins.len(), 2);
    assert_eq!(s.list.plugins.iter().filter(|p| p.manifest.id == "official").count(), 1);
    assert_eq!(s.index["official"].source, Source::User);
    assert!(s.list.errors.is_empty(), "{:?}", s.list.errors);
}

#[test]
fn install_refuses_a_built_in_command_group_as_an_id() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    for id in ["vault", "file", "view", "config", "uri", "control", "ai"] {
        let src = source_folder(tmp.path(), &format!("src-{id}"), id);
        let e = install::install_folder(&user, &src, APP, &HashSet::new()).unwrap_err();
        assert_eq!(e.code, "NAME_COLLISION", "{id}");
        assert!(e.message.contains("command group"), "{}", e.message);
    }
    assert!(!user.exists() || fs::read_dir(&user).unwrap().count() == 0);
    install::install_folder(&user, &source_folder(tmp.path(), "ok", "vault-tools"), APP, &HashSet::new()).unwrap();
}

#[test]
fn security_a_folder_install_over_an_existing_id_forgets_the_old_consent() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let state = tmp.path().join("state");
    let none = HashSet::new();
    install::install_folder_with_fresh_consent(&state, &user, &source_folder(tmp.path(), "v1", "lookalike"), APP, &none).unwrap();
    consent::confirm(&state, "lookalike", &perms(&["vault.read"])).unwrap();
    consent::confirm(&state, "other", &perms(&[])).unwrap();
    assert!(consent::load(&state).contains_key("lookalike"));
    // "My fixed copy": same id, different code. The old record must not carry over.
    install::install_folder_with_fresh_consent(&state, &user, &source_folder(tmp.path(), "v2", "lookalike"), APP, &none).unwrap();
    let rec = consent::load(&state);
    assert!(!rec.contains_key("lookalike"), "the new code asks again");
    assert!(rec.contains_key("other"), "other plugins keep theirs");
}

#[test]
fn install_refuses_an_official_id_unless_dev() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let official: HashSet<String> = ["graph".to_string()].into();
    let src = source_folder(tmp.path(), "src", "graph");
    let e = install::install_folder(&user, &src, APP, &official).unwrap_err();
    assert_eq!(e.code, "NAME_COLLISION");
    assert!(e.message.contains("official plugin id"), "{}", e.message);
    assert!(!user.join("graph").exists(), "nothing was copied");
    install::install_folder(&user, &source_folder(tmp.path(), "src2", "graph-two"), APP, &official).unwrap();
    let dev = source_folder(tmp.path(), "src3", "graph");
    let text = fs::read_to_string(dev.join("plugin.toml")).unwrap();
    fs::write(dev.join("plugin.toml"), format!("{text}dev = true\n")).unwrap();
    install::install_folder(&user, &dev, APP, &official).unwrap();
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
    let info = install::install_folder(&user, &src, APP, &HashSet::new()).unwrap();
    assert_eq!((info.manifest.id.as_str(), info.source), ("inst-one", Source::User));
    assert_eq!(list_names(&user), ["inst-one"]);
    assert_eq!(list_names(&user.join("inst-one")), ["lib", "main.js", "plugin.toml"]);
}

#[test]
fn install_replaces_same_id_and_refuses_other_folder() {
    let tmp = tempdir().unwrap();
    let src = source_folder(tmp.path(), "src", "inst-one");
    let user = tmp.path().join("cfg/plugins");
    install::install_folder(&user, &src, APP, &HashSet::new()).unwrap();
    fs::write(src.join("main.js"), "export default { v: 2 };").unwrap();
    fs::remove_file(src.join("lib/util.js")).unwrap();
    install::install_folder(&user, &src, APP, &HashSet::new()).unwrap();
    assert_eq!(fs::read_to_string(user.join("inst-one/main.js")).unwrap(), "export default { v: 2 };");
    assert!(!user.join("inst-one/lib/util.js").exists());
    assert_eq!(list_names(&user), ["inst-one"]);
    // A different plugin sitting in the folder named after the id is not overwritten.
    fs::remove_dir_all(user.join("inst-one")).unwrap();
    make_plugin(&user, "inst-one", &minimal("another"));
    let e = install::install_folder(&user, &src, APP, &HashSet::new()).unwrap_err();
    assert_eq!(e.code, "NAME_COLLISION");
    assert_eq!(list_names(&user), ["inst-one"]);
}

#[test]
fn install_validates_first_and_cleans_staging() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let bad_src = make_plugin(tmp.path(), "bad", "id = ");
    assert!(install::install_folder(&user, &bad_src, APP, &HashSet::new()).is_err());
    assert!(!user.exists() || list_names(&user).is_empty());
    // main inside a skipped folder fails after copy; staging must be removed.
    let hidden = make_plugin(tmp.path(), "hid", &minimal("hid-one").replace("main.js", ".dist/main.js"));
    fs::remove_file(hidden.join("main.js")).unwrap();
    fs::create_dir_all(hidden.join(".dist")).unwrap();
    fs::write(hidden.join(".dist/main.js"), "x").unwrap();
    assert!(install::install_folder(&user, &hidden, APP, &HashSet::new()).is_err());
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
    assert!(install::install_folder(&user, &many, APP, &HashSet::new()).unwrap_err().message.contains("too large"));
    let big = source_folder(tmp.path(), "big", "big-one");
    fs::File::create(big.join("huge.js")).unwrap().set_len(21 * 1024 * 1024).unwrap();
    assert!(install::install_folder(&user, &big, APP, &HashSet::new()).unwrap_err().message.contains("20 MB"));
    let total = source_folder(tmp.path(), "total", "total-one");
    for i in 0..3 {
        fs::File::create(total.join(format!("p{i}.js"))).unwrap().set_len(19 * 1024 * 1024).unwrap();
    }
    assert!(install::install_folder(&user, &total, APP, &HashSet::new()).unwrap_err().message.contains("too large"));
    assert!(list_names(&user).is_empty(), "{:?}", list_names(&user));
}

#[test]
fn uninstall_only_direct_children_of_user_root() {
    let tmp = tempdir().unwrap();
    let user = tmp.path().join("cfg/plugins");
    let src = source_folder(tmp.path(), "src", "gone-one");
    install::install_folder(&user, &src, APP, &HashSet::new()).unwrap();
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
fn data_key_is_optional_and_checked() {
    let plain = manifest::parse(&minimal("plain")).unwrap();
    assert_eq!(plain.data_key, None);
    assert!(serde_json::to_value(&plain).unwrap()["dataKey"].is_null());
    for ok in ["latex", "plugins.my-plugin", "a_b.c-d.e1"] {
        let m = manifest::parse(&with(&format!("data_key = \"{ok}\"\n"))).unwrap();
        assert_eq!(m.data_key.as_deref(), Some(ok));
        assert_eq!(serde_json::to_value(&m).unwrap()["dataKey"], serde_json::json!(ok));
    }
    let long = "a".repeat(65);
    for bad_key in ["", "Latex", "1abc", "a..b", "a.", ".a", "a b", "a/b", long.as_str()] {
        bad(&with(&format!("data_key = \"{bad_key}\"\n")), "data_key");
    }
    bad(&with("data_key = 3\n"), "data_key");
    // `plugins.` keys belong to the plugin of that id ("my-plugin" in `with`).
    bad(&with("data_key = \"plugins.flow-diagram\"\n"), "belongs to another plugin");
    bad(&with("data_key = \"plugins\"\n"), "belongs to another plugin");
}

#[test]
fn permission_rules() {
    bad(&with("permissions = [\"vault.delete\"]\n"), "unknown permission");
    for reserved in ["net", "secret"] {
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
    assert_eq!(r(&[], Some(&[]), false).state, Ok, "reviewed with nothing declared needs nothing more");
    let none = r(&[], None, false);
    assert_eq!((none.state, none.added), (Review, Vec::<String>::new()), "never confirmed needs a review even with no permissions");
    assert_eq!(r(&[], None, true).state, Ok, "bundled plugins never need a record");
    assert_eq!(r(&["vault.read"], Some(&["vault.read"]), false).state, Ok);
    assert_eq!(r(&["vault.read"], Some(&["vault.read", "vault.write"]), false).state, Ok, "fewer is fine");
    let n = r(&["vault.read"], None, false);
    assert_eq!((n.state, n.added), (Review, perms(&["vault.read"])), "never confirmed needs a review, read-only or not");
    let n = r(&["vault.read", "clipboard"], Some(&["vault.read"]), false);
    assert_eq!((n.state, n.added), (Notice, perms(&["clipboard"])), "a new read permission to a confirmed plugin is a notice");
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
    consent::confirm(state, "demo-plugin", &perms(&["vault.read", "vault.write"])).unwrap();
    consent::prune(state, "demo-plugin", &perms(&["vault.read"])).unwrap();
    assert_eq!(consent::load(state)["demo-plugin"], perms(&["vault.read"]), "a dropped permission leaves the record");
    consent::prune(state, "never-there", &[]).unwrap();
    consent::forget(state, "demo-plugin").unwrap();
    consent::forget(state, "never-there").unwrap();
    assert!(!consent::load(state).contains_key("demo-plugin"));
    assert!(consent::confirm(state, "../evil", &[]).is_err(), "ids are validated");
    fs::write(state.join("plugin-consent.json"), "{ not json").unwrap();
    assert!(consent::load(state).is_empty(), "corrupt file means nothing confirmed");
    assert!(state.join("plugin-consent.json.corrupt").exists(), "the damaged file is kept, not deleted");
    assert!(!state.join("plugin-consent.json").exists(), "and moved out of the way");
    assert!(consent::take_reset(), "the next list says so once");
    assert!(!consent::take_reset());
}

// ---- P4a2: the gateway allowlist, consent check and storage.global ----

use super::{gateway, storage};

fn info_with(id: &str, permissions: &str, source: Source) -> scan::PluginInfo {
    let d = tempdir().unwrap();
    let dir = d.path().join(id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.toml"), format!("{}permissions = [{permissions}]\n", minimal(id))).unwrap();
    fs::write(dir.join("main.js"), "export default {}").unwrap();
    scan::info_for_dir(&dir, source, APP).unwrap()
}

fn record(id: &str, perms: &[&str]) -> consent::Record {
    let mut r = consent::Record::new();
    r.insert(id.into(), perms.iter().map(|s| s.to_string()).collect());
    r
}

#[test]
fn gateway_allowlist_maps_methods_to_permissions() {
    let rows: Vec<(&str, Option<&str>)> = gateway::ALLOWLIST.iter().map(|r| (r.method, r.permission)).collect();
    assert_eq!(
        rows,
        vec![
            ("vault.list", Some("vault.read")),
            ("file.read", Some("vault.read")),
            ("file.write", Some("vault.write")),
            ("vault.graph", Some("vault.read")),
            ("vault.graphLayout.load", Some("vault.read")),
            ("vault.graphLayout.save", Some("vault.write")),
            ("export.write", Some("vault.write")),
            ("export.move", Some("vault.write")),
            ("export.remove", Some("vault.write")),
            ("vault.settings.read", Some("vault.read")),
            ("vault.settings.update", Some("vault.write")),
            ("pdf.pick", Some("pdf")),
            ("pdf.open", Some("pdf")),
            ("pdf.render", Some("pdf")),
            ("pdf.unlock", Some("pdf")),
            ("pdf.close", Some("pdf")),
            ("network.askImages", Some("network.images")),
            ("network.fetchImage", Some("network.images")),
            ("storage.read", None),
            ("storage.write", None),
            ("markdown.parse", None),
            ("folders.pickSource", Some("folders.import")),
            ("folders.list", Some("folders.import")),
            ("folders.readText", Some("folders.import")),
            ("folders.readBytes", Some("folders.import")),
            ("folders.pickNewVault", Some("folders.import")),
            ("folders.vaultTarget", Some("folders.import")),
            ("folders.writeDrawing", Some("folders.import")),
            ("folders.copy", Some("folders.import")),
            ("folders.convertDrawing", Some("folders.import")),
            ("folders.release", Some("folders.import")),
        ]
    );
    // The folders rows and the module that serves them name the same methods.
    let folders: Vec<&str> = gateway::ALLOWLIST.iter().filter(|r| r.route == gateway::Route::Folders).map(|r| r.method).collect();
    assert_eq!(folders, crate::import_folder::ROWS);
    // Every permission a row needs is a name the manifest accepts.
    for r in gateway::ALLOWLIST {
        if let Some(p) = r.permission {
            assert!(manifest::parse(&format!("{}permissions = [\"{p}\"]\n", minimal("ab"))).is_ok(), "{p}");
        }
    }
}

#[test]
fn gateway_refuses_unknown_methods_and_plugins() {
    let none = consent::Record::new();
    let p = info_with("reader", "\"vault.read\"", Source::User);
    let e = gateway::authorize("config.set", "reader", Some(&p), || none.clone()).unwrap_err();
    assert_eq!(e.code, "NOT_FOUND");
    let e = gateway::authorize("app.quit", "reader", Some(&p), || none.clone()).unwrap_err();
    assert_eq!(e.code, "NOT_FOUND");
    let e = gateway::authorize("storage.read", "ghost", None, || none.clone()).unwrap_err();
    assert_eq!(e.code, "NOT_FOUND");
    let unread = || -> consent::Record { panic!("free rows must not read the consent file") };
    assert!(gateway::authorize("storage.read", "reader", Some(&p), unread).is_ok(), "storage is free");
}

#[test]
fn gateway_checks_declared_and_confirmed_permissions() {
    let p = info_with("reader", "\"vault.read\"", Source::User);
    let none = consent::Record::new();
    // Declared but never confirmed.
    let e = gateway::authorize("vault.list", "reader", Some(&p), || none.clone()).unwrap_err();
    assert_eq!((e.code.as_str(), e.detail["permission"].as_str()), ("PERMISSION", Some("vault.read")));
    assert!(e.message.contains("not confirmed"), "{}", e.message);
    // Confirmed.
    let ok = record("reader", &["vault.read"]);
    assert_eq!(gateway::authorize("file.read", "reader", Some(&p), || ok.clone()).unwrap().route, gateway::Route::Control("file.read"));
    // Not declared, even if a stale record says confirmed.
    let stale = record("reader", &["vault.read", "vault.write"]);
    let e = gateway::authorize("file.write", "reader", Some(&p), || stale.clone()).unwrap_err();
    assert!(e.code == "PERMISSION" && e.message.contains("does not declare"), "{}", e.message);
    // Another plugin's record does not count.
    let other = record("someone", &["vault.read"]);
    assert_eq!(gateway::authorize("vault.list", "reader", Some(&p), || other.clone()).unwrap_err().code, "PERMISSION");
    // Bundled plugins need no confirmation, but still the declaration.
    let b = info_with("bundled-one", "\"vault.read\"", Source::Bundled);
    assert!(gateway::authorize("vault.list", "bundled-one", Some(&b), || none.clone()).is_ok());
    assert_eq!(gateway::authorize("file.write", "bundled-one", Some(&b), || none.clone()).unwrap_err().code, "PERMISSION");
}

#[test]
fn gateway_file_write_is_create_only() {
    use serde_json::json;
    assert_eq!(gateway::create_only(None).unwrap(), json!({"expectedRevision": null}));
    let p = gateway::create_only(Some(json!({"path": "a", "scene": {}}))).unwrap();
    assert_eq!(p, json!({"path": "a", "scene": {}, "expectedRevision": null}));
    assert!(gateway::create_only(Some(json!({"expectedRevision": null}))).is_ok());
    assert_eq!(gateway::create_only(Some(json!({"expectedRevision": "abc"}))).unwrap_err().code, "PERMISSION");
    assert_eq!(gateway::create_only(Some(json!([1]))).unwrap_err().code, "INVALID_ARGUMENT");
}

#[test]
fn gateway_errors_keep_their_code_and_detail() {
    use vaultdraw_protocol::{codes, RpcError};
    let e: gateway::GatewayError = RpcError::app(codes::CONFLICT, "dirty").with("reason", "dirty").into();
    assert_eq!((e.code.as_str(), e.detail["reason"].as_str()), ("CONFLICT", Some("dirty")));
    let v = serde_json::to_value(&e).unwrap();
    assert_eq!(v, serde_json::json!({"code": "CONFLICT", "message": "dirty", "reason": "dirty"}));
    let e: gateway::GatewayError = RpcError::invalid_params("bad").into();
    assert_eq!(e.code, "INVALID_ARGUMENT");
}

#[test]
fn storage_is_lazy_and_round_trips() {
    use serde_json::json;
    let t = tempdir().unwrap();
    let state = t.path();
    assert_eq!(storage::read(state, "kv-one").unwrap(), json!({"data": null, "corrupt": false}));
    assert!(!state.join("plugin-data").exists(), "a read creates nothing");
    storage::write(state, "kv-one", r#"{"a":1,"b":[true,"x"]}"#).unwrap();
    assert_eq!(storage::read(state, "kv-one").unwrap(), json!({"data": {"a": 1, "b": [true, "x"]}, "corrupt": false}));
    assert_eq!(storage::sizes(state), vec![storage::DataSize { id: "kv-one".into(), bytes: 22 }]);
    // Only the file, no temp leftovers.
    assert_eq!(fs::read_dir(state.join("plugin-data/kv-one")).unwrap().count(), 1);
    assert!(storage::delete(state, "kv-one").unwrap());
    assert!(!storage::delete(state, "kv-one").unwrap());
    assert!(storage::sizes(state).is_empty());
}

#[test]
fn storage_refuses_bad_input() {
    let t = tempdir().unwrap();
    let state = t.path();
    for id in ["../x", "A", "", "a/b"] {
        assert_eq!(storage::write(state, id, "{}").unwrap_err().code, "INVALID_ARGUMENT", "{id}");
        assert_eq!(storage::read(state, id).unwrap_err().code, "INVALID_ARGUMENT", "{id}");
        assert_eq!(storage::delete(state, id).unwrap_err().code, "INVALID_ARGUMENT", "{id}");
    }
    assert_eq!(storage::write(state, "kv", "[1]").unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(storage::write(state, "kv", "{").unwrap_err().code, "INVALID_ARGUMENT");
    let big = format!("{{\"a\":\"{}\"}}", "x".repeat(storage::MAX_BYTES as usize));
    assert_eq!(storage::write(state, "kv", &big).unwrap_err().code, "QUOTA");
    assert!(!state.join("plugin-data").exists());
}

#[test]
fn storage_renames_a_corrupt_file_and_starts_empty() {
    use serde_json::json;
    let t = tempdir().unwrap();
    let dir = t.path().join("plugin-data/kv");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("data.json"), "{not json").unwrap();
    assert_eq!(storage::read(t.path(), "kv").unwrap(), json!({"data": null, "corrupt": true}));
    assert_eq!(fs::read_to_string(dir.join("data.json.bad")).unwrap(), "{not json");
    assert!(!dir.join("data.json").exists());
    // A JSON value that is not an object is corrupt too.
    fs::write(dir.join("data.json"), "[1,2]").unwrap();
    assert_eq!(storage::read(t.path(), "kv").unwrap()["corrupt"], true);
    // The first backup is kept; the second goes next to it.
    assert_eq!(fs::read_to_string(dir.join("data.json.bad")).unwrap(), "{not json");
    assert_eq!(fs::read_to_string(dir.join("data.json.bad.1")).unwrap(), "[1,2]");
}

#[cfg(unix)]
#[test]
fn storage_refuses_symlinks() {
    let t = tempdir().unwrap();
    let outside = t.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(t.path().join("plugin-data")).unwrap();
    std::os::unix::fs::symlink(&outside, t.path().join("plugin-data/kv")).unwrap();
    assert_eq!(storage::write(t.path(), "kv", "{}").unwrap_err().code, "INVALID_PATH");
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    assert!(storage::sizes(t.path()).is_empty());
    // The folder itself as a link.
    let t2 = tempdir().unwrap();
    std::os::unix::fs::symlink(&outside, t2.path().join("plugin-data")).unwrap();
    assert_eq!(storage::read(t2.path(), "kv").unwrap_err().code, "INVALID_PATH");
}

// ---- P4c1: importers in the manifest, plugin path rules, create-only vault calls ----

use super::vault_paths::{self, Kind};
use serde_json::{json, Value};
use vaultdraw_core::{ops::vault_ops, Vault};

fn importer(extensions: &str) -> String {
    with(&format!("\n[[contributes.importers]]\nid = \"txt\"\ntitle = \"Text\"\nextensions = {extensions}\n"))
}

#[test]
fn importers_parse_and_always_serialise() {
    let m = manifest::parse(&importer(r#"["txt", "tar.gz"]"#)).unwrap();
    assert_eq!(m.contributes.importers.len(), 1);
    assert_eq!(m.contributes.importers[0].extensions, ["txt", "tar.gz"]);
    let none = serde_json::to_value(manifest::parse(&minimal("my-plugin")).unwrap()).unwrap();
    assert_eq!(none["contributes"]["importers"], json!([]));
    let some = serde_json::to_value(&m).unwrap();
    assert_eq!(some["contributes"]["importers"], json!([{"id": "txt", "title": "Text", "extensions": ["txt", "tar.gz"]}]));
}

#[test]
fn importer_extension_rules() {
    for e in ["Txt", ".txt", "tx t", "a..b", "a.", "", "t-x", "TXT", "日本"] {
        bad(&importer(&format!("[\"{e}\"]")), "invalid");
    }
    bad(&importer(&format!("[\"{}\"]", "a".repeat(33))), "invalid");
    assert!(manifest::parse(&importer(&format!("[\"{}\"]", "a".repeat(32)))).is_ok());
    bad(&importer("[]"), "1 to 8 extensions");
    bad(&importer(r#"["a","b","c","d","e","f","g","h","i"]"#), "1 to 8 extensions");
    assert!(manifest::parse(&importer(r#"["a","b","c","d","e","f","g","h"]"#)).is_ok());
    bad(&importer(r#"["txt", "txt"]"#), "Duplicate importer extension 'txt'");
    // Unique across the plugin's importers, not only inside one.
    bad(&with("\n[[contributes.importers]]\nid = \"a\"\ntitle = \"A\"\nextensions = [\"x\"]\n[[contributes.importers]]\nid = \"b\"\ntitle = \"B\"\nextensions = [\"x\"]\n"), "Duplicate importer extension");
    bad(&with("\n[[contributes.importers]]\nid = \"a\"\ntitle = \"A\"\nextensions = [\"x\"]\n[[contributes.importers]]\nid = \"a\"\ntitle = \"B\"\nextensions = [\"y\"]\n"), "Duplicate importer id");
    bad(&with("\n[[contributes.importers]]\nid = \"1a\"\ntitle = \"A\"\nextensions = [\"x\"]\n"), "importer id");
    bad(&with("\n[[contributes.importers]]\nid = \"a\"\ntitle = \" \"\nextensions = [\"x\"]\n"), "importer title");
    bad(&with("\n[[contributes.importers]]\nid = \"a\"\ntitle = \"A\"\nextensions = [\"x\"]\nkind = 1\n"), "kind");
}

#[test]
fn importers_cannot_claim_what_the_app_handles() {
    for e in manifest::RESERVED_EXTENSIONS {
        bad(&importer(&format!("[\"{e}\"]")), &format!("Extension '{e}' is handled by the app"));
    }
    // Longer names that merely end in a reserved one are the plugin's to claim.
    assert!(manifest::parse(&importer(r#"["data.json", "my.excalidraw"]"#)).is_ok());
}

#[test]
fn reserved_extensions_match_the_schema_and_the_image_types() {
    let schema: Value = serde_json::from_str(include_str!("../../../../sdk/api/plugin.schema.json")).unwrap();
    let in_schema = &schema["definitions"]["importer"]["properties"]["extensions"]["items"]["not"]["enum"];
    assert_eq!(in_schema, &json!(manifest::RESERVED_EXTENSIONS));
    // Every key of IMAGE_MIME_TYPES (packages/common/src/constants.ts) is reserved.
    let constants = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/common/src/constants.ts")).unwrap();
    let block = constants.split("export const IMAGE_MIME_TYPES = {").nth(1).unwrap().split('}').next().unwrap();
    let keys: Vec<&str> = block.lines().filter_map(|l| l.trim().split(':').next()).filter(|k| !k.is_empty()).collect();
    assert!(keys.len() >= 9, "{keys:?}");
    for k in keys {
        assert!(manifest::RESERVED_EXTENSIONS.contains(&k), "{k} is an image type the app handles");
    }
}

#[test]
fn too_many_importers() {
    let many = |n: usize| with(&(0..n).map(|i| format!("\n[[contributes.importers]]\nid = \"i{i}\"\ntitle = \"T\"\nextensions = [\"e{i}\"]\n")).collect::<String>());
    assert!(manifest::parse(&many(8)).is_ok());
    bad(&many(9), "Too many importers");
}

#[test]
fn on_drop_activation_needs_an_importer_for_the_extension() {
    // `activation` is a top-level key, so it has to come before the tables.
    let doc = |events: &str, ext: &str| format!("{}activation = {events}\n[[contributes.importers]]\nid = \"txt\"\ntitle = \"Text\"\nextensions = {ext}\n", minimal("my-plugin"));
    assert!(manifest::parse(&doc(r#"["onDrop:txt"]"#, r#"["txt"]"#)).is_ok());
    assert!(manifest::parse(&doc(r#"["onStartupFinished", "onDrop:tar.gz"]"#, r#"["tar.gz"]"#)).is_ok());
    bad(&doc(r#"["onDrop:csv"]"#, r#"["txt"]"#), "Unknown activation event 'onDrop:csv'");
    bad(&doc(r#"["onDrop:tar"]"#, r#"["tar.gz"]"#), "Unknown activation event");
    bad(&doc(r#"["onFile:txt"]"#, r#"["txt"]"#), "Unknown activation event 'onFile:txt'");
    bad(&doc(r#"["onDrop:"]"#, r#"["txt"]"#), "Unknown activation event");
    bad(&format!("{}activation = [\"onDrop:txt\"]\n", minimal("my-plugin")), "Unknown activation event 'onDrop:txt'");
}

// ---- vault_paths ----

fn corpus() -> Vec<(String, Kind, Option<String>)> {
    let rows: Vec<Value> = serde_json::from_str(include_str!("../../../../sdk/api/test/vault-paths.json")).unwrap();
    rows.iter()
        .map(|r| {
            let kind = match r["kind"].as_str().unwrap() {
                "file" => Kind::File,
                "folder" => Kind::Folder,
                k => panic!("kind {k}"),
            };
            (r["path"].as_str().unwrap().to_string(), kind, r["code"].as_str().map(str::to_string))
        })
        .collect()
}

#[test]
fn plugin_path_corpus() {
    let rows = corpus();
    assert!(rows.len() >= 30);
    assert!(rows.iter().any(|r| r.2.is_none()) && rows.iter().any(|r| r.2.is_some()));
    for (path, kind, code) in rows {
        let got = vault_paths::check_plugin_path(&path, kind).err().map(|e| e.app_code().unwrap().to_string());
        assert_eq!(got, code, "{path:?} ({kind:?})");
    }
}

/// A vault in a temp folder, with the root canonical like the app's.
fn vault(read_only: bool) -> (tempfile::TempDir, Vault) {
    let d = tempdir().unwrap();
    let v = Vault::new(d.path().canonicalize().unwrap(), "t".into(), read_only, None);
    (d, v)
}

fn scene() -> Value {
    json!({"type": "excalidraw", "version": 2, "elements": [], "appState": {}, "files": {}})
}

/// `vault.list` as a plugin gets it: path rules, the core call, the dot filter.
fn plugin_list(v: &Vault, params: Value) -> Result<Vec<String>, gateway::GatewayError> {
    let p = gateway::plugin_params("vault.list", Some(params))?;
    let out = gateway::filter_list(vault_ops::list(v, p["dir"].as_str().unwrap(), p["recursive"].as_bool().unwrap())?);
    Ok(out["entries"].as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap().to_string()).collect())
}

fn plugin_read(v: &Vault, path: &str) -> Result<Value, gateway::GatewayError> {
    let p = gateway::plugin_params("file.read", Some(json!({"path": path})))?;
    Ok(vault_ops::read(v, p["path"].as_str().unwrap())?)
}

/// `file.write` as a plugin gets it: create only (what the control call runs after the rules).
fn plugin_create(v: &Vault, path: &str) -> Result<(), gateway::GatewayError> {
    let p = gateway::plugin_params("file.write", Some(json!({"path": path, "scene": scene()})))?;
    assert_eq!(p["expectedRevision"], Value::Null);
    vault_ops::write(v, p["path"].as_str().unwrap(), &p["scene"], None).map_err(|e| gateway::create_error(e.into()))?;
    Ok(())
}

fn code<T: std::fmt::Debug>(r: Result<T, gateway::GatewayError>) -> String {
    r.unwrap_err().code
}

#[test]
fn plugin_params_keep_only_what_a_call_needs() {
    let p = gateway::plugin_params("vault.list", Some(json!({"dir": "a", "recursive": true, "x": 1}))).unwrap();
    assert_eq!(p, json!({"dir": "a", "recursive": false}));
    assert_eq!(gateway::plugin_params("vault.list", None).unwrap(), json!({"dir": "", "recursive": false}));
    assert_eq!(gateway::plugin_params("vault.list", Some(json!({"dir": null}))).unwrap()["dir"], "");
    assert_eq!(code(gateway::plugin_params("vault.list", Some(json!({"dir": 3})))), "INVALID_ARGUMENT");
    assert_eq!(code(gateway::plugin_params("vault.list", Some(json!({"dir": ".git"})))), "INVALID_PATH");
    // A link-style `file` name must not reach the control call: only `path` does.
    assert_eq!(code(gateway::plugin_params("file.read", Some(json!({"file": "Name"})))), "INVALID_ARGUMENT");
    assert_eq!(gateway::plugin_params("file.read", Some(json!({"path": "a.excalidraw", "file": "x"}))).unwrap(), json!({"path": "a.excalidraw"}));
    assert_eq!(code(gateway::plugin_params("file.read", Some(json!({"path": "a"})))), "INVALID_PATH");
    assert_eq!(code(gateway::plugin_params("file.write", Some(json!({"file": "n", "scene": {}})))), "INVALID_ARGUMENT");
    assert_eq!(code(gateway::plugin_params("file.write", Some(json!({"path": "a.txt", "scene": {}})))), "INVALID_PATH");
    assert_eq!(code(gateway::plugin_params("file.write", Some(json!({"path": "a.excalidraw", "expectedRevision": "r"})))), "PERMISSION");
    assert_eq!(code(gateway::plugin_params("file.read", Some(json!([1])))), "INVALID_ARGUMENT");
}

#[test]
fn list_hides_dot_entries_and_symlinks() {
    let (d, v) = vault(false);
    let root = d.path();
    for f in ["a.excalidraw", "B.EXCALIDRAW", ".hidden.excalidraw", "notes.txt"] {
        fs::write(root.join(f), "x").unwrap();
    }
    for dir in ["sub", ".git", ".obsidian", ".excalidraw-vault"] {
        fs::create_dir_all(root.join(dir)).unwrap();
    }
    fs::write(root.join("sub/c.excalidraw"), "x").unwrap();
    fs::write(root.join("sub/.d.excalidraw"), "x").unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("a.excalidraw"), root.join("link.excalidraw")).unwrap();
        std::os::unix::fs::symlink(root.join("sub"), root.join("linkdir")).unwrap();
    }
    assert_eq!(plugin_list(&v, json!({})).unwrap(), ["sub", "a.excalidraw", "B.EXCALIDRAW"]);
    assert_eq!(plugin_list(&v, json!({"dir": "sub", "recursive": true})).unwrap(), ["sub/c.excalidraw"]);
    assert_eq!(code(plugin_list(&v, json!({"dir": ".git"}))), "INVALID_PATH");
    assert_eq!(code(plugin_list(&v, json!({"dir": "nope"}))), "NOT_FOUND");
    // Only the dot filter is the plugin's: the filter itself keeps plain entries and bad shapes alone.
    assert_eq!(gateway::filter_list(json!({"entries": [{"path": "a/.x"}, {"path": "a/b"}]})), json!({"entries": [{"path": "a/b"}]}));
    assert_eq!(gateway::filter_list(json!({"other": 1})), json!({"other": 1}));
}

#[cfg(unix)]
#[test]
fn symlinks_are_refused_for_read_and_create() {
    let (d, v) = vault(false);
    let root = d.path();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("o.excalidraw"), "x").unwrap();
    fs::create_dir_all(root.join("real")).unwrap();
    fs::write(root.join("real/a.excalidraw"), serde_json::to_string(&scene()).unwrap()).unwrap();
    std::os::unix::fs::symlink(outside.path().join("o.excalidraw"), root.join("file-link.excalidraw")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("dir-link")).unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("inner-link")).unwrap();
    assert_eq!(code(plugin_read(&v, "file-link.excalidraw")), "INVALID_PATH");
    assert_eq!(code(plugin_read(&v, "dir-link/o.excalidraw")), "INVALID_PATH");
    assert_eq!(code(plugin_read(&v, "inner-link/a.excalidraw")), "INVALID_PATH");
    assert_eq!(code(plugin_create(&v, "dir-link/new.excalidraw")), "INVALID_PATH");
    assert_eq!(code(plugin_create(&v, "file-link.excalidraw")), "INVALID_PATH");
    assert!(!outside.path().join("new.excalidraw").exists());
    assert_eq!(fs::read_to_string(outside.path().join("o.excalidraw")).unwrap(), "x");
    assert_eq!(code(plugin_list(&v, json!({"dir": "dir-link"}))), "INVALID_PATH");
    assert!(plugin_read(&v, "real/a.excalidraw").is_ok());
}

#[test]
fn create_makes_a_drawing_and_never_overwrites() {
    let (d, v) = vault(false);
    fs::create_dir_all(d.path().join("sub")).unwrap();
    plugin_create(&v, "sub/new.excalidraw").unwrap();
    assert_eq!(plugin_read(&v, "sub/new.excalidraw").unwrap()["scene"]["type"], "excalidraw");
    let before = fs::read(d.path().join("sub/new.excalidraw")).unwrap();
    // The same name, and the same name in another case: both are collisions.
    assert_eq!(code(plugin_create(&v, "sub/new.excalidraw")), "NAME_COLLISION");
    assert_eq!(code(plugin_create(&v, "sub/NEW.excalidraw")), "NAME_COLLISION");
    assert_eq!(fs::read(d.path().join("sub/new.excalidraw")).unwrap(), before);
    // A missing parent is NOT_FOUND and makes no folder.
    assert_eq!(code(plugin_create(&v, "missing/new.excalidraw")), "NOT_FOUND");
    assert!(!d.path().join("missing").exists());
    // Path rules apply before anything touches the disk.
    assert_eq!(code(plugin_create(&v, "sub/new.txt")), "INVALID_PATH");
    assert_eq!(code(plugin_create(&v, ".git/new.excalidraw")), "INVALID_PATH");
    assert_eq!(code(plugin_create(&v, &format!("{}.excalidraw", "a/".repeat(600)))), "INVALID_PATH");
    assert!(!d.path().join(".git").exists());
}

#[test]
fn create_in_a_read_only_vault_is_refused() {
    let (d, v) = vault(true);
    assert_eq!(code(plugin_create(&v, "a.excalidraw")), "READ_ONLY");
    assert!(!d.path().join("a.excalidraw").exists());
}

#[test]
fn read_refuses_non_drawings_and_missing_files() {
    let (d, v) = vault(false);
    fs::write(d.path().join("notes.txt"), "x").unwrap();
    assert_eq!(code(plugin_read(&v, "notes.txt")), "INVALID_PATH");
    assert_eq!(code(plugin_read(&v, "gone.excalidraw")), "NOT_FOUND");
    assert_eq!(code(plugin_read(&v, ".excalidraw-vault/x.excalidraw")), "INVALID_PATH");
}

/// Budget: `vault.list` of 5000 drawings in one folder, p95 under 30 ms. Run with
/// `cargo test -j 4 vault_list_5000 -- --ignored --nocapture` (the percentiles are printed).
#[test]
#[ignore = "timing run: prints p50 and p95 of vault.list over 5000 drawings"]
fn vault_list_5000_drawings_timing() {
    let (d, v) = vault(false);
    for i in 0..5000 {
        fs::write(d.path().join(format!("drawing-{i:05}.excalidraw")), "{}").unwrap();
    }
    for i in 0..10 {
        fs::write(d.path().join(format!(".hidden-{i}.excalidraw")), "{}").unwrap();
    }
    assert_eq!(plugin_list(&v, json!({})).unwrap().len(), 5000);
    let mut ms: Vec<f64> = (0..40)
        .map(|_| {
            let t = Instant::now();
            let n = plugin_list(&v, json!({})).unwrap().len();
            assert_eq!(n, 5000);
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (p50, p95) = (ms[ms.len() / 2], ms[(ms.len() * 95 / 100).min(ms.len() - 1)]);
    let mut core: Vec<f64> = (0..20)
        .map(|_| {
            let t = Instant::now();
            let _ = vaultdraw_core::list_directory_in(&v, "").unwrap();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    core.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("  of which the core's directory listing alone: p50 {:.2} ms", core[core.len() / 2]);
    println!("vault.list 5000 drawings: p50 {p50:.2} ms, p95 {p95:.2} ms (budget p95 < 30 ms)");
    assert!(p95 < 30.0 * 4.0, "p95 {p95:.1} ms is far over the 30 ms budget");
}

#[test]
fn gateway_markdown_parse_needs_no_permission_and_checks_params() {
    let none = consent::Record::new();
    let p = info_with("md", "", Source::User);
    let row = gateway::authorize("markdown.parse", "md", Some(&p), || none.clone()).unwrap();
    assert_eq!(row.route, gateway::Route::MarkdownParse);
    let doc = gateway::markdown_call(Some(serde_json::json!({ "text": "# Hi #tag\n\n[[Note|alias]]" }))).unwrap();
    assert_eq!(doc["schemaVersion"], 1);
    assert_eq!(doc["blocks"][0]["kind"], "heading");
    assert_eq!(doc["tags"][0], "tag");
    assert_eq!(doc["links"][0]["target"], "Note");
    for bad in [serde_json::json!({}), serde_json::json!({ "text": 3 }), serde_json::json!({ "text": "x", "softBreakNewline": "yes" }), serde_json::json!([1])] {
        assert_eq!(gateway::markdown_call(Some(bad)).unwrap_err().code, "INVALID_ARGUMENT");
    }
    let big = "a".repeat(vaultdraw_core::markdown::MAX_MARKDOWN_BYTES as usize + 1);
    assert_eq!(gateway::markdown_call(Some(serde_json::json!({ "text": big }))).unwrap_err().code, "INVALID_ARGUMENT");
}

#[test]
fn gateway_folders_rows_need_the_import_permission_and_consent() {
    let none = consent::Record::new();
    let reader = info_with("reader", "\"vault.read\"", Source::User);
    let e = gateway::authorize("folders.list", "reader", Some(&reader), || none.clone()).unwrap_err();
    assert_eq!((e.code.as_str(), e.detail["permission"].as_str()), ("PERMISSION", Some("folders.import")));
    let importer = info_with("importer", "\"folders.import\"", Source::User);
    let e = gateway::authorize("folders.writeDrawing", "importer", Some(&importer), || none.clone()).unwrap_err();
    assert_eq!(e.code, "PERMISSION");
    let ok = gateway::authorize("folders.writeDrawing", "importer", Some(&importer), || record("importer", &["folders.import"])).unwrap();
    assert_eq!(ok.route, gateway::Route::Folders);
    let bundled = info_with("official", "\"folders.import\"", Source::Bundled);
    let unread = || -> consent::Record { panic!("bundled plugins never read the consent file") };
    assert!(gateway::authorize("folders.copy", "official", Some(&bundled), unread).is_ok());
    // A write permission for the review dialog: adding it later needs the user's confirmation.
    assert!(manifest::is_write_permission("folders.import"));
}

// ---- P6: status bar items in the manifest ----

fn sbar(extra: &str) -> String {
    with(&format!("\n[[contributes.commands]]\nid = \"go\"\ntitle = \"Go\"\n[[contributes.status_bar]]\nid = \"clock\"\ntitle = \"Clock\"\n{extra}"))
}

#[test]
fn status_bar_items_parse_and_serialise() {
    let m = manifest::parse(&sbar("align = \"left\"\npriority = 5\ncommand = \"go\"\n")).unwrap();
    let item = &m.contributes.status_bar[0];
    assert_eq!((item.id.as_str(), item.priority, item.command.as_deref()), ("clock", 5, Some("go")));
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["contributes"]["status_bar"][0]["align"], json!("left"));
    // Defaults: right-aligned, priority 0, no command.
    let d = manifest::parse(&sbar("")).unwrap();
    assert_eq!(serde_json::to_value(&d).unwrap()["contributes"]["status_bar"][0]["align"], json!("right"));
    assert_eq!(d.contributes.status_bar[0].priority, 0);
}

#[test]
fn status_bar_rules() {
    bad(&sbar("command = \"nope\"\n"), "does not declare");
    bad(&sbar("align = \"middle\"\n"), "unknown variant");
    bad(&sbar("color = \"red\"\n"), "unknown field");
    bad(&with("\n[[contributes.status_bar]]\nid = \"a\"\ntitle = \"A\"\n[[contributes.status_bar]]\nid = \"a\"\ntitle = \"B\"\n"), "Duplicate status bar item id");
    let many: String = (0..9).map(|i| format!("\n[[contributes.status_bar]]\nid = \"s{i}\"\ntitle = \"S\"\n")).collect();
    bad(&with(&many), "Too many status bar items");
}

// ---- P6: views in the manifest ----

fn view(extensions: &str) -> String {
    with(&format!("\n[[contributes.views]]\nid = \"board\"\ntitle = \"Board\"\nextensions = {extensions}\n"))
}

#[test]
fn views_parse_and_serialise() {
    let m = manifest::parse(&view(r#"["kanban.md", "board.md"]"#)).unwrap();
    assert_eq!(m.contributes.views[0].extensions, ["kanban.md", "board.md"]);
    assert_eq!(serde_json::to_value(&m).unwrap()["contributes"]["views"][0]["id"], json!("board"));
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.views.is_empty());
}

#[test]
fn view_extension_rules() {
    bad(&view(r#"["md"]"#), "must end in '.md'");
    bad(&view(r#"["excalidraw.md"]"#), "must end in '.md'");
    bad(&view(r#"["csv"]"#), "must end in '.md'");
    bad(&view(r#"[".kanban.md"]"#), "invalid");
    bad(&view("[]"), "1 to 8 extensions");
    bad(&view(r#"["a.md", "a.md"]"#), "Duplicate view extension");
    bad(&with("\n[[contributes.views]]\nid = \"a\"\ntitle = \"A\"\nextensions = [\"x.md\"]\n[[contributes.views]]\nid = \"b\"\ntitle = \"B\"\nextensions = [\"x.md\"]\n"), "Duplicate view extension");
    let many: String = (0..9).map(|i| format!("\n[[contributes.views]]\nid = \"v{i}\"\ntitle = \"V\"\nextensions = [\"v{i}.md\"]\n")).collect();
    bad(&with(&many), "Too many views");
}

// ---- P6: context menu items in the manifest ----

fn menu(extra: &str) -> String {
    with(&format!("\n[[contributes.commands]]\nid = \"go\"\ntitle = \"Go\"\n[[contributes.menus]]\nsurface = \"tree\"\ncommand = \"go\"\n{extra}"))
}

#[test]
fn menus_parse_and_serialise() {
    let m = manifest::parse(&menu("title = \"Do it\"\nkinds = [\"note\"]\n")).unwrap();
    assert_eq!(m.contributes.menus[0].kinds, ["note"]);
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["contributes"]["menus"][0], json!({"surface": "tree", "command": "go", "title": "Do it", "kinds": ["note"]}));
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.menus.is_empty());
}

#[test]
fn menu_rules() {
    bad(&menu("kinds = [\"file\"]\n"), "unknown");
    bad(&menu("title = \"\"\n"), "title");
    bad(&with("\n[[contributes.menus]]\nsurface = \"tab\"\ncommand = \"nope\"\n"), "does not declare");
    bad(&with("\n[[contributes.commands]]\nid = \"go\"\ntitle = \"Go\"\n[[contributes.menus]]\nsurface = \"tab\"\ncommand = \"go\"\nkinds = [\"note\"]\n"), "tree surface only");
    bad(&with("\n[[contributes.commands]]\nid = \"go\"\ntitle = \"Go\"\n[[contributes.menus]]\nsurface = \"toolbar\"\ncommand = \"go\"\n"), "unknown variant");
    bad(&menu("[[contributes.menus]]\nsurface = \"tree\"\ncommand = \"go\"\n"), "Duplicate menu item");
    let many: String = (0..17).map(|i| format!("\n[[contributes.menus]]\nsurface = \"canvas\"\ncommand = \"c{i}\"\n")).collect();
    bad(&with(&many), "Too many menu items");
}

// ---- P7: toolbar buttons in the manifest ----

fn toolbar(extra: &str) -> String {
    with(&format!("\n[[contributes.commands]]\nid = \"go\"\ntitle = \"Go\"\n[[contributes.toolbar]]\ncommand = \"go\"\n{extra}"))
}

#[test]
fn toolbar_parses_and_serialises() {
    let m = manifest::parse(&toolbar("title = \"Do it\"\nicon = \"M4 4h16v16H4z\"\npriority = 3\n")).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["contributes"]["toolbar"][0], json!({"command": "go", "title": "Do it", "icon": "M4 4h16v16H4z", "priority": 3}));
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.toolbar.is_empty());
}

#[test]
fn toolbar_rules() {
    bad(&toolbar("icon = \"<svg/>\"\n"), "path data");
    bad(&toolbar("icon = \"\"\n"), "path data");
    bad(&toolbar("title = \" \"\n"), "title");
    bad(&with("\n[[contributes.toolbar]]\ncommand = \"nope\"\n"), "does not declare");
    bad(&toolbar("[[contributes.toolbar]]\ncommand = \"go\"\n"), "Duplicate toolbar");
    let many: String = (0..9).map(|i| format!("\n[[contributes.commands]]\nid = \"c{i}\"\ntitle = \"C\"\n[[contributes.toolbar]]\ncommand = \"c{i}\"\n")).collect();
    bad(&with(&many), "Too many toolbar");
}

// ---- P7: canvas tools in the manifest ----

fn tool(extra: &str) -> String {
    with(&format!("\n[[contributes.tools]]\nid = \"pen\"\ntitle = \"Pen\"\n{extra}"))
}

#[test]
fn tools_parse_and_serialise() {
    let m = manifest::parse(&tool("icon = \"M4 4h16\"\ncursor = \"grab\"\n")).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["contributes"]["tools"][0], json!({"id": "pen", "title": "Pen", "icon": "M4 4h16", "cursor": "grab"}));
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.tools.is_empty());
}

#[test]
fn tool_rules() {
    bad(&tool("cursor = \"wait\"\n"), "unknown");
    bad(&tool("icon = \"<x>\"\n"), "path data");
    bad(&tool("[[contributes.tools]]\nid = \"pen\"\ntitle = \"Again\"\n"), "pen");
    bad(&with("\n[[contributes.tools]]\nid = \"t\"\ntitle = \" \"\n"), "title");
    let many: String = (0..9).map(|i| format!("\n[[contributes.tools]]\nid = \"t{i}\"\ntitle = \"T\"\n")).collect();
    bad(&with(&many), "Too many tools");
}

// ---- P7: custom shapes in the manifest ----

fn shape(extra: &str) -> String {
    with(&format!("\n[[contributes.shapes]]\nid = \"card\"\ntitle = \"Card\"\n{extra}"))
}

#[test]
fn shapes_parse_and_serialise() {
    let m = manifest::parse(&shape("width = 200\n")).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(v["contributes"]["shapes"][0], json!({"id": "card", "title": "Card", "icon": null, "width": 200, "height": 100}));
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.shapes.is_empty());
}

#[test]
fn shape_rules() {
    bad(&shape("width = 2\n"), "between");
    bad(&shape("height = 5000\n"), "between");
    bad(&shape("icon = \"<x>\"\n"), "path data");
    bad(&shape("[[contributes.shapes]]\nid = \"card\"\ntitle = \"Again\"\n"), "card");
    let many: String = (0..9).map(|i| format!("\n[[contributes.shapes]]\nid = \"s{i}\"\ntitle = \"S\"\n")).collect();
    bad(&with(&many), "Too many shapes");
}

// ---- C8: methods other programs can call ----

fn method(extra: &str) -> String {
    with(&format!("permissions = [\"control\"]\n\n[[contributes.methods]]\nid = \"to_drawing\"\ntitle = \"To drawing\"\n{extra}"))
}

#[test]
fn methods_parse_and_serialise() {
    let m = manifest::parse(&method("mcp = true\nwrite = true\ntimeout_ms = 5000\n")).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(
        v["contributes"]["methods"][0],
        json!({"id": "to_drawing", "title": "To drawing", "description": null, "params": null, "mcp": true, "write": true, "timeout_ms": 5000})
    );
    assert!(manifest::parse(&minimal("a-b")).unwrap().contributes.methods.is_empty());
    assert!(manifest::is_write_permission("control"));
}

#[test]
fn method_rules() {
    // Methods need the permission, and the id and limits are checked.
    bad(&with("\n[[contributes.methods]]\nid = \"m\"\ntitle = \"M\"\n"), "permission 'control'");
    bad(&method("timeout_ms = 5\n"), "timeout_ms");
    bad(&method("params = \"x\"\n"), "json schema object");
    bad(&method("[[contributes.methods]]\nid = \"to_drawing\"\ntitle = \"Again\"\n"), "to_drawing");
    bad(&with("permissions = [\"control\"]\n\n[[contributes.methods]]\nid = \"Bad-Id\"\ntitle = \"B\"\n"), "lowercase");
    let many: String = (0..17).map(|i| format!("\n[[contributes.methods]]\nid = \"m{i}\"\ntitle = \"M\"\n")).collect();
    bad(&with(&format!("permissions = [\"control\"]\n{many}")), "Too many methods");
}

#[test]
fn raw_rows_need_their_permission_and_are_not_json_routes() {
    let none = consent::Record::new();
    let reader = info_with("reader", "\"vault.read\"", Source::Bundled);
    for m in ["vault.graph", "vault.graphLayout.load"] {
        assert_eq!(gateway::authorize(m, "reader", Some(&reader), || none.clone()).unwrap().route, gateway::Route::Raw, "{m}");
    }
    // Saving the layout writes: a read-only plugin is refused.
    let e = gateway::authorize("vault.graphLayout.save", "reader", Some(&reader), || none.clone()).unwrap_err();
    assert_eq!(e.code, "PERMISSION");
    let writer = info_with("writer", "\"vault.read\", \"vault.write\"", Source::Bundled);
    assert!(gateway::authorize("vault.graphLayout.save", "writer", Some(&writer), || none.clone()).is_ok());
    // A user plugin needs the confirmation too.
    let user = info_with("user", "\"vault.read\"", Source::User);
    assert_eq!(gateway::authorize("vault.graph", "user", Some(&user), || none.clone()).unwrap_err().code, "PERMISSION");
}

mod exports_rows {
    use super::super::exports;
    use std::fs;
    use tempfile::tempdir;

    fn vault(root: &std::path::Path, read_only: bool) -> crate::Vault {
        crate::Vault::for_tests(root.canonicalize().unwrap(), "t", read_only)
    }
    fn body(head: serde_json::Value, bytes: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(&head).unwrap();
        let mut out = (json.len() as u32).to_be_bytes().to_vec();
        out.extend(json);
        out.extend(bytes);
        out
    }

    #[test]
    fn writes_moves_and_removes_images_only() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        exports::call(&v, "export.write", &body(serde_json::json!({"path": "out/a/Draw.svg"}), b"<svg/>")).unwrap();
        assert_eq!(fs::read(t.path().join("out/a/Draw.svg")).unwrap(), b"<svg/>");
        // Moving a folder of exports, then a file.
        assert_eq!(exports::call(&v, "export.move", &body(serde_json::json!({"from": "out/a", "to": "out/b"}), b"")).unwrap(), vec![1]);
        assert!(t.path().join("out/b/Draw.svg").exists() && !t.path().join("out/a").exists());
        assert_eq!(exports::call(&v, "export.move", &body(serde_json::json!({"from": "out/b/Draw.svg", "to": "out/b/New.svg"}), b"")).unwrap(), vec![1]);
        assert_eq!(exports::call(&v, "export.move", &body(serde_json::json!({"from": "out/none.svg", "to": "out/x.svg"}), b"")).unwrap(), vec![0]);
        assert_eq!(exports::call(&v, "export.remove", &body(serde_json::json!({"path": "out/b/New.svg"}), b"")).unwrap(), vec![1]);
        assert_eq!(exports::call(&v, "export.remove", &body(serde_json::json!({"path": "out/b/New.svg"}), b"")).unwrap(), vec![0]);
        // A folder removal deletes images and then the empty folders.
        exports::call(&v, "export.write", &body(serde_json::json!({"path": "out/c/d/One.png"}), b"x")).unwrap();
        assert_eq!(exports::call(&v, "export.remove", &body(serde_json::json!({"path": "out/c"}), b"")).unwrap(), vec![1]);
        assert!(!t.path().join("out/c").exists());
    }

    #[test]
    fn a_users_own_image_survives_export_move_and_delete() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        let ok = |m: &str, h: serde_json::Value, b: &[u8]| exports::call(&v, m, &body(h, b));
        // The user's own Logo.png sits next to Logo.excalidraw.
        fs::write(t.path().join("Logo.png"), "mine").unwrap();
        let err = ok("export.write", serde_json::json!({"path": "Logo.png"}), b"export").unwrap_err();
        assert_eq!(err.code, "CONFLICT");
        assert_eq!(fs::read_to_string(t.path().join("Logo.png")).unwrap(), "mine");
        // Neither a move nor a remove touches it.
        assert_eq!(ok("export.remove", serde_json::json!({"path": "Logo.png"}), b"").unwrap(), vec![0]);
        assert_eq!(ok("export.move", serde_json::json!({"from": "Logo.png", "to": "Other.png"}), b"").unwrap(), vec![0]);
        assert_eq!(fs::read_to_string(t.path().join("Logo.png")).unwrap(), "mine");
        // The plugin's own export is updated, moved and removed.
        ok("export.write", serde_json::json!({"path": "Logo.svg"}), b"<svg>1</svg>").unwrap();
        ok("export.write", serde_json::json!({"path": "Logo.svg"}), b"<svg>2</svg>").unwrap();
        assert_eq!(fs::read(t.path().join("Logo.svg")).unwrap(), b"<svg>2</svg>");
        assert_eq!(ok("export.move", serde_json::json!({"from": "Logo.svg", "to": "Brand.svg"}), b"").unwrap(), vec![1]);
        ok("export.write", serde_json::json!({"path": "Brand.svg"}), b"<svg>3</svg>").unwrap();
        assert_eq!(ok("export.remove", serde_json::json!({"path": "Brand.svg"}), b"").unwrap(), vec![1]);
        assert!(!t.path().join("Brand.svg").exists());
        assert_eq!(fs::read_to_string(t.path().join("Logo.png")).unwrap(), "mine");
        // An export the user then edited is theirs too.
        ok("export.write", serde_json::json!({"path": "E.svg"}), b"a").unwrap();
        fs::write(t.path().join("E.svg"), "edited").unwrap();
        assert_eq!(ok("export.write", serde_json::json!({"path": "E.svg"}), b"b").unwrap_err().code, "CONFLICT");
        assert_eq!(ok("export.remove", serde_json::json!({"path": "E.svg"}), b"").unwrap(), vec![0]);
        // A folder removal keeps a user's image and the folder that holds it.
        ok("export.write", serde_json::json!({"path": "out/One.png"}), b"x").unwrap();
        fs::write(t.path().join("out/Mine.png"), "m").unwrap();
        assert_eq!(ok("export.remove", serde_json::json!({"path": "out"}), b"").unwrap(), vec![1]);
        assert!(!t.path().join("out/One.png").exists() && t.path().join("out/Mine.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_case_only_move_keeps_the_export() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        exports::call(&v, "export.write", &body(serde_json::json!({"path": "a.svg"}), b"<svg/>")).unwrap();
        assert_eq!(exports::call(&v, "export.move", &body(serde_json::json!({"from": "a.svg", "to": "A.svg"}), b"")).unwrap(), vec![1]);
        let names: Vec<String> = fs::read_dir(t.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".svg")).collect();
        assert_eq!(names, vec!["A.svg".to_string()]);
        exports::call(&v, "export.write", &body(serde_json::json!({"path": "A.svg"}), b"<svg>2</svg>")).unwrap();
    }

    #[test]
    fn refuses_other_files_dot_paths_symlinks_and_read_only() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        let code = |r: crate::Result<Vec<u8>>| r.unwrap_err().code;
        let w = |path: &str| exports::call(&v, "export.write", &body(serde_json::json!({ "path": path }), b"x"));
        assert_eq!(code(w("a.excalidraw")), "INVALID_PATH");
        assert_eq!(code(w("a.txt")), "INVALID_PATH");
        assert_eq!(code(w(".hidden/a.svg")), "INVALID_PATH");
        assert_eq!(code(w("../a.svg")), "INVALID_PATH");
        assert_eq!(code(w(".excalidraw-vault/a.svg")), "INVALID_PATH");
        // A folder that holds anything but exports is never moved or removed.
        fs::create_dir_all(t.path().join("keep")).unwrap();
        fs::write(t.path().join("keep/notes.md"), "x").unwrap();
        fs::write(t.path().join("keep/a.svg"), "x").unwrap();
        assert_eq!(code(exports::call(&v, "export.remove", &body(serde_json::json!({"path": "keep"}), b""))), "INVALID_PATH");
        assert!(t.path().join("keep/a.svg").exists());
        #[cfg(unix)]
        {
            let other = tempdir().unwrap();
            std::os::unix::fs::symlink(other.path(), t.path().join("link")).unwrap();
            assert_eq!(code(w("link/a.svg")), "INVALID_PATH");
            assert!(!other.path().join("a.svg").exists());
        }
        let ro = vault(t.path(), true);
        assert_eq!(code(exports::call(&ro, "export.write", &body(serde_json::json!({"path": "a.svg"}), b"x"))), "READ_ONLY");
        assert_eq!(code(exports::call(&v, "export.write", b"\0\0")), "INVALID_ARGUMENT");
    }
}

/// Every official plugin's plugin.toml parses with the real validator and is compatible with this
/// app version: a manifest the app refuses loses its commands and activity bar button once the
/// host runs (toimprove #103, the graph button).
#[test]
fn every_official_manifest_parses_and_is_compatible() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/official");
    let app = env!("CARGO_PKG_VERSION");
    let mut seen = 0;
    let mut bad = Vec::new();
    for entry in fs::read_dir(&root).unwrap() {
        let dir = entry.unwrap().path();
        let toml = dir.join("plugin.toml");
        if !toml.is_file() {
            continue;
        }
        seen += 1;
        let text = fs::read_to_string(&toml).unwrap();
        match manifest::parse(&text) {
            Err(e) => bad.push(format!("{}: {e}", dir.display())),
            Ok(m) => {
                if let (false, problem) = manifest::compatibility(&m, app) {
                    bad.push(format!("{}: {problem:?}", dir.display()));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
    assert!(seen >= 9, "found {seen} official plugins");
}
