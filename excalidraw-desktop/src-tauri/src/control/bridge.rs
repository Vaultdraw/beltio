//! Calls from the control server into the window: the server emits `control-request`
//! `{rid, method, params}`, the page answers with the `control_reply` command.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use vaultdraw_protocol::{codes, RpcError};

pub(crate) const WINDOW_LABEL: &str = "main";
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const STATE_TIMEOUT: Duration = Duration::from_millis(500);

type Reply = Result<Value, RpcError>;

/// Pending window calls and the readiness flag. No Tauri types, so it is unit-tested directly.
#[derive(Default)]
pub(crate) struct Pending {
    next: AtomicU64,
    ready: AtomicBool,
    map: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
}

impl Pending {
    pub(crate) fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
    pub(crate) fn set_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }
    /// A page load started: not ready, and calls waiting on the old page fail now.
    pub(crate) fn reset(&self) {
        self.ready.store(false, Ordering::SeqCst);
        let waiting: Vec<_> = self.map.lock().unwrap().drain().collect();
        for (_, tx) in waiting {
            let _ = tx.send(Err(not_ready("The window reloaded")));
        }
    }
    /// Delivers a reply; false when nobody waits for `rid` any more (timed out).
    pub(crate) fn resolve(&self, rid: u64, reply: Reply) -> bool {
        match self.map.lock().unwrap().remove(&rid) {
            Some(tx) => tx.send(reply).is_ok(),
            None => false,
        }
    }
    /// Registers a call, hands its id to `send` (which emits the event) and waits.
    pub(crate) fn call(&self, timeout: Duration, send: impl FnOnce(u64) -> Result<(), String>) -> Reply {
        if !self.is_ready() {
            return Err(not_ready("The app window is not ready yet"));
        }
        let rid = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.map.lock().unwrap().insert(rid, tx);
        if let Err(e) = send(rid) {
            self.map.lock().unwrap().remove(&rid);
            return Err(not_ready(&e));
        }
        match rx.recv_timeout(timeout) {
            Ok(reply) => reply,
            Err(_) => {
                self.map.lock().unwrap().remove(&rid);
                Err(RpcError::app(codes::TIMEOUT, "The app window did not answer in time"))
            }
        }
    }
}

fn not_ready(msg: &str) -> RpcError {
    RpcError::app(codes::NOT_READY, msg)
}

static PENDING: OnceLock<Arc<Pending>> = OnceLock::new();

pub(crate) fn pending() -> &'static Arc<Pending> {
    PENDING.get_or_init(Default::default)
}

/// Calls a method the window answers (`app.state`, `command.list`, `command.run`, `app.openTarget`).
pub(crate) fn call_window(app: &AppHandle, method: &str, params: Option<Value>, timeout: Duration) -> Reply {
    pending().call(timeout, |rid| {
        let payload = json!({"rid": rid, "method": method, "params": params.unwrap_or(Value::Null)});
        app.emit_to(WINDOW_LABEL, "control-request", payload).map_err(|e| e.to_string())
    })
}

#[derive(Deserialize)]
pub(crate) struct ReplyError {
    code: String,
    message: String,
    data: Option<Map<String, Value>>,
}

impl ReplyError {
    fn into_rpc(self) -> RpcError {
        let mut e = RpcError::app(&self.code, self.message);
        for (k, v) in self.data.unwrap_or_default() {
            e = e.with(&k, v);
        }
        e
    }
}

/// The page finished loading its control handler: calls may flow. Returns the window topics
/// currently wanted (`{topics}`), so the page attaches only the listeners someone needs.
#[tauri::command]
pub(crate) async fn control_ready(app: AppHandle) -> Value {
    pending().set_ready();
    super::uri::on_window_ready(&app);
    json!({"topics": super::events::window_topics()})
}

#[tauri::command]
pub(crate) async fn control_reply(rid: u64, result: Option<Value>, error: Option<ReplyError>) {
    let reply = match error {
        Some(e) => Err(e.into_rpc()),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    pending().resolve(rid, reply);
}

/// Starts a spool file for an `export.spool` result: `{id, path}`.
#[tauri::command]
pub(crate) async fn control_spool_begin() -> crate::Result<Value> {
    let state = crate::config::resolve_dirs()?.state;
    let (id, path) = super::spool::begin(&state).map_err(crate::ioerr)?;
    Ok(json!({"id": id, "path": path}))
}

/// Appends one raw chunk (header `x-spool-id`) to a spool file.
#[tauri::command]
pub(crate) async fn control_spool_append(request: tauri::ipc::Request<'_>) -> crate::Result<()> {
    let id = crate::clipboard::header(&request, "x-spool-id")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => return Err(crate::err("INVALID_ARGUMENT", "Expected a raw binary body, got JSON")),
    };
    let state = crate::config::resolve_dirs()?.state;
    super::spool::append(&state, &id, bytes).map_err(crate::ioerr)
}

