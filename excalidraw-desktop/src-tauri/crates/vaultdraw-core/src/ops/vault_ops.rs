//! Rust-side vault and file methods of the control API, on an open [`Vault`]: no Tauri, no
//! window, so they are unit-tested directly. `file.write` is the UI's own save path.

use super::target::native_err;
use crate::Vault;
use serde_json::{json, Value};
use vaultdraw_protocol::RpcError;

/// `vault.info` / `vault.open` result.
pub fn info(v: &Vault) -> Value {
    let name = v.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    json!({"name": name, "path": v.root.to_string_lossy(), "readOnly": v.read_only})
}

/// `vault.list`: drawings and folders of `dir`, folders first; `recursive` descends into folders.
pub fn list(v: &Vault, dir: &str, recursive: bool) -> Result<Value, RpcError> {
    let mut entries = Vec::new();
    let mut pending = vec![dir.trim_end_matches('/').to_string()];
    while let Some(d) = pending.pop() {
        // The control API still lists drawings and folders only; the tree also lists Markdown notes.
        let mut level = crate::list_directory_in(v, &d).map_err(native_err)?;
        level.retain(|e| e.kind == "folder" || e.kind == "drawing");
        if recursive {
            pending.extend(level.iter().filter(|e| e.kind == "folder").map(|e| e.path.clone()));
        }
        entries.extend(level);
    }
    if recursive {
        entries.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    }
    Ok(json!({"entries": entries}))
}

/// `file.read`: `{path, revision, scene}` with the scene as parsed JSON.
pub fn read(v: &Vault, path: &str) -> Result<Value, RpcError> {
    let file = crate::read_drawing_parts(&v.root, path).map_err(native_err)?;
    let scene: Value = serde_json::from_str(&file.json).map_err(|e| RpcError::app("INVALID_FILE", e.to_string()))?;
    Ok(json!({"path": path, "revision": file.revision, "scene": scene}))
}

/// `file.write` core: the UI save path (`writable`, the vault mutation guard, a fresh operation
/// id, `write_drawing_file`). Returns the new revision and the byte length written. The caller
/// records history and publishes `file.saved` after success.
pub fn write(v: &Vault, path: &str, scene: &Value, expected_revision: Option<&str>) -> Result<(String, u64), RpcError> {
    crate::writable(v).map_err(native_err)?;
    let json = serde_json::to_string(scene).map_err(|e| RpcError::invalid_params(e.to_string()))?;
    let _guard = crate::mutation_guard(v).map_err(native_err)?;
    let done = crate::write_drawing_file(v, path, &json, expected_revision, &crate::random_id()).map_err(native_err)?;
    let revision = done["revision"].as_str().unwrap_or_default().to_string();
    Ok((revision, json.len() as u64))
}

/// Creates the missing folders above `path` (a vault-relative file path) for a write that makes a
/// new drawing, like the app's "new drawing" and the imports do (a plugin's `createDrawing`, `write
/// --create`). Never follows or replaces a symbolic link, and never touches an existing file.
pub fn ensure_parents(v: &Vault, path: &str) -> Result<(), RpcError> {
    crate::writable(v).map_err(native_err)?;
    let parts = crate::validate_relative(path).map_err(native_err)?;
    let mut dir = v.root.to_path_buf();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        dir.push(part);
        match std::fs::symlink_metadata(&dir) {
            Ok(m) if m.file_type().is_symlink() => return Err(RpcError::app("INVALID_PATH", "Symbolic links are not allowed in a vault")),
            Ok(m) if m.is_dir() => {}
            Ok(_) => return Err(RpcError::app("INVALID_PATH", format!("{part} is a file, not a folder"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&dir).map_err(|e| RpcError::app("IO_ERROR", e.to_string()))?;
            }
            Err(e) => return Err(RpcError::app("IO_ERROR", e.to_string())),
        }
    }
    Ok(())
}

