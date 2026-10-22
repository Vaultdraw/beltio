//! C3 subcommands: vault, files, tabs, config, events, quit. Golden --json / human output,
//! target mapping, request params and exit codes against the fake server.
mod common;
use common::*;
use serde_json::{json, Value};

type Reply = Result<Value, (i64, String, Option<&'static str>)>;

fn parse(s: &str) -> Value {
    serde_json::from_str(s.trim()).unwrap()
}

fn scene() -> Value {
    json!({"type":"excalidraw","elements":[{"id":"a","type":"rectangle"}],"appState":{}})
}

fn tabs_result() -> Value {
    json!({"tabs":[
        {"id":"t1","path":"","pinned":false,"missing":false,"active":false,"dirty":false},
        {"id":"t2","path":"Graphs/BFS.excalidraw","pinned":false,"missing":false,"active":true,"dirty":true},
        {"id":"t3","path":"B.excalidraw","pinned":false,"missing":false,"active":false,"dirty":false}],"activeId":"t2"})
}

fn app(method: &str, params: &Value) -> Reply {
    match method {
        "vault.info" => Ok(json!({"name":"DSA","path":"/v/DSA","readOnly":true})),
        "vault.open" => Ok(json!({"name":"X","path":params["path"],"readOnly":false})),
        "vault.list" => Ok(json!({"entries":[
            {"path":"a.excalidraw","name":"a","kind":"drawing"},
            {"path":"Graphs","name":"Graphs","kind":"folder"},
            {"path":"b.excalidraw","name":"b","kind":"drawing"}]})),
        "vault.search" => Ok(json!({"results":[{"path":"Graphs/BFS.excalidraw","score":2.0,"text":"queue"},{"path":"a.excalidraw"}]})),
        "vault.links" => Ok(if params["backlinks"] == true {
            json!({"path":"a.excalidraw","backlinks":[{"path":"x.excalidraw"},{"path":"y.excalidraw"}]})
        } else {
            json!({"path":"a.excalidraw","links":[{"path":"b.excalidraw","target":"b","resolved":true},{"target":"zz","resolved":false}]})
        }),
        "vault.tags" => Ok(json!({"tags":[{"tag":"graph","count":3},{"tag":"dp","count":1}]})),
        "file.read" => match (params["path"].as_str(), params["file"].as_str()) {
            (Some("missing.excalidraw"), _) => Err((-32000, "No such drawing".into(), Some("NOT_FOUND"))),
            (Some(p), _) => Ok(json!({"path":p,"revision":7,"scene":scene()})),
            (None, Some(f)) => Ok(json!({"path":format!("{f}.excalidraw"),"revision":"r9","scene":scene()})),
            _ => Err((-32602, "target required".into(), None)),
        },
        "file.write" => match params["expectedRevision"] {
            Value::Number(ref n) if n.as_i64() == Some(7) => Ok(json!({"path":"a.excalidraw","revision":8})),
            Value::Null => Ok(json!({"path":"new.excalidraw","revision":1})),
            _ => Err((-32000, "Changed on disk".into(), Some("CONFLICT"))),
        },
        "file.open" => Ok(json!({"path":"a.excalidraw","opened":true})),
        "file.create" => Ok(json!({"path":"n.excalidraw","revision":1})),
        "file.move" => Ok(json!({"from":params["from"],"to":params["to"],"rewritten":2})),
        "file.trash" => Ok(json!({"path":"a.excalidraw","trashed":true})),
        "tab.list" => Ok(tabs_result()),
        "tab.focus" => Ok(json!({"id":"t3"})),
        "tab.close" => Ok(json!({"closed":true})),
        "config.get" => Ok(json!({"key":params["key"],"value":match params["key"].as_str() { Some("ui.name") => json!("dark"), Some(_) => json!(12), None => json!({"ui":{"name":"dark"}}) }})),
        "config.set" => Ok(json!({"changed":1})),
        "app.quit" => Ok(json!({"quitting":true})),
        "events.subscribe" => Ok(json!({"seq":4,"topics":params["topics"]})),
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

fn run(args: &[&str]) -> (Output, Vec<Value>) {
    let f = Fake::start(app);
    let o = vd(args, Some(&f.socket), None);
    let seen = f.seen.lock().unwrap().clone();
    (o, seen)
}
use std::process::Output;

fn params_of(seen: &[Value], i: usize) -> Value {
    seen[i]["params"].clone()
}

#[test]
fn ls_json_human_and_params() {
    let (o, seen) = run(&["ls", "Graphs/", "-r", "--json"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(seen[0]["method"], "vault.list");
    assert_eq!(params_of(&seen, 0), json!({"dir":"Graphs","recursive":true}));
    assert_eq!(parse(&out(&o))["entries"].as_array().unwrap().len(), 3);
    let (o, seen) = run(&["ls"]);
    assert_eq!(out(&o), "Graphs/\na.excalidraw\nb.excalidraw\n");
    assert_eq!(params_of(&seen, 0), json!({"recursive":false}));
}

#[test]
fn search_human_json_and_limit() {
    let (o, seen) = run(&["search", "bfs", "--limit", "5"]);
    assert_eq!(out(&o), "Graphs/BFS.excalidraw\tqueue\na.excalidraw\n");
    assert_eq!(params_of(&seen, 0), json!({"query":"bfs","limit":5}));
    let (o, _) = run(&["search", "x", "--json"]);
    assert_eq!(parse(&out(&o))["results"][0]["score"], 2.0);
}

#[test]
fn target_mapping_name_path_and_flags() {
    for (args, want) in [
        (vec!["cat", "BFS and DFS"], json!({"file":"BFS and DFS"})),
        (vec!["cat", "Graphs/BFS.excalidraw"], json!({"path":"Graphs/BFS.excalidraw"})),
        (vec!["cat", "a.excalidraw"], json!({"path":"a.excalidraw"})),
        (vec!["cat", "plain", "--path"], json!({"path":"plain"})),
        (vec!["cat", "dir/x", "--file"], json!({"file":"dir/x"})),
        (vec!["--path", "cat", "plain"], json!({"path":"plain"})),
    ] {
        let (o, seen) = run(&args);
        assert_eq!(code(&o), 0, "{args:?}: {}", err(&o));
        assert_eq!(params_of(&seen, 0), want, "{args:?}");
    }
    assert_eq!(code(&run(&["cat", "x", "--path", "--file"]).0), 1);
}

#[test]
fn cat_prints_the_scene_exactly_and_json_wraps_it() {
    let (o, _) = run(&["cat", "a.excalidraw"]);
    assert_eq!(code(&o), 0);
    assert_eq!(out(&o), format!("{}\n", serde_json::to_string(&scene()).unwrap()));
    let (o, _) = run(&["cat", "a.excalidraw", "--json"]);
    assert_eq!(parse(&out(&o)), json!({"path":"a.excalidraw","revision":7,"scene":scene()}));
    let (o, _) = run(&["cat", "missing.excalidraw"]);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("NOT_FOUND"), "{}", err(&o));
}

#[test]
fn write_default_reads_the_revision_first() {
    let f = Fake::start(app);
    let o = vd_in(&["write", "a.excalidraw"], Some(&f.socket), None, &scene().to_string());
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o), "8\n");
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen.iter().map(|r| r["method"].as_str().unwrap()).collect::<Vec<_>>(), ["file.read", "file.write"]);
    assert_eq!(seen[1]["params"], json!({"path":"a.excalidraw","scene":scene(),"expectedRevision":7}));
}

#[test]
fn write_create_sends_null_and_explicit_revision_skips_the_read() {
    let f = Fake::start(app);
    let o = vd_in(&["write", "new.excalidraw", "--create", "--json"], Some(&f.socket), None, &scene().to_string());
    assert_eq!(parse(&out(&o)), json!({"path":"new.excalidraw","revision":1}));
    let o = vd_in(&["write", "a.excalidraw", "--expected-revision", "7"], Some(&f.socket), None, &scene().to_string());
    assert_eq!(code(&o), 0, "{}", err(&o));
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen.len(), 2, "no file.read when the revision is given");
    assert!(seen[0]["params"]["expectedRevision"].is_null());
    assert_eq!(seen[1]["params"]["expectedRevision"], 7);
}

