//! The C3 methods on the running app: looks up the active vault and the app services, then
//! calls the pure functions (`vault_ops`, `config_ops`, `target`) or the window. Thin glue.

use super::bridge::{call_window, pending, CALL_TIMEOUT, STATE_TIMEOUT, WINDOW_LABEL};
use super::target::{self, native_err, Need};
use super::{config_ops, events, vault_ops};
use crate::search::{SearchService, VaultIndex};
use crate::{links, Vault};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use vaultdraw_protocol::methods::*;
use vaultdraw_protocol::{codes, RpcError};

type Reply = Result<Value, RpcError>;

/// Time the reply of `app.quit` gets to reach the client before the quit starts.
const QUIT_DELAY: Duration = Duration::from_millis(100);
/// Rendering a drawing to a file (`export.render`) takes longer than the other window calls.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(120);
/// A control call that reads the index waits this long for the first build of a vault's index.
const INDEX_WAIT: Duration = Duration::from_secs(10);
/// After a create, move or trash the reply waits this long for the index to show the change.
const SYNC_WAIT: Duration = Duration::from_secs(3);

pub(crate) fn call(app: &AppHandle, method: &str, params: Option<Value>) -> Reply {
    let params = params.unwrap_or(Value::Null);
    match method {
        VAULT_INFO => {
            let v = active(app)?;
            Ok(vault_ops::info(&v))
        }
        VAULT_LIST => {
            let dir = opt_str(&params, "dir")?.unwrap_or("");
            let recursive = params.get("recursive").and_then(Value::as_bool).unwrap_or(false);
            let v = active(app)?;
            vault_ops::list(&v, dir, recursive)
        }
        VAULT_SEARCH => search(app, &params),
        VAULT_LINKS => links_of(app, &params),
        VAULT_TAGS => {
            let v = active(app)?;
            settled_index(app, &v);
            to_json(app.state::<SearchService>().tags(&v.handle).map_err(native_err)?)
        }
        FILE_READ => {
            let v = active(app)?;
            let path = resolve(app, &v, &params, Need::File)?;
            let result = vault_ops::read(&v, &path);
            crate::memory::schedule_release();
            result
        }
        FILE_WRITE => write(app, &params),
        CONFIG_GET => config_ops::get(&dirs()?, &params),
        CONFIG_SET => config_ops::set(&dirs()?, &params),
        APP_QUIT => Ok(quit(app)),
        VAULT_OPEN | TAB_LIST => call_window(app, method, Some(params), CALL_TIMEOUT),
        FILE_OPEN => window_with_target(app, method, params, Need::File, CALL_TIMEOUT),
        FILE_TRASH => {
            let reply = window_with_target(app, method, params, Need::File, CALL_TIMEOUT)?;
            index_caught_up(app, &[], &[reply["path"].as_str()]);
            Ok(reply)
        }
        FILE_CREATE => {
            let reply = window_with_target(app, method, params, Need::Nothing, CALL_TIMEOUT)?;
            index_caught_up(app, &[reply["path"].as_str()], &[]);
            Ok(reply)
        }
        EXPORT_RENDER | EXPORT_SPOOL => window_with_target(app, method, params, Need::File, EXPORT_TIMEOUT),
        TAB_FOCUS | TAB_CLOSE => tab_call(app, method, params),
        FILE_MOVE => file_move(app, params),
        _ => Err(RpcError::method_not_found(method)),
    }
}

fn dirs() -> Result<crate::config::Dirs, RpcError> {
    crate::config::resolve_dirs().map_err(native_err)
}

fn to_json(v: impl serde::Serialize) -> Reply {
    serde_json::to_value(v).map_err(|e| RpcError::app("INTERNAL", e.to_string()))
}

fn active(app: &AppHandle) -> Result<Arc<Vault>, RpcError> {
    crate::control_active_vault(app).ok_or_else(|| RpcError::app(codes::NO_VAULT, "No vault is open"))
}

fn opt_str<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, RpcError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(RpcError::invalid_params(format!("{key} must be a string"))),
    }
}

/// Link-style name to path through the vault's link resolver; `None` when it resolves to nothing.
/// Waits for the vault's first index build, so a name never misses just because the app is young.
fn by_name<'a>(app: &'a AppHandle, v: &'a Vault) -> impl Fn(&str) -> Option<String> + 'a {
    move |name| {
        let vi = settled_index(app, v)?;
        links::resolve_name(&vi, name)
    }
}

