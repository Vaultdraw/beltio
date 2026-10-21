//! File targets of the control API: `{path}` (exact, vault-relative) or `{file}` (a link-style
//! name, resolved like `[[name]]`). One resolver for every target method.

use crate::NativeError;
use serde_json::Value;
use std::path::Path;
use vaultdraw_protocol::{codes, RpcError};

const EXT: &str = ".excalidraw";

/// What a resolved target must be on disk.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Need {
    /// Nothing (write/create, tabs of deleted files).
    Nothing,
    /// An existing drawing.
    File,
    /// An existing drawing or folder (`file.move` source).
    Entry,
}

/// The app's error code and message as a JSON-RPC application error.
pub(crate) fn native_err(e: NativeError) -> RpcError {
    RpcError::app(&e.code, e.message)
}

fn not_found(target: &str) -> RpcError {
    RpcError::app(codes::NOT_FOUND, format!("No drawing matches '{target}'")).with("target", target)
}

/// Resolves an exact vault-relative path: validates it (`INVALID_PATH` on escapes), appends
/// `.excalidraw` when missing and the bare path is not an existing file, checks `need`.
pub(crate) fn resolve_path(root: &Path, path: &str, need: Need) -> Result<String, RpcError> {
    let mut rel = path.to_string();
    let full = crate::safe_path(root, &rel, true).map_err(native_err)?;
    if !rel.to_ascii_lowercase().ends_with(EXT) && !full.is_file() && !(need == Need::Entry && full.is_dir()) {
        rel.push_str(EXT);
    }
    let full = crate::safe_path(root, &rel, true).map_err(native_err)?;
    let ok = match need {
        Need::Nothing => true,
        Need::File => full.is_file(),
        Need::Entry => full.exists(),
    };
    if ok {
        Ok(rel)
    } else {
        Err(not_found(path))
    }
}

/// `{path}` or `{file}` of `params` to a vault-relative path. `by_name` resolves a link-style
/// name to a path. `Ok(None)` when the params have neither key.
pub(crate) fn resolve_optional(
    root: &Path,
    params: &Value,
    need: Need,
    by_name: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<String>, RpcError> {
    let text = |key: &str| match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.as_str())),
        Some(_) => Err(RpcError::invalid_params(format!("{key} must be a non-empty string"))),
    };
    if let Some(path) = text("path")? {
        return resolve_path(root, path, need).map(Some);
    }
    match text("file")? {
        Some(name) => by_name(name).map(Some).ok_or_else(|| not_found(name)),
        None => Ok(None),
    }
}

/// Like [`resolve_optional`] but one of `path` / `file` is required.
pub(crate) fn resolve(root: &Path, params: &Value, need: Need, by_name: &dyn Fn(&str) -> Option<String>) -> Result<String, RpcError> {
    resolve_optional(root, params, need, by_name)?.ok_or_else(|| RpcError::invalid_params("path or file is required"))
}

/// `file.move`'s `from`: an existing exact path first, else a link-style name.
pub(crate) fn resolve_from(root: &Path, from: &str, by_name: &dyn Fn(&str) -> Option<String>) -> Result<String, RpcError> {
    match resolve_path(root, from, Need::Entry) {
        Ok(p) => Ok(p),
        Err(e) if e.app_code() == Some(codes::NOT_FOUND) => by_name(from).ok_or(e),
        Err(e) => Err(e),
    }
}

/// `file.move`'s `to`: a vault-relative path; a trailing `/` (a folder) is kept.
pub(crate) fn validate_destination(to: &str) -> Result<String, RpcError> {
    crate::validate_relative(to.trim_end_matches('/')).map_err(native_err)?;
    Ok(to.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vault() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("a.excalidraw"), "{}").unwrap();
        std::fs::write(d.path().join("sub/b.excalidraw"), "{}").unwrap();
        d
    }
    fn names(name: &str) -> Option<String> {
        (name == "BFS").then(|| "sub/b.excalidraw".to_string())
    }
    fn code(e: RpcError) -> String {
        e.app_code().unwrap_or("-").to_string()
    }

    #[test]
    fn exact_path_with_and_without_extension() {
        let d = vault();
        let r = |p: Value, need| resolve(d.path(), &p, need, &names);
        assert_eq!(r(json!({"path": "a.excalidraw"}), Need::File).unwrap(), "a.excalidraw");
        assert_eq!(r(json!({"path": "a"}), Need::File).unwrap(), "a.excalidraw");
        assert_eq!(r(json!({"path": "sub/b"}), Need::File).unwrap(), "sub/b.excalidraw");
        assert_eq!(r(json!({"path": "new"}), Need::Nothing).unwrap(), "new.excalidraw");
        assert_eq!(code(r(json!({"path": "nope"}), Need::File).unwrap_err()), "NOT_FOUND");
        // An existing bare file without the extension is kept as is.
        std::fs::write(d.path().join("plain"), "x").unwrap();
        assert_eq!(r(json!({"path": "plain"}), Need::File).unwrap(), "plain");
    }

    #[test]
    fn name_resolves_like_a_link_and_misses_carry_the_target() {
        let d = vault();
        assert_eq!(resolve(d.path(), &json!({"file": "BFS"}), Need::File, &names).unwrap(), "sub/b.excalidraw");
        let e = resolve(d.path(), &json!({"file": "Nothing"}), Need::File, &names).unwrap_err();
        assert_eq!(code(e.clone()), "NOT_FOUND");
        assert_eq!(e.data.unwrap().extra["target"], "Nothing");
        // path wins over file.
        assert_eq!(resolve(d.path(), &json!({"path": "a", "file": "BFS"}), Need::File, &names).unwrap(), "a.excalidraw");
    }

    #[test]
    fn neither_key_and_bad_types_are_invalid_params() {
        let d = vault();
        for p in [json!({}), json!({"path": 3}), json!({"file": ""})] {
            let e = resolve(d.path(), &p, Need::File, &names).unwrap_err();
            assert_eq!(e.code, vaultdraw_protocol::INVALID_PARAMS, "{p}");
        }
        assert!(resolve_optional(d.path(), &json!({}), Need::File, &names).unwrap().is_none());
    }

    #[test]
    fn escapes_are_invalid_path() {
        let d = vault();
        for p in ["../x", "/etc/passwd", "sub/../../x", "a\\b", ".excalidraw-vault/x"] {
            let e = resolve(d.path(), &json!({"path": p}), Need::Nothing, &names).unwrap_err();
            assert_eq!(code(e), "INVALID_PATH", "{p}");
        }
        assert_eq!(code(validate_destination("../x").unwrap_err()), "INVALID_PATH");
        assert_eq!(validate_destination("sub/").unwrap(), "sub/");
    }

    #[test]
    fn move_source_may_be_a_folder_or_a_name() {
        let d = vault();
        assert_eq!(resolve_from(d.path(), "sub", &names).unwrap(), "sub");
        assert_eq!(resolve_from(d.path(), "a", &names).unwrap(), "a.excalidraw");
        assert_eq!(resolve_from(d.path(), "BFS", &names).unwrap(), "sub/b.excalidraw");
        assert_eq!(code(resolve_from(d.path(), "zzz", &names).unwrap_err()), "NOT_FOUND");
    }
}
