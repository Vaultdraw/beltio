//! One app process per user: an exclusive flock on `<runtime>/instance.lock`. The first
//! process keeps it for its lifetime; later launches forward their argv to the first one
//! over the control socket and exit.

use serde_json::json;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use vaultdraw_protocol::dirs::{ensure_private_dir, InstancePaths};
use vaultdraw_protocol::methods::{roles, APP_OPEN, RPC_HELLO};
use vaultdraw_protocol::{codes, CallError, Client};

static HELD: OnceLock<File> = OnceLock::new();
/// The first app binds after its window is built; a forwarder waits this long for the socket.
const FORWARD_WAIT: Duration = Duration::from_secs(2);

pub(crate) fn holds_lock() -> bool {
    HELD.get().is_some()
}

#[cfg(feature = "smoke-test")]
fn smoke_root() -> Option<PathBuf> {
    Some(std::env::temp_dir().join("vaultdraw-smoke"))
}
#[cfg(not(feature = "smoke-test"))]
fn smoke_root() -> Option<PathBuf> {
    None
}

/// The runtime files for this process (same smoke rule as `config::resolve_dirs`).
pub(crate) fn paths() -> Result<InstancePaths, String> {
    InstancePaths::from_env(smoke_root().as_deref())
}

pub(crate) use vaultdraw_core::instance::{try_claim, Claim};

/// `instance.json`: who owns the lock.
pub(crate) fn write_info(paths: &InstancePaths) -> io::Result<()> {
    let started = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let info = json!({"pid": std::process::id(), "app": super::APP_VERSION, "api": vaultdraw_protocol::API_LEVEL, "startedAt": started});
    super::write_file_atomic(&paths.info, info.to_string().as_bytes())
}

fn forwarding_allowed() -> bool {
    !cfg!(feature = "smoke-test") && std::env::var_os("EXCALIDRAW_VAULT_SMOKE_DIR").is_none()
}

/// First thing in `run()`: claim the instance, or hand this launch to the running app and
/// exit. Any failure falls through to a normal start (the vault then opens read-only).
pub(crate) fn claim_or_forward() {
    let Ok(paths) = paths() else { return };
    if ensure_private_dir(&paths.dir).is_err() {
        return;
    }
    match try_claim(&paths) {
        Ok(Claim::Held(file)) => {
            let _ = write_info(&paths);
            let _ = HELD.set(file);
            // Single-threaded here, so setting the environment is safe; children of the app
            // (terminals, scripts it starts) find the socket through it.
            std::env::set_var(vaultdraw_protocol::ENV_SOCKET, &paths.socket);
        }
        Ok(Claim::Busy) if forwarding_allowed() => {
            let args: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with("-psn_")).collect();
            let cwd = std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned());
            match forward(&paths.socket, &args, cwd.as_deref(), FORWARD_WAIT) {
                Ok(()) => std::process::exit(0),
                Err(e) => eprintln!("vaultdraw: could not hand over to the running app ({e}); starting normally"),
            }
        }
        _ => {}
    }
}

/// Sends `app.open {argv, cwd}` to the running app, waiting up to `wait` for its socket and
/// for its window to be ready.
pub(crate) fn forward(socket: &Path, argv: &[String], cwd: Option<&str>, wait: Duration) -> Result<(), String> {
    let deadline = Instant::now() + wait;
    let mut client = loop {
        match Client::connect(socket) {
            Ok(c) => break c,
            Err(CallError::NotRunning(m)) if Instant::now() >= deadline => return Err(m),
            Err(CallError::NotRunning(_)) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    };
    client.set_timeout(Some(Duration::from_secs(35))).map_err(|e| e.to_string())?;
    client.call(RPC_HELLO, Some(json!({"role": roles::URI, "client": "vaultdraw-launch"}))).map_err(|e| e.to_string())?;
    loop {
        let params = json!({"argv": argv, "cwd": cwd});
        match client.call(APP_OPEN, Some(params)) {
            Ok(_) => return Ok(()),
            Err(CallError::Rpc(e)) if e.app_code() == Some(codes::NOT_READY) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_file_has_pid_version_api() {
        let t = tempfile::tempdir().unwrap();
        let paths = InstancePaths::in_dir(t.path());
        write_info(&paths).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&paths.info).unwrap()).unwrap();
        assert_eq!(v["pid"], std::process::id());
        assert_eq!(v["app"], super::super::APP_VERSION);
        assert_eq!(v["api"], vaultdraw_protocol::API_LEVEL);
        assert!(v["startedAt"].as_u64().unwrap() > 0);
    }

    #[test]
    fn forward_without_a_socket_fails_after_the_wait() {
        let t = tempfile::tempdir().unwrap();
        let socket = t.path().join("ctl.sock");
        let started = Instant::now();
        let r = forward(&socket, &[], None, Duration::from_millis(150));
        assert!(r.is_err());
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// The first-instance path (resolve, mkdir check, open, flock, write info) must stay cheap.
    #[test]
    fn startup_claim_cost() {
        let t = tempfile::tempdir().unwrap();
        let mut samples = Vec::new();
        for i in 0..50 {
            let dir = t.path().join(format!("r{i}"));
            let start = Instant::now();
            ensure_private_dir(&dir).unwrap();
            let paths = InstancePaths::in_dir(&dir);
            let claim = try_claim(&paths).unwrap();
            write_info(&paths).unwrap();
            samples.push(start.elapsed());
            assert!(matches!(claim, Claim::Held(_)));
        }
        samples.sort();
        eprintln!("claim path: p50 {:?} p95 {:?} max {:?}", samples[25], samples[47], samples[49]);
        // Unloaded it is ~0.2 ms; the bound only catches an order-of-magnitude regression, so a loaded machine does not flake it.
        assert!(samples[25] < Duration::from_millis(25), "claim path is slow");
    }
}
