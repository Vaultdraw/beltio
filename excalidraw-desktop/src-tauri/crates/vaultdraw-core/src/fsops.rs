//! Atomic file writes, bounded reads, revision of a file on disk, folder create and move.

use crate::error::{err, ioerr, Result};
use crate::paths::{random_id, revision_of_reader, safe_path, MAX_DRAWING_BYTES};
use serde::Deserialize;
use std::{
    borrow::Cow,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub fn ensure_no_sibling_collision(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "Entry has no parent"))?;
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Err(err("INVALID_PATH", "Invalid entry name"));
    };
    if !parent.is_dir() {
        return Err(err("NOT_FOUND", "Parent directory not found"));
    }
    for item in fs::read_dir(parent).map_err(ioerr)? {
        let item = item.map_err(ioerr)?;
        if item
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(name)
        {
            return Err(err(
                "NAME_COLLISION",
                "A case-insensitive name collision already exists",
            ));
        }
    }
    Ok(())
}
/// Only the field the validator needs; serde skips (but still syntax-checks) the rest,
/// so a large scene is validated without building a `serde_json::Value` tree.
#[derive(Deserialize)]
struct SceneProbe<'a> {
    #[serde(rename = "type")]
    kind: Option<Cow<'a, str>>,
}
pub fn ensure_json(json: &str) -> Result<()> {
    if json.len() as u64 > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "Drawing exceeds the 32 MiB limit"));
    }
    let probe: SceneProbe = serde_json::from_str(json)
        .map_err(|e| err("INVALID_FILE", format!("Invalid JSON: {e}")))?;
    // A derived struct also accepts a JSON array, so require an object explicitly.
    if !json.trim_start().starts_with('{') || probe.kind.as_deref() != Some("excalidraw") {
        return Err(err("INVALID_FILE", "Drawing JSON must be an Excalidraw scene object"));
    }
    Ok(())
}
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        // Same-directory rename is atomic on the primary macOS target. Windows replacement
        // may refuse existing destinations; fail closed rather than remove the source first.
        fs::rename(&temp, path)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(ioerr)
}
pub fn write_atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    write_atomic_new_with(path, |f| f.write_all(bytes))
}
/// No-clobber atomic create where `fill` streams the content into the temp file.
pub fn write_atomic_new_with(path: &Path, fill: impl FnOnce(&mut File) -> std::io::Result<()>) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        fill(&mut f)?;
        f.sync_all()?;
        // Hard-link creation is an atomic no-clobber commit on the same filesystem.
        fs::hard_link(&temp, path)?;
        fs::remove_file(&temp)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            err("NAME_COLLISION", "Destination already exists")
        } else {
            ioerr(e)
        }
    })
}
pub fn current_revision(path: &Path) -> Result<Option<String>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ioerr(e)),
    };
    let (rev, total) = revision_of_reader(file.take(MAX_DRAWING_BYTES + 1)).map_err(ioerr)?;
    if total > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(Some(rev))
}
pub fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    File::open(path).map_err(ioerr)?.take(limit.saturating_add(1)).read_to_end(&mut data).map_err(ioerr)?;
    if data.len() as u64 > limit { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(data)
}
/// fsyncs directories (best effort), making renames into them durable.
pub fn sync_dirs<'a>(dirs: impl IntoIterator<Item = &'a PathBuf>) {
    for d in dirs { if let Ok(f) = File::open(d) { let _ = f.sync_all(); } }
}
/// Refuses a path with a dot-named component (`.obsidian`, `.trash`, `.git`): those are never written,
/// listed or watched, so a file or folder created there would silently vanish from the tree.
pub fn reject_hidden(path: &str) -> Result<()> {
    if crate::filekind::has_hidden_component(path) {
        return Err(err("INVALID_PATH", "Names starting with a dot are reserved and never listed or written"));
    }
    Ok(())
}
pub fn create_folder_at(root: &Path, path: &str) -> Result<()> {
    if path.is_empty() { return Err(err("INVALID_PATH", "Cannot create the vault root")); }
    reject_hidden(path)?;
    let p = safe_path(root, path, true)?;
    ensure_no_sibling_collision(&p)?;
    fs::create_dir(p).map_err(ioerr)
}
pub fn move_entry_paths(root: &Path, from: &str, to: &str) -> Result<()> {
    if from.is_empty() || to.is_empty() || from == to || to.starts_with(&format!("{from}/")) { return Err(err("INVALID_PATH", "Cannot move an entry into itself")); }
    reject_hidden(to)?;
    let src = safe_path(root, from, false)?;
    let dst = safe_path(root, to, true)?;
    if !src.exists() { return Err(err("NOT_FOUND", "Source entry not found")); }
    ensure_no_sibling_collision(&dst)?;
    if let Some(parent) = dst.parent() { if !parent.is_dir() { return Err(err("NOT_FOUND", "Destination folder not found")); } }
    fs::rename(src, dst).map_err(ioerr)
}
