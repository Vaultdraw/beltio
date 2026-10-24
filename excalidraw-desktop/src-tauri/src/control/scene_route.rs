//! `scene.*` calls: Rust turns a link-style `file` into an exact `path` and stamps who is asking,
//! then the window (`sceneMethods.ts`) does the work on the drawing on screen.

use super::bridge::{call_window, CALL_TIMEOUT};
use serde_json::{Map, Value};
use vaultdraw_protocol::methods::SCENE_APPLY;
use vaultdraw_protocol::RpcError;

type Reply = Result<Value, RpcError>;

/// The window's params for `method`. `resolve` maps the caller's `path` or `file` to a checked
/// vault-relative path; it runs only when the caller named a drawing (no target means "the
/// drawing on screen"). `scene.apply` also gets `by` (the caller's role) and `notify`, which a
/// caller cannot set itself.
pub(super) fn prepare(
    method: &str,
    params: Option<Value>,
    role: &str,
    notify: bool,
    resolve: &dyn Fn(&Value) -> Result<String, RpcError>,
) -> Result<Value, RpcError> {
    let mut map: Map<String, Value> = match params {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m,
        Some(_) => return Err(RpcError::invalid_params("params must be an object")),
    };
    let named = |m: &Map<String, Value>, key: &str| m.get(key).is_some_and(|v| !v.is_null());
    if named(&map, "path") || named(&map, "file") {
        let path = resolve(&Value::Object(map.clone()))?;
        map.remove("file");
        map.insert("path".into(), Value::String(path));
    } else {
        map.remove("path");
        map.remove("file");
    }
    if method == SCENE_APPLY {
        map.insert("by".into(), Value::String(role.to_string()));
        map.insert("notify".into(), Value::Bool(notify));
    }
    Ok(Value::Object(map))
}

/// Routes one `scene.*` call to the window.
pub(super) fn call(app: &tauri::AppHandle, role: &str, method: &str, params: Option<Value>) -> Reply {
    // The config file is read only for an edit, the one call that can show the notice.
    let notify = method == SCENE_APPLY && super::policy::notify_edits_in_config();
    let prepared = prepare(method, params, role, notify, &|p| super::ops::resolve_file(app, p))?;
    call_window(app, method, Some(prepared), CALL_TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;
    use vaultdraw_protocol::methods::{SCENE_GET, SCENE_READ};

    fn by_name(p: &Value) -> Result<String, RpcError> {
        match (p.get("path").and_then(Value::as_str), p.get("file").and_then(Value::as_str)) {
            (Some(path), _) => Ok(path.to_string()),
            (None, Some("BFS")) => Ok("Graphs/BFS.excalidraw".into()),
            _ => Err(RpcError::app("NOT_FOUND", "no such drawing")),
        }
    }

    #[test]
    fn file_becomes_a_resolved_path() {
        let v = prepare(SCENE_READ, Some(json!({"file": "BFS", "limit": 5})), "cli", true, &by_name).unwrap();
        assert_eq!(v, json!({"path": "Graphs/BFS.excalidraw", "limit": 5}));
        let v = prepare(SCENE_GET, Some(json!({"path": "a.excalidraw", "ids": ["x"]})), "cli", true, &by_name).unwrap();
        assert_eq!(v, json!({"path": "a.excalidraw", "ids": ["x"]}));
    }

    #[test]
    fn resolver_runs_only_when_a_target_is_given() {
        let calls = Cell::new(0);
        let count = |_: &Value| {
            calls.set(calls.get() + 1);
            Ok("a.excalidraw".to_string())
        };
        for p in [None, Some(Value::Null), Some(json!({})), Some(json!({"path": null, "file": null, "scope": "all"}))] {
            let v = prepare(SCENE_READ, p, "cli", true, &count).unwrap();
            assert!(v.get("path").is_none() && v.get("file").is_none(), "{v}");
        }
        assert_eq!(calls.get(), 0);
        prepare(SCENE_READ, Some(json!({"file": "x"})), "cli", true, &count).unwrap();
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn a_resolver_error_is_returned() {
        let e = prepare(SCENE_READ, Some(json!({"file": "nope"})), "cli", true, &by_name).unwrap_err();
        assert_eq!(e.app_code(), Some("NOT_FOUND"));
    }

    #[test]
    fn params_must_be_an_object_or_absent() {
        for bad in [json!([1]), json!("x"), json!(3), json!(true)] {
            let e = prepare(SCENE_READ, Some(bad), "cli", true, &by_name).unwrap_err();
            assert_eq!(e.code, vaultdraw_protocol::INVALID_PARAMS);
        }
    }

    #[test]
    fn only_apply_gets_by_and_notify_and_the_caller_cannot_set_them() {
        let v = prepare(SCENE_APPLY, Some(json!({"ops": [{}], "by": "uri", "notify": false})), "mcp", true, &by_name).unwrap();
        assert_eq!((v["by"].clone(), v["notify"].clone()), (json!("mcp"), json!(true)));
        let v = prepare(SCENE_APPLY, Some(json!({"ops": [{}]})), "cli", false, &by_name).unwrap();
        assert_eq!((v["by"].clone(), v["notify"].clone()), (json!("cli"), json!(false)));
        let v = prepare(SCENE_READ, Some(json!({"by": "x", "notify": false})), "cli", true, &by_name).unwrap();
        assert_eq!(v, json!({"by": "x", "notify": false}), "read-only methods pass the caller's params untouched");
    }
}
