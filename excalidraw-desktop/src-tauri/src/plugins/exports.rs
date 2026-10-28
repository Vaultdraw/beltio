//! `export.write`, `export.move` and `export.remove`: how a plugin keeps rendered exports
//! (`.svg`, `.png`) in the vault. Plugins still cannot write any other file type: these rows
//! take only paths without a dot segment that end in `.svg` or `.png` (folders for move and
//! remove hold nothing but such files), refuse symlinks and escapes through the core's
//! `safe_path`, and need `vault.write`.
//!
//! The request body is `u32 big-endian JSON length | JSON | bytes`; the JSON holds `path` (write),
//! `from` and `to` (move) or `path` (remove). `write` carries the bytes after the JSON.
use super::vault_paths::{has_dot_segment, MAX_PLUGIN_PATH};
use crate::{err, ioerr, mutation_guard, safe_path, validate_relative, write_atomic, writable, Result};
use std::{fs, path::Path};

/// Largest export one call writes.
pub(crate) const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

fn is_image(path: &str) -> bool {
    let l = path.to_ascii_lowercase();
    l.ends_with(".svg") || l.ends_with(".png")
}

/// A vault-relative path a plugin may touch: no dot segment, bounded, and the core's naming rules.
fn check(path: &str, file: bool) -> Result<()> {
    if path.is_empty() || path.len() > MAX_PLUGIN_PATH || has_dot_segment(path) {
        return Err(err("INVALID_PATH", "Export paths are non-empty, at most 1024 bytes and have no segment that starts with a dot"));
    }
    if file && !is_image(path) {
        return Err(err("INVALID_PATH", "Exports end in .svg or .png"));
    }
    validate_relative(path)?;
    Ok(())
}

/// Every file under `dir` is an export image; no symlinks. Folders and images only.
fn only_images(dir: &Path) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let ty = entry.file_type().map_err(ioerr)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if ty.is_symlink() {
            return Err(err("INVALID_PATH", "Symbolic links are not allowed in a vault"));
        }
        if ty.is_dir() {
            only_images(&entry.path())?;
        } else if !is_image(&name) {
            return Err(err("INVALID_PATH", "The folder holds files that are not exports"));
        }
    }
    Ok(())
}

fn remove_tree(dir: &Path) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        if entry.file_type().map_err(ioerr)?.is_dir() {
            remove_tree(&entry.path())?;
        } else {
            fs::remove_file(entry.path()).map_err(ioerr)?;
        }
    }
    fs::remove_dir(dir).map_err(ioerr)
}

pub(crate) fn write(v: &vaultdraw_core::Vault, path: &str, bytes: &[u8]) -> Result<()> {
    check(path, true)?;
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(err("TOO_LARGE", "An export is at most 64 MiB"));
    }
    writable(v)?;
    let _guard = mutation_guard(v)?;
    let dest = safe_path(&v.root, path, true)?;
    if dest.is_dir() {
        return Err(err("INVALID_PATH", "A folder has that name"));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    write_atomic(&dest, bytes)
}

/// Moves one export file, or a folder of exports. False when `from` does not exist.
pub(crate) fn move_(v: &vaultdraw_core::Vault, from: &str, to: &str) -> Result<bool> {
    let file = is_image(from);
    check(from, file)?;
    check(to, file)?;
    writable(v)?;
    let _guard = mutation_guard(v)?;
    let src = safe_path(&v.root, from, true)?;
    let Ok(meta) = fs::symlink_metadata(&src) else { return Ok(false) };
    let dest = safe_path(&v.root, to, true)?;
    if src == dest {
        return Ok(false);
    }
    if dest.starts_with(&src) {
        return Err(err("INVALID_PATH", "A folder cannot move into itself"));
    }
    if file == meta.is_dir() {
        return Err(err("INVALID_PATH", "A file and a folder do not exchange places"));
    }
    if meta.is_dir() {
        only_images(&src)?;
        if dest.exists() {
            return Err(err("CONFLICT", "The destination folder exists"));
        }
    } else if dest.is_dir() {
        return Err(err("INVALID_PATH", "A folder has that name"));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    fs::rename(&src, &dest).map_err(ioerr)?;
    Ok(true)
}

/// Removes one export file, or a folder that holds only exports. False when it does not exist.
pub(crate) fn remove(v: &vaultdraw_core::Vault, path: &str) -> Result<bool> {
    let file = is_image(path);
    check(path, file)?;
    writable(v)?;
    let _guard = mutation_guard(v)?;
    let target = safe_path(&v.root, path, true)?;
    let Ok(meta) = fs::symlink_metadata(&target) else { return Ok(false) };
    if meta.is_dir() {
        only_images(&target)?;
        remove_tree(&target)?;
    } else if file {
        fs::remove_file(&target).map_err(ioerr)?;
    } else {
        return Err(err("INVALID_PATH", "Not an export"));
    }
    Ok(true)
}

/// Splits a request body into its JSON header and the bytes after it.
fn split(body: &[u8]) -> Result<(serde_json::Value, &[u8])> {
    let bad = || err("INVALID_ARGUMENT", "Malformed export request");
    let len = u32::from_be_bytes(body.get(..4).ok_or_else(bad)?.try_into().map_err(|_| bad())?) as usize;
    let json = body.get(4..4 + len).ok_or_else(bad)?;
    Ok((serde_json::from_slice(json).map_err(|_| bad())?, &body[4 + len..]))
}

fn field<'a>(head: &'a serde_json::Value, key: &str) -> Result<&'a str> {
    head.get(key).and_then(|v| v.as_str()).ok_or_else(|| err("INVALID_ARGUMENT", format!("{key} must be a string")))
}

/// Runs one `export.*` row; the reply is one byte for `move` and `remove` (1 = done, 0 = nothing there).
pub(crate) fn call(v: &vaultdraw_core::Vault, method: &str, body: &[u8]) -> Result<Vec<u8>> {
    let (head, bytes) = split(body)?;
    match method {
        "export.write" => {
            write(v, field(&head, "path")?, bytes)?;
            Ok(Vec::new())
        }
        "export.move" => Ok(vec![u8::from(move_(v, field(&head, "from")?, field(&head, "to")?)?)]),
        "export.remove" => Ok(vec![u8::from(remove(v, field(&head, "path")?)?)]),
        _ => Err(err("NOT_FOUND", format!("Plugins cannot call \"{method}\""))),
    }
}
