//! `scene.*` calls: Rust turns a link-style `file` into an exact `path` and stamps who is asking,
//! then the window (`sceneMethods.ts`) does the work on the drawing on screen.

use super::bridge::{call_window, CALL_TIMEOUT};
use serde_json::{json, Map, Value};
use vaultdraw_protocol::methods::{FILE_CREATE, FILE_READ, FILE_WRITE, SCENE_APPLY, SCENE_GET, SCENE_READ, SCENE_SELECTION};
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
    match call_window(app, method, Some(prepared.clone()), CALL_TIMEOUT) {
        Err(e) if method != SCENE_SELECTION && is_not_on_screen(&e, &prepared) => on_file(app, method, &prepared),
        other => other,
    }
}

/// `scene.create`: builds the scene from the operations in the window (nothing is written if an
/// operation is invalid), then creates the drawing with that scene through `file.create`, so no
/// blank file is ever left behind.
pub(super) fn create(app: &tauri::AppHandle, params: Option<Value>) -> Reply {
    let params = params.unwrap_or(Value::Null);
    let path = params.get("path").and_then(Value::as_str).filter(|p| !p.is_empty()).ok_or_else(|| RpcError::invalid_params("path must be a non-empty string"))?;
    let ops = params.get("ops").cloned().unwrap_or(Value::Null);
    let mut built = call_window(app, "scene.onFile", Some(create_params(path, &ops)), CALL_TIMEOUT)?;
    let scene = built.as_object_mut().and_then(|m| m.remove("scene")).unwrap_or(Value::Null);
    let made = super::ops::call(app, FILE_CREATE, Some(json!({"path": path, "scene": new_scene(&scene)})))?;
    let mut out = built;
    out["path"] = made["path"].clone();
    if let Some(r) = made.get("revision") {
        out["revision"] = r.clone();
    }
    Ok(out)
}

/// The window's params for building a scene from nothing.
fn create_params(path: &str, ops: &Value) -> Value {
    json!({"method": "apply", "path": path, "scene": {"elements": []}, "ops": ops})
}

/// A complete, empty-appState drawing file around the built `elements` and `files`.
fn new_scene(edited: &Value) -> Value {
    json!({
        "type": "excalidraw",
        "version": 2,
        "source": "vaultdraw",
        "elements": edited.get("elements").cloned().unwrap_or_else(|| json!([])),
        "appState": {},
        "files": edited.get("files").cloned().unwrap_or_else(|| json!({})),
    })
}

/// The drawing was named but is not the one on screen (or nothing is on screen): the file route.
fn is_not_on_screen(e: &RpcError, prepared: &Value) -> bool {
    let reason = e.data.as_ref().and_then(|d| d.extra.get("reason")).and_then(Value::as_str);
    e.app_code() == Some("NOT_FOUND") && matches!(reason, Some("not_active") | Some("no_drawing")) && prepared.get("path").is_some()
}

/// The window's params for the file route: the parsed scene and the caller's own params.
fn file_params(method: &str, prepared: &Value, scene: &Value) -> Value {
    let kind = match method {
        SCENE_READ => "read",
        SCENE_GET => "get",
        _ => "apply",
    };
    let mut map = prepared.as_object().cloned().unwrap_or_default();
    map.remove("by");
    map.remove("notify");
    map.insert("method".into(), json!(kind));
    map.insert("scene".into(), scene.clone());
    Value::Object(map)
}

/// The scene to write back: the file's own scene with the edited `elements` and the added `files`.
fn merged_scene(original: &Value, edited: &Value) -> Value {
    let mut out = original.clone();
    if let Some(map) = out.as_object_mut() {
        if let Some(els) = edited.get("elements") {
            map.insert("elements".into(), els.clone());
        }
        if let Some(Value::Object(new_files)) = edited.get("files") {
            let files = map.entry("files").or_insert_with(|| json!({}));
            if let Some(f) = files.as_object_mut() {
                f.extend(new_files.clone());
            }
        }
    }
    out
}

/// Reads, and for an apply edits and writes back, a drawing that is not on screen. The window
/// does the work on the parsed scene (it never touches the editor); the write goes through
/// `file.write` with the revision read here, so history, read-only checks, the unsaved-edits
/// check and the atomic write are the app's own.
fn on_file(app: &tauri::AppHandle, method: &str, prepared: &Value) -> Reply {
    let path = prepared.get("path").cloned().unwrap_or(Value::Null);
    let read = super::ops::call(app, FILE_READ, Some(json!({"path": path})))?;
    let scene = read.get("scene").cloned().unwrap_or(Value::Null);
    let mut result = call_window(app, "scene.onFile", Some(file_params(method, prepared, &scene)), CALL_TIMEOUT)?;
    if method == SCENE_APPLY {
        if let Some(edited) = result.as_object_mut().and_then(|m| m.remove("scene")) {
            let revision = read.get("revision").cloned().unwrap_or(Value::Null);
            let written = super::ops::call(app, FILE_WRITE, Some(json!({"path": path, "scene": merged_scene(&scene, &edited), "expectedRevision": revision})))?;
            result["revision"] = written["revision"].clone();
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    #[test]
    fn the_file_route_is_for_a_named_drawing_that_is_not_on_screen() {
        let not_active = RpcError::app("NOT_FOUND", "x").with("reason", "not_active");
        let none_open = RpcError::app("NOT_FOUND", "x").with("reason", "no_drawing");
        let other = RpcError::app("NOT_FOUND", "x").with("reason", "something");
        let named = json!({"path": "a.excalidraw"});
        assert!(is_not_on_screen(&not_active, &named));
        assert!(is_not_on_screen(&none_open, &named));
        assert!(!is_not_on_screen(&other, &named));
        assert!(!is_not_on_screen(&not_active, &json!({})), "no path: the drawing on screen was meant");
        assert!(!is_not_on_screen(&RpcError::app("READ_ONLY", "x"), &named));
    }

    #[test]
    fn a_created_scene_is_a_whole_drawing_file() {
        let s = new_scene(&json!({"elements": [{"id": "a"}], "files": {"f": 1}}));
        assert_eq!(s["type"], "excalidraw");
        assert_eq!(s["elements"], json!([{"id": "a"}]));
        assert_eq!(s["files"], json!({"f": 1}));
        assert_eq!(new_scene(&Value::Null)["elements"], json!([]));
        let p = create_params("n/a", &json!([1]));
        assert_eq!(p["scene"], json!({"elements": []}));
        assert_eq!(p["method"], "apply");
    }

    #[test]
    fn file_params_carry_the_scene_and_drop_server_keys() {
        let p = file_params(SCENE_APPLY, &json!({"path": "a.excalidraw", "ops": [1], "by": "mcp", "notify": true}), &json!({"elements": []}));
        assert_eq!(p, json!({"path": "a.excalidraw", "ops": [1], "method": "apply", "scene": {"elements": []}}));
        assert_eq!(file_params(SCENE_READ, &json!({}), &json!({}))["method"], "read");
        assert_eq!(file_params(SCENE_GET, &json!({}), &json!({}))["method"], "get");
    }

    #[test]
    fn merged_scene_keeps_the_files_own_fields() {
        let original = json!({"type": "excalidraw", "appState": {"x": 1}, "elements": [1], "files": {"a": 1}});
        let edited = json!({"elements": [1, 2], "files": {"b": 2}});
        assert_eq!(merged_scene(&original, &edited), json!({"type": "excalidraw", "appState": {"x": 1}, "elements": [1, 2], "files": {"a": 1, "b": 2}}));
    }

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
