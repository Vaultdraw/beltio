//! Capability-scoped folder access for importers (the "Import Obsidian vault" plugin flow).
//!
//! A [`SourceFolder`] is read-only by construction: it has list and read methods and no write
//! method at all, so an import can never touch the folder it reads. A [`TargetFolder`] is a new
//! vault (an empty or missing folder, created) or a folder inside an open vault; it only creates
//! files (atomic, no-clobber: an existing name is `NAME_COLLISION`). Attachments are copied by
//! Rust from source to target, so their bytes never cross IPC. The [`Registry`] hands out opaque
//! session handles for both, so the plugin side only ever holds ids.

use crate::error::{err, ioerr, Result};
use crate::fsops::{ensure_json, ensure_no_sibling_collision, read_bounded, write_atomic_new, write_atomic_new_with};
use crate::paths::{now_ms, random_id, safe_path, validate_relative};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[cfg(test)]
mod tests;

/// Most entries `SourceFolder::list` returns; the reply says when the folder had more.
pub const MAX_ENTRIES: usize = 100_000;
/// Largest text file `read_text` returns (the Markdown parser's own limit).
pub const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
/// Largest file `read_bytes` returns (attachments read into the plugin, e.g. an image to lay out).
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// One file of a source folder, path relative to the folder with `/` separators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub modified_at: u64,
}

/// The files of a source folder, in path order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Listing {
    pub entries: Vec<Entry>,
    /// True when the walk stopped at [`MAX_ENTRIES`].
    pub truncated: bool,
}

/// True when any `/`-separated segment starts with a dot (`.obsidian`, `.trash`, `.git`, `..`).
pub fn has_dot_segment(path: &str) -> bool {
    path.split('/').any(|s| s.starts_with('.'))
}

/// A path a plugin hands to a source or target: relative, bounded, no dot segments, no `\`.
fn check_rel(path: &str) -> Result<()> {
    if path.is_empty() {
        return Err(err("INVALID_PATH", "A path is required"));
    }
    validate_relative(path)?;
    if has_dot_segment(path) {
        return Err(err("INVALID_PATH", "Paths with a segment that starts with a dot are not allowed"));
    }
    Ok(())
}

/// A folder an import reads. No method writes.
#[derive(Debug)]
pub struct SourceFolder {
    root: PathBuf,
    name: String,
}

