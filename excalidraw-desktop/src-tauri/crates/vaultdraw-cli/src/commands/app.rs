//! App-level commands: config get/set/path, vault info/open, quit.

use super::request;
use crate::cli::{Cli, ConfigAction, VaultAction};
use crate::error::Fail;
use crate::render;
use serde_json::{json, Value};
use vaultdraw_protocol::dirs::resolve_dirs_with;
use vaultdraw_protocol::methods;

/// The config file name inside the config dir (the app owns the format).
const CONFIG_FILE: &str = "config.toml";

pub fn config(cli: &Cli, action: &ConfigAction) -> Result<(), Fail> {
    match action {
        ConfigAction::Get { key } => {
            let p = key.as_ref().map(|k| json!({ "key": k }));
            request(cli, methods::CONFIG_GET, p, |v| v.get("value").map(render::value).unwrap_or_default(), false)
        }
        ConfigAction::Set { key, value } => {
            let parsed = serde_json::from_str::<Value>(value).unwrap_or_else(|_| json!(value));
            let p = json!({ "changes": [{ "key": key, "value": parsed }] });
            request(cli, methods::CONFIG_SET, Some(p), |v| format!("changed {}", v.get("changed").and_then(Value::as_u64).unwrap_or(0)), false)
        }
        ConfigAction::Path => config_path(cli),
    }
}

/// Local: the protocol crate's dirs ladder already gives the config dir, so no app round trip.
fn config_path(cli: &Cli) -> Result<(), Fail> {
    let dirs = resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map_err(Fail::cli)?;
    let path = dirs.config.join(CONFIG_FILE);
    if cli.json {
        println!("{}", json!({ "path": path }));
    } else {
        println!("{}", path.display());
    }
    Ok(())
}

pub fn quit(cli: &Cli) -> Result<(), Fail> {
    request(cli, methods::APP_QUIT, None, |_| "quitting".to_string(), false)
}

pub fn vault(cli: &Cli, action: Option<&VaultAction>) -> Result<(), Fail> {
    match action {
        None | Some(VaultAction::Info) => request(cli, methods::VAULT_INFO, None, render::vault, false),
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
