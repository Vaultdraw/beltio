//! Plugin commands: `plugin commands`, `plugin run`.

use super::request;
use crate::cli::{Cli, PluginAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Value};
use std::io::Read;
use vaultdraw_protocol::methods;

pub fn run(cli: &Cli, action: &PluginAction) -> Result<(), Fail> {
    match action {
        PluginAction::Commands { plugin } => {
            let params = plugin.as_ref().map(|p| json!({ "plugin": p }));
            request(cli, methods::PLUGIN_COMMANDS, params, render::plugin_commands, false)
        }
        PluginAction::Methods { plugin } => {
            let params = plugin.as_ref().map(|p| json!({ "plugin": p }));
            request(cli, methods::PLUGIN_METHODS, params, render::plugin_methods, false)
        }
        PluginAction::Call { plugin, method, params } => {
            let input = match params.as_deref() {
                None => json!({}),
                Some(text) => {
                    let text = if text == "-" {
                        let mut t = String::new();
                        std::io::stdin().read_to_string(&mut t).map_err(|e| Fail::cli(format!("cannot read stdin: {e}")))?;
                        t
                    } else {
                        text.to_string()
                    };
                    serde_json::from_str::<Value>(&text).map_err(|e| Fail::cli(format!("params are not valid JSON: {e}")))?
                }
            };
            let p = json!({ "plugin": plugin, "method": method, "params": input });
            // The result is the plugin's own JSON: printed as is, so a script can pipe it on.
            request(cli, methods::PLUGIN_CALL, Some(p), |v| serde_json::to_string_pretty(&v["result"]).unwrap_or_default(), false)
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
