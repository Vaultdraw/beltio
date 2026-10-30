//! Diagnostics that need no app and never write: `config check`, `config schema`, `doctor`.
//! They read the config folder and the state folder only; `doctor` also asks a running app
//! for its status over the local socket (short timeout). Nothing touches the network.

use super::emit;
use crate::cli::Cli;
use crate::error::{Fail, EXIT_CLI};
use crate::rpc::{resolve_socket, Rpc};
use serde_json::Value;
use std::path::PathBuf;
use vaultdraw_core::config::{check_config_in, control_enabled, doctor_in, layered_config_in, resolve_dirs_with, Dirs, DoctorInput, CONFIG_SCHEMA};
use vaultdraw_core::vault_path::{self, ENV_VAULT};
use vaultdraw_protocol::dirs::InstancePaths;
use vaultdraw_protocol::{methods, API_LEVEL};

/// Seconds `doctor` waits for a running app's status: a report must never hang.
const PROBE_SECS: u64 = 2;

fn dirs() -> Result<Dirs, Fail> {
    resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map_err(|e| Fail::cli(e.message))
}

/// `vaultdraw config check [--strict]`: exit 1 on errors, or on warnings with `--strict`.
pub fn config_check(cli: &Cli, strict: bool) -> Result<(), Fail> {
    let report = check_config_in(&dirs()?);
    let value = serde_json::to_value(&report).unwrap_or(Value::Null);
    emit(cli.json, &value, || report.text.trim_end().to_string());
    if report.errors > 0 || (strict && report.warnings > 0) {
        let what = if report.errors > 0 { format!("{} error(s)", report.errors) } else { format!("{} warning(s) (--strict)", report.warnings) };
        return Err(Fail::new(EXIT_CLI, format!("the config has {what}"), "CONFIG_INVALID"));
    }
    Ok(())
}

/// `vaultdraw config schema`: the JSON Schema of config.toml, for editors (taplo, Even Better TOML).
pub fn config_schema() -> Result<(), Fail> {
    print!("{CONFIG_SCHEMA}");
    Ok(())
}

/// What a connect attempt to the socket found, and the app's status when it answered.
fn probe(cli: &Cli) -> (Option<PathBuf>, String, Option<Value>) {
    let socket = match resolve_socket(cli.socket.as_deref()) {
        Ok(s) => s,
        Err(f) => return (None, format!("unknown ({})", f.message), None),
    };
    // Windows has no socket file (a named pipe): connecting is the only probe.
    if !cfg!(windows) && !socket.exists() {
        return (Some(socket), "no app (socket absent)".into(), None);
    }
    match Rpc::new(socket.clone(), PROBE_SECS).call(methods::APP_STATUS, None) {
        Ok(v) => (Some(socket), "connected".into(), Some(v)),
        Err(f) => (Some(socket), format!("no answer ({})", f.message), None),
    }
}

/// `vaultdraw doctor`: one read-only report for bug reports. Always exits 0.
pub fn doctor(cli: &Cli) -> Result<(), Fail> {
    let dirs = dirs()?;
    let (socket, socket_state, status) = probe(cli);
    let str_at = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    let mut input = DoctorInput {
        cli_version: Some(env!("CARGO_PKG_VERSION").into()),
        api_level: API_LEVEL,
        socket,
        socket_state,
        ..Default::default()
    };
    match &status {
        Some(s) => {
            input.app_version = str_at(s, "app");
            input.app_state = "running".into();
            if let Some(path) = s.get("vault").and_then(|v| str_at(v, "path")) {
                input.vault = Some(PathBuf::from(path));
                input.vault_from = "the app".into();
            }
        }
        None => {
            let live = InstancePaths::from_env(None).is_ok_and(|p| vaultdraw_core::instance::app_live(&p.dir));
            let socket_off = !layered_config_in(&dirs).as_ref().is_none_or(control_enabled);
            input.app_state = match (live, socket_off) {
                (false, _) => "not running",
                (true, true) => "running, control socket off ([control] enabled = false)",
                (true, false) => "starting (holds the instance lock, no answer yet)",
            }
            .into();
        }
    }
    if input.vault.is_none() {
        if let Ok(v) = vault_path::resolve(cli.vault.as_deref()) {
            input.vault_from = if cli.vault.is_some() {
                "--vault"
            } else if std::env::var_os(ENV_VAULT).is_some_and(|v| !v.is_empty()) {
                "$VAULTDRAW_VAULT"
            } else {
                "the last opened vault"
            }
            .into();
            input.vault = Some(v);
        }
    }
    let r = doctor_in(&dirs, &input);
    emit(cli.json, &r.report, || r.text.trim_end().to_string());
    Ok(())
}
