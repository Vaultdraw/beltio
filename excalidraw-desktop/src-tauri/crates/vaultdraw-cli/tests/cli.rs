mod common;
use common::*;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn parse(s: &str) -> Value {
    serde_json::from_str(s.trim()).unwrap()
}

fn commands() -> Value {
    json!({"commands":[
        {"id":"vault.newDrawing","title":"New drawing","category":"Vault","keys":["Mod+N"],"available":true},
        {"id":"appearance.toggleMode","title":"Toggle mode","category":"Appearance","keys":[],"available":false}]})
}

fn app(method: &str, params: &Value) -> Result<Value, (i64, String, Option<&'static str>)> {
    match method {
        "app.status" => Ok(status_result()),
        "rpc.discover" => Ok(vaultdraw_protocol::methods::discover("0.9.0")),
        "command.list" => Ok(commands()),
        "command.run" => match params["id"].as_str() {
            Some("vault.newDrawing") => Ok(json!({"ran":true,"id":"vault.newDrawing"})),
            Some(id) => Err((-32000, "Command is not available now".into(), Some(if id == "nope" { "NOT_FOUND" } else { "UNAVAILABLE" }))),
            None => Err((-32602, "id required".into(), None)),
        },
        "plugin.commands" => Ok(json!({"plugins":[
            {"id":"hello","name":"Hello","version":"1.0.0","enabled":true,"state":"idle","commands":[{"id":"hello.say","title":"Say hello"}]},
            {"id":"off","name":"Off","version":"0.1.0","enabled":false,"state":"idle","commands":[]}]})),
        "plugin.methods" => Ok(json!({"methods":[{"plugin":"hello","method":"greet","title":"Greet","mcp":true,"write":false}]})),
        "plugin.call" => match params["method"].as_str() {
            Some("greet") => Ok(json!({"plugin":"hello","method":"greet","result":{"said":params["params"]}})),
            _ => Err((-32000, "No method".into(), Some("NOT_FOUND"))),
        },
        "plugin.run" => match params["id"].as_str() {
            Some("hello.say") => Ok(json!({"ran":true,"id":"hello.say","plugin":"hello"})),
            _ => Err((-32000, "No plugin command".into(), Some("NOT_FOUND"))),
        },
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

#[test]
fn status_json_is_the_raw_result() {
    let f = Fake::start(app);
    let o = vd(&["status", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(parse(&out(&o)), status_result());
    // One round trip, no hello.
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["method"], "app.status");
}

#[test]
fn status_human_text() {
    let f = Fake::start(app);
    let o = vd(&["status"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    assert_eq!(
        out(&o),
        "Vaultdraw 0.9.0 (api 1, pid 4242)\nvault: DSA (/v/DSA)\ndrawing: Graphs/BFS.excalidraw (unsaved)\ntabs: 3\n"
    );
}

#[test]
fn socket_from_env_variable() {
    let f = Fake::start(app);
    let mut c = std::process::Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
    let o = c.args(["status", "--json"]).env_clear().env("VAULTDRAW_SOCKET", &f.socket).output().unwrap();
    assert_eq!(code(&o), 0, "{}", err(&o));
}

#[test]
fn methods_json_and_human() {
    let f = Fake::start(app);
    let o = vd(&["methods", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    assert_eq!(parse(&out(&o)), vaultdraw_protocol::methods::discover("0.9.0"));
    let h = out(&vd(&["methods"], Some(&f.socket), None));
    assert!(h.lines().any(|l| l.starts_with("app.status  ") && l.contains("Is the app running")), "{h}");
}

#[test]
fn cmd_list_json_human_and_ids() {
    let f = Fake::start(app);
    let o = vd(&["cmd", "list", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    assert_eq!(parse(&out(&o)), commands());
    let h = out(&vd(&["cmd", "list"], Some(&f.socket), None));
    assert!(h.lines().next().unwrap().starts_with("ID"), "{h}");
    assert!(h.contains("vault.newDrawing") && h.contains("Mod+N") && h.contains("yes") && h.contains("no"), "{h}");
    let ids = out(&vd(&["cmd", "list", "--ids"], Some(&f.socket), None));
    assert_eq!(ids, "vault.newDrawing\nappearance.toggleMode\n");
}

#[test]
fn cmd_run_long_and_short_form() {
    let f = Fake::start(app);
    for args in [&["cmd", "run", "vault.newDrawing", "--json"][..], &["cmd", "vault.newDrawing", "--json"][..]] {
        let o = vd(args, Some(&f.socket), None);
        assert_eq!(code(&o), 0, "{}", err(&o));
        assert_eq!(parse(&out(&o)), json!({"ran":true,"id":"vault.newDrawing"}));
    }
    let h = out(&vd(&["cmd", "vault.newDrawing"], Some(&f.socket), None));
    assert_eq!(h, "ran vault.newDrawing\n");
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen[0]["params"], json!({"id":"vault.newDrawing"}));
}

#[test]
fn cmd_with_prefix_id_containing_spaces() {
    let f = Fake::start(app);
    let o = vd(&["cmd", "--print-request", "drawing.open:Graphs/BFS and DFS"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    let v = parse(&out(&o));
    assert_eq!(v["params"]["id"], "drawing.open:Graphs/BFS and DFS");
}

#[test]
fn exit_2_when_the_app_refuses() {
    let f = Fake::start(app);
    let o = vd(&["cmd", "run", "other.cmd"], Some(&f.socket), None);
    assert_eq!(code(&o), 2);
    assert_eq!(err(&o), "vaultdraw: Command is not available now (UNAVAILABLE)\n");
    assert_eq!(out(&o), "");
    let o = vd(&["cmd", "run", "nope"], Some(&f.socket), None);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("(NOT_FOUND)"));
}

#[test]
fn exit_1_on_usage_errors() {
    let o = vd(&["frobnicate"], None, None);
    assert_eq!(code(&o), 1);
    assert!(!err(&o).is_empty());
    assert_eq!(code(&vd(&["cmd"], None, None)), 1);
    assert_eq!(code(&vd(&["status", "--timeout", "abc"], None, None)), 1);
    assert_eq!(code(&vd(&["--help"], None, None)), 0);
}

#[test]
fn exit_1_on_io_failure_from_a_dead_peer() {
    // A server that closes the connection without answering.
    let dir = std::path::PathBuf::from(format!("/tmp/vd-dead-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("c.sock");
    let l = std::os::unix::net::UnixListener::bind(&sock).unwrap();
    std::thread::spawn(move || for s in l.incoming() { drop(s); });
    let o = vd(&["status"], Some(&sock), None);
    assert_eq!(code(&o), 1, "{}", err(&o));
    assert!(err(&o).starts_with("vaultdraw: "));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn not_running_status() {
    let o = vd(&["status", "--json"], None, None);
    assert_eq!(code(&o), 3);
    assert_eq!(parse(&out(&o)), json!({"running": false}));
    assert!(err(&o).contains("(NOT_RUNNING)"), "{}", err(&o));
    let o = vd(&["status"], None, None);
    assert_eq!(code(&o), 3);
    assert_eq!(out(&o), "");
}

#[test]
fn version_never_fails() {
    let o = vd(&["version", "--json"], None, None);
    assert_eq!(code(&o), 0);
    let v = parse(&out(&o));
    assert_eq!(v["api"], 1);
    assert!(v["app"].is_null());
    assert!(out(&vd(&["version"], None, None)).contains("not running"));
    let f = Fake::start(app);
    let v = parse(&out(&vd(&["version", "--json"], Some(&f.socket), None)));
    assert_eq!(v["app"], json!({"version":"0.9.0","api":1}));
}

#[test]
fn print_request_does_not_connect() {
    for (args, method) in [(&["status"][..], "app.status"), (&["methods"][..], "rpc.discover"), (&["cmd", "list"][..], "command.list")] {
        let mut a = args.to_vec();
        a.push("--print-request");
        let o = vd(&a, None, None);
        assert_eq!(code(&o), 0);
        assert_eq!(out(&o), format!("{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"{method}\"}}\n"));
    }
    let o = vd(&["cmd", "run", "a.b", "--print-request"], None, None);
    assert_eq!(out(&o), "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"command.run\",\"params\":{\"id\":\"a.b\"}}\n");
}

#[test]
fn cmd_list_falls_back_to_the_snapshot() {
    let state = tempfile::tempdir().unwrap();
    std::fs::write(state.path().join("commands.json"), serde_json::to_string(&commands()).unwrap()).unwrap();
    let sp = state.path().to_path_buf();
    let o = vd(&["cmd", "list", "--json"], None, Some(&sp));
    assert_eq!(code(&o), 0, "{}", err(&o));
    let v = parse(&out(&o));
    let list = v["commands"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().all(|c| c.get("available").is_none()));
    assert_eq!(out(&vd(&["cmd", "list", "--ids"], None, Some(&sp))), "vault.newDrawing\nappearance.toggleMode\n");
    let h = out(&vd(&["cmd", "list"], None, Some(&sp)));
    assert!(!h.contains("AVAILABLE"));
}

#[test]
fn cmd_list_without_app_or_snapshot_exits_3() {
    let state = tempfile::tempdir().unwrap();
    let o = vd(&["cmd", "list"], None, Some(&state.path().to_path_buf()));
    assert_eq!(code(&o), 3);
}

#[test]
fn not_ready_is_retried_then_succeeds() {
    let n = Arc::new(AtomicUsize::new(0));
    let n2 = n.clone();
    let f = Fake::start(move |m, p| {
        if m == "command.list" && n2.fetch_add(1, Ordering::SeqCst) < 3 {
            return Err((-32000, "The window is still loading".into(), Some("NOT_READY")));
        }
        app(m, p)
    });
    let o = vd(&["cmd", "list", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(parse(&out(&o)), commands());
    assert_eq!(n.load(Ordering::SeqCst), 4);
}

#[test]
fn not_ready_forever_exits_3() {
    let f = Fake::start(|_, _| Err((-32000, "The window is still loading".into(), Some("NOT_READY"))));
    let t = std::time::Instant::now();
    let o = vd(&["status", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 3);
    assert!(err(&o).contains("(NOT_READY)"));
    assert_eq!(parse(&out(&o)), json!({"running": false}));
    assert!(t.elapsed().as_secs_f64() >= 1.9);
}

#[test]
fn protocol_mismatch_exits_4() {
    let f = Fake::start(|m, _| match m {
        "rpc.discover" => Ok(json!({"api":99,"apiMin":98,"app":"9.0.0","methods":[]})),
        _ => Err((-32601, "Method not found".into(), None)),
    });
    let o = vd(&["status"], Some(&f.socket), None);
    assert_eq!(code(&o), 4);
    assert!(err(&o).contains("restart Vaultdraw after an update"), "{}", err(&o));
}

#[test]
fn method_not_found_within_range_is_a_refusal() {
    let f = Fake::start(|m, _| match m {
        "rpc.discover" => Ok(vaultdraw_protocol::methods::discover("0.9.0")),
        _ => Err((-32601, "Method not found".into(), None)),
    });
    let o = vd(&["status"], Some(&f.socket), None);
    assert_eq!(code(&o), 2);
}

#[test]
fn unparsable_reply_checks_the_api_level() {
    let dir = std::path::PathBuf::from(format!("/tmp/vd-bad-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("c.sock");
    let l = std::os::unix::net::UnixListener::bind(&sock).unwrap();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader, Write};
        for s in l.incoming().flatten() {
            let mut w = s.try_clone().unwrap();
            for line in BufReader::new(s).lines().flatten() {
                let v: Value = serde_json::from_str(&line).unwrap();
                let reply = if v["method"] == "rpc.discover" {
                    json!({"jsonrpc":"2.0","id":v["id"],"result":{"api":7,"apiMin":7,"app":"7","methods":[]}}).to_string()
                } else {
                    "this is not json".to_string()
                };
                let _ = writeln!(w, "{reply}");
            }
        }
    });
    let o = vd(&["status"], Some(&sock), None);
    assert_eq!(code(&o), 4, "{}", err(&o));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn raw_sends_each_line_and_prints_replies() {
    use std::io::Write;
    let f = Fake::start(app);
    let mut c = std::process::Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
    let mut child = c
        .args(["raw", "--socket"])
        .arg(&f.socket)
        .env_clear()
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"app.status\"}\n\n{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"nope\"}\n")
        .unwrap();
    let o = child.wait_with_output().unwrap();
    assert_eq!(code(&o), 0);
    let lines: Vec<Value> = out(&o).lines().map(parse).collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["id"], 5);
    assert_eq!(lines[0]["result"]["app"], "0.9.0");
    assert_eq!(lines[1]["error"]["code"], -32601);
}

#[test]
fn completions_for_every_shell_and_man() {
    for shell in ["bash", "zsh", "fish", "elvish", "nushell"] {
        let o = vd(&["completions", shell], None, None);
        assert_eq!(code(&o), 0, "{shell}: {}", err(&o));
        assert!(out(&o).contains("vaultdraw"), "{shell}");
        assert!(out(&o).len() > 200, "{shell}");
    }
    let o = vd(&["man"], None, None);
    assert_eq!(code(&o), 0);
    assert!(out(&o).contains(".TH vaultdraw"));
    assert_eq!(code(&vd(&["completions", "tcsh"], None, None)), 1);
}

// ---- scene read | get | selection | apply (live only) ----

fn scene_elements() -> Value {
    json!([
        {"id": "a1", "type": "rectangle", "x": 10, "y": 20.25, "width": 100, "height": 50.5},
        {"id": "t2", "type": "text", "x": -5, "y": 0, "width": 80, "height": 25, "text": "Hello world, this label is longer than forty characters"},
    ])
}

fn scene_app(method: &str, params: &Value) -> Result<Value, (i64, String, Option<&'static str>)> {
    match method {
        "scene.read" => Ok(json!({"path": "a.excalidraw", "live": true, "readOnly": false, "version": "s1x", "total": 5, "returned": 2,
            "truncated": true, "counts": {"rectangle": 4, "text": 1}, "elements": scene_elements(), "selection": [],
            "viewport": {"x": 0, "y": 0, "width": 800, "height": 600, "zoom": 1}})),
        "scene.get" => Ok(json!({"path": "a.excalidraw", "version": "s1x", "elements": [scene_elements()[0].clone()], "missing": ["zz"]})),
        "scene.selection" => Ok(json!({"path": "a.excalidraw", "version": "s1x", "ids": ["a1"], "elements": [scene_elements()[0].clone()]})),
        "scene.apply" => {
            if params["dryRun"] == true {
                Ok(json!({"path": "a.excalidraw", "live": true, "dryRun": true, "applied": 0, "valid": true, "version": "s1x"}))
            } else if params["ifVersion"] == "stale" {
                Err((-32000, "The drawing changed".into(), Some("CONFLICT")))
            } else {
                Ok(json!({"path": "a.excalidraw", "live": true, "applied": 2, "ids": ["n1", "n2"], "version": "s2y"}))
            }
        }
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

fn last_request(f: &Fake) -> Value {
    f.seen.lock().unwrap().last().cloned().unwrap()
}

#[test]
fn scene_read_request_shape_and_human_output() {
    let f = Fake::start(scene_app);
    let o = vd(&["scene", "read"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(last_request(&f)["method"], "scene.read");
    assert_eq!(last_request(&f)["params"], json!({}));
    let text = out(&o);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert_eq!(lines[0], "a1  rectangle  10,20.3  100\u{d7}50.5");
    assert_eq!(lines[1], "t2  text       -5,0     80\u{d7}25     Hello world, this label is longer than f");
    assert_eq!(lines[2], "2 of 5 elements, version s1x");

    let o = vd(
        &["scene", "read", "Graphs/BFS", "--scope", "viewport", "--type", "text,arrow", "--id", "a,b", "--limit", "50", "--offset", "10", "--json"],
        Some(&f.socket),
        None,
    );
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(
        last_request(&f)["params"],
        json!({"path": "Graphs/BFS", "scope": "viewport", "types": ["text", "arrow"], "ids": ["a", "b"], "limit": 50, "offset": 10})
    );
    assert_eq!(parse(&out(&o))["version"], "s1x");
    // A link-style name goes as `file`.
    vd(&["scene", "read", "BFS"], Some(&f.socket), None);
    assert_eq!(last_request(&f)["params"], json!({"file": "BFS"}));
    // A bad scope is refused before anything is sent.
    let before = f.seen.lock().unwrap().len();
    assert_ne!(code(&vd(&["scene", "read", "--scope", "everything"], Some(&f.socket), None)), 0);
    assert_eq!(f.seen.lock().unwrap().len(), before);
}

#[test]
fn scene_get_and_selection() {
    let f = Fake::start(scene_app);
    let o = vd(&["scene", "get", "a1", "zz", "--in", "BFS"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(last_request(&f)["method"], "scene.get");
    assert_eq!(last_request(&f)["params"], json!({"file": "BFS", "ids": ["a1", "zz"]}));
    assert_eq!(out(&o), "a1  rectangle  10,20.3  100\u{d7}50.5\nmissing: zz\n1 elements, version s1x\n");

    let o = vd(&["scene", "selection", "a.excalidraw"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(last_request(&f)["method"], "scene.selection");
    assert_eq!(last_request(&f)["params"], json!({"path": "a.excalidraw"}));
    assert_eq!(out(&o), "a1  rectangle  10,20.3  100\u{d7}50.5\n1 selected, version s1x\n");
    vd(&["scene", "selection"], Some(&f.socket), None);
    assert_eq!(last_request(&f)["params"], json!({}));
    // get needs at least one id.
    assert_ne!(code(&vd(&["scene", "get"], Some(&f.socket), None)), 0);
}

const OPS: &str = r#"[{"op":"add","element":{"type":"rectangle","x":0,"y":0,"width":10,"height":10}},{"op":"delete","id":"a1"}]"#;

#[test]
fn scene_apply_ops_from_stdin_and_object_form() {
    let f = Fake::start(scene_app);
    let o = vd_in(&["scene", "apply"], Some(&f.socket), None, OPS);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let req = last_request(&f);
    assert_eq!(req["method"], "scene.apply");
    assert_eq!(req["params"], json!({"ops": serde_json::from_str::<Value>(OPS).unwrap()}));
    assert_eq!(out(&o), "applied 2 changes (version s2y)\n");

    let wrapped = format!(r#"{{"ops": {OPS}}}"#);
    let o = vd_in(&["scene", "apply", "BFS", "--ops", "-", "--json"], Some(&f.socket), None, &wrapped);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(last_request(&f)["params"]["file"], "BFS");
    assert_eq!(last_request(&f)["params"]["ops"].as_array().unwrap().len(), 2);
    assert_eq!(parse(&out(&o))["ids"], json!(["n1", "n2"]));
}

#[test]
fn scene_apply_ops_from_a_file_with_flags() {
    let f = Fake::start(scene_app);
    let file = f.dir.join("ops.json");
    std::fs::write(&file, OPS).unwrap();
    let o = vd(&["scene", "apply", "a.excalidraw", "--ops", file.to_str().unwrap(), "--if-version", "s1x"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let p = last_request(&f)["params"].clone();
    assert_eq!((p["path"].clone(), p["ifVersion"].clone()), (json!("a.excalidraw"), json!("s1x")));
    assert!(p.get("dryRun").is_none());

    let o = vd(&["scene", "apply", "--ops", file.to_str().unwrap(), "--dry-run"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(last_request(&f)["params"]["dryRun"], true);
    assert_eq!(out(&o), "dry run: 2 ops valid\n");

    // A stale version is the app's CONFLICT: exit 2 with its tag.
    let o = vd(&["scene", "apply", "--ops", file.to_str().unwrap(), "--if-version", "stale"], Some(&f.socket), None);
    assert_eq!(code(&o), 2);
    assert_eq!(err(&o), "vaultdraw: The drawing changed (CONFLICT)\n");
}

#[test]
fn scene_apply_bad_ops_are_cli_errors_and_send_nothing() {
    let f = Fake::start(scene_app);
    let o = vd_in(&["scene", "apply"], Some(&f.socket), None, "{not json");
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("stdin: not valid JSON"), "{}", err(&o));
    let bad = f.dir.join("bad.json");
    std::fs::write(&bad, "[1,").unwrap();
    let o = vd(&["scene", "apply", "--ops", bad.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("bad.json: not valid JSON"), "{}", err(&o));
    let o = vd(&["scene", "apply", "--ops", f.dir.join("missing.json").to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1);
    let o = vd_in(&["scene", "apply"], Some(&f.socket), None, r#"{"other": []}"#);
    assert_eq!(code(&o), 1);
    assert!(f.seen.lock().unwrap().is_empty(), "nothing reaches the app");
}

#[test]
fn scene_print_request_for_every_subcommand() {
    let f = Fake::start(scene_app);
    let line = |args: &[&str], stdin: &str| {
        let o = vd_in(args, Some(&f.socket), None, stdin);
        assert_eq!(code(&o), 0, "{args:?}: {}", err(&o));
        parse(&out(&o))
    };
    let v = line(&["scene", "read", "--print-request", "--scope", "selection"], "");
    assert_eq!((v["method"].clone(), v["params"].clone()), (json!("scene.read"), json!({"scope": "selection"})));
    let v = line(&["scene", "get", "--print-request", "a", "b"], "");
    assert_eq!((v["method"].clone(), v["params"].clone()), (json!("scene.get"), json!({"ids": ["a", "b"]})));
    let v = line(&["scene", "selection", "--print-request"], "");
    assert_eq!((v["method"].clone(), v["params"].clone()), (json!("scene.selection"), json!({})));
    let v = line(&["scene", "apply", "--print-request", "--dry-run", "--if-version", "s1x"], OPS);
    assert_eq!(v["method"], "scene.apply");
    assert_eq!((v["params"]["dryRun"].clone(), v["params"]["ifVersion"].clone()), (json!(true), json!("s1x")));
    assert_eq!(v["params"]["ops"].as_array().unwrap().len(), 2);
    assert!(f.seen.lock().unwrap().is_empty(), "print-request sends nothing");
}

#[test]
fn scene_commands_exit_3_when_the_app_is_not_running() {
    let o = vd(&["scene", "read"], None, None);
    assert_eq!(code(&o), 3);
    let o = vd_in(&["scene", "apply"], None, None, OPS);
    assert_eq!(code(&o), 3);
}

#[test]
fn plugin_commands_and_run() {
    let f = Fake::start(app);
    let o = vd(&["plugin", "commands"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o), "hello 1.0.0 (idle)\n  hello.say  Say hello\noff 0.1.0 (idle) [disabled]\n");
    let o = vd(&["plugin", "commands", "hello", "--json"], Some(&f.socket), None);
    assert_eq!(parse(&out(&o))["plugins"][0]["id"], "hello");
    assert_eq!(f.seen.lock().unwrap().last().unwrap()["params"], json!({"plugin": "hello"}));
    let o = vd(&["plugin", "run", "hello.say"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o), "ran hello.say\n");
    let o = vd(&["plugin", "run", "nope.x"], Some(&f.socket), None);
    assert_ne!(code(&o), 0);
    let o = vd(&["plugin", "run", "a.b", "--print-request"], None, None);
    assert_eq!(out(&o), "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"plugin.run\",\"params\":{\"id\":\"a.b\"}}\n");
}

#[test]
fn plugin_methods_and_call() {
    let f = Fake::start(app);
    let o = vd(&["plugin", "methods"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert!(out(&o).contains("hello.greet") && out(&o).contains("Greet"), "{}", out(&o));
    let o = vd(&["plugin", "call", "hello", "greet", r#"{"to":"you"}"#, "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(parse(&out(&o))["result"], json!({"said": {"to": "you"}}));
    // No params means {}; the human output is the plugin's JSON.
    let o = vd(&["plugin", "call", "hello", "greet"], Some(&f.socket), None);
    assert_eq!(parse(&out(&o)), json!({"said": {}}));
    // Params that are not JSON never reach the app.
    let before = f.seen.lock().unwrap().len();
    let o = vd(&["plugin", "call", "hello", "greet", "{oops"], Some(&f.socket), None);
    assert_eq!(code(&o), 1);
    assert_eq!(f.seen.lock().unwrap().len(), before);
    let o = vd(&["plugin", "call", "hello", "nope"], Some(&f.socket), None);
    assert_ne!(code(&o), 0);
}