/// The vault's index once its first build has finished (waits up to [`INDEX_WAIT`], then answers
/// from what is indexed: a huge vault gets partial results rather than a hang).
fn settled_index(app: &AppHandle, v: &Vault) -> Option<Arc<VaultIndex>> {
    let vi = app.state::<SearchService>().vault(&v.handle).ok()?;
    vi.wait_ready_for(INDEX_WAIT);
    Some(vi)
}

/// Answers a create, move or trash only once the index shows it: the watcher would tell the index
/// about 0.8 s later, and a script's next `open Name` or `links Name` must not miss (hunter C-10).
/// `added` and `gone` are vault-relative paths; only drawings are indexed for sure, so only they are awaited.
fn index_caught_up(app: &AppHandle, added: &[Option<&str>], gone: &[Option<&str>]) {
    let drawings = |list: &[Option<&str>]| -> Vec<String> {
        list.iter().flatten().filter(|p| vaultdraw_core::filekind::has_drawing_ext(p)).map(|p| p.to_string()).collect()
    };
    let (added, gone) = (drawings(added), drawings(gone));
    if added.is_empty() && gone.is_empty() {
        return;
    }
    let Ok(v) = active(app) else { return };
    let service = app.state::<SearchService>();
    let Ok(vi) = service.vault(&v.handle) else { return };
    // Until the first build ends, the scan itself finds the change.
    if !vi.wait_ready_for(INDEX_WAIT) {
        return;
    }
    let all: Vec<String> = added.iter().chain(gone.iter()).cloned().collect();
    service.notify(&v.handle, &all, false);
    let deadline = std::time::Instant::now() + SYNC_WAIT;
    while std::time::Instant::now() < deadline {
        let done = {
            let index = vi.read();
            added.iter().all(|p| index.contains(p)) && gone.iter().all(|p| !index.contains(p))
        };
        if done {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn resolve(app: &AppHandle, v: &Vault, params: &Value, need: Need) -> Result<String, RpcError> {
    target::resolve(&v.root, params, need, &by_name(app, v))
}

fn search(app: &AppHandle, params: &Value) -> Reply {
    let query = opt_str(params, "query")?.ok_or_else(|| RpcError::invalid_params("query is required"))?;
    let limit = params.get("limit").and_then(Value::as_u64).map(|n| n.min(u32::MAX as u64) as u32);
    let v = active(app)?;
    settled_index(app, &v);
    to_json(app.state::<SearchService>().search(&v.handle, query, limit, None).map_err(native_err)?)
}

/// `vault.links`: the app's `LinksResponse` as is (`outgoing`, `unresolved`, `backlinks`).
fn links_of(app: &AppHandle, params: &Value) -> Reply {
    let v = active(app)?;
    let path = resolve(app, &v, params, Need::File)?;
    // Backlinks of a vault still being indexed would be incomplete, and an empty list is no error.
    let vi = settled_index(app, &v).ok_or_else(|| RpcError::app("NOT_FOUND", "The vault's index is not available"))?;
    to_json(links::links_of(&vi, &path))
}

/// `file.write`: the UI's save path, after refusing to overwrite unsaved edits in the window.
fn write(app: &AppHandle, params: &Value) -> Reply {
    let v = active(app)?;
    let path = resolve(app, &v, params, Need::Nothing)?;
    let scene = params.get("scene").filter(|s| s.is_object()).ok_or_else(|| RpcError::invalid_params("scene must be a drawing object"))?;
    let expected = vault_ops::expected_revision(params)?;
    refuse_if_dirty(app, &path)?;
    if expected.is_none() {
        // A new drawing in a folder that does not exist yet creates the folder, as the app's own creates do.
        vault_ops::ensure_parents(&v, &path)?;
    }
    let json = serde_json::to_string(scene).map_err(|e| RpcError::invalid_params(e.to_string()))?;
    let history = app.try_state::<crate::history::HistoryService>();
    let search = app.try_state::<SearchService>();
    let done = crate::commit_drawing(&v, history.as_deref(), search.as_deref(), &path, &json, expected, &crate::random_id()).map_err(native_err)?;
    Ok(json!({"path": path, "revision": done["revision"]}))
}

/// An open drawing with unsaved edits must not be overwritten behind the editor's back.
fn refuse_if_dirty(app: &AppHandle, path: &str) -> Result<(), RpcError> {
    if !pending().is_ready() {
        return Ok(());
    }
    // An unanswered probe is not a reason to refuse: the revision check still guards the file.
    let Ok(state) = call_window(app, "file.openState", Some(json!({"path": path})), STATE_TIMEOUT) else { return Ok(()) };
    if state["open"] == true && state["dirty"] == true {
        return Err(RpcError::app(codes::CONFLICT, "The drawing is open with unsaved changes").with("reason", "dirty").with("path", path));
    }
    Ok(())
}

/// Params with `file` replaced by the resolved `path`.
fn with_path(params: Value, path: String) -> Value {
    let mut map: Map<String, Value> = match params {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    map.remove("file");
    map.insert("path".into(), Value::String(path));
    Value::Object(map)
}

/// A `path` or `file` of `params` as a checked vault-relative path of an existing drawing.
pub(super) fn resolve_file(app: &AppHandle, params: &Value) -> Result<String, RpcError> {
    let v = active(app)?;
    resolve(app, &v, params, Need::File)
}

fn window_with_target(app: &AppHandle, method: &str, params: Value, need: Need, timeout: Duration) -> Reply {
    let v = active(app)?;
    let path = resolve(app, &v, &params, need)?;
    call_window(app, method, Some(with_path(params, path)), timeout)
}

/// `tab.focus` / `tab.close` take an id, an index or a target; a target is resolved here.
fn tab_call(app: &AppHandle, method: &str, params: Value) -> Reply {
    let has_target = ["path", "file"].iter().any(|k| params.get(*k).is_some_and(|v| !v.is_null()));
    let params = if has_target {
        let v = active(app)?;
        let path = resolve(app, &v, &params, Need::Nothing)?;
        with_path(params, path)
    } else {
        params
    };
    call_window(app, method, Some(params), CALL_TIMEOUT)
}

fn file_move(app: &AppHandle, mut params: Value) -> Reply {
    let v = active(app)?;
    let need = |key: &str| opt_str(&params, key).and_then(|s| s.ok_or_else(|| RpcError::invalid_params(format!("{key} is required"))));
    let from = target::resolve_from(&v.root, need("from")?, &by_name(app, &v))?;
    let to = target::validate_destination(need("to")?)?;
    params["from"] = Value::String(from);
    params["to"] = Value::String(to);
    let reply = call_window(app, FILE_MOVE, Some(params), CALL_TIMEOUT)?;
    index_caught_up(app, &[reply["to"].as_str()], &[reply["from"].as_str()]);
    Ok(reply)
}

/// Replies `{quitting: true}` now; the quit starts once the reply is on the wire, through the
/// same awaited save barrier as Cmd+Q (`vault-quit-request`).
fn quit(app: &AppHandle) -> Value {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("control-quit".into()).spawn(move || {
        std::thread::sleep(QUIT_DELAY);
        events::app_quitting();
        if app.webview_windows().is_empty() {
            app.exit(0);
        } else {
            let _ = app.emit("vault-quit-request", ());
        }
    });
    let _ = spawned;
    json!({"quitting": true})
}

/// State for `events.snapshot`: vault from Rust, drawing and tabs from the window when ready.
pub(super) fn snapshot(app: &AppHandle, mask: u32) -> Value {
    let ready = pending().is_ready();
    let state = if ready { call_window(app, "app.state", None, STATE_TIMEOUT).ok() } else { None };
    let tabs = if ready && mask & events::Topic::Tab.bit() != 0 { call_window(app, TAB_LIST, None, STATE_TIMEOUT).ok() } else { None };
    json!({
        "vault": crate::control_vault_summary(app),
        "activeDrawing": state.as_ref().and_then(|s| s.get("activeDrawing")).cloned(),
        "tabs": tabs,
    })
}

/// Tells the window which of its topics are wanted (`control-topics`).
pub(super) fn emit_window_topics(app: &AppHandle, mask: u32) {
    let _ = app.emit_to(WINDOW_LABEL, "control-topics", json!({"topics": vaultdraw_protocol::events::topics_of(mask)}));
}
