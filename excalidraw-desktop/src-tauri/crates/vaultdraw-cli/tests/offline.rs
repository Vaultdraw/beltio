//! Headless reads: the built binary against a fixture vault, no app. Same JSON as the
//! server's methods, refusals, and the app-live rules (the instance lock held by the test).
use fs2::FileExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use vaultdraw_core::ops::{target, vault_ops};
use vaultdraw_core::Vault;

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    runtime: PathBuf,
    config: PathBuf,
}

fn scene(texts: &[&str], link: Option<&str>) -> String {
    let mut els: Vec<Value> = texts
        .iter()
        .enumerate()
        .map(|(i, t)| json!({"id": format!("t{i}"), "type": "text", "text": t, "x": 0, "y": 0, "width": 10, "height": 10}))
        .collect();
    if let Some(l) = link {
        els.push(json!({"id": "r", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10, "link": l}));
    }
    json!({"type": "excalidraw", "version": 2, "elements": els, "appState": {}, "files": {}}).to_string()
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let base = dunce::canonicalize(tmp.path()).unwrap();
    let root = base.join("vault");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("a.excalidraw"), scene(&["alpha foo #graph"], Some("[[b]]"))).unwrap();
    std::fs::write(root.join("sub/b.excalidraw"), scene(&["beta foo #graph #dp"], None)).unwrap();
    std::fs::write(root.join("c.excalidraw"), scene(&["gamma"], Some("[[nowhere]]"))).unwrap();
    let (state, runtime, config) = (base.join("state"), base.join("run"), base.join("config"));
    for d in [&state, &runtime, &config] {
        std::fs::create_dir_all(d).unwrap();
    }
    Env { _tmp: tmp, root, state, runtime, config }
}

impl Env {
    fn cmd(&self) -> Command {
        let mut c = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
        c.env_clear()
            .env("HOME", "/nonexistent-vd-home")
            .env("VAULTDRAW_STATE_DIR", &self.state)
            .env("VAULTDRAW_RUNTIME_DIR", &self.runtime)
            .env("VAULTDRAW_CONFIG_DIR", &self.config)
            .stdin(Stdio::null());
        c
    }
    fn run(&self, args: &[&str]) -> Output {
        self.cmd().args(args).output().unwrap()
    }
    /// With `--vault <root> --json`.
    fn json(&self, args: &[&str]) -> Value {
        let v = self.root.to_str().unwrap();
        let o = self.cmd().args(["--vault", v, "--json"]).args(args).output().unwrap();
        assert_eq!(o.status.code(), Some(0), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
        serde_json::from_slice(&o.stdout).unwrap()
    }
    fn vault(&self) -> Vault {
        Vault::new(self.root.clone(), "t".into(), true, None)
    }
    /// Holds the instance lock like a running app.
    fn hold_instance(&self) -> std::fs::File {
        let f = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(self.runtime.join("instance.lock")).unwrap();
        f.try_lock_exclusive().unwrap();
        f
    }
}

fn code(o: &Output) -> i32 {
    o.status.code().unwrap_or(-1)
}
fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}
fn paths(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap().to_string()).collect()
}

#[test]
fn ls_matches_the_servers_vault_list() {
    let e = env();
    let want = vault_ops::list(&e.vault(), "", false).unwrap();
    assert_eq!(e.json(&["ls"]), want);
    let want = vault_ops::list(&e.vault(), "", true).unwrap();
    assert_eq!(e.json(&["ls", "-r"]), want);
    assert_eq!(paths(&e.json(&["ls", "sub/"]), "entries"), ["sub/b.excalidraw"]);
}

#[test]
fn cat_matches_the_servers_file_read_and_resolves_names() {
    let e = env();
    let want = vault_ops::read(&e.vault(), "sub/b.excalidraw").unwrap();
    assert_eq!(e.json(&["cat", "sub/b.excalidraw"]), want);
    assert_eq!(e.json(&["cat", "sub/b"]), want);
    assert_eq!(e.json(&["cat", "b"]), want, "a bare name resolves like a link");
    let v = e.root.to_str().unwrap();
    let o = e.run(&["--vault", v, "cat", "b"]);
    assert_eq!(code(&o), 0);
    let scene: Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(scene, want["scene"]);
}

