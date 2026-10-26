//! The Tauri implementation of the control server's `Dispatch`.

use super::bridge::{call_window, pending, CALL_TIMEOUT, STATE_TIMEOUT, WINDOW_LABEL};
use super::{events, ops, scene_route};
use super::server::Dispatch;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use vaultdraw_protocol::methods::{self, APP_FOCUS, APP_OPEN, APP_STATUS, COMMAND_LIST, COMMAND_RUN, RPC_DISCOVER, SCENE_APPLY, SCENE_GET, SCENE_READ, SCENE_SELECTION, URI_HANDLE};
use vaultdraw_protocol::{codes, RpcError, API_LEVEL};

pub(crate) struct TauriDispatch {
    app: AppHandle,
}

impl TauriDispatch {
    pub(crate) fn new(app: AppHandle) -> Self {
        let hook_app = app.clone();
        events::bus().set_window_hook(move |mask| ops::emit_window_topics(&hook_app, mask));
        Self { app }
    }

    fn status(&self) -> Value {
        let ready = pending().is_ready();
        let state = if ready { call_window(&self.app, "app.state", None, STATE_TIMEOUT).ok() } else { None };
        status_json(crate::control_vault_summary(&self.app), state, ready)
    }

    fn focus(&self) -> Result<Value, RpcError> {
        let window = self
            .app
            .get_webview_window(WINDOW_LABEL)
            .ok_or_else(|| RpcError::app(codes::NOT_READY, "The app has no window yet"))?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        Ok(json!({"focused": true}))
    }

    /// Focuses the window, then sends each `vaultdraw://` link to the link handler and each
    /// file path to the window.
    fn open(&self, params: Option<Value>) -> Result<Value, RpcError> {
        let params = params.unwrap_or(Value::Null);
        let argv: Vec<&str> = params
            .get("argv")
            .and_then(Value::as_array)
            .ok_or_else(|| RpcError::invalid_params("argv must be an array of strings"))?
            .iter()
            .map(|v| v.as_str().ok_or_else(|| RpcError::invalid_params("argv must be an array of strings")))
            .collect::<Result<_, _>>()?;
        let cwd = params.get("cwd").cloned().unwrap_or(Value::Null);
        let wants_safe = crate::launch::argv_has_safe(&argv);
        // The window must be listening, or the request is lost: the sender retries NOT_READY.
        if wants_safe && !pending().is_ready() {
            return Err(RpcError::app(codes::NOT_READY, "The app window is still starting"));
        }
        self.focus()?;
        let mut handled = 0;
        for route in route_argv(&argv) {
            match route {
                Route::Link(url) => {
                    // A refused link (off, rate limit, bad URL) already showed the user a notice;
                    // failing here would make the second launch start a second app. Only a
                    // window that is not ready yet is retried by the sender.
                    if let Err(e) = super::uri::handle(&self.app, url, super::uri::Origin::Forwarded) {
                        if e.app_code() == Some(codes::NOT_READY) {
                            return Err(e);
                        }
                    }
                }
                Route::File(path) => {
                    // Same handler as Finder opens: in-vault files open, others ask first.
                    // `path` may be a plain path (relative to the sender's cwd) or a `file:` URL (Linux `%U`).
                    for item in super::uri::classify_opened([path.to_string()], cwd.as_str()) {
                        if let super::uri::Item::File(abs) = item {
                            if let Err(e) = super::uri::handle_file(&self.app, &abs, super::uri::Origin::Forwarded) {
                                if e.app_code() == Some(codes::NOT_READY) {
                                    return Err(e);
                                }
                            }
                        }
                    }
                }
                Route::Path(target) => {
                    call_window(&self.app, "app.openTarget", Some(json!({"target": target, "cwd": cwd})), CALL_TIMEOUT)?;
                }
            }
            handled += 1;
        }
        if wants_safe {
            // Sent once, after every route succeeded: a retried request (NOT_READY above or
            // from a route) has not sent it yet. The window asks the user first, because a
            // safe start closes the open drawings.
            let _ = self.app.emit(crate::launch::SAFE_REQUESTED_EVENT, ());
        }
        Ok(json!({"handled": handled}))
    }
}