#[test]
fn write_conflict_exits_2_and_bad_stdin_exits_1() {
    let f = Fake::start(app);
    let o = vd_in(&["write", "a.excalidraw", "--expected-revision", "3"], Some(&f.socket), None, &scene().to_string());
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("CONFLICT"), "{}", err(&o));
    let o = vd_in(&["write", "a.excalidraw"], Some(&f.socket), None, "not json");
    assert_eq!(code(&o), 1);
    assert_eq!(f.seen.lock().unwrap().len(), 1, "bad stdin sends nothing (only the conflicting attempt is recorded)");
    assert_eq!(code(&vd(&["write", "a", "--create", "--expected-revision", "1"], Some(&f.socket), None)), 1);
}

#[test]
fn new_from_stdin_and_file() {
    let f = Fake::start(app);
    let o = vd_in(&["new", "n", "--from", "-"], Some(&f.socket), None, &scene().to_string());
    assert_eq!(out(&o), "created n.excalidraw\n");
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("s.json");
    std::fs::write(&file, scene().to_string()).unwrap();
    let o = vd(&["new", "n", "--from", file.to_str().unwrap(), "--json"], Some(&f.socket), None);
    assert_eq!(parse(&out(&o))["path"], "n.excalidraw");
    let o = vd(&["new", "bare"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen[0]["params"], json!({"path":"n","scene":scene()}));
    assert_eq!(seen[2]["params"], json!({"path":"bare"}));
}

#[test]
fn open_params_and_human() {
    let (o, seen) = run(&["open", "BFS", "--new-tab"]);
    assert_eq!(out(&o), "opened a.excalidraw\n");
    assert_eq!(params_of(&seen, 0), json!({"file":"BFS","newTab":true}));
    let (o, _) = run(&["open", "a.excalidraw", "--json"]);
    assert_eq!(parse(&out(&o)), json!({"path":"a.excalidraw","opened":true}));
}

#[test]
fn mv_trash_links_tags() {
    let (o, seen) = run(&["mv", "a.excalidraw", "Graphs/"]);
    assert_eq!(out(&o), "a.excalidraw -> Graphs/ (2 links rewritten)\n");
    assert_eq!(params_of(&seen, 0), json!({"from":"a.excalidraw","to":"Graphs/"}));
    let (o, seen) = run(&["trash", "a"]);
    assert_eq!(out(&o), "trashed a.excalidraw\n");
    assert_eq!(params_of(&seen, 0), json!({"file":"a"}));
    let (o, _) = run(&["links", "a.excalidraw"]);
    assert_eq!(out(&o), "b.excalidraw\n");
    let (o, seen) = run(&["links", "a.excalidraw", "--backlinks"]);
    assert_eq!(out(&o), "x.excalidraw\ny.excalidraw\n");
    assert_eq!(params_of(&seen, 0), json!({"path":"a.excalidraw","backlinks":true}));
    let (o, _) = run(&["tags"]);
    assert_eq!(out(&o), "graph 3\ndp 1\n");
    let (o, _) = run(&["tags", "--json"]);
    assert_eq!(parse(&out(&o))["tags"][1]["count"], 1);
}

#[test]
fn links_tolerates_the_outgoing_shape() {
    let f = Fake::start(|m, _| match m {
        "vault.links" => Ok(json!({"path":"a","outgoing":["b.excalidraw"],"unresolved":["q"],"backlinks":[]})),
        _ => Err((-32601, "nf".into(), None)),
    });
    assert_eq!(out(&vd(&["links", "a"], Some(&f.socket), None)), "b.excalidraw\n");
}

/// The app's real LinksResponse: `resolved` is the target path; one backlink per element.
#[test]
fn links_reads_the_app_shape_once_per_path() {
    let f = Fake::start(|m, _| match m {
        "vault.links" => Ok(json!({"path":"a.excalidraw","tookMs":0.1,
            "outgoing":[{"elementId":"e1","kind":"text","target":"B","resolved":"G/B.excalidraw"},
                        {"elementId":"e2","kind":"text","target":"B","resolved":"G/B.excalidraw"},
                        {"elementId":"e3","kind":"text","target":"C","resolved":"C.excalidraw"}],
            "unresolved":[{"elementId":"e4","kind":"text","target":"zz","resolved":null}],
            "backlinks":[{"path":"x.excalidraw","elementId":"1"},{"path":"x.excalidraw","elementId":"2"},{"path":"y.excalidraw","elementId":"3"}]})),
        _ => Err((-32601, "nf".into(), None)),
    });
    assert_eq!(out(&vd(&["links", "a"], Some(&f.socket), None)), "G/B.excalidraw\nC.excalidraw\n");
    assert_eq!(out(&vd(&["links", "a", "--backlinks"], Some(&f.socket), None)), "x.excalidraw\ny.excalidraw\n");
}

#[test]
fn tabs_human_and_json_and_tab_actions() {
    let (o, _) = run(&["tabs"]);
    assert_eq!(out(&o), "  1 (home)\n* 2 Graphs/BFS.excalidraw [+]\n  3 B.excalidraw\n");
    let (o, _) = run(&["tabs", "--json"]);
    assert_eq!(parse(&out(&o)), tabs_result());
    for (args, want) in [
        (vec!["tab", "focus", "2"], json!({"index":2})),
        (vec!["tab", "focus", "t3"], json!({"id":"t3"})),
        (vec!["tab", "close", "t3"], json!({"id":"t3"})),
        (vec!["tab", "close", "Graphs/BFS.excalidraw"], json!({"path":"Graphs/BFS.excalidraw"})),
        (vec!["tab", "close", "BFS", "--file"], json!({"file":"BFS"})),
    ] {
        let (o, seen) = run(&args);
        assert_eq!(code(&o), 0, "{args:?}: {}", err(&o));
        assert_eq!(params_of(&seen, 0), want, "{args:?}");
    }
    assert_eq!(out(&run(&["tab", "close", "t1"]).0), "closed\n");
}

#[test]
fn config_get_set_and_path() {
    let (o, seen) = run(&["config", "get", "ui.name"]);
    assert_eq!(out(&o), "dark\n");
    assert_eq!(params_of(&seen, 0), json!({"key":"ui.name"}));
    let (o, _) = run(&["config", "get", "ui.size", "--json"]);
    assert_eq!(parse(&out(&o)), json!({"key":"ui.size","value":12}));
    let (o, seen) = run(&["config", "get"]);
    assert!(out(&o).contains("\"name\": \"dark\""));
    assert!(seen[0].get("params").is_none_or(|p| p.is_null() || p.get("key").is_none()));
    for (v, want) in [("42", json!(42)), ("true", json!(true)), ("dark", json!("dark")), ("[1,2]", json!([1, 2])), ("\"x\"", json!("x"))] {
        let (o, seen) = run(&["config", "set", "a.b", v]);
        assert_eq!(out(&o), "changed 1\n");
        assert_eq!(params_of(&seen, 0), json!({"changes":[{"key":"a.b","value":want}]}), "{v}");
    }
}

#[test]
fn config_path_is_local() {
    let o = std::process::Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"))
        .args(["config", "path"])
        .env_clear()
        .env("VAULTDRAW_CONFIG_DIR", "/tmp/vd-cfg")
        .env("VAULTDRAW_STATE_DIR", "/tmp/vd-st")
        .output()
        .unwrap();
    assert_eq!(out(&o), "/tmp/vd-cfg/config.toml\n");
    let o = std::process::Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"))
        .args(["config", "path", "--json"])
        .env_clear()
        .env("VAULTDRAW_CONFIG_DIR", "/tmp/vd-cfg")
        .env("VAULTDRAW_STATE_DIR", "/tmp/vd-st")
        .output()
        .unwrap();
    assert_eq!(parse(&out(&o)), json!({"path":"/tmp/vd-cfg/config.toml"}));
}

#[test]
fn quit_and_vault() {
    let (o, _) = run(&["quit"]);
    assert_eq!(out(&o), "quitting\n");
    let (o, _) = run(&["vault"]);
    assert_eq!(out(&o), "DSA (/v/DSA) [read-only]\n");
    let (o, _) = run(&["vault", "info", "--json"]);
    assert_eq!(parse(&out(&o))["name"], "DSA");
    let (_, seen) = run(&["vault", "open", "/abs/vault"]);
    assert_eq!(params_of(&seen, 0), json!({"path":"/abs/vault"}));
    let (_, seen) = run(&["vault", "open", "rel/vault"]);
    let want = std::env::current_dir().unwrap().join("rel/vault");
    assert_eq!(params_of(&seen, 0)["path"], want.to_str().unwrap());
}

#[test]
fn print_request_for_target_commands_does_not_connect() {
    let o = vd(&["cat", "BFS", "--print-request"], None, None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let line = parse(&out(&o));
    assert_eq!((line["method"].as_str(), &line["params"]), (Some("file.read"), &json!({"file":"BFS"})));
    let o = vd_in(&["write", "a.excalidraw", "--create", "--print-request"], None, None, &scene().to_string());
    let line = parse(&out(&o));
    assert_eq!(line["method"], "file.write");
    assert!(line["params"]["expectedRevision"].is_null());
    for args in [&["events", "--topic", "tab,file", "--print-request"][..], &["open", "x", "--wait", "--print-request"][..]] {
        assert_eq!(code(&vd(args, None, None)), 0);
    }
}

#[test]
fn not_running_exits_3() {
    // Reads (ls, cat, ...) fall back to the vault on disk: see tests/offline.rs.
    for args in [&["tabs"][..], &["events"][..], &["quit"][..]] {
        assert_eq!(code(&vd(args, None, None)), 3, "{args:?}");
    }
}

#[test]
fn events_print_snapshot_then_deltas_as_ndjson_until_eof() {
    let f = Fake::start_with_pushes(app, |m, _| {
        if m != "events.subscribe" {
            return vec![];
        }
        vec![
            json!({"jsonrpc":"2.0","method":"events.snapshot","params":{"seq":4,"vault":{"name":"DSA"}}}),
            json!({"jsonrpc":"2.0","method":"file.saved","params":{"seq":5,"topic":"file","path":"a.excalidraw","revision":8}}),
            json!("CLOSE"),
        ]
    });
    for args in [&["events", "--topic", "file,tab"][..], &["events", "--json"][..]] {
        let o = vd(args, Some(&f.socket), None);
        assert_eq!(code(&o), 0, "{} / {} / {:?}", err(&o), out(&o), o.status);
        let lines: Vec<Value> = out(&o).lines().map(parse).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["method"], "events.snapshot");
        assert_eq!(lines[1]["params"]["revision"], 8);
    }
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen[0]["params"], json!({"topics":["file","tab"]}));
    assert!(seen[1]["params"].is_null() || seen[1]["params"].get("topics").is_none());
}

