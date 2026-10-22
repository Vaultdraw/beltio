//! Vault and file commands: ls, search, open, new, cat, write, mv, trash, links, tags.

use super::{emit, events, out_line, read_request, request, rpc, target};
use crate::cli::Cli;
use crate::error::{Fail, EXIT_PROTOCOL};
use crate::render;
use crate::rpc::request_line;
use serde_json::{json, Value};
use std::io::Read;
use vaultdraw_protocol::methods;

/// Params as a JSON value for `request`.
fn some(m: serde_json::Map<String, Value>) -> Option<Value> {
    Some(Value::Object(m))
}

pub fn ls(cli: &Cli, dir: Option<&str>, recursive: bool) -> Result<(), Fail> {
    let mut p = json!({ "recursive": recursive });
    if let Some(d) = dir {
        p["dir"] = json!(d.trim_end_matches('/'));
    }
    read_request(cli, methods::VAULT_LIST, Some(p), render::ls)
}

pub fn search(cli: &Cli, query: &str, limit: Option<u32>) -> Result<(), Fail> {
    let mut p = json!({ "query": query });
    if let Some(n) = limit {
        p["limit"] = json!(n);
    }
    read_request(cli, methods::VAULT_SEARCH, Some(p), render::search)
}

pub fn open(cli: &Cli, t: &str, new_tab: bool, wait: bool) -> Result<(), Fail> {
    let mut p = target(cli, t);
    if new_tab {
        p.insert("newTab".into(), json!(true));
    }
    if wait && !cli.print_request {
        return events::open_wait(cli, p);
    }
    request(cli, methods::FILE_OPEN, some(p), |v| format!("opened {}", path_of(v)), false)
}

fn path_of(v: &Value) -> &str {
    v.get("path").and_then(Value::as_str).unwrap_or("")
}

/// Parses JSON from a file, or from stdin when `src` is `-`.
fn read_json(src: &str) -> Result<Value, Fail> {
    let mut text = String::new();
    if src == "-" {
        std::io::stdin().read_to_string(&mut text).map_err(|e| Fail::cli(format!("cannot read stdin: {e}")))?;
    } else {
        text = std::fs::read_to_string(src).map_err(|e| Fail::cli(format!("cannot read {src}: {e}")))?;
    }
    serde_json::from_str(&text).map_err(|e| Fail::cli(format!("{}: not valid JSON: {e}", if src == "-" { "stdin" } else { src })))
}

pub fn new(cli: &Cli, path: &str, from: Option<&str>) -> Result<(), Fail> {
    let mut p = json!({ "path": path });
    if let Some(src) = from {
        p["scene"] = read_json(src)?;
    }
    request(cli, methods::FILE_CREATE, Some(p), |v| format!("created {}", path_of(v)), false)
}

pub fn cat(cli: &Cli, t: &str) -> Result<(), Fail> {
    let p = Value::Object(target(cli, t));
    if cli.print_request {
        println!("{}", request_line(methods::FILE_READ, Some(p)));
        return Ok(());
    }
    let v = crate::backend::read(cli, &rpc(cli)?, methods::FILE_READ, Some(p))?;
    if cli.json {
        emit(true, &v, String::new);
    } else {
        let scene = v.get("scene").ok_or_else(|| Fail::new(EXIT_PROTOCOL, "the app's reply has no scene", "BAD_REPLY"))?;
        out_line(&serde_json::to_string(scene).unwrap_or_default());
    }
    Ok(())
}

/// A revision as given on the command line: JSON when it parses (`3`), else a string.
fn parse_loose(s: &str) -> Value {
    serde_json::from_str(s).unwrap_or_else(|_| json!(s))
}

pub fn write(cli: &Cli, t: &str, expected: Option<&str>, create: bool) -> Result<(), Fail> {
    let scene = read_json("-")?;
    let mut p = target(cli, t);
    p.insert("scene".into(), scene);
    let explicit = if create { Some(Value::Null) } else { expected.map(parse_loose) };
    if cli.print_request {
        if let Some(rev) = &explicit {
            p.insert("expectedRevision".into(), rev.clone());
        } else {
            println!("{}", request_line(methods::FILE_READ, Some(Value::Object(target(cli, t)))));
            p.insert("expectedRevision".into(), json!("<revision from file.read>"));
        }
        println!("{}", request_line(methods::FILE_WRITE, Some(Value::Object(p))));
        return Ok(());
    }
    let rpc = rpc(cli)?;
    let mut client = rpc.connect()?;
    let rev = match explicit {
        Some(r) => r,
        // Default: overwrite only if unchanged since now.
        None => rpc.call_on(&mut client, methods::FILE_READ, Some(Value::Object(target(cli, t))))?.get("revision").cloned().unwrap_or(Value::Null),
    };
    p.insert("expectedRevision".into(), rev);
    let v = rpc.call_on(&mut client, methods::FILE_WRITE, Some(Value::Object(p)))?;
    emit(cli.json, &v, || match v.get("revision") {
        Some(Value::String(r)) => r.clone(),
        Some(r) => r.to_string(),
        None => String::new(),
    });
    Ok(())
}

pub fn mv(cli: &Cli, from: &str, to: &str) -> Result<(), Fail> {
    let human = |v: &Value| {
        let n = v.get("rewritten").and_then(Value::as_u64).filter(|n| *n > 0);
        let tail = n.map(|n| format!(" ({n} links rewritten)")).unwrap_or_default();
        format!("{} -> {}{tail}", v.get("from").and_then(Value::as_str).unwrap_or(from), v.get("to").and_then(Value::as_str).unwrap_or(to))
    };
    request(cli, methods::FILE_MOVE, Some(json!({ "from": from, "to": to })), human, false)
}

pub fn trash(cli: &Cli, t: &str) -> Result<(), Fail> {
    request(cli, methods::FILE_TRASH, some(target(cli, t)), |v| format!("trashed {}", path_of(v)), false)
}

pub fn links(cli: &Cli, t: &str, backlinks: bool) -> Result<(), Fail> {
    let mut p = target(cli, t);
    if backlinks {
        p.insert("backlinks".into(), json!(true));
    }
    read_request(cli, methods::VAULT_LINKS, some(p), |v| render::links(v, backlinks))
}

pub fn tags(cli: &Cli) -> Result<(), Fail> {
    read_request(cli, methods::VAULT_TAGS, None, render::tags)
}
