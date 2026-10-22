//! Listing, reading and writing drawings: the revision-guarded save path shared by the UI,
//! the control API and the CLI.

use crate::error::{err, ioerr, Result};
use crate::fsops::{current_revision, ensure_json, ensure_no_sibling_collision, write_atomic, write_atomic_new};
use crate::paths::{now_ms, random_id, revision, safe_path, validate_relative, MAX_DRAWING_BYTES, META_DIR};
use crate::recovery::{create_recovery, remove_recovery};
use crate::vault::Vault;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub modified_at: u64,
    pub size: u64,
}
/// The entries of one vault folder (the UI file tree and `vault.list` share this).
pub fn list_directory_in(v: &Vault, path: &str) -> Result<Vec<VaultEntry>> {
    let dir = safe_path(&v.root, path, false)?;
    if !dir.is_dir() {
        return Err(err("NOT_FOUND", "Directory not found"));
    }
    let mut out = Vec::new();
    for item in fs::read_dir(dir).map_err(ioerr)? {
        let item = item.map_err(ioerr)?;
        let meta = item.file_type().map_err(ioerr)?;
        if meta.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if name.eq_ignore_ascii_case(META_DIR)
            || (!meta.is_dir() && !name.to_ascii_lowercase().ends_with(".excalidraw"))
        {
            continue;
        }
        let rel = item
            .path()
            .strip_prefix(&v.root)
            .map_err(|e| err("INVALID_PATH", e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if validate_relative(&rel).is_err() {
            continue;
        }
        let md = item.metadata().map_err(ioerr)?;
        out.push(VaultEntry {
            path: rel,
            name,
            kind: if meta.is_dir() { "folder" } else { "drawing" }.into(),
            modified_at: md.modified().map(now_ms).unwrap_or_default(),
            size: if meta.is_file() { md.len() } else { 0 },
        });
    }
    out.sort_by(|a, b| {
        (a.kind != "folder", a.name.to_lowercase())
            .cmp(&(b.kind != "folder", b.name.to_lowercase()))
    });
    Ok(out)
}
/// Hex SHA-256 length; the read frame is `<revision hex>\n<json bytes>`.
pub const REVISION_HEX_LEN: usize = 64;
pub const FRAME_PREFIX_LEN: usize = REVISION_HEX_LEN + 1;
/// Reads a drawing into one buffer laid out as `<revision hex>\n<json bytes>`: the file is
/// read straight into the buffer after a placeholder prefix, hashed in place and validated
/// as UTF-8 JSON without further copies. The body is the raw file (see `read_drawing_file`).
pub fn read_drawing_disk(root: &Path, path: &str) -> Result<Vec<u8>> {
    if !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Only .excalidraw files can be read as drawings")); }
    let p = safe_path(root, path, false)?;
    let file = File::open(&p).map_err(ioerr)?;
    let meta = file.metadata().map_err(ioerr)?;
    if !meta.is_file() || meta.len() > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "Drawing is not a regular file or exceeds 32 MiB")); }
    let mut buf = Vec::with_capacity(FRAME_PREFIX_LEN + meta.len() as usize);
    buf.resize(FRAME_PREFIX_LEN, 0);
    file.take(MAX_DRAWING_BYTES + 1).read_to_end(&mut buf).map_err(ioerr)?;
    if (buf.len() - FRAME_PREFIX_LEN) as u64 > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    let json = std::str::from_utf8(&buf[FRAME_PREFIX_LEN..]).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    ensure_json(json)?;
    let digest = Sha256::digest(&buf[FRAME_PREFIX_LEN..]);
    hex::encode_to_slice(digest, &mut buf[..REVISION_HEX_LEN]).map_err(|e| err("INTERNAL", e.to_string()))?;
    buf[REVISION_HEX_LEN] = b'\n';
    Ok(buf)
}
/// Webview read frame: `<revision of the disk bytes>\n<pure-ASCII json>` (non-ASCII as `\uXXXX`,
/// see `json_ascii`). The buffer is only rebuilt when the file has non-ASCII text.
pub fn read_drawing_file(root: &Path, path: &str) -> Result<Vec<u8>> {
    let buf = read_drawing_disk(root, path)?;
    match crate::json_ascii::escape_non_ascii(&buf[FRAME_PREFIX_LEN..]) {
        std::borrow::Cow::Borrowed(_) => Ok(buf),
        std::borrow::Cow::Owned(body) => {
            let mut prefix = [0u8; FRAME_PREFIX_LEN];
            prefix.copy_from_slice(&buf[..FRAME_PREFIX_LEN]);
            drop(buf);
            let mut framed = Vec::with_capacity(FRAME_PREFIX_LEN + body.len());
            framed.extend_from_slice(&prefix);
            framed.extend_from_slice(&body);
            Ok(framed)
        }
    }
}
/// `{ json, revision }` for small JSON-IPC readers (global templates); vault drawings use the raw frame.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingFile {
    pub json: String,
    pub revision: String,
}
pub fn read_drawing_parts(root: &Path, path: &str) -> Result<DrawingFile> {
    let mut framed = read_drawing_disk(root, path)?;
    let json = String::from_utf8(framed.split_off(FRAME_PREFIX_LEN)).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    framed.truncate(REVISION_HEX_LEN);
    let revision = String::from_utf8(framed).map_err(|e| err("INTERNAL", e.to_string()))?;
    Ok(DrawingFile { json, revision })
}
/// Revision of a drawing without sending its content; `None` when the file is missing.
pub fn drawing_revision_at(root: &Path, path: &str) -> Result<Option<String>> {
    if !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Only .excalidraw files have drawing revisions")); }
    match safe_path(root, path, true) {
        Ok(p) => current_revision(&p),
        Err(e) if e.code == "NOT_FOUND" => Ok(None),
        Err(e) => Err(e),
    }
}
pub fn write_drawing_file(v: &Vault, path: &str, json: &str, expected_revision: Option<&str>, operation_id: &str) -> Result<serde_json::Value> {
    write_drawing_file_with_commit(v, path, json, expected_revision, operation_id, |p, bytes, create| {
        if create { write_atomic_new(p, bytes) } else { write_atomic(p, bytes) }
    })
}
pub fn write_drawing_file_with_commit<F>(v: &Vault, path: &str, json: &str, expected_revision: Option<&str>, operation_id: &str, commit_fn: F) -> Result<serde_json::Value>
where F: FnOnce(&Path, &[u8], bool) -> Result<()> {
    // The webview sends non-ASCII as \uXXXX; the file, its revision and the size limit use the raw UTF-8.
    let bytes = crate::json_ascii::unescape_non_ascii(json.as_bytes());
    let json = std::str::from_utf8(&bytes).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    ensure_json(json)?;
    if path.is_empty() || !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Drawing filenames must end in .excalidraw")); }
    if operation_id.is_empty() || operation_id.len() > 200 { return Err(err("INVALID_ARGUMENT", "Invalid operation id")); }
    let p = safe_path(&v.root, path, true)?;
    if current_revision(&p)?.as_deref() != expected_revision { return Err(err("CONFLICT", "Drawing changed on disk; save was not applied")); }
    if expected_revision.is_none() { ensure_no_sibling_collision(&p)?; }
    let snapshot = create_recovery(v, path, expected_revision, operation_id, json)?;
    let recheck = match current_revision(&p) {
        Ok(rev) => rev,
        Err(e) => { remove_recovery(&snapshot); return Err(e); }
    };
    if recheck.as_deref() != expected_revision { return Err(err("CONFLICT", "Drawing changed immediately before commit; recovery snapshot retained")); }
    commit_fn(&p, json.as_bytes(), expected_revision.is_none())?;
    let rev = revision(json.as_bytes());
    remove_recovery(&snapshot);
    // `bytes`: size on disk (the webview's text can be longer: \uXXXX escapes).
    Ok(serde_json::json!({"revision": rev, "bytes": json.len()}))
}
/// Write for the link rewriter (closed drawings only). Same path, size and JSON validation and the
/// same revision check (before the write and again right before the rename) as
/// `write_drawing_file`, but no recovery copy: the original stays intact until the atomic rename
/// and the rewrite journal makes the job re-runnable. One fsync of the temp file; the parent
/// directory is NOT synced here, the caller syncs each distinct parent once per batch
/// (`sync_dirs`). The caller holds the vault mutation guard. Returns the parent directory.
pub fn write_drawing_file_rewrite(v: &Vault, path: &str, json: &str, expected_revision: &str) -> Result<PathBuf> {
    let bytes = crate::json_ascii::unescape_non_ascii(json.as_bytes());
    let json = std::str::from_utf8(&bytes).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    ensure_json(json)?;
    if path.is_empty() || !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Drawing filenames must end in .excalidraw")); }
    let p = safe_path(&v.root, path, false)?;
    if current_revision(&p)?.as_deref() != Some(expected_revision) { return Err(err("CONFLICT", "Drawing changed on disk; rewrite was not applied")); }
    let parent = p.parent().ok_or_else(|| err("INVALID_PATH", "File has no parent"))?.to_path_buf();
    let temp = parent.join(format!(".excalidraw-tmp-{}-{}", std::process::id(), random_id()));
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(ioerr)?;
        f.write_all(json.as_bytes()).map_err(ioerr)?;
        f.sync_all().map_err(ioerr)?;
        if current_revision(&p)?.as_deref() != Some(expected_revision) { return Err(err("CONFLICT", "Drawing changed immediately before commit; rewrite was not applied")); }
        fs::rename(&temp, &p).map_err(ioerr)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result.map(|_| parent)
}