/// Deletes a spool file whose export failed.
#[tauri::command]
pub(crate) async fn control_spool_abort(id: String) -> crate::Result<()> {
    let state = crate::config::resolve_dirs()?.state;
    super::spool::abort(&state, &id).map_err(crate::ioerr)
}

/// The window's command registry, for `vaultdraw` completions and offline `command list`.
#[tauri::command]
pub(crate) async fn control_commands_snapshot(commands: Value) -> crate::Result<()> {
    let dirs = crate::config::resolve_dirs()?;
    write_snapshot(&dirs.state.join("commands.json"), &commands).map(drop).map_err(crate::ioerr)
}

/// Writes `commands` to `path` only when the content changed. True when written.
pub(crate) fn write_snapshot(path: &std::path::Path, commands: &Value) -> std::io::Result<bool> {
    let bytes = serde_json::to_vec(commands).map_err(std::io::Error::other)?;
    if std::fs::read(path).is_ok_and(|old| old == bytes) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    super::write_file_atomic(path, &bytes)?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn control_install_cli(system: bool) -> crate::Result<Value> {
    let done = super::install::install_cli_report(system)?;
    Ok(json!({"path": done.path, "message": done.message()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn not_ready_until_the_window_says_so() {
        let p = Pending::default();
        let e = p.call(Duration::from_millis(50), |_| panic!("must not emit")).unwrap_err();
        assert_eq!(e.app_code(), Some(codes::NOT_READY));
    }

    #[test]
    fn reply_resolves_the_waiter() {
        let p = Arc::new(Pending::default());
        p.set_ready();
        let p2 = p.clone();
        let r = p.call(Duration::from_secs(2), move |rid| {
            thread::spawn(move || {
                assert!(p2.resolve(rid, Ok(json!({"ok": 1}))));
            });
            Ok(())
        });
        assert_eq!(r.unwrap(), json!({"ok": 1}));
    }

    #[test]
    fn timeout_cleans_up_and_late_reply_is_ignored() {
        let p = Pending::default();
        p.set_ready();
        let mut seen = 0;
        let e = p.call(Duration::from_millis(30), |rid| {
            seen = rid;
            Ok(())
        });
        assert_eq!(e.unwrap_err().app_code(), Some(codes::TIMEOUT));
        assert!(!p.resolve(seen, Ok(Value::Null)));
        assert!(p.map.lock().unwrap().is_empty());
    }

    #[test]
    fn emit_failure_is_not_ready() {
        let p = Pending::default();
        p.set_ready();
        let e = p.call(Duration::from_secs(1), |_| Err("no window".into())).unwrap_err();
        assert_eq!(e.app_code(), Some(codes::NOT_READY));
        assert!(p.map.lock().unwrap().is_empty());
    }

    #[test]
    fn reset_fails_waiters_and_clears_readiness() {
        let p = Arc::new(Pending::default());
        p.set_ready();
        let p2 = p.clone();
        let t = thread::spawn(move || p2.call(Duration::from_secs(5), |_| Ok(())));
        while p.map.lock().unwrap().is_empty() {
            thread::sleep(Duration::from_millis(5));
        }
        p.reset();
        assert_eq!(t.join().unwrap().unwrap_err().app_code(), Some(codes::NOT_READY));
        assert!(!p.is_ready());
    }

    #[test]
    fn reply_error_merges_data_fields() {
        let e: ReplyError = serde_json::from_value(json!({"code": "UNAVAILABLE", "message": "m", "data": {"id": "x", "failed": ["a"]}})).unwrap();
        let e = e.into_rpc();
        assert_eq!(e.app_code(), Some("UNAVAILABLE"));
        assert_eq!(e.data.unwrap().extra["id"], "x");
    }

    #[test]
    fn snapshot_is_written_only_on_change() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("state/commands.json");
        assert!(write_snapshot(&p, &json!([{"id": "a"}])).unwrap());
        assert!(!write_snapshot(&p, &json!([{"id": "a"}])).unwrap());
        assert!(write_snapshot(&p, &json!([{"id": "b"}])).unwrap());
    }
}
