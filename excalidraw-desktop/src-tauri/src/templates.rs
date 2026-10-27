//! Global templates: plain `.excalidraw` files in `<config>/templates`, shared by every vault.
//!
//! The folder is flat. Names are single path components validated by the same helpers as vault
//! paths, symlinks are never followed, and writes are create-only (a template is never silently
//! overwritten).
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{
    config, ensure_json, ensure_no_sibling_collision, err, ioerr, now_ms, read_drawing_parts, revision, safe_path,
    validate_relative, write_atomic_new, DrawingFile, Result,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const TEMPLATES_DIR: &str = "templates";
const EXTENSION: &str = vaultdraw_core::DRAWING_EXT;

/// Serializes template writes within the process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TemplateEntry {
    name: String,
    modified_at: u64,
    size: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct TemplateWritten {
    revision: String,
}

fn templates_dir() -> Result<PathBuf> {
    Ok(config::resolve_dirs()?.config.join(TEMPLATES_DIR))
}

/// A template name is one valid path component ending in `.excalidraw`.
fn validate_name(name: &str) -> Result<()> {
    let single = validate_relative(name)?.len() == 1;
    if !single || !vaultdraw_core::has_drawing_ext(name) {
        return Err(err("INVALID_PATH", "Template names must be a single file name ending in .excalidraw"));
    }
    Ok(())
}

fn list_in(root: &Path) -> Result<Vec<TemplateEntry>> {
    let items = match fs::read_dir(root) {
        Ok(items) => items,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(ioerr(e)),
    };
    let mut out = Vec::new();
    for item in items {
        let item = item.map_err(ioerr)?;
        let Ok(name) = item.file_name().into_string() else { continue };
        if validate_name(&name).is_err() {
            continue;
        }
        // `DirEntry::metadata` does not follow symlinks.
        let md = item.metadata().map_err(ioerr)?;
        if !md.file_type().is_file() {
            continue;
        }
        out.push(TemplateEntry { name, modified_at: md.modified().map(now_ms).unwrap_or_default(), size: md.len() });
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

fn write_in(root: &Path, name: &str, json: &str) -> Result<TemplateWritten> {
    validate_name(name)?;
    // Drawing text from the webview has non-ASCII as \uXXXX (json_ascii): keep files raw UTF-8.
    let bytes = vaultdraw_core::json_ascii::unescape_non_ascii(json.as_bytes());
    let json = std::str::from_utf8(&bytes).map_err(|_| err("INVALID_FILE", "Template is not UTF-8 JSON"))?;
    ensure_json(json)?;
    let _guard = WRITE_LOCK.lock().map_err(|_| err("INTERNAL", "Template write state unavailable"))?;
    if let Ok(md) = fs::symlink_metadata(root) {
        if md.file_type().is_symlink() {
            return Err(err("INVALID_PATH", "The templates folder must not be a symbolic link"));
        }
    }
    fs::create_dir_all(root).map_err(ioerr)?;
    let path = safe_path(root, name, true)?;
    ensure_no_sibling_collision(&path)?;
    write_atomic_new(&path, json.as_bytes())?;
    Ok(TemplateWritten { revision: revision(json.as_bytes()) })
}

#[tauri::command]
pub(crate) async fn list_global_templates() -> Result<Vec<TemplateEntry>> {
    list_in(&templates_dir()?)
}

#[tauri::command]
pub(crate) async fn read_global_template(name: String) -> Result<DrawingFile> {
    validate_name(&name)?;
    read_drawing_parts(&templates_dir()?, &name)
}

#[tauri::command]
pub(crate) async fn write_global_template(name: String, json: String) -> Result<TemplateWritten> {
    write_in(&templates_dir()?, &name, &json)
}

#[tauri::command]
pub(crate) async fn open_global_templates_dir() -> Result<()> {
    config::open_dir(&templates_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const DOC: &str = r#"{"type":"excalidraw","version":2,"elements":[]}"#;

    fn code<T: std::fmt::Debug>(r: Result<T>) -> String {
        r.unwrap_err().code
    }

    #[test]
    fn list_missing_or_empty_dir_is_empty() {
        let t = tempdir().unwrap();
        assert!(list_in(&t.path().join("templates")).unwrap().is_empty());
        assert!(list_in(t.path()).unwrap().is_empty());
    }

    #[test]
    fn write_creates_dir_and_read_roundtrips() {
        let t = tempdir().unwrap();
        let root = t.path().join("templates");
        let w = write_in(&root, "Kanban.excalidraw", DOC).unwrap();
        let read = read_drawing_parts(&root, "Kanban.excalidraw").unwrap();
        assert_eq!(read.json, DOC);
        assert_eq!(read.revision, w.revision);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1, "no temp files left");
    }

    #[test]
    fn list_filters_and_sorts() {
        let t = tempdir().unwrap();
        let root = t.path();
        for n in ["b.excalidraw", "A.EXCALIDRAW", "notes.txt", "c.excalidrawlib", "bad:name.excalidraw"] {
            fs::write(root.join(n), DOC).unwrap();
        }
        fs::create_dir(root.join("dir.excalidraw")).unwrap();
        let list = list_in(root).unwrap();
        let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["A.EXCALIDRAW", "b.excalidraw"]);
        assert_eq!(list[0].size, DOC.len() as u64);
        let v = serde_json::to_value(&list[0]).unwrap();
        assert!(v.get("modifiedAt").is_some());
    }

    #[test]
    fn create_only_rejects_existing_and_case_variants() {
        let t = tempdir().unwrap();
        let root = t.path().join("templates");
        write_in(&root, "a.excalidraw", DOC).unwrap();
        assert_eq!(code(write_in(&root, "a.excalidraw", DOC)), "NAME_COLLISION");
        assert_eq!(code(write_in(&root, "A.excalidraw", DOC)), "NAME_COLLISION");
        assert_eq!(fs::read_to_string(root.join("a.excalidraw")).unwrap(), DOC);
    }

    #[test]
    fn invalid_names_and_json_rejected() {
        let t = tempdir().unwrap();
        let root = t.path().join("templates");
        for n in ["", "../x.excalidraw", "sub/x.excalidraw", "/abs.excalidraw", "..", "x.txt", "x.excalidraw/", "a\\b.excalidraw", "con.excalidraw"] {
            assert!(validate_name(n).is_err(), "{n:?} should be invalid");
            assert_eq!(code(write_in(&root, n, DOC)), "INVALID_PATH", "{n:?}");
        }
        assert_eq!(code(write_in(&root, "ok.excalidraw", "{}")), "INVALID_FILE");
        assert!(!root.join("ok.excalidraw").exists());
        assert!(!t.path().join("x.excalidraw").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_skipped_and_not_read_or_written() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap();
        let root = t.path().join("templates");
        fs::create_dir(&root).unwrap();
        let outside = t.path().join("outside.excalidraw");
        fs::write(&outside, DOC).unwrap();
        symlink(&outside, root.join("link.excalidraw")).unwrap();
        fs::write(root.join("real.excalidraw"), DOC).unwrap();
        let names: Vec<_> = list_in(&root).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["real.excalidraw"]);
        assert_eq!(code(read_drawing_parts(&root, "link.excalidraw")), "INVALID_PATH");
        assert!(write_in(&root, "link.excalidraw", DOC).is_err());
    }
}
