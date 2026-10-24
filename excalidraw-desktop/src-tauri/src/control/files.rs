//! Files the system hands the app: a double-click or Open With in Finder (macOS Apple Event
//! with `file:` URLs), a path in the first launch's argv, or a path in a forwarded launch.
//! They end in the same handler as `vaultdraw://` links (`uri::Handler::handle_file`), so the
//! `[control]` switch, the rate limit and the queue apply the same way.
//!
//! What this module owns:
//! - which paths count (`.excalidraw`, `.excalidrawlib`; absolute; no control characters),
//! - the grant list: only a path that arrived from the system can be read by
//!   `external_file_read`, once. A script in the page cannot read other files through it,
//! - the bounded, validated read itself (no symlinks, size limits, JSON checked).
//!
//! Nothing here writes. Copying into a vault is done by the window through `file.create`
//! (never overwrites); opening a library merges in the editor. No network.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;
use vaultdraw_core::uri::is_bidi;

use crate::{err, ioerr, read_bounded, Result};

/// Longest path accepted (bytes). Real paths are far shorter; this bounds the dialog text.
pub(crate) const MAX_PATH_BYTES: usize = 4096;
/// Paths granted at once; the oldest is dropped beyond this.
pub(crate) const GRANT_CAP: usize = 32;

/// What a file is, by its extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Drawing,
    Library,
}

impl Kind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Drawing => "drawing",
            Self::Library => "library",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        match s {
            "drawing" => Some(Self::Drawing),
            "library" => Some(Self::Library),
            _ => None,
        }
    }
}

/// `.excalidraw` or `.excalidrawlib` (case-insensitive), nothing else.
pub(crate) fn kind_of(path: &str) -> Option<Kind> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "excalidraw" => Some(Kind::Drawing),
        "excalidrawlib" => Some(Kind::Library),
        _ => None,
    }
}

/// True when `arg` looks like a file this app opens (used on argv, before any checks).
pub(crate) fn is_file_arg(arg: &str) -> bool {
    !arg.starts_with('-') && kind_of(arg).is_some()
}

/// `path` made absolute against `cwd` (text only, no file system access).
pub(crate) fn absolute(path: &str, cwd: Option<&str>) -> Option<String> {
    let p = Path::new(path);
    if p.is_absolute() {
        return Some(path.to_string());
    }
    let cwd = cwd.filter(|c| Path::new(c).is_absolute())?;
    Some(Path::new(cwd).join(p).to_string_lossy().into_owned())
}

/// The plan the window gets for a file, or the refusal text. Pure.
pub(crate) fn plan_for(path: &str, origin: &str) -> std::result::Result<Value, String> {
    let kind = kind_of(path).ok_or("Only .excalidraw and .excalidrawlib files can be opened this way")?;
    if !Path::new(path).is_absolute() {
        return Err("The file path must be absolute".into());
    }
    if path.len() > MAX_PATH_BYTES {
        return Err("The file path is too long".into());
    }
    if path.chars().any(|c| c.is_control() || is_bidi(c)) {
        return Err("The file path has control or invisible characters".into());
    }
    Ok(json!({"action": "file", "path": path, "kind": kind.name(), "origin": origin}))
}

/// Paths the system handed us and the window has not read yet.
#[derive(Default)]
pub(crate) struct Grants {
    paths: Mutex<Vec<String>>,
}

impl Grants {
    pub(crate) fn grant(&self, path: &str) {
        let mut v = self.paths.lock().unwrap();
        v.retain(|p| p != path);
        if v.len() >= GRANT_CAP {
            v.remove(0);
        }
        v.push(path.to_string());
    }
    /// True once per grant.
    pub(crate) fn take(&self, path: &str) -> bool {
        let mut v = self.paths.lock().unwrap();
        match v.iter().position(|p| p == path) {
            Some(i) => {
                v.remove(i);
                true
            }
            None => false,
        }
    }
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.paths.lock().unwrap().len()
    }
}

pub(crate) fn grants() -> &'static Grants {
    static G: std::sync::OnceLock<Grants> = std::sync::OnceLock::new();
    G.get_or_init(Grants::default)
}

#[derive(Debug, Serialize, PartialEq)]
pub(crate) struct ExternalFile {
    pub name: String,
    pub json: String,
}

/// Reads and checks one external file: a regular file (a symlink is refused), within the size
/// limit, UTF-8, and a real drawing or library. Does not look at grants (the command does).
pub(crate) fn read_checked(path: &str, kind: Kind) -> Result<ExternalFile> {
    if kind_of(path) != Some(kind) {
        return Err(err("INVALID_FILE", "The file extension does not match"));
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(err("INVALID_PATH", "The file path must be absolute"));
    }
    let meta = std::fs::symlink_metadata(p).map_err(ioerr)?;
    if meta.file_type().is_symlink() {
        return Err(err("INVALID_PATH", "A symbolic link cannot be opened this way; open the file it points to"));
    }
    if !meta.is_file() {
        return Err(err("INVALID_PATH", "Not a regular file"));
    }
    let limit = match kind {
        Kind::Drawing => vaultdraw_core::paths::MAX_DRAWING_BYTES,
        Kind::Library => 64 * 1024 * 1024,
    };
    if meta.len() > limit {
        return Err(err("INVALID_FILE", "The file is too large to open"));
    }
    let bytes = read_bounded(p, limit)?;
    let json = String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", "The file is not valid UTF-8"))?;
    match kind {
        Kind::Drawing => vaultdraw_core::fsops::ensure_json(&json)?,
        Kind::Library => crate::library::validate_library(&json)?,
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(ExternalFile { name, json })
}

/// The window reads a file the system just handed us. Single use per grant.
#[tauri::command]
pub(crate) async fn external_file_read(path: String, kind: String) -> Result<ExternalFile> {
    let kind = Kind::parse(&kind).ok_or_else(|| err("INVALID_ARGUMENT", "kind must be drawing or library"))?;
    if !grants().take(&path) {
        return Err(err("NOT_PERMITTED", "That file was not opened from outside the app"));
    }
    tauri::async_runtime::spawn_blocking(move || read_checked(&path, kind))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

#[cfg(test)]
mod tests;