#[test]
fn open_wait_exits_when_the_tab_disappears() {
    let tab = |paths: &[&str]| {
        json!({"jsonrpc":"2.0","method":"tab.changed","params":{"seq":6,"topic":"tab","activeId":"t1",
            "tabs": paths.iter().map(|p| json!({"id":"t1","path":p})).collect::<Vec<_>>()}})
    };
    let f = Fake::start_with_pushes(app, move |m, _| match m {
        "events.subscribe" => vec![json!({"jsonrpc":"2.0","method":"events.snapshot","params":{"seq":4}})],
        // A stale event without the tab, then the tab appears, an unrelated change, then it closes.
        "file.open" => vec![tab(&["other.excalidraw"]), tab(&["a.excalidraw"]), tab(&["a.excalidraw", "b.excalidraw"]), tab(&["b.excalidraw"])],
        _ => vec![],
    });
    let o = vd(&["open", "a.excalidraw", "--wait"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o), "opened a.excalidraw\n");
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen.iter().map(|r| r["method"].as_str().unwrap()).collect::<Vec<_>>(), ["events.subscribe", "file.open"]);
    assert_eq!(seen[0]["params"], json!({"topics":["tab"]}));
}

#[test]
fn open_wait_exits_on_app_quitting() {
    let f = Fake::start_with_pushes(app, |m, _| match m {
        "file.open" => vec![json!({"jsonrpc":"2.0","method":"app.quitting","params":{"seq":9}})],
        _ => vec![],
    });
    assert_eq!(code(&vd(&["open", "a.excalidraw", "--wait"], Some(&f.socket), None)), 0);
}

#[test]
fn completions_still_work_with_the_new_commands() {
    let o = vd(&["completions", "zsh"], None, None);
    assert_eq!(code(&o), 0);
    let text = out(&o);
    for c in ["ls", "search", "backlinks", "expected-revision", "events"] {
        assert!(text.contains(c), "{c} missing from the zsh completions");
    }
}
