//! The `vaultdraw` command's offline `new` / `write` / `cat` / `ls` on REAL volumes (exFAT, FAT32,
//! APFS, HFS+). Skipped unless `VAULTDRAW_TEST_VOLUMES` lists mounted folders (colon-separated);
//! see `vaultdraw-core/tests/volumes.rs`. `mv` needs the running app (no offline form), so the
//! rename safety of a volume is covered by the core test. Prints `VOLUME <path> <case> PASS|FAIL`.
use serde_json::{json, Value};
use std::{io::Write, path::{Path, PathBuf}, process::{Command, Output, Stdio}};

fn scene(t: &str) -> Value {
    json!({"type": "excalidraw", "version": 2, "elements": [{"id": "t", "type": "text", "text": t, "x": 0, "y": 0, "width": 10, "height": 10}], "appState": {}, "files": {}})
}

struct Env { root: PathBuf, state: PathBuf, runtime: PathBuf, config: PathBuf, _tmp: tempfile::TempDir }

fn run(e: &Env, args: &[&str], stdin: &str) -> Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
    c.env_clear().env("HOME", "/nonexistent-vd-home")
        .env("VAULTDRAW_STATE_DIR", &e.state).env("VAULTDRAW_RUNTIME_DIR", &e.runtime).env("VAULTDRAW_CONFIG_DIR", &e.config)
        .args(["--vault", e.root.to_str().unwrap(), "--json"]).args(args)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    child.wait_with_output().unwrap()
}
fn ok(e: &Env, args: &[&str], stdin: &str) -> Result<Value, String> {
    let o = run(e, args, stdin);
    if o.status.code() != Some(0) { return Err(format!("{args:?}: exit {:?}: {}", o.status.code(), String::from_utf8_lossy(&o.stderr))); }
    serde_json::from_slice(&o.stdout).map_err(|x| format!("{args:?}: bad json: {x}"))
}

fn env_on(mount: &Path, tag: &str) -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().canonicalize().unwrap();
    let root = mount.join(format!("vdcli-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let e = Env { root, state: base.join("state"), runtime: base.join("run"), config: base.join("config"), _tmp: tmp };
    for d in [&e.state, &e.runtime, &e.config] { std::fs::create_dir_all(d).unwrap(); }
    e
}

fn cases(e: &Env) -> Vec<(&'static str, Result<String, String>)> {
    let mut out = Vec::new();
    let mut step = |name: &'static str, r: Result<String, String>| out.push((name, r));
    // new + write + chained expected revisions
    step("new_creates_a_drawing", (|| {
        ok(e, &["new", "fresh"], "")?;
        let p = e.root.join("fresh.excalidraw");
        if !p.is_file() { return Err("fresh.excalidraw missing".into()); }
        #[cfg(unix)] { use std::os::unix::fs::MetadataExt; if std::fs::metadata(&p).unwrap().nlink() != 1 { return Err("nlink != 1".into()); } }
        Ok("blank drawing created, nlink 1".into())
    })());
    step("write_overwrite_and_conflict", (|| {
        let a = scene("one");
        let r = ok(e, &["write", "a.excalidraw"], &a.to_string())?;
        let rev = r["revision"].as_str().ok_or("no revision")?.to_string();
        if std::fs::read(e.root.join("a.excalidraw")).unwrap() != serde_json::to_string(&a).unwrap().into_bytes() { return Err("bytes differ".into()); }
        let b = scene("two");
        let r2 = ok(e, &["write", "a.excalidraw", "--expected-revision", &rev], &b.to_string())?;
        let rev2 = r2["revision"].as_str().ok_or("no revision")?.to_string();
        // A stale revision is refused and the file stays.
        let o = run(e, &["write", "a.excalidraw", "--expected-revision", &rev], &scene("three").to_string());
        if o.status.code() == Some(0) { return Err("stale write accepted".into()); }
        if !String::from_utf8_lossy(&o.stderr).contains("CONFLICT") { return Err(format!("stale write error: {}", String::from_utf8_lossy(&o.stderr))); }
        let o = { let mut c = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli")); c.env_clear().env("HOME", "/nonexistent-vd-home").env("VAULTDRAW_STATE_DIR", &e.state).env("VAULTDRAW_RUNTIME_DIR", &e.runtime).env("VAULTDRAW_CONFIG_DIR", &e.config).args(["--vault", e.root.to_str().unwrap(), "cat", "a.excalidraw"]).stdin(Stdio::null()); c.output().unwrap() };
        let now: Value = serde_json::from_slice(&o.stdout).map_err(|x| format!("cat output: {x}: {}", String::from_utf8_lossy(&o.stdout)))?;
        if now != b { return Err(format!("file changed by the refused write: {now}")); }
        let _ = rev2;
        Ok("write, chained revision, stale refused, cat roundtrips".into())
    })());
    step("create_flag_refuses_existing", (|| {
        let o = run(e, &["write", "a.excalidraw", "--create"], &scene("x").to_string());
        if o.status.code() == Some(0) { return Err("--create replaced an existing file".into()); }
        Ok("--create onto an existing drawing refused".into())
    })());
    step("many_writes_leave_no_temp", (|| {
        let mut rev = ok(e, &["write", "m.excalidraw"], &scene("0").to_string())?["revision"].as_str().unwrap().to_string();
        for i in 1..=8 {
            rev = ok(e, &["write", "m.excalidraw", "--expected-revision", &rev], &scene(&i.to_string()).to_string())?["revision"].as_str().unwrap().to_string();
        }
        let tmp: Vec<String> = std::fs::read_dir(&e.root).unwrap().filter_map(|x| x.ok()).map(|x| x.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".excalidraw-tmp-")).collect();
        if !tmp.is_empty() { return Err(format!("temp files left: {tmp:?}")); }
        Ok("9 writes, no temp files".into())
    })());
    step("ls_lists_only_drawings", (|| {
        let v = ok(e, &["ls"], "")?;
        let s = v.to_string();
        if s.contains("\"._") { return Err(format!("AppleDouble sidecar listed: {s}")); }
        for n in ["a.excalidraw", "fresh.excalidraw", "m.excalidraw"] { if !s.contains(n) { return Err(format!("{n} not listed: {s}")); } }
        Ok("ls shows the drawings, no ._ sidecars".into())
    })());
    out
}

#[test]
fn cli_on_real_volumes() {
    let Ok(list) = std::env::var("VAULTDRAW_TEST_VOLUMES") else {
        eprintln!("VAULTDRAW_TEST_VOLUMES not set: skipping the real-volume CLI tests");
        return;
    };
    let mut failures = 0;
    for (i, mount) in list.split(':').filter(|s| !s.is_empty()).enumerate() {
        let e = env_on(Path::new(mount), &i.to_string());
        let vol = Path::new(mount).file_name().unwrap().to_string_lossy().into_owned();
        for (name, r) in cases(&e) {
            match r { Ok(d) => println!("VOLUME {vol} cli:{name} PASS {d}"), Err(m) => { failures += 1; println!("VOLUME {vol} cli:{name} FAIL {m}") } }
        }
        let _ = std::fs::remove_dir_all(&e.root);
    }
    assert_eq!(failures, 0, "{failures} CLI case(s) failed");
}
