//! App-level commands: config get/set/path, vault info/open, quit.

use super::{read_request, request};
use crate::cli::{Cli, ConfigAction, VaultAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Value};
use vaultdraw_protocol::dirs::resolve_dirs_with;
use vaultdraw_protocol::methods;

/// The config file name inside the config dir (the app owns the format).
const CONFIG_FILE: &str = "config.toml";
/// Settings changes, in the state folder.
const OVERRIDES_FILE: &str = "overrides.toml";

pub fn config(cli: &Cli, action: &ConfigAction) -> Result<(), Fail> {
    match action {
        ConfigAction::Get { key, source } => {
            let p = key.as_ref().map(|k| if *source { json!({ "key": k, "source": true }) } else { json!({ "key": k }) });
            read_request(cli, methods::CONFIG_GET, p, |v| {
                let value = v.get("value").map(render::value).unwrap_or_default();
                if *source { with_source(&value, v) } else { value }
            })
        }
        ConfigAction::Set { key, value } => {
            let parsed = serde_json::from_str::<Value>(value).unwrap_or_else(|_| json!(value));
            let p = json!({ "changes": [{ "key": key, "value": parsed }] });
            read_request(cli, methods::CONFIG_SET, Some(p), |v| format!("changed {}", v.get("changed").and_then(Value::as_u64).unwrap_or(0)))
        }
        ConfigAction::Path { all } => config_path(cli, *all),
    }
}

/// Local: the protocol crate's dirs ladder already gives the config dir, so no app round trip.
fn config_path(cli: &Cli, all: bool) -> Result<(), Fail> {
    let dirs = resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map_err(Fail::cli)?;
    let path = dirs.config.join(CONFIG_FILE);
    let overrides = dirs.state.join(OVERRIDES_FILE);
    match (cli.json, all) {
        (true, false) => println!("{}", json!({ "path": path })),
        (true, true) => println!("{}", json!({ "path": path, "layers": [{ "file": CONFIG_FILE, "path": path }, { "file": OVERRIDES_FILE, "path": overrides }] })),
        (false, false) => println!("{}", path.display()),
        (false, true) => {
            println!("{}", path.display());
            println!("{}", overrides.display());
        }
    }
    Ok(())
}

/// `20  (overrides.toml; config.toml says 14)` for `config get <key> --source`.
fn with_source(value: &str, reply: &Value) -> String {
    let source = reply.get("source").and_then(Value::as_str).unwrap_or("default");
    match reply.get("hidden") {
        Some(h) => {
            let file = h.get("file").and_then(Value::as_str).unwrap_or(CONFIG_FILE);
            format!("{value}  ({source}; {file} says {})", h.get("value").map(render::value).unwrap_or_default())
        }
        None => format!("{value}  ({source})"),
    }
}

pub fn quit(cli: &Cli) -> Result<(), Fail> {
    request(cli, methods::APP_QUIT, None, |_| "quitting".to_string(), false)
}

pub fn vault(cli: &Cli, action: Option<&VaultAction>) -> Result<(), Fail> {
    match action {
        None | Some(VaultAction::Info) => read_request(cli, methods::VAULT_INFO, None, render::vault),
        Some(VaultAction::Open { path }) => {
            let abs = if path.is_absolute() {
                path.clone()
            } else {
                std::env::current_dir().map_err(|e| Fail::cli(format!("cannot read the working directory: {e}")))?.join(path)
            };
            let p = json!({ "path": abs });
            request(cli, methods::VAULT_OPEN, Some(p), |v| format!("opened {}", render::vault(v)), false)
        }
    }
}
