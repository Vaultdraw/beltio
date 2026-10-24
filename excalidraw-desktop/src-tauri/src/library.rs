//! Persisted Excalidraw library: `library.excalidrawlib` in the config folder (personal)
//! and at the vault root (per vault). Both are plain `.excalidrawlib` files, so they stay
//! portable to excalidraw.com.
//!
//! The frontend keeps the parsed items; this module only moves validated bytes. Reads
//! short-circuit on an unchanged revision (a library can reach tens of MiB) and writes are
//! compare-and-swap on the sha256 revision, so two writers never silently overwrite each
//! other.
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{
    config, err, ioerr, mutation_guard, read_bounded, revision, vault_for, write_atomic, write_atomic_new,
    writable, Result, Service,
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde::de::IgnoredAny;
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, State};

/// File name of a library, in the config folder and at the vault root.
pub(crate) const LIBRARY_FILE: &str = "library.excalidrawlib";
/// Advisory lock file next to the personal library; serializes writers across processes.
pub(crate) const LOCK_FILE: &str = ".library.excalidrawlib.lock";
/// 2x the drawing cap; a 2,000-item library is about 20 MiB.
const MAX_LIBRARY_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryRead {
    json: Option<String>,
    revision: Option<String>,
    unchanged: bool,
    path: String,
    read_only: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct LibraryWritten {
    revision: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct PickedLibrary {
    name: String,
    json: String,
}

/// Payload of the `library-change` event.
#[derive(Debug, Serialize, Clone)]
struct LibraryChange {
    scope: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle: Option<String>,
}

/// Emits `library-change` for the personal library (`handle` None) or a vault's library.
pub(crate) fn emit_change(app: &AppHandle, handle: Option<String>) {
    let scope = if handle.is_some() { "vault" } else { "personal" };
    let _ = app.emit("library-change", LibraryChange { scope, handle });
}

/// The two places a library lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    Personal,
    Vault,
}
impl Scope {
    fn parse(scope: &str) -> Result<Scope> {
        match scope {
            "personal" => Ok(Scope::Personal),
            "vault" => Ok(Scope::Vault),
            _ => Err(err("INVALID_PATH", "Library scope must be \"personal\" or \"vault\"")),
        }
    }
}

/// Checks that `path` is absent or a regular, non-symlink file. Returns its length.
fn inspect(path: &Path) -> Result<Option<u64>> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            Err(err("INVALID_PATH", "library.excalidrawlib is a symbolic link; only regular files are used"))
        }
        Ok(m) if !m.is_file() => Err(err("INVALID_PATH", "library.excalidrawlib is not a regular file")),
        Ok(m) => Ok(Some(m.len())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ioerr(e)),
    }
}

/// Bounded read of a library file's bytes with a clear message for oversized files.
pub(crate) fn read_library_bytes(path: &Path) -> Result<Vec<u8>> {
    let too_large = || err("INVALID_FILE", "The library file is larger than 64 MiB and cannot be loaded");
    if fs::metadata(path).map_err(ioerr)?.len() > MAX_LIBRARY_BYTES {
        return Err(too_large());
    }
    read_bounded(path, MAX_LIBRARY_BYTES).map_err(|e| if e.code == "INVALID_FILE" { too_large() } else { e })
}

/// Current bytes' revision, or `None` for a missing file. Refuses symlinks.
fn current_revision(path: &Path) -> Result<Option<String>> {
    match inspect(path)? {
        None => Ok(None),
        Some(_) => Ok(Some(revision(&read_library_bytes(path)?))),
    }
}

/// Reads the library at `path`. `known` short-circuits to `unchanged` without the text.
fn read_library_at(path: &Path, known: Option<&str>, read_only: bool) -> Result<LibraryRead> {
    let out = |json, revision, unchanged| LibraryRead {
        json,
        revision,
        unchanged,
        path: path.to_string_lossy().into_owned(),
        read_only,
    };
    if inspect(path)?.is_none() {
        return Ok(out(None, None, false));
    }
    let bytes = read_library_bytes(path)?;
    let rev = revision(&bytes);
    if known == Some(rev.as_str()) {
        return Ok(out(None, Some(rev), true));
    }
    let json = String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", "The library file is not valid UTF-8"))?;
    Ok(out(Some(json), Some(rev), false))
}