/// Where one forwarded argv item goes.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Route<'a> {
    /// A `vaultdraw:` link: the policy handler (`uri::handle`).
    Link(&'a str),
    /// A `.excalidraw` / `.excalidrawlib` path: the file handler (`uri::handle_file`).
    File(&'a str),
    /// Any other path: the window's `app.openTarget`.
    Path(&'a str),
}

/// Flags are skipped, links and paths keep their order.
pub(crate) fn route_argv<'a>(argv: &[&'a str]) -> Vec<Route<'a>> {
    argv.iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            if super::uri::is_uri(a) {
                Route::Link(a)
            } else if super::files::is_file_arg(a) {
                Route::File(a)
            } else {
                Route::Path(a)
            }
        })
        .collect()
}

/// `app.status` result from its parts (kept pure for the golden test).
pub(crate) fn status_json(vault: Option<Value>, state: Option<Value>, window_ready: bool) -> Value {
    let field = |name: &str| state.as_ref().and_then(|s| s.get(name)).cloned().unwrap_or(Value::Null);
    json!({
        "running": true,
        "app": super::APP_VERSION,
        "api": API_LEVEL,
        "pid": std::process::id(),
        "vault": vault,
        "activeDrawing": field("activeDrawing"),
        "tabs": field("tabs"),
        "windowReady": window_ready,
    })
}

impl Dispatch for TauriDispatch {
    fn call(&self, role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        match method {
            RPC_DISCOVER => Ok(methods::discover(super::APP_VERSION)),
            APP_STATUS => Ok(self.status()),
            APP_FOCUS => self.focus(),
            APP_OPEN => self.open(params),
            URI_HANDLE => {
                let url = params.as_ref().and_then(|p| p.get("url")).and_then(Value::as_str).ok_or_else(|| RpcError::invalid_params("url must be a string"))?;
                super::uri::handle(&self.app, url, super::uri::Origin::Cli)
            }
            COMMAND_LIST | COMMAND_RUN => call_window(&self.app, method, params, CALL_TIMEOUT),
            SCENE_READ | SCENE_GET | SCENE_SELECTION | SCENE_APPLY => scene_route::call(&self.app, role, method, params),
            // The C3 methods (vault, files, tabs, config, quit).
            _ => ops::call(&self.app, method, params),
        }
    }

    fn snapshot(&self, mask: u32) -> Value {
        ops::snapshot(&self.app, mask)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwarded_safe_flag_is_seen_and_not_routed_as_a_target() {
        let argv = ["--safe", "/v/a.excalidraw"];
        assert!(crate::launch::argv_has_safe(argv));
        assert_eq!(route_argv(&argv), vec![Route::File("/v/a.excalidraw")]);
        assert!(!crate::launch::argv_has_safe(["/v/a.excalidraw"]));
    }

    #[test]
    fn app_open_routes_links_to_the_policy_handler_and_paths_to_the_window() {
        let r = route_argv(&["--flag", "/v/a.excalidraw", "vaultdraw://open?file=a", "-psn_0_1", "VAULTDRAW://new?path=x", "rel/b.excalidraw", "BFS", "l.excalidrawlib"]);
        assert_eq!(
            r,
            [
                Route::File("/v/a.excalidraw"),
                Route::Link("vaultdraw://open?file=a"),
                Route::Link("VAULTDRAW://new?path=x"),
                Route::File("rel/b.excalidraw"),
                Route::Path("BFS"),
                Route::File("l.excalidrawlib")
            ]
        );
        assert!(route_argv(&[]).is_empty());
    }

    #[test]
    fn status_golden_shape() {
        let v = status_json(
            Some(json!({"name": "Notes", "path": "/v/Notes", "readOnly": false})),
            Some(json!({"activeDrawing": {"path": "a.excalidraw", "dirty": true}, "tabs": 3})),
            true,
        );
        let mut expected = json!({
            "running": true, "app": super::super::APP_VERSION, "api": 1, "pid": std::process::id(),
            "vault": {"name": "Notes", "path": "/v/Notes", "readOnly": false},
            "activeDrawing": {"path": "a.excalidraw", "dirty": true}, "tabs": 3, "windowReady": true
        });
        assert_eq!(v, expected);
        let none = status_json(None, None, false);
        expected["vault"] = Value::Null;
        expected["activeDrawing"] = Value::Null;
        expected["tabs"] = Value::Null;
        expected["windowReady"] = json!(false);
        assert_eq!(none, expected);
    }
}