/// `file.write`'s `expectedRevision`: required key, `null` = create only.
pub fn expected_revision(params: &Value) -> Result<Option<&str>, RpcError> {
    match params.get("expectedRevision") {
        None => Err(RpcError::invalid_params("expectedRevision is required (null creates a new drawing)")),
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(RpcError::invalid_params("expectedRevision must be a string or null")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vaultdraw_protocol::codes;

    fn vault(root: &std::path::Path, read_only: bool) -> Vault {
        Vault::new(dunce::canonicalize(root).unwrap(), "t".into(), read_only, None)
    }
    fn scene() -> Value {
        json!({"type": "excalidraw", "version": 2, "elements": [], "appState": {}, "files": {}})
    }
    fn code(e: &RpcError) -> &str {
        e.app_code().unwrap_or("-")
    }

    #[test]
    fn write_is_byte_identical_to_the_ui_save_path() {
        let d = tempfile::tempdir().unwrap();
        let v = vault(d.path(), false);
        let (rev, len) = write(&v, "a.excalidraw", &scene(), None).unwrap();
        let bytes = std::fs::read(d.path().join("a.excalidraw")).unwrap();
        assert_eq!(bytes, serde_json::to_string(&scene()).unwrap().into_bytes());
        assert_eq!(len as usize, bytes.len());
        assert_eq!(rev, crate::revision(&bytes));
        // The UI path (write_drawing_file) on the same scene yields the same revision.
        let ui = crate::write_drawing_file(&v, "b.excalidraw", &serde_json::to_string(&scene()).unwrap(), None, "op").unwrap();
        assert_eq!(ui["revision"], rev.as_str());
        assert_eq!(std::fs::read(d.path().join("b.excalidraw")).unwrap(), bytes);
    }

    #[test]
    fn write_refuses_stale_revision_create_over_existing_and_read_only() {
        let d = tempfile::tempdir().unwrap();
        let v = vault(d.path(), false);
        let (rev, _) = write(&v, "a.excalidraw", &scene(), None).unwrap();
        let mut s2 = scene();
        s2["elements"] = json!([]);
        s2["version"] = json!(3);
        assert_eq!(code(&write(&v, "a.excalidraw", &s2, Some("deadbeef")).unwrap_err()), codes::CONFLICT);
        assert_eq!(code(&write(&v, "a.excalidraw", &s2, None).unwrap_err()), codes::CONFLICT);
        let (rev2, _) = write(&v, "a.excalidraw", &s2, Some(&rev)).unwrap();
        assert_ne!(rev, rev2);
        let ro = vault(d.path(), true);
        assert_eq!(code(&write(&ro, "a.excalidraw", &s2, Some(&rev2)).unwrap_err()), codes::READ_ONLY);
        assert_eq!(code(&write(&v, "x.txt", &s2, None).unwrap_err()), codes::INVALID_PATH);
        assert_eq!(code(&write(&v, "x.excalidraw", &json!({"nope": 1}), None).unwrap_err()), "INVALID_FILE");
    }

    #[test]
    fn ensure_parents_makes_the_folders_above_a_new_drawing_and_nothing_else() {
        // Hunter C small item: a plugin creating a drawing in a folder that does not exist yet.
        let d = tempfile::tempdir().unwrap();
        let v = vault(d.path(), false);
        ensure_parents(&v, "Diagrams/2026/Flow.excalidraw").unwrap();
        assert!(d.path().join("Diagrams/2026").is_dir());
        assert!(!d.path().join("Diagrams/2026/Flow.excalidraw").exists());
        // Existing folders, a file at the top level, and a repeat are fine.
        ensure_parents(&v, "Diagrams/2026/Other.excalidraw").unwrap();
        ensure_parents(&v, "Top.excalidraw").unwrap();
        // The write itself then works in the new folder.
        assert!(write(&v, "Diagrams/2026/Flow.excalidraw", &scene(), None).is_ok());
        // A file where a folder is needed, an escape, and a read-only vault are refused; nothing is made.
        write(&v, "Top.excalidraw", &scene(), None).unwrap();
        assert_eq!(code(&ensure_parents(&v, "Top.excalidraw/x.excalidraw").unwrap_err()), codes::INVALID_PATH);
        assert!(ensure_parents(&v, "../out/x.excalidraw").is_err());
        assert!(!d.path().parent().unwrap().join("out").exists());
        let ro = vault(d.path(), true);
        assert!(ensure_parents(&ro, "New/x.excalidraw").is_err());
        assert!(!d.path().join("New").exists());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.path(), d.path().join("link")).unwrap();
            assert!(ensure_parents(&v, "link/sub/x.excalidraw").is_err());
        }
    }

    #[test]
    fn read_returns_path_revision_and_parsed_scene() {
        let d = tempfile::tempdir().unwrap();
        let v = vault(d.path(), false);
        let (rev, _) = write(&v, "a.excalidraw", &scene(), None).unwrap();
        let r = read(&v, "a.excalidraw").unwrap();
        assert_eq!(r, json!({"path": "a.excalidraw", "revision": rev, "scene": scene()}));
        assert_eq!(code(&read(&v, "missing.excalidraw").unwrap_err()), codes::NOT_FOUND);
    }

    #[test]
    fn list_filters_like_the_ui_and_recurses() {
        let d = tempfile::tempdir().unwrap();
        let v = vault(d.path(), false);
        std::fs::create_dir_all(d.path().join("sub/deep")).unwrap();
        std::fs::create_dir_all(d.path().join(".excalidraw-vault")).unwrap();
        for p in ["z.excalidraw", "sub/b.excalidraw", "sub/deep/c.excalidraw", "notes.txt", "sub/skip.md"] {
            std::fs::write(d.path().join(p), "{}").unwrap();
        }
        let top = list(&v, "", false).unwrap();
        let paths = |v: &Value| v["entries"].as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(paths(&top), ["sub", "z.excalidraw"]);
        assert_eq!(top["entries"][0]["kind"], "folder");
        assert!(top["entries"][1]["modifiedAt"].is_u64() && top["entries"][1]["size"].is_u64());
        assert_eq!(paths(&list(&v, "sub/", false).unwrap()), ["sub/deep", "sub/b.excalidraw"]);
        assert_eq!(paths(&list(&v, "", true).unwrap()), ["sub", "sub/b.excalidraw", "sub/deep", "sub/deep/c.excalidraw", "z.excalidraw"]);
        assert_eq!(code(&list(&v, "nope", false).unwrap_err()), codes::NOT_FOUND);
        assert_eq!(code(&list(&v, "../x", false).unwrap_err()), codes::INVALID_PATH);
        assert_eq!(info(&v)["readOnly"], false);
    }

    #[test]
    fn expected_revision_is_required() {
        assert!(expected_revision(&json!({})).is_err());
        assert_eq!(expected_revision(&json!({"expectedRevision": null})).unwrap(), None);
        assert_eq!(expected_revision(&json!({"expectedRevision": "r"})).unwrap(), Some("r"));
        assert!(expected_revision(&json!({"expectedRevision": 1})).is_err());
    }
}