impl SourceFolder {
    /// Opens `root`, which must be an existing directory (symlinks resolved once, here).
    pub fn open(root: &Path) -> Result<Self> {
        let meta = fs::metadata(root).map_err(ioerr)?;
        if !meta.is_dir() {
            return Err(err("INVALID_PATH", "The source is not a folder"));
        }
        let root = root.canonicalize().map_err(ioerr)?;
        let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(SourceFolder { root, name })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Every regular file under the folder, recursively, in path order. Entries whose name starts
    /// with a dot and symbolic links (files or folders) are skipped. Stops at [`MAX_ENTRIES`].
    pub fn list(&self) -> Result<Listing> {
        let mut entries = Vec::new();
        let mut truncated = false;
        let mut stack = vec![(self.root.clone(), String::new())];
        while let Some((dir, rel)) = stack.pop() {
            let mut children: Vec<(String, PathBuf)> = Vec::new();
            for item in fs::read_dir(&dir).map_err(ioerr)? {
                let item = item.map_err(ioerr)?;
                let name = item.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                children.push((name, item.path()));
            }
            // Deterministic order: a parent is pushed last so it pops first (depth-first, sorted).
            children.sort_by(|a, b| b.0.cmp(&a.0));
            let mut files = Vec::new();
            for (name, path) in children {
                let Ok(meta) = fs::symlink_metadata(&path) else { continue };
                let ft = meta.file_type();
                let child_rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                if ft.is_symlink() {
                    continue;
                } else if ft.is_dir() {
                    stack.push((path, child_rel));
                } else if ft.is_file() {
                    files.push(Entry {
                        path: child_rel,
                        size: meta.len(),
                        modified_at: meta.modified().map(now_ms).unwrap_or(0),
                    });
                }
            }
            files.reverse();
            for f in files {
                if entries.len() >= MAX_ENTRIES {
                    truncated = true;
                    break;
                }
                entries.push(f);
            }
            if truncated {
                break;
            }
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Listing { entries, truncated })
    }

    /// The absolute path of `path` inside the source: validated, no symlink in any component.
    fn resolve(&self, path: &str) -> Result<PathBuf> {
        check_rel(path)?;
        let p = safe_path(&self.root, path, false)?;
        let meta = fs::symlink_metadata(&p).map_err(ioerr)?;
        if !meta.file_type().is_file() {
            return Err(err("NOT_FOUND", "Not a regular file"));
        }
        Ok(p)
    }

    /// The file as text (lossy UTF-8), at most [`MAX_TEXT_BYTES`].
    pub fn read_text(&self, path: &str) -> Result<String> {
        let bytes = read_bounded(&self.resolve(path)?, MAX_TEXT_BYTES)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The file's bytes, at most [`MAX_READ_BYTES`].
    pub fn read_bytes(&self, path: &str) -> Result<Vec<u8>> {
        read_bounded(&self.resolve(path)?, MAX_READ_BYTES)
    }
}

/// What a target folder is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    NewVault,
    VaultFolder,
}

/// A folder an import writes into. Create-only: nothing here overwrites or deletes.
#[derive(Debug)]
pub struct TargetFolder {
    root: PathBuf,
    name: String,
    kind: TargetKind,
}

impl TargetFolder {
    /// A new vault at `path`: the folder must not exist yet or be empty; it is created.
    pub fn new_vault(path: &Path) -> Result<Self> {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(err("INVALID_PATH", "The new vault's path is a symbolic link"));
            }
            Ok(meta) if !meta.is_dir() => return Err(err("INVALID_PATH", "The new vault's path is a file")),
            Ok(_) => {
                if fs::read_dir(path).map_err(ioerr)?.next().is_some() {
                    return Err(err("NAME_COLLISION", "The folder for the new vault is not empty"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(path).map_err(ioerr)?;
            }
            Err(e) => return Err(ioerr(e)),
        }
        let root = path.canonicalize().map_err(ioerr)?;
        let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(TargetFolder { root, name, kind: TargetKind::NewVault })
    }

    /// The folder `rel` (vault-relative, `""` = the root) inside the open vault at `vault_root`,
    /// created if missing. No dot segments, no symlinks, never outside the vault.
    pub fn vault_folder(vault_root: &Path, rel: &str) -> Result<Self> {
        let root = if rel.is_empty() {
            vault_root.to_path_buf()
        } else {
            check_rel(rel)?;
            let p = safe_path(vault_root, rel, true)?;
            match fs::symlink_metadata(&p) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => return Err(err("INVALID_PATH", "The target path is a file")),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(&p).map_err(ioerr)?,
                Err(e) => return Err(ioerr(e)),
            }
            p
        };
        let name = if rel.is_empty() {
            vault_root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        } else {
            rel.rsplit('/').next().unwrap_or(rel).to_string()
        };
        Ok(TargetFolder { root, name, kind: TargetKind::VaultFolder })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn kind(&self) -> TargetKind {
        self.kind
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Validates `path` for a new file and creates its parent folders. Returns the absolute path.
    fn prepare(&self, path: &str) -> Result<PathBuf> {
        check_rel(path)?;
        let p = safe_path(&self.root, path, true)?;
        let parent = p.parent().ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
        fs::create_dir_all(parent).map_err(ioerr)?;
        ensure_no_sibling_collision(&p)?;
        Ok(p)
    }

    /// Creates the drawing `path` (must end in `.excalidraw`) with the scene `json`. Atomic
    /// (temp file, then a no-clobber commit); an existing name is `NAME_COLLISION`.
    pub fn write_drawing(&self, path: &str, json: &str) -> Result<()> {
        if !path.to_ascii_lowercase().ends_with(".excalidraw") {
            return Err(err("INVALID_PATH", "Drawing paths must end in .excalidraw"));
        }
        ensure_json(json)?;
        let p = self.prepare(path)?;
        write_atomic_new(&p, json.as_bytes())
    }

    /// Copies `from` in `source` to `to` here, streaming through a temp file; create-only.
    pub fn copy_from(&self, source: &SourceFolder, from: &str, to: &str) -> Result<()> {
        let src = source.resolve(from)?;
        let dst = self.prepare(to)?;
        write_atomic_new_with(&dst, |f| {
            let mut reader = fs::File::open(&src)?;
            std::io::copy(&mut reader, f).map(|_| ())
        })
    }

    /// Converts the Obsidian Excalidraw file `from` (`*.excalidraw.md`, plain or compressed) in
    /// `source` into the scene file `to` here, create-only. The decoder is `excalidraw_md`.
    pub fn convert_drawing(&self, source: &SourceFolder, from: &str, to: &str) -> Result<()> {
        let scene = crate::excalidraw_md::extract_scene(&source.read_text(from)?)?;
        self.write_drawing(to, &scene)
    }
}

/// Session handles for sources and targets. Handles are opaque strings; a source handle can
/// only reach `SourceFolder` (no write path exists for it).
#[derive(Default)]
pub struct Registry {
    sources: Mutex<HashMap<String, Arc<SourceFolder>>>,
    targets: Mutex<HashMap<String, Arc<TargetFolder>>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_source(&self, source: SourceFolder) -> String {
        let handle = format!("src-{}", random_id());
        self.sources.lock().unwrap_or_else(|e| e.into_inner()).insert(handle.clone(), Arc::new(source));
        handle
    }

    pub fn add_target(&self, target: TargetFolder) -> String {
        let handle = format!("dst-{}", random_id());
        self.targets.lock().unwrap_or_else(|e| e.into_inner()).insert(handle.clone(), Arc::new(target));
        handle
    }

    pub fn source(&self, handle: &str) -> Result<Arc<SourceFolder>> {
        self.sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(handle)
            .cloned()
            .ok_or_else(|| err("NOT_FOUND", "Unknown source folder handle"))
    }

    pub fn target(&self, handle: &str) -> Result<Arc<TargetFolder>> {
        self.targets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(handle)
            .cloned()
            .ok_or_else(|| err("NOT_FOUND", "Unknown target folder handle"))
    }

    /// Forgets a handle of either kind (an import finished); unknown handles are ignored.
    pub fn release(&self, handle: &str) {
        self.sources.lock().unwrap_or_else(|e| e.into_inner()).remove(handle);
        self.targets.lock().unwrap_or_else(|e| e.into_inner()).remove(handle);
    }
}
