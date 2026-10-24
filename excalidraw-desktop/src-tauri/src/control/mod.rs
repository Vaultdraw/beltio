//! Control API server inside the app (personal/feature/control-api).
//!
//! - `instance`: one app process per user (flock) and forwarding of later launches.
//! - `server`: the Unix-socket JSON-RPC server, independent of Tauri (`Dispatch` trait).
//! - `dispatch`: the Tauri implementation of `Dispatch`.
//! - `policy`: the `mcp` role's gate (closed switch, rate limit, one window call at a time).
//! - `scene_route`: `scene.*` calls to the window (`file` to `path`, who is asking).
//! - `bridge`: calls into the window (`control-request` event, `control_reply` command).
//! - `install`: the palette's "install CLI" symlink.
//! - `ops` (glue on the running app) over `vault_ops`, `config_ops` and `target` (pure, tested).
//! - `spool`: chunked spool files that carry large exports to the CLI.
//! - `uri`: `vaultdraw://` links (policy, rate limit, queue) from every entry point.
//! - `linux_handlers`: the opt-in `.desktop` and MIME files for Linux installs nothing registers.
//! - `files`: files from the system (`.excalidraw`, `.excalidrawlib`): checks, grants, bounded read.
//! - `events`: the event bus with its single topic mask (zero cost while nobody subscribes).

// Pure vault/file methods and target resolution live in `vaultdraw-core`.
pub(crate) use vaultdraw_core::ops::{config_ops, target, vault_ops};

pub(crate) mod bridge;
mod dispatch;
pub(crate) mod events;
pub(crate) mod files;
pub(crate) mod install;
pub(crate) mod instance;
pub(crate) mod linux_handlers;
pub(crate) mod ops;
mod policy;
mod scene_route;
pub(crate) mod server;
pub(crate) mod spool;
pub(crate) mod uri;

use std::io::Write;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use tauri::AppHandle;
use vaultdraw_core::control_settings::ControlSettings;

/// App version reported by `rpc.discover`, `app.status` and `instance.json`.
pub(crate) const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

static SERVER: OnceLock<server::ServerHandle> = OnceLock::new();

/// Called when a page starts loading: the window is not ready until it says so again.
pub(crate) fn on_page_load_started() {
    bridge::pending().reset();
}

/// Process exit: remove the socket and `instance.json` this process owns (the next start would
/// replace them anyway; this keeps clients from finding a dead socket).
pub(crate) fn on_exit() {
    if !instance::holds_lock() {
        return;
    }
    if let Ok(paths) = instance::paths() {
        let _ = std::fs::remove_file(&paths.socket);
        let _ = std::fs::remove_file(&paths.info);
    }
}

/// Starts the control server on a background thread (after the window is built).
/// Does nothing when another process owns the instance lock or `[control] enabled = false`.
pub(crate) fn spawn(app: &AppHandle) {
    if !instance::holds_lock() {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("control-start".into()).spawn(move || {
        if !control_enabled_in_config() {
            return;
        }
        let Ok(paths) = instance::paths() else { return };
        let dispatch = Arc::new(dispatch::TauriDispatch::new(app));
        match server::start(&paths, dispatch, events::bus().clone(), server::ServerConfig::default()) {
            Ok(handle) => {
                let _ = SERVER.set(handle);
            }
            Err(e) => eprintln!("vaultdraw: control socket not started: {e}"),
        }
    });
    if let Err(e) = spawned {
        eprintln!("vaultdraw: control socket not started: {e}");
    }
}

/// The control socket path and its state, for the debug info report. Reads only.
pub(crate) fn socket_report() -> (Option<std::path::PathBuf>, String) {
    let path = instance::paths().ok().map(|p| p.socket);
    let state = if SERVER.get().is_some() {
        "served by this app"
    } else if !instance::holds_lock() {
        "not served (another Vaultdraw holds the instance lock)"
    } else {
        "not served ([control] enabled = false, or it failed to start)"
    };
    (path, state.into())
}

/// The control settings from the merged config layers (`overrides.toml` over `config.toml`),
/// read now; `None` when the config folders cannot be resolved. One reader shared with
/// `vaultdraw mcp` (`vaultdraw_core::control_settings`).
pub(crate) fn control_settings() -> Option<ControlSettings> {
    crate::config::resolve_dirs().ok().map(|dirs| vaultdraw_core::control_settings::control_settings(&dirs))
}

/// `[control] enabled` through the layers; a missing or broken config means enabled.
fn control_enabled_in_config() -> bool {
    control_settings().is_none_or(|s| s.enabled)
}

/// Writes `bytes` to `path` through a same-directory temp file and a rename. No fsync: these
/// files (instance.json, commands.json) are rebuilt at every launch.
pub(crate) fn write_file_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| std::io::Error::other("file has no parent"))?;
    let tmp = parent.join(format!(".tmp-{}-{}", std::process::id(), path.file_name().and_then(|n| n.to_str()).unwrap_or("f")));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_content() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a.json");
        write_file_atomic(&p, b"1").unwrap();
        write_file_atomic(&p, b"22").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"22");
        assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 1);
    }
}