#[test]
fn search_tags_links_golden() {
    let e = env();
    let s = e.json(&["search", "foo"]);
    assert_eq!(s["query"], "foo");
    assert_eq!(s["totalMatches"], 2);
    let mut got = paths(&s, "results");
    got.sort();
    assert_eq!(got, ["a.excalidraw", "sub/b.excalidraw"]);
    assert_eq!(s["status"]["state"], "ready");
    assert_eq!(e.json(&["search", "foo", "--limit", "1"])["results"].as_array().unwrap().len(), 1);
    assert_eq!(e.json(&["search", "zzzz"])["totalMatches"], 0);

    let t = e.json(&["tags"]);
    let tags: Vec<(String, u64)> = t["tags"].as_array().or(t["summary"].as_array()).unwrap_or(&vec![]).iter().map(|x| (x["tag"].as_str().unwrap().into(), x["count"].as_u64().unwrap())).collect();
    assert!(tags.contains(&("graph".into(), 2)) && tags.contains(&("dp".into(), 1)), "{t}");

    let l = e.json(&["links", "a"]);
    assert_eq!(l["outgoing"][0]["resolved"], "sub/b.excalidraw", "{l}");
    let b = e.json(&["links", "b", "--backlinks"]);
    assert_eq!(b["backlinks"][0]["path"], "a.excalidraw", "{b}");
    let c = e.json(&["links", "c"]);
    assert_eq!(c["unresolved"].as_array().unwrap().len(), 1, "{c}");
}

#[test]
fn search_builds_the_snapshot_so_the_next_call_is_warm() {
    let e = env();
    let _ = e.json(&["search", "foo"]);
    let snap: Vec<_> = walk(&e.state).into_iter().filter(|p| p.ends_with("index.bin")).collect();
    assert_eq!(snap.len(), 1, "snapshot saved under the state dir: {snap:?}");
    assert_eq!(e.json(&["search", "foo"])["totalMatches"], 2);
}

fn walk(d: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}

