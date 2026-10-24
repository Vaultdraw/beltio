//! `ctx.storage.global`: `<state dir>/plugin-data/<id>/data.json`, one JSON object per plugin.
//!
//! Machine-local (not the config dotfiles, never inside a vault). The host keeps the object in
//! memory and writes it whole, debounced; this module only reads, writes atomically and deletes.
//! Nothing is created until the first write.
use super::manifest::is_valid_id;
use crate::{err, ioerr, read_bounded, write_atomic, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::Path, path::PathBuf};

const DIR: &str = "plugin-data";
const FILE: &str = "data.json";
const BAD: &str = "data.json.bad";
/// Hard ceiling: the largest `plugins.storage_limit_kb` allows (16384 KiB). The host enforces
/// the configured limit; this one holds for any caller of the gateway.
pub(crate) const MAX_BYTES: u64 = 16 * 1024 * 1024;

fn plugin_dir(state_dir: &Path, id: &str) -> Result<PathBuf> {
    if !is_valid_id(id) {
        return Err(err("INVALID_ARGUMENT", "Invalid plugin id"));
    }
    let root = state_dir.join(DIR);
    let dir = root.join(id);
    // Symlinks are refused, so a link planted in the state folder cannot redirect writes.
    for p in [&root, &dir, &dir.join(FILE)] {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(err("INVALID_PATH", "Plugin data folder is a symbolic link"));
        }
    }
    Ok(dir)
}

/// `{"data": {...} | null, "corrupt": bool}`. A file that is not a JSON object (or is too big)
/// is renamed `data.json.bad` and reads as empty with `corrupt: true`.
pub(crate) fn read(state_dir: &Path, id: &str) -> Result<Value> {
    let dir = plugin_dir(state_dir, id)?;
    let path = dir.join(FILE);
    let bytes = match read_bounded(&path, MAX_BYTES) {
        Ok(b) => Some(b),
        Err(e) if e.code == "NOT_FOUND" => return Ok(json!({"data": null, "corrupt": false})),
        Err(e) if e.code == "INVALID_FILE" => None,
        Err(e) => return Err(e),
    };
    match bytes.and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(Value::is_object) {
        Some(data) => Ok(json!({"data": data, "corrupt": false})),
        None => {
            fs::rename(&path, dir.join(BAD)).map_err(ioerr)?;
            Ok(json!({"data": null, "corrupt": true}))
        }
    }
}

/// Replaces the plugin's data with `text`, which must be a JSON object of at most [`MAX_BYTES`].
pub(crate) fn write(state_dir: &Path, id: &str, text: &str) -> Result<()> {
    let dir = plugin_dir(state_dir, id)?;
    if text.len() as u64 > MAX_BYTES {
        return Err(err("QUOTA", "Plugin data is over the storage limit"));
    }
    let parsed: Value = serde_json::from_str(text).map_err(|e| err("INVALID_ARGUMENT", format!("Plugin data is not JSON: {e}")))?;
    if !parsed.is_object() {
        return Err(err("INVALID_ARGUMENT", "Plugin data must be a JSON object"));
    }
    fs::create_dir_all(&dir).map_err(ioerr)?;
    write_atomic(&dir.join(FILE), text.as_bytes())
}

/// Deletes the plugin's data folder. Returns whether there was one.
pub(crate) fn delete(state_dir: &Path, id: &str) -> Result<bool> {
    let dir = plugin_dir(state_dir, id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(ioerr(e)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DataSize {
    pub id: String,
    pub bytes: u64,
}

/// Plugins with saved data and the size of their `data.json` (for Settings → Plugins).
pub(crate) fn sizes(state_dir: &Path) -> Vec<DataSize> {
    let Ok(entries) = fs::read_dir(state_dir.join(DIR)) else { return Vec::new() };
    let mut out: Vec<DataSize> = entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().into_string().ok()?;
            let dir = plugin_dir(state_dir, &id).ok()?;
            let meta = fs::symlink_metadata(dir.join(FILE)).ok()?;
            meta.is_file().then(|| DataSize { id, bytes: meta.len() })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}