/// The parts of an `.excalidrawlib` that are validated; item contents are skipped, not built.
#[derive(Deserialize)]
struct LibraryShape {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "libraryItems")]
    items: Option<Vec<IgnoredAny>>,
    library: Option<Vec<IgnoredAny>>,
}

/// Accepts only an `excalidrawlib` object with `libraryItems` (or the legacy `library`) array.
pub(crate) fn validate_library(json: &str) -> Result<()> {
    if json.len() as u64 > MAX_LIBRARY_BYTES {
        return Err(err("INVALID_FILE", "Library exceeds 64 MiB"));
    }
    let shape: LibraryShape =
        serde_json::from_str(json).map_err(|e| err("INVALID_FILE", format!("Invalid library JSON: {e}")))?;
    if shape.kind != "excalidrawlib" || (shape.items.is_none() && shape.library.is_none()) {
        return Err(err("INVALID_FILE", "Not an Excalidraw library (expected type \"excalidrawlib\" with libraryItems)"));
    }
    Ok(())
}

/// Compare-and-swap write. Callers hold the scope's write guard. `expected` None creates
/// the file and conflicts if it exists; Some(r) replaces it only while its revision is r.
fn write_library_at(path: &Path, json: &str, expected: Option<&str>) -> Result<LibraryWritten> {
    validate_library(json)?;
    let conflict = || err("CONFLICT", "The library changed on disk since it was read");
    let current = current_revision(path)?;
    match (expected, current.as_deref()) {
        (None, None) => write_atomic_new(path, json.as_bytes()).map_err(|e| {
            if e.code == "NAME_COLLISION" { conflict() } else { e }
        })?,
        (Some(want), Some(have)) if want == have => write_atomic(path, json.as_bytes())?,
        _ => return Err(conflict()),
    }
    Ok(LibraryWritten { revision: revision(json.as_bytes()) })
}

/// Opens `path` as an exclusive advisory lock (created if missing), refusing symlinks.
/// The lock is released when the returned file is dropped.
fn lock_exclusive(path: &Path) -> Result<File> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() || !m.is_file() => {
            return Err(err("INVALID_PATH", "The library lock file is not a regular file"))
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(ioerr(e)),
    }
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path).map_err(ioerr)?;
    file.lock_exclusive().map_err(ioerr)?;
    Ok(file)
}

/// Where a scope's file is and whether it is read-only.
fn personal_target() -> Result<(PathBuf, bool)> {
    let dir = config::resolve_dirs()?.config;
    let read_only = fs::metadata(&dir).is_ok_and(|m| m.permissions().readonly());
    Ok((dir.join(LIBRARY_FILE), read_only))
}

fn vault_handle(handle: Option<String>) -> Result<String> {
    handle.ok_or_else(|| err("INVALID_PATH", "A vault handle is required for the vault library"))
}

#[tauri::command]
pub(crate) async fn read_library(
    scope: String,
    handle: Option<String>,
    known_revision: Option<String>,
    state: State<'_, Service>,
) -> Result<LibraryRead> {
    let (path, read_only) = match Scope::parse(&scope)? {
        Scope::Personal => personal_target()?,
        Scope::Vault => {
            let v = vault_for(&state, &vault_handle(handle)?)?;
            (v.root.join(LIBRARY_FILE), v.read_only)
        }
    };
    read_library_at(&path, known_revision.as_deref(), read_only)
}