#[test]
fn vault_info_and_the_vault_ladder() {
    let e = env();
    let v = e.root.to_str().unwrap();
    let want = vault_ops::info(&Vault::new(e.root.clone(), "t".into(), false, None));
    assert_eq!(want["readOnly"], false);
    let got = e.json(&["vault", "info"]);
    assert_eq!(got["readOnly"], false);
    assert_eq!(got, want, "offline `vault info` matches the writable vault's info");
    assert_eq!(e.json(&["vault"])["name"], "vault");
    // $VAULTDRAW_VAULT, then <state>/recent-vault.
    let o = e.cmd().env("VAULTDRAW_VAULT", v).args(["vault", "info", "--json"]).output().unwrap();
    assert_eq!(code(&o), 0, "{}", err(&o));
    std::fs::write(e.state.join("recent-vault"), v).unwrap();
    let o = e.run(&["vault", "info", "--json"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(serde_json::from_slice::<Value>(&o.stdout).unwrap()["path"], want["path"]);
}

#[test]
fn no_vault_is_an_error_with_a_hint() {
    let e = env();
    let o = e.run(&["ls"]);
    assert_eq!(code(&o), 1, "{}", err(&o));
    assert!(err(&o).contains("(NO_VAULT)"), "{}", err(&o));
    assert!(o.stdout.is_empty());
}

#[test]
fn path_escapes_are_refused() {
    let e = env();
    let v = e.root.to_str().unwrap();
    for bad in ["../x", "/etc/passwd", "sub/../../x", ".excalidraw-vault/x"] {
        let o = e.run(&["--vault", v, "cat", "--path", bad]);
        assert_eq!(code(&o), 2, "{bad}: {}", err(&o));
        assert!(err(&o).contains("(INVALID_PATH)"), "{bad}: {}", err(&o));
    }
    let o = e.run(&["--vault", v, "ls", "../.."]);
    assert_eq!(code(&o), 2);
    let o = e.run(&["--vault", v, "cat", "missing"]);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(NOT_FOUND)"), "{}", err(&o));
}

#[test]
fn config_get_and_set_work_without_the_app() {
    let e = env();
    let set = e.json(&["config", "set", "control.enabled", "false"]);
    assert_eq!(set, json!({"changed": 1}));
    assert_eq!(e.json(&["config", "get", "control.enabled"]), json!({"key": "control.enabled", "value": false}));
    assert!(e.json(&["config", "get"])["value"]["control"]["enabled"] == false);
    assert!(e.config.join("config.toml").exists());
}

#[test]
fn config_get_source_and_path_all_name_the_layers() {
    let e = env();
    std::fs::write(e.config.join("config.toml"), "[editor]\nfont_size = 14\n").unwrap();
    let before = std::fs::read(e.config.join("config.toml")).unwrap();
    e.json(&["config", "set", "editor.font_size", "20"]);
    let r = e.json(&["config", "get", "editor.font_size", "--source"]);
    assert_eq!(r, json!({"key": "editor.font_size", "value": 20, "source": "overrides.toml", "hidden": {"file": "config.toml", "value": 14}}));
    let o = e.run(&["--vault", e.root.to_str().unwrap(), "config", "get", "editor.font_size", "--source"]);
    assert_eq!(String::from_utf8_lossy(&o.stdout).trim(), "20  (overrides.toml; config.toml says 14)");
    let r = e.json(&["config", "get", "interface.zoom", "--source"]);
    assert_eq!(r["source"], "default");
    // `--source` needs a key.
    assert_ne!(code(&e.run(&["config", "get", "--source"])), 0);
    let o = e.run(&["config", "path", "--all"]);
    let lines: Vec<String> = String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect();
    assert_eq!(lines, [e.config.join("config.toml").display().to_string(), e.state.join("overrides.toml").display().to_string()]);
    assert_eq!(std::fs::read(e.config.join("config.toml")).unwrap(), before, "config.toml bytes changed");
}

#[test]
fn app_live_never_goes_headless() {
    let e = env();
    let _held = e.hold_instance();
    let v = e.root.to_str().unwrap();
    let t = std::time::Instant::now();
    let o = e.run(&["--vault", v, "ls", "--json"]);
    assert_eq!(code(&o), 3, "{}", err(&o));
    assert!(err(&o).contains("(NOT_READY)"), "{}", err(&o));
    assert!(o.stdout.is_empty());
    assert!(t.elapsed().as_secs_f64() >= 1.9, "keeps retrying like NOT_READY");
}

#[test]
fn offline_with_a_live_app_is_refused() {
    let e = env();
    let v = e.root.to_str().unwrap();
    assert_eq!(code(&e.run(&["--vault", v, "--offline", "ls"])), 0, "no app: --offline is fine");
    let _held = e.hold_instance();
    let o = e.run(&["--vault", v, "--offline", "ls"]);
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(APP_LIVE)"), "{}", err(&o));
}

#[test]
fn scene_read_and_get_of_a_named_drawing_work_with_the_app_closed() {
    let e = env();
    let r = e.json(&["scene", "read", "a"]);
    assert_eq!((r["path"].as_str(), r["live"].as_bool(), r["total"].as_u64()), (Some("a.excalidraw"), Some(false), Some(2)));
    assert!(r["version"].as_str().unwrap().starts_with('s'));
    assert_eq!(e.json(&["scene", "read", "a", "--type", "text"])["counts"], json!({"text": 1}));
    let g = e.json(&["scene", "get", "t0", "nope", "--in", "sub/b.excalidraw"]);
    assert_eq!(g["elements"][0]["text"], "beta foo #graph #dp");
    assert_eq!(g["missing"], json!(["nope"]));
    // The drawing on screen has no offline answer.
    let v = e.root.to_str().unwrap();
    let o = e.run(&["--vault", v, "scene", "read"]);
    assert_eq!(code(&o), 3, "{}", err(&o));
    assert!(err(&o).contains("NOT_RUNNING"), "{}", err(&o));
    let o = e.run(&["--vault", v, "scene", "read", "a", "--scope", "viewport"]);
    assert_ne!(code(&o), 0);
}

#[test]
fn window_commands_still_need_the_app() {
    let e = env();
    let v = e.root.to_str().unwrap();
    for args in [
        vec!["mv", "a", "z"],
        vec!["trash", "a"],
        vec!["open", "a"],
        vec!["tabs"],
        vec!["events"],
        vec!["quit"],
    ] {
        let mut child = e.cmd().args(["--vault", v]).args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        // The command may exit before reading its input (EPIPE on Linux): that is fine.
        let _ = std::io::Write::write_all(&mut child.stdin.take().unwrap(), b"{}");
        let o = child.wait_with_output().unwrap();
        assert_eq!(code(&o), 3, "{args:?}: {}", err(&o));
        assert!(err(&o).contains("(NOT_RUNNING)"), "{args:?}: {}", err(&o));
    }
}

#[test]
fn print_request_never_goes_headless() {
    let e = env();
    let o = e.run(&["ls", "--print-request"]);
    assert_eq!(code(&o), 0);
    assert!(String::from_utf8_lossy(&o.stdout).contains("vault.list"));
}

#[test]
fn name_targets_resolve_through_the_index_like_the_app() {
    let e = env();
    let mut ix = vaultdraw_core::search::load_or_build(&e.root, &e.state.join("x.bin")).unwrap();
    let li = ix.build_links();
    ix.install_links(li);
    let by = |n: &str| vaultdraw_core::links::resolve_name(&ix, n);
    let p = target::resolve(&e.root, &json!({"file": "b"}), target::Need::File, &by).unwrap();
    assert_eq!(p, "sub/b.excalidraw");
}

/// Every file and folder under `dir`, to prove a command wrote nothing.
fn tree(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        out.push(e.path());
        if e.path().is_dir() {
            out.extend(tree(&e.path()));
        }
    }
    out.sort();
    out
}

#[test]
fn config_check_reports_lines_and_exits_by_severity() {
    let e = env();
    let o = e.run(&["config", "check"]);
    assert_eq!(code(&o), 0, "no config file is fine: {}", err(&o));
    std::fs::write(e.config.join("config.toml"), "[interface]\nzom = 1\n").unwrap();
    let o = e.run(&["config", "check"]);
    assert_eq!(code(&o), 0, "a warning alone passes");
    let out = String::from_utf8_lossy(&o.stdout).into_owned();
    assert!(out.contains("config.toml:2:1: warning: unknown key interface.zom"), "{out}");
    assert!(out.contains("did you mean interface.zoom?"), "{out}");
    let o = e.run(&["config", "check", "--strict"]);
    assert_eq!(code(&o), 1, "--strict fails on warnings");
    assert!(err(&o).contains("CONFIG_INVALID"), "{}", err(&o));
    std::fs::write(e.config.join("config.toml"), "[interface]\nzoom = \"big\"\n").unwrap();
    let before = tree(e.root.parent().unwrap());
    let o = e.run(&["--json", "config", "check"]);
    assert_eq!(code(&o), 1, "an error fails");
    let v: Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(v["errors"], 1);
    assert_eq!(v["problems"][0]["line"], 2);
    assert_eq!(v["problems"][0]["key"], "interface.zoom");
    assert_eq!(tree(e.root.parent().unwrap()), before, "config check writes nothing");
}

#[test]
fn config_schema_prints_the_embedded_schema() {
    let e = env();
    let o = e.run(&["config", "schema"]);
    assert_eq!(code(&o), 0);
    let v: Value = serde_json::from_slice(&o.stdout).unwrap();
    assert!(v["properties"]["interface"]["properties"]["zoom"].is_object(), "{v}");
}

#[test]
fn doctor_is_read_only_and_works_without_the_app() {
    let e = env();
    std::fs::write(e.config.join("config.toml"), "[interface]\nzoom = 120\n").unwrap();
    let before = tree(e.root.parent().unwrap());
    let v = e.root.to_str().unwrap();
    let o = e.run(&["--vault", v, "doctor"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let out = String::from_utf8_lossy(&o.stdout).into_owned();
    assert!(out.contains("read-only: nothing was changed"), "{out}");
    assert!(out.contains("interface.zoom = 120  (config.toml)"), "{out}");
    assert!(out.contains("not running"), "{out}");
    assert!(out.contains("(--vault)"), "{out}");
    assert!(out.contains("no app (socket absent)"), "{out}");
    let j = e.json(&["doctor"]);
    assert_eq!(j["versions"]["appState"], "not running");
    assert_eq!(j["config"]["changed"][0]["key"], "interface.zoom");
    assert_eq!(tree(e.root.parent().unwrap()), before, "doctor writes nothing");
}

#[test]
fn doctor_names_a_running_app_with_the_socket_off() {
    let e = env();
    std::fs::write(e.config.join("config.toml"), "[control]\nenabled = false\n").unwrap();
    let _lock = e.hold_instance();
    let o = e.run(&["doctor"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let out = String::from_utf8_lossy(&o.stdout).into_owned();
    assert!(out.contains("running, control socket off"), "{out}");
}
