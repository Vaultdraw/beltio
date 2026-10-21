//! Pure parts of the background indexer: walking a vault for drawings, deciding what needs a
//! (re)parse and turning file bytes into index entries. No threads, no UI.

use super::extract::extract_doc;
use super::index::DocEntry;
use crate::error::{err, ioerr, Result};
use crate::paths::{now_ms, validate_relative, MAX_DRAWING_BYTES, META_DIR};
use std::{
    fs,
    io::Read,
    path::Path,
};

const MAX_DEPTH: usize = 64;

pub struct Found {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

impl Found {
    pub fn stat(&self) -> (u64, u64) {
        (self.size, self.mtime)
    }
}

pub fn is_drawing_name(name: &str) -> bool {
    name.len() > 11 && name.get(name.len() - 11..).is_some_and(|e| e.eq_ignore_ascii_case(".excalidraw"))
}

/// Recursively lists drawings under `root/rel` (never following symlinks, skipping
/// the metadata folder and temp files). Paths are vault-relative with forward slashes.
pub fn walk(root: &Path, rel: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut stack = vec![(rel.to_string(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(root.join(&dir)) else { continue };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else { continue };
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() || name.starts_with(".excalidraw-tmp-") || (dir.is_empty() && name.eq_ignore_ascii_case(META_DIR)) {
                continue;
            }
            let child = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
            if ft.is_dir() {
                if depth < MAX_DEPTH && validate_relative(&child).is_ok() {
                    stack.push((child, depth + 1));
                }
            } else if ft.is_file() && is_drawing_name(&name) && validate_relative(&child).is_ok() {
                if let Ok(md) = entry.metadata() {
                    out.push(Found { path: child, size: md.len(), mtime: md.modified().map(now_ms).unwrap_or(0) });
                }
            }
        }
    }
    out
}

/// Parsed entry for one drawing file's bytes (unparseable files stay findable by name).
pub fn entry_from_bytes(path: &str, stat: (u64, u64), bytes: &[u8]) -> DocEntry {
    match extract_doc(bytes) {
        Ok(x) => DocEntry::new(path, stat, x.items).with_links(x.elinks, x.hash8),
        Err(_) => DocEntry::new(path, stat, Vec::new()),
    }
}

/// Reads `path` into `buf` (reused across files, so a build faults big buffers in once, and
/// freed with the caller's `Vec` when the build ends).
pub fn read_into(path: &Path, buf: &mut Vec<u8>, size_hint: u64) -> Result<()> {
    let need = size_hint.min(MAX_DRAWING_BYTES) as usize + 1;
    if buf.capacity() < need {
        // Replace instead of growing: growing would copy bytes we are about to overwrite.
        *buf = Vec::with_capacity(need.max(buf.capacity() * 2));
    }
    buf.clear();
    fs::File::open(path).map_err(ioerr)?.take(MAX_DRAWING_BYTES + 1).read_to_end(buf).map_err(ioerr)?;
    if buf.len() as u64 > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "File exceeds its size limit"));
    }
    Ok(())
}

pub fn parse(root: &Path, f: &Found, buf: &mut Vec<u8>) -> Option<(String, DocEntry)> {
    let entry = match read_into(&root.join(&f.path), buf, f.size) {
        Ok(()) => entry_from_bytes(&f.path, f.stat(), buf),
        Err(e) if e.code == "NOT_FOUND" => return None,
        // Unreadable or oversize: still findable by name.
        Err(_) => DocEntry::new(&f.path, f.stat(), Vec::new()),
    };
    Some((f.path.clone(), entry))
}

pub fn needs_parse(existing: Option<&DocEntry>, f: &Found, racy_before: u64) -> bool {
    match existing {
        Some(d) => !d.parsed || d.stat != f.stat() || f.mtime >= racy_before,
        None => true,
    }
}