#[tauri::command]
pub(crate) async fn write_library(
    scope: String,
    handle: Option<String>,
    json: String,
    expected_revision: Option<String>,
    state: State<'_, Service>,
) -> Result<LibraryWritten> {
    match Scope::parse(&scope)? {
        Scope::Personal => {
            let (path, _) = personal_target()?;
            let _guard = config::write_guard()?;
            let dir = path.parent().ok_or_else(|| err("INVALID_PATH", "Library has no folder"))?;
            fs::create_dir_all(dir).map_err(ioerr)?;
            let _lock = lock_exclusive(&dir.join(LOCK_FILE))?;
            write_library_at(&path, &json, expected_revision.as_deref())
        }
        Scope::Vault => {
            let v = vault_for(&state, &vault_handle(handle)?)?;
            writable(&v)?;
            let _mutation = mutation_guard(&v)?;
            write_library_at(&v.root.join(LIBRARY_FILE), &json, expected_revision.as_deref())
        }
    }
}

/// Native open dialog for importing a library; `None` when cancelled.
#[tauri::command]
pub(crate) async fn pick_library_file() -> Result<Option<PickedLibrary>> {
    let picked = rfd::FileDialog::new()
        .set_title("Import library")
        .add_filter("Excalidraw library", &["excalidrawlib", "json"])
        .pick_file();
    let Some(path) = picked else { return Ok(None) };
    if !fs::metadata(&path).map_err(ioerr)?.is_file() {
        return Err(err("INVALID_PATH", "The chosen library is not a regular file"));
    }
    let json = String::from_utf8(read_library_bytes(&path)?)
        .map_err(|_| err("INVALID_FILE", "The library file is not valid UTF-8"))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Some(PickedLibrary { name, json }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Vault;
    use tempfile::tempdir;

    const LIB: &str = r#"{"type":"excalidrawlib","version":2,"libraryItems":[{"id":"a"}]}"#;
    const LIB2: &str = r#"{"type":"excalidrawlib","version":2,"libraryItems":[]}"#;

    fn code(r: Result<impl std::fmt::Debug>) -> String {
        r.unwrap_err().code
    }

    #[test]
    fn create_read_update_roundtrip() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        let missing = read_library_at(&p, None, false).unwrap();
        assert!(missing.json.is_none() && missing.revision.is_none() && !missing.unchanged);

        let r1 = write_library_at(&p, LIB, None).unwrap().revision;
        let read = read_library_at(&p, None, false).unwrap();
        assert_eq!(read.json.as_deref(), Some(LIB));
        assert_eq!(read.revision.as_deref(), Some(r1.as_str()));

        let r2 = write_library_at(&p, LIB2, Some(&r1)).unwrap().revision;
        assert_ne!(r1, r2);
        assert_eq!(fs::read_to_string(&p).unwrap(), LIB2);
        // Only the library remains: no temp files.
        assert_eq!(fs::read_dir(t.path()).unwrap().count(), 1);
        let out = serde_json::to_value(read_library_at(&p, None, true).unwrap()).unwrap();
        assert_eq!(out["readOnly"], true);
        assert_eq!(out["unchanged"], false);
    }

    #[test]
    fn unchanged_revision_skips_the_text() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        let rev = write_library_at(&p, LIB, None).unwrap().revision;
        let same = read_library_at(&p, Some(&rev), false).unwrap();
        assert!(same.unchanged && same.json.is_none());
        assert_eq!(same.revision.as_deref(), Some(rev.as_str()));
        let stale = read_library_at(&p, Some("old"), false).unwrap();
        assert!(!stale.unchanged && stale.json.is_some());
    }

    #[test]
    fn compare_and_swap_conflicts() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        // Replacing a file that does not exist conflicts.
        assert_eq!(code(write_library_at(&p, LIB, Some("x"))), "CONFLICT");
        let rev = write_library_at(&p, LIB, None).unwrap().revision;
        // Create-only over an existing file conflicts.
        assert_eq!(code(write_library_at(&p, LIB2, None)), "CONFLICT");
        // Stale revision conflicts.
        assert_eq!(code(write_library_at(&p, LIB2, Some("stale"))), "CONFLICT");
        assert_eq!(fs::read_to_string(&p).unwrap(), LIB);
        write_library_at(&p, LIB2, Some(&rev)).unwrap();
    }

    #[test]
    fn invalid_content_is_rejected_and_file_untouched() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        let rev = write_library_at(&p, LIB, None).unwrap().revision;
        for bad in [
            "not json",
            "[]",
            r#"{"type":"excalidraw","libraryItems":[]}"#,
            r#"{"type":"excalidrawlib"}"#,
            r#"{"type":"excalidrawlib","libraryItems":{}}"#,
            r#"{"libraryItems":[]}"#,
        ] {
            assert_eq!(code(write_library_at(&p, bad, Some(&rev))), "INVALID_FILE", "{bad}");
        }
        assert_eq!(fs::read_to_string(&p).unwrap(), LIB);
        // The legacy v1 key is accepted.
        write_library_at(&p, r#"{"type":"excalidrawlib","version":1,"library":[]}"#, Some(&rev)).unwrap();
    }

    #[test]
    fn oversize_is_rejected_on_write_and_read() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        let pad = " ".repeat(MAX_LIBRARY_BYTES as usize);
        let big = format!("{LIB}{pad}");
        assert_eq!(code(write_library_at(&p, &big, None)), "INVALID_FILE");
        assert!(!p.exists());
        fs::write(&p, big).unwrap();
        let e = read_library_at(&p, None, false).unwrap_err();
        assert_eq!(e.code, "INVALID_FILE");
        assert!(e.message.contains("64 MiB"));
    }

    #[test]
    fn non_utf8_file_is_invalid() {
        let t = tempdir().unwrap();
        let p = t.path().join(LIBRARY_FILE);
        fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(code(read_library_at(&p, None, false)), "INVALID_FILE");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_directories_are_refused() {
        let t = tempdir().unwrap();
        let target = t.path().join("real.excalidrawlib");
        fs::write(&target, LIB).unwrap();
        let p = t.path().join(LIBRARY_FILE);
        std::os::unix::fs::symlink(&target, &p).unwrap();
        assert_eq!(code(read_library_at(&p, None, false)), "INVALID_PATH");
        assert_eq!(code(write_library_at(&p, LIB2, None)), "INVALID_PATH");
        assert_eq!(code(write_library_at(&p, LIB2, Some("x"))), "INVALID_PATH");
        assert_eq!(fs::read_to_string(&target).unwrap(), LIB);

        let d = tempdir().unwrap();
        let dir = d.path().join(LIBRARY_FILE);
        fs::create_dir(&dir).unwrap();
        assert_eq!(code(read_library_at(&dir, None, false)), "INVALID_PATH");
    }

    #[test]
    fn read_only_vault_is_refused() {
        let t = tempdir().unwrap();
        let v = Vault::for_tests(t.path().canonicalize().unwrap(), "h", true);
        assert_eq!(code(writable(&v)), "READ_ONLY");
    }

    #[cfg(unix)]
    #[test]
    fn lock_file_refuses_symlinks_and_locks_exclusively() {
        let t = tempdir().unwrap();
        let p = t.path().join(LOCK_FILE);
        let held = lock_exclusive(&p).unwrap();
        let other = OpenOptions::new().read(true).write(true).open(&p).unwrap();
        assert!(other.try_lock_exclusive().is_err());
        drop(held);
        assert!(other.try_lock_exclusive().is_ok());

        let link = t.path().join("link.lock");
        std::os::unix::fs::symlink(&p, &link).unwrap();
        assert_eq!(code(lock_exclusive(&link)), "INVALID_PATH");
    }

    #[test]
    fn scope_parsing() {
        assert_eq!(Scope::parse("personal").unwrap(), Scope::Personal);
        assert_eq!(Scope::parse("vault").unwrap(), Scope::Vault);
        assert!(Scope::parse("other").is_err());
        assert!(vault_handle(None).is_err());
    }
}
