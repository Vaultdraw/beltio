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
    /// Real paths of the folder links `list` followed (a vault whose attachments folder is a link to
    /// somewhere else). Reads may reach files under these as well as under `root`.
    linked: std::sync::Mutex<Vec<PathBuf>>,
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
        Ok(SourceFolder { root, name, linked: std::sync::Mutex::new(Vec::new()) })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Every regular file under the folder, recursively, in path order. Entries whose name starts
    /// with a dot and symbolic links to files are skipped. A symbolic link to a FOLDER outside the
    /// source is followed (read only: people keep attachments in a linked folder, as Obsidian
    /// allows); one that points inside the source (already listed), at a parent of it, or through a
    /// hidden folder is skipped, and each real folder is walked once, so a loop cannot repeat.
    /// Stops at [`MAX_ENTRIES`].
    pub fn list(&self) -> Result<Listing> {
        let mut entries = Vec::new();
        let mut truncated = false;
        let mut stack = vec![(self.root.clone(), String::new())];
        let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::from([self.root.clone()]);
        let mut linked = self.linked.lock().unwrap();
        linked.clear();
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
                    if let Some(real) = self.followable_dir(&path) {
                        if seen.insert(real.clone()) {
                            linked.push(real);
                            stack.push((path, child_rel));
                        }
                    }
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

    /// The real folder a symbolic link points at, when `list` may follow it (see `list`).
    fn followable_dir(&self, link: &Path) -> Option<PathBuf> {
        let real = fs::canonicalize(link).ok()?;
        if !fs::metadata(&real).ok()?.is_dir() || real.starts_with(&self.root) || self.root.starts_with(&real) {
            return None;
        }
        // Never into a hidden folder (`.ssh`, `.config`, ...), whatever the link is called.
        if real.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
            return None;
        }
        Some(real)
    }

    /// The absolute path of `path` inside the source: validated; the only symbolic links allowed in
    /// it are the folder links `list` followed, and the file must really sit in the source or under
    /// one of them.
    fn resolve(&self, path: &str) -> Result<PathBuf> {
        check_rel(path)?;
        let parts = validate_relative(path)?;
        let linked = self.linked.lock().unwrap().clone();
        let mut cur = self.root.clone();
        for (i, part) in parts.iter().enumerate() {
            cur.push(part);
            let meta = fs::symlink_metadata(&cur).map_err(ioerr)?;
            if meta.file_type().is_symlink() {
                // Only a folder link `list` followed, and never the last part (a file link).
                let ok = i + 1 < parts.len() && fs::canonicalize(&cur).is_ok_and(|r| linked.contains(&r));
                if !ok {
                    return Err(err("INVALID_PATH", "Symbolic links are not allowed in a vault"));
                }
            }
        }
        let real = fs::canonicalize(&cur).map_err(ioerr)?;
        if !(real.starts_with(&self.root) || linked.iter().any(|l| real.starts_with(l))) {
            return Err(err("INVALID_PATH", "Path escapes the selected vault"));
        }
        let meta = fs::symlink_metadata(&cur).map_err(ioerr)?;
        if !meta.file_type().is_file() {
            return Err(err("NOT_FOUND", "Not a regular file"));
        }
        Ok(cur)
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
        let text = source.read_text(from)?;
        // The listing is only read when the file embeds images.
        let mut index: Option<Vec<Entry>> = None;
        let scene = crate::excalidraw_md::extract_scene_with(&text, |_, target| {
            let entries = index.get_or_insert_with(|| source.list().map(|l| l.entries).unwrap_or_default());
            let found = find_image(entries, from, target)?;
            if found.size > MAX_EMBED_BYTES {
                return None;
            }
            source.read_bytes(&found.path).ok()
        })?;
        self.write_drawing(to, &scene)
    }
}

/// Largest image put into a converted drawing (the same cap as the notes import).
pub const MAX_EMBED_BYTES: u64 = 4 * 1024 * 1024;

/// The source file an `## Embedded Files` target names, Obsidian's way: the path from the vault
/// root or from the drawing's folder, else the closest file with that name (case-insensitive).
pub(crate) fn find_image<'a>(entries: &'a [Entry], from: &str, target: &str) -> Option<&'a Entry> {
    let target = target.trim().trim_start_matches('/');
    let dir = from.rsplit_once('/').map_or("", |(d, _)| d);
    let near = if dir.is_empty() { target.to_string() } else { format!("{dir}/{target}") };
    let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
    if let Some(e) = entries.iter().find(|e| e.path == near || e.path == target) {
        return Some(e);
    }
    let name = target.rsplit('/').next().unwrap_or(target);
    entries
        .iter()
        .filter(|e| same(e.path.rsplit('/').next().unwrap_or(&e.path), name) && (!target.contains('/') || e.path.to_lowercase().ends_with(&format!("/{}", target.to_lowercase()))))
        .min_by_key(|e| {
            let shared = e.path.split('/').zip(dir.split('/')).take_while(|(a, b)| a == b).count();
            (std::cmp::Reverse(shared), e.path.len())
        })
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
