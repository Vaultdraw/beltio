//! Headless `write` / `new`: the built binary against a fixture vault, no app. Same bytes,
//! revision and recovery behaviour as the server's `file.write`, under the vault flock.
use fs2::FileExt;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use vaultdraw_core::staging;

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    runtime: PathBuf,
    config: PathBuf,
}

fn scene(text: &str) -> Value {
    json!({"type": "excalidraw", "version": 2, "elements": [{"id": "t", "type": "text", "text": text, "x": 0, "y": 0, "width": 10, "height": 10}], "appState": {}, "files": {}})
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let base = dunce::canonicalize(tmp.path()).unwrap();
    let root = base.join("vault");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("a.excalidraw"), scene("old").to_string()).unwrap();
    let (state, runtime, config) = (base.join("state"), base.join("run"), base.join("config"));
    for d in [&state, &runtime, &config] {
        std::fs::create_dir_all(d).unwrap();
    }
    Env { _tmp: tmp, root, state, runtime, config }
}

impl Env {
    /// `vaultdraw --vault <root> --json <args>` with `stdin` piped in.
    fn run(&self, args: &[&str], stdin: &str) -> Output {
        let mut c = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
        c.env_clear()
            .env("HOME", "/nonexistent-vd-home")
            .env("VAULTDRAW_STATE_DIR", &self.state)
            .env("VAULTDRAW_RUNTIME_DIR", &self.runtime)
            .env("VAULTDRAW_CONFIG_DIR", &self.config)
            .args(["--vault", self.root.to_str().unwrap()])
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = c.spawn().unwrap();
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        child.wait_with_output().unwrap()
    }
    fn ok(&self, args: &[&str], stdin: &str) -> Value {
        let mut a = vec!["--json"];
        a.extend_from_slice(args);
        let o = self.run(&a, stdin);
        assert_eq!(code(&o), 0, "{args:?}: {}", err(&o));
        serde_json::from_slice(&o.stdout).unwrap()
    }
    fn read(&self, rel: &str) -> Vec<u8> {
        std::fs::read(self.root.join(rel)).unwrap()
    }
    fn staged_dir(&self) -> PathBuf {
        staging::staged_dir(&self.state, &self.root)
    }
    fn staged(&self) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(self.staged_dir()).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }
    fn hold_flock(&self, pid: u32) -> std::fs::File {
        let f = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(self.root.join(".excalidraw-vault.lock")).unwrap();
        f.try_lock_exclusive().unwrap();
        f.set_len(0).unwrap();
        (&f).write_all(pid.to_string().as_bytes()).unwrap();
        f
    }
}

fn code(o: &Output) -> i32 {
    o.status.code().unwrap_or(-1)
}
fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

#[test]
fn write_offline_matches_the_servers_file_write() {
    let e = env();
    let s = scene("new");
    let r = e.ok(&["write", "a.excalidraw"], &s.to_string());
    let want = serde_json::to_string(&s).unwrap().into_bytes();
    assert_eq!(e.read("a.excalidraw"), want);
    assert_eq!(r["revision"], vaultdraw_core::revision(&want));
    assert_eq!(r["path"], "a.excalidraw");
    let o = e.run(&["cat", "a.excalidraw"], "");
    assert_eq!(serde_json::from_slice::<Value>(&o.stdout).unwrap(), s);

    let s2 = scene("again");
    let o = e.run(&["write", "a.excalidraw", "--expected-revision", "deadbeef"], &s2.to_string());
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(CONFLICT)"), "{}", err(&o));
    assert_eq!(e.read("a.excalidraw"), want);
    let o = e.run(&["write", "a.excalidraw", "--create"], &s2.to_string());
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(CONFLICT)"), "{}", err(&o));
    assert_eq!(e.read("a.excalidraw"), want);
    // An explicit current revision works; a missing file with the default rule is created.
    let rev = r["revision"].as_str().unwrap();
    e.ok(&["write", "a.excalidraw", "--expected-revision", rev], &s2.to_string());
    e.ok(&["write", "sub/fresh.excalidraw"], &s2.to_string());
    assert_eq!(e.read("sub/fresh.excalidraw"), serde_json::to_string(&s2).unwrap().into_bytes());
}

