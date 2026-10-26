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
use vaultdraw_protocol::client::Client;
use vaultdraw_protocol::{codes, methods, ENV_SOCKET};

const START_WINDOW: Duration = Duration::from_secs(2);
const START_STEP: Duration = Duration::from_millis(100);

/// True while an app process holds `<runtime>/instance.lock`. Fails toward "live" when the runtime
/// dir cannot be resolved (like core `app_live` on probe errors), so a read never goes headless
/// against an app it could not rule out.
fn app_live() -> bool {
    InstancePaths::from_env(None).map_or(true, |p| vaultdraw_core::instance::app_live(&p.dir))
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

/// Runs one call against the app (`on_app`, on a connected client) or, with no app, on disk
/// (`headless`). The one place that knows the socket / instance-lock rule.
pub(crate) fn route(
    cli: &Cli,
    rpc: &Rpc,
    on_app: impl FnOnce(&mut Client) -> Result<Value, Fail>,
    headless: impl FnOnce() -> Result<Value, Fail>,
) -> Result<Value, Fail> {
    if cli.offline {
        if app_live() {
            return Err(offline_refused());
        }
        return headless();
    }
    let started = Instant::now();
    loop {
        match rpc.connect() {
            Ok(mut client) => {
                check_vault(cli, rpc, &mut client)?;
                return on_app(&mut client);
            }
            Err(f) if f.not_running() && !pinned_socket(cli) => {
                if !app_live() {
                    return headless();
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

/// One read call, from the app or from disk.
pub fn read(cli: &Cli, rpc: &Rpc, method: &str, params: Option<Value>) -> Result<Value, Fail> {
    let for_app = params.clone();
    route(cli, rpc, |c| rpc.call_on(c, method, for_app), || headless::call(cli, method, params))
}

/// The `{path}` / `{file}` part of write params.
fn target_of(params: &Value) -> Value {
    let keep = |k: &str| params.get(k).map(|v| (k.to_string(), v.clone()));
    Value::Object(["path", "file"].into_iter().filter_map(keep).collect())
}

/// One write call (`file.write` / `file.create`): the app's RPC, or the vault on disk under
/// the vault lock. `params` of a `file.write` may omit `expectedRevision`: "overwrite unless
/// changed since now", read first (on the same connection, or under the lock).
pub fn write(cli: &Cli, rpc: &Rpc, method: &str, params: Value) -> Result<Value, Fail> {
    let on_app = |c: &mut Client| {
        let mut p = params.clone();
        if method == methods::FILE_WRITE && p.get("expectedRevision").is_none() {
            let read = rpc.call_on(c, methods::FILE_READ, Some(target_of(&params)))?;
            p["expectedRevision"] = read.get("revision").cloned().unwrap_or(Value::Null);
        }
        rpc.call_on(c, method, Some(p))
    };
    route(cli, rpc, on_app, || headless::write_call(cli, method, &params))
}
