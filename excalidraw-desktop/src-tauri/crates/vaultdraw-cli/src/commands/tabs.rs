//! Tab commands: tabs, tab focus, tab close.

use super::{request, target};
use crate::cli::{Cli, TabAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Value};
use vaultdraw_protocol::methods;

pub fn list(cli: &Cli) -> Result<(), Fail> {
    request(cli, methods::TAB_LIST, None, render::tabs, false)
}

/// A tab argument is an id unless it looks like a file target (or `--path`/`--file` say so).
fn tab_params(cli: &Cli, arg: &str) -> Value {
    let like_target = cli.force_path || cli.force_file || arg.contains('/') || arg.ends_with(vaultdraw_core::DRAWING_EXT);
    if like_target {
        Value::Object(target(cli, arg))
    } else {
        json!({ "id": arg })
    }
}

pub fn run(cli: &Cli, action: &TabAction) -> Result<(), Fail> {
    match action {
        TabAction::Focus { id } => {
            // All digits: a 1-based index.
            let p = match id.parse::<u64>() {
                Ok(n) if id.bytes().all(|b| b.is_ascii_digit()) => json!({ "index": n }),
                _ => tab_params(cli, id),
            };
            request(cli, methods::TAB_FOCUS, Some(p), |v| format!("focused {}", v.get("id").and_then(Value::as_str).unwrap_or("")), false)
        }
        TabAction::Close { id } => {
            let human = |v: &Value| if v.get("closed").and_then(Value::as_bool) == Some(false) { "not closed" } else { "closed" }.to_string();
            request(cli, methods::TAB_CLOSE, Some(tab_params(cli, id)), human, false)
        }
    }
}
