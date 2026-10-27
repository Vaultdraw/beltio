//! Plugin commands: `plugin commands`, `plugin run`.

use super::request;
use crate::cli::{Cli, PluginAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Value};
use vaultdraw_protocol::methods;

pub fn run(cli: &Cli, action: &PluginAction) -> Result<(), Fail> {
    match action {
        PluginAction::Commands { plugin } => {
            let params = plugin.as_ref().map(|p| json!({ "plugin": p }));
            request(cli, methods::PLUGIN_COMMANDS, params, render::plugin_commands, false)
        }
        PluginAction::Run { id } => request(
            cli,
            methods::PLUGIN_RUN,
            Some(json!({ "id": id })),
            |v| format!("ran {}", v.get("id").and_then(Value::as_str).unwrap_or("")),
            false,
        ),
    }
}