#[test]
fn write_offline_stages_the_previous_content() {
    let e = env();
    let old = e.read("a.excalidraw");
    e.ok(&["write", "a.excalidraw"], &scene("one").to_string());
    let fold = !staging::volume_case_sensitive(&e.root);
    let key = staging::key_for("a.excalidraw", fold);
    let rev16 = staging::rev16(&vaultdraw_core::revision(&old)).unwrap().to_string();
    let clone = staging::clone_name(&key, &rev16);
    let mut want = vec![format!("{key}.path"), clone.clone()];
    want.sort();
    assert_eq!(e.staged(), want);
    assert_eq!(std::fs::read(e.staged_dir().join(&clone)).unwrap(), old);
    assert_eq!(std::fs::read_to_string(e.staged_dir().join(format!("{key}.path"))).unwrap(), "a.excalidraw");

    e.ok(&["write", "a.excalidraw"], &scene("two").to_string());
    assert_eq!(e.staged().len(), 2, "a second overwrite adds no second clone: {:?}", e.staged());
    assert_eq!(std::fs::read(e.staged_dir().join(&clone)).unwrap(), old);

    let before = e.staged();
    e.ok(&["new", "fresh"], "");
    assert_eq!(e.staged(), before, "new stages nothing");
}

#[test]
fn new_offline_creates_a_blank_drawing_and_appends_the_extension() {
    let e = env();
    let r = e.ok(&["new", "sub/n"], "");
    assert_eq!(r, json!({"path": "sub/n.excalidraw"}));
    let blank: Value = serde_json::from_slice(&e.read("sub/n.excalidraw")).unwrap();
    assert_eq!(blank, json!({"type":"excalidraw","version":2,"source":"vaultdraw-cli","elements":[],"appState":{"viewBackgroundColor":"#ffffff","viewBackgroundPattern":null,"pageSetup":null},"files":{}}));

    let o = e.run(&["new", "nofolder/x"], "");
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(NOT_FOUND)"), "{}", err(&o));
    assert!(!e.root.join("nofolder").exists());

    let s = scene("from stdin");
    e.ok(&["new", "from.excalidraw", "--from", "-"], &s.to_string());
    assert_eq!(e.read("from.excalidraw"), serde_json::to_string(&s).unwrap().into_bytes());

    let o = e.run(&["new", "a"], "");
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(CONFLICT)"), "{}", err(&o));
    let o = e.run(&["new", "arr.excalidraw", "--from", "-"], "[1,2]");
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(INVALID_PARAMS)") || err(&o).contains("-32602"), "{}", err(&o));
    assert!(!e.root.join("arr.excalidraw").exists());
}

#[test]
fn write_refuses_when_another_process_holds_the_vault_lock() {
    let e = env();
    let old = e.read("a.excalidraw");
    let held = e.hold_flock(424242);
    let o = e.run(&["write", "a.excalidraw"], &scene("x").to_string());
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(READ_ONLY)") && err(&o).contains("424242"), "{}", err(&o));
    let o = e.run(&["new", "n"], "");
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(READ_ONLY)") && err(&o).contains("424242"), "{}", err(&o));
    let o = e.run(&["--json", "new", "n"], "");
    let line: Value = serde_json::from_slice(&o.stderr).unwrap();
    assert_eq!(line["data"], json!({"reason": "lockedByOtherProcess", "holderPid": 424242}));
    assert_eq!(e.read("a.excalidraw"), old);
    assert!(!e.root.join("n.excalidraw").exists());
    drop(held);
    e.ok(&["write", "a.excalidraw"], &scene("x").to_string());
    e.ok(&["new", "n"], "");
}

