//! Where a read command gets its result: the running app (RPC) or the vault on disk
//! (headless core). Both produce the same JSON, so the callers do not care which.
//!
//! Rule: connect to the socket. Connected: RPC, and never headless. Not connected: if the
//! instance lock is held an app is starting, so keep retrying the socket and never go
//! headless; if the lock is free there is no app and the read goes headless. `--offline`
//! forces headless and refuses while an app is live (the app holds the vault).

use crate::cli::Cli;
use crate::error::{Fail, EXIT_REFUSED};
use crate::headless;
use crate::rpc::Rpc;
use serde_json::Value;
use std::time::{Duration, Instant};
use vaultdraw_protocol::dirs::InstancePaths;
use vaultdraw_protocol::{codes, ENV_SOCKET};

const START_WINDOW: Duration = Duration::from_secs(2);
const START_STEP: Duration = Duration::from_millis(100);

/// True while an app process holds `<runtime>/instance.lock`.
fn app_live() -> bool {
    InstancePaths::from_env(None).is_ok_and(|p| vaultdraw_core::instance::app_live(&p.dir))
}

/// An explicit socket (flag or `$VAULTDRAW_SOCKET`) names an app to talk to: no fallback.
fn pinned_socket(cli: &Cli) -> bool {
    cli.socket.is_some() || std::env::var_os(ENV_SOCKET).is_some_and(|v| !v.is_empty())
}

fn app_vault_conflict(want: &str, app: &str) -> Fail {
    Fail::new(
        EXIT_REFUSED,
        format!("Vaultdraw is running with {app}: --vault {want} would be ignored (use --offline only with the app closed)"),
        "VAULT_MISMATCH",
    )
}

/// `--vault` with a live app must name the app's vault; never silently use the other one.
fn check_vault(cli: &Cli, rpc: &Rpc, client: &mut vaultdraw_protocol::client::Client) -> Result<(), Fail> {
    let Some(want) = &cli.vault else { return Ok(()) };
    let info = rpc.call_on(client, vaultdraw_protocol::methods::VAULT_INFO, None)?;
    let app = info.get("path").and_then(Value::as_str).unwrap_or("");
    let canon = |p: &std::path::Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if canon(want) == canon(std::path::Path::new(app)) {
        Ok(())
    } else {
        Err(app_vault_conflict(&want.display().to_string(), app))
    }
}

fn offline_refused() -> Fail {
    Fail::new(EXIT_REFUSED, "Vaultdraw is running and holds the vault: use it directly (drop --offline) or quit the app", "APP_LIVE")
}

/// One read call, from the app or from disk.
pub fn read(cli: &Cli, rpc: &Rpc, method: &str, params: Option<Value>) -> Result<Value, Fail> {
    if cli.offline {
        if app_live() {
            return Err(offline_refused());
        }
        return headless::call(cli, method, params);
    }
    let started = Instant::now();
    loop {
        match rpc.connect() {
            Ok(mut client) => {
                check_vault(cli, rpc, &mut client)?;
                return rpc.call_on(&mut client, method, params);
            }
            Err(f) if f.not_running() && !pinned_socket(cli) => {
                if !app_live() {
                    return headless::call(cli, method, params);
                }
                // An app owns the lock but has no socket yet: wait for it like NOT_READY.
                if started.elapsed() >= START_WINDOW {
                    return Err(Fail::new(f.exit, "Vaultdraw is starting and not ready yet", codes::NOT_READY));
                }
                std::thread::sleep(START_STEP);
            }
            Err(f) => return Err(f),
        }
    }
}
