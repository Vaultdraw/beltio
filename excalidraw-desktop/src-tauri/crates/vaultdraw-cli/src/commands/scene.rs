//! `vaultdraw scene read|get|selection|apply`: the drawing on screen, live. No headless
//! fallback: with no app running these exit 3 like every other live command.

use super::{read_request, request, target};
use crate::cli::{Cli, SceneAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Map, Value};
use std::io::{IsTerminal, Read};
use vaultdraw_protocol::methods;

/// Params with the optional target (`path` or `file`) filled in.
fn with_target(cli: &Cli, t: Option<&str>) -> Map<String, Value> {
    t.map(|t| target(cli, t)).unwrap_or_default()
}

/// A read that names a drawing can come from disk with the app closed; one without a target is
/// the drawing on screen and needs the app.
fn read_or_request(cli: &Cli, method: &str, p: Map<String, Value>, human: impl Fn(&Value) -> String) -> Result<(), Fail> {
    let p = Value::Object(p);
    if crate::headless::names_a_drawing(&p) {
        read_request(cli, method, Some(p), human)
    } else {
        request(cli, method, Some(p), human, false)
    }
}

pub fn run(cli: &Cli, action: &SceneAction) -> Result<(), Fail> {
    match action {
        SceneAction::Read { target, scope, types, ids, limit, offset } => {
            let mut p = with_target(cli, target.as_deref());
            if let Some(s) = scope {
                p.insert("scope".into(), json!(s));
            }
            if !types.is_empty() {
                p.insert("types".into(), json!(types));
            }
            if !ids.is_empty() {
                p.insert("ids".into(), json!(ids));
            }
            if let Some(n) = limit {
                p.insert("limit".into(), json!(n));
            }
            if let Some(n) = offset {
                p.insert("offset".into(), json!(n));
            }
            read_or_request(cli, methods::SCENE_READ, p, render::scene_read)
        }
        SceneAction::Get { ids, target } => {
            let mut p = with_target(cli, target.as_deref());
            p.insert("ids".into(), json!(ids));
            read_or_request(cli, methods::SCENE_GET, p, render::scene_get)
        }
        SceneAction::Selection { target } => {
            request(cli, methods::SCENE_SELECTION, Some(Value::Object(with_target(cli, target.as_deref()))), render::scene_selection, false)
        }
        SceneAction::Create { path, ops } => {
            let ops = read_ops(ops)?;
            let count = ops.len();
            let p = json!({"path": path, "ops": ops});
            request(cli, methods::SCENE_CREATE, Some(p), |v| render::scene_apply(v, count), false)
        }
        SceneAction::Apply { target, ops, if_version, dry_run } => {
            let ops = read_ops(ops)?;
            let count = ops.len();
            let mut p = with_target(cli, target.as_deref());
            p.insert("ops".into(), Value::Array(ops));
            if let Some(v) = if_version {
                p.insert("ifVersion".into(), json!(v));
            }
            if *dry_run {
                p.insert("dryRun".into(), json!(true));
            }
            request(cli, methods::SCENE_APPLY, Some(Value::Object(p)), |v| render::scene_apply(v, count), false)
        }
    }
}

/// Operations from a file or stdin (`-`): a JSON array, or an object with an `ops` array.
fn read_ops(src: &str) -> Result<Vec<Value>, Fail> {
    check_ops_source(src, std::io::stdin().is_terminal())?;
    let (text, name) = if src == "-" {
        let mut t = String::new();
        std::io::stdin().read_to_string(&mut t).map_err(|e| Fail::cli(format!("cannot read stdin: {e}")))?;
        (t, "stdin")
    } else {
        (std::fs::read_to_string(src).map_err(|e| Fail::cli(format!("cannot read {src}: {e}")))?, src)
    };
    parse_ops(&text, name)
}

/// Reading stdin from an interactive terminal would hang, so refuse before reading.
fn check_ops_source(src: &str, stdin_is_terminal: bool) -> Result<(), Fail> {
    if src == "-" && stdin_is_terminal {
        return Err(Fail::cli("pass --ops FILE or pipe the operations on stdin"));
    }
    Ok(())
}

fn parse_ops(text: &str, name: &str) -> Result<Vec<Value>, Fail> {
    let value: Value = serde_json::from_str(text).map_err(|e| Fail::cli(format!("{name}: not valid JSON: {e}")))?;
    match value {
        Value::Array(a) => Ok(a),
        Value::Object(mut m) => match m.remove("ops") {
            Some(Value::Array(a)) => Ok(a),
            _ => Err(Fail::cli(format!("{name}: expected a JSON array of operations or an object with an \"ops\" array"))),
        },
        _ => Err(Fail::cli(format!("{name}: expected a JSON array of operations or an object with an \"ops\" array"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_stdin_is_refused_before_reading() {
        let e = check_ops_source("-", true).unwrap_err();
        assert!(e.to_string().contains("pass --ops FILE or pipe the operations on stdin"));
        assert!(check_ops_source("-", false).is_ok());
        assert!(check_ops_source("ops.json", true).is_ok());
    }

    #[test]
    fn ops_as_array_or_object() {
        assert_eq!(parse_ops(r#"[{"op":"add"}]"#, "x").unwrap().len(), 1);
        assert_eq!(parse_ops(r#"{"ops":[{"op":"a"},{"op":"b"}]}"#, "x").unwrap().len(), 2);
        assert!(parse_ops("{nope", "x").is_err());
        assert!(parse_ops(r#"{"ops":3}"#, "x").is_err());
        assert!(parse_ops("3", "x").is_err());
        assert!(parse_ops(r#"{"other":[]}"#, "x").is_err());
    }
}