#[test]
fn write_offline_refused_while_an_app_is_live() {
    let e = env();
    let old = e.read("a.excalidraw");
    let f = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(e.runtime.join("instance.lock")).unwrap();
    f.try_lock_exclusive().unwrap();
    let o = e.run(&["write", "a.excalidraw"], &scene("x").to_string());
    assert_eq!(code(&o), 3, "{}", err(&o));
    assert!(err(&o).contains("(NOT_READY)"), "{}", err(&o));
    let o = e.run(&["--offline", "write", "a.excalidraw"], &scene("x").to_string());
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(APP_LIVE)"), "{}", err(&o));
    let o = e.run(&["--offline", "new", "n"], "");
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("(APP_LIVE)"), "{}", err(&o));
    assert_eq!(e.read("a.excalidraw"), old);
    assert!(!e.root.join("n.excalidraw").exists());
}

#[test]
fn path_escapes_for_write_and_new_are_refused() {
    let e = env();
    for bad in ["../x.excalidraw", ".excalidraw-vault/x.excalidraw"] {
        for args in [vec!["write", "--path", bad], vec!["new", bad]] {
            let o = e.run(&args, &scene("x").to_string());
            assert_eq!(code(&o), 2, "{args:?}: {}", err(&o));
            assert!(err(&o).contains("(INVALID_PATH)"), "{args:?}: {}", err(&o));
        }
    }
    assert!(!e.root.parent().unwrap().join("x.excalidraw").exists());
    assert!(!e.root.join(".excalidraw-vault/x.excalidraw").exists());
}

#[test]
fn a_successful_write_leaves_no_temp_file_and_no_recovery_snapshot() {
    let e = env();
    e.ok(&["write", "a.excalidraw"], &scene("x").to_string());
    e.ok(&["new", "b"], "");
    let mut names: Vec<String> = std::fs::read_dir(&e.root).unwrap().flatten().map(|d| d.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    assert_eq!(names, [".excalidraw-vault", ".excalidraw-vault.lock", "a.excalidraw", "b.excalidraw", "sub"], "no temp files");
    let rec = e.root.join(".excalidraw-vault/recovery");
    let left: Vec<_> = std::fs::read_dir(&rec).into_iter().flatten().flatten().collect();
    assert!(left.is_empty(), "recovery snapshots removed after commit: {left:?}");
}

#[test]
fn new_offline_applies_the_paper_and_page_defaults_of_config_and_vault() {
    let e = env();
    std::fs::write(
        e.config.join("config.toml"),
        "[paper]\nstyle = \"grid\"\nspacing = 30\n[page]\nmode = \"page\"\nsize = \"a5\"\norientation = \"landscape\"\npaper_theme = \"old_school\"\n",
    )
    .unwrap();
    e.ok(&["new", "paged"], "");
    let s: Value = serde_json::from_slice(&e.read("paged.excalidraw")).unwrap();
    let st = &s["appState"];
    assert_eq!(st["viewBackgroundColor"], "#f8efd4");
    assert_eq!(st["viewBackgroundPattern"]["type"], "grid");
    assert_eq!(st["viewBackgroundPattern"]["spacing"], 30);
    assert_eq!(st["viewBackgroundPattern"]["color"], "#8fb1d9");
    assert_eq!(st["pageSetup"]["size"], "a5");
    assert_eq!((st["pageSetup"]["width"].clone(), st["pageSetup"]["height"].clone()), (json!(794), json!(559)));
    assert_eq!(st["pageSetup"]["paperTheme"], "oldSchool");

    // The vault's own paper style wins over config.toml.
    std::fs::create_dir_all(e.root.join(".excalidraw-vault")).unwrap();
    std::fs::write(e.root.join(".excalidraw-vault/settings.toml"), "[paper]\nstyle = \"dots\"\n").unwrap();
    e.ok(&["new", "vaulty"], "");
    let s: Value = serde_json::from_slice(&e.read("vaulty.excalidraw")).unwrap();
    assert_eq!(s["appState"]["viewBackgroundPattern"]["type"], "dots");
    assert_eq!(s["appState"]["viewBackgroundPattern"]["spacing"], 20);

    // `--from` keeps the given scene untouched.
    let given = scene("mine");
    e.ok(&["new", "given", "--from", "-"], &given.to_string());
    let s: Value = serde_json::from_slice(&e.read("given.excalidraw")).unwrap();
    assert_eq!(s["appState"], json!({}));
}
