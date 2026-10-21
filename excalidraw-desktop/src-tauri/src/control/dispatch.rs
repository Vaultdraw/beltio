//! The Tauri implementation of the control server's `Dispatch`.

use super::bridge::{call_window, pending, CALL_TIMEOUT, STATE_TIMEOUT, WINDOW_LABEL};
use super::{events, ops};
use super::server::Dispatch;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use vaultdraw_protocol::methods::{self, APP_FOCUS, APP_OPEN, APP_STATUS, COMMAND_LIST, COMMAND_RUN, RPC_DISCOVER};
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

    /// Focuses the window and forwards each file path / `vaultdraw://` URI to it
    /// (URI semantics are the window's business, see C6).
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
        self.focus()?;
        let mut handled = 0;
        for target in argv.into_iter().filter(|a| !a.starts_with('-')) {
            call_window(&self.app, "app.openTarget", Some(json!({"target": target, "cwd": cwd})), CALL_TIMEOUT)?;
            handled += 1;
        }
        Ok(json!({"handled": handled}))
    }
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
    fn call(&self, _role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        match method {
            RPC_DISCOVER => Ok(methods::discover(super::APP_VERSION)),
            APP_STATUS => Ok(self.status()),
            APP_FOCUS => self.focus(),
            APP_OPEN => self.open(params),
            COMMAND_LIST | COMMAND_RUN => call_window(&self.app, method, params, CALL_TIMEOUT),
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
