//! `vaultdraw uri <url>`: the role it connects with, the request, output and exit codes.
mod common;
use common::*;
use serde_json::{json, Value};

type Reply = Result<Value, (i64, String, Option<&'static str>)>;

fn app(method: &str, params: &Value) -> Reply {
    match method {
        "rpc.hello" => Ok(json!({"api": 1, "role": params["role"]})),
        "uri.handle" => match params["url"].as_str() {
            Some(u) if u.contains("new") => Ok(json!({"status": "asking"})),
            Some(u) if u.contains("limited") => Err((-32000, "Too many links at once".into(), Some("RATE_LIMITED"))),
            _ => Ok(json!({"status": "done"})),
        },
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

#[test]
fn sends_uri_handle_with_the_limited_role_and_prints_the_status() {
    let f = Fake::start(app);
    let o = vd(&["uri", "vaultdraw://open?file=Graphs/BFS"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o).trim(), "done");
    let seen = f.seen.lock().unwrap().clone();
    assert_eq!(seen[0]["method"], "rpc.hello");
    assert_eq!(seen[0]["params"]["role"], "uri", "least privilege: the uri role");
    assert_eq!(seen[1]["method"], "uri.handle");
    assert_eq!(seen[1]["params"], json!({"url": "vaultdraw://open?file=Graphs/BFS"}));
    assert_eq!(seen.len(), 2);
}

#[test]
fn asking_is_reported_and_json_is_the_raw_result() {
    let f = Fake::start(app);
    let o = vd(&["uri", "vaultdraw://new?path=Inbox/Idea"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    assert!(out(&o).starts_with("asking"), "{}", out(&o));
    let j = vd(&["uri", "vaultdraw://new?path=Inbox/Idea", "--json"], Some(&f.socket), None);
    assert_eq!(serde_json::from_str::<Value>(out(&j).trim()).unwrap(), json!({"status": "asking"}));
}

#[test]
fn security_a_bad_url_exits_2_without_connecting() {
    let f = Fake::start(app);
    for url in ["vaultdraw://open?file=../x", "https://example.com", "vaultdraw://open?file=/etc/passwd", "vaultdraw://frobnicate"] {
        let o = vd(&["uri", url], Some(&f.socket), None);
        assert_eq!(code(&o), 2, "{url}: {}", err(&o));
        assert!(err(&o).contains("INVALID_URI"), "{}", err(&o));
    }
    assert!(f.seen.lock().unwrap().is_empty(), "no connection for a bad link");
}

#[test]
fn an_app_refusal_exits_2_with_its_code() {
    let f = Fake::start(app);
    let o = vd(&["uri", "vaultdraw://open?file=limited"], Some(&f.socket), None);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("RATE_LIMITED"), "{}", err(&o));
}

#[test]
fn without_the_app_it_exits_3() {
    let o = vd(&["uri", "vaultdraw://open?file=a"], None, None);
    assert_eq!(code(&o), 3, "{}", err(&o));
}

#[test]
fn print_request_shows_the_line_and_sends_nothing() {
    let f = Fake::start(app);
    let o = vd(&["uri", "vaultdraw://focus", "--print-request"], Some(&f.socket), None);
    assert_eq!(code(&o), 0);
    let line: Value = serde_json::from_str(out(&o).trim()).unwrap();
    assert_eq!((line["method"].clone(), line["params"].clone()), (json!("uri.handle"), json!({"url": "vaultdraw://focus"})));
    assert!(f.seen.lock().unwrap().is_empty());
}
