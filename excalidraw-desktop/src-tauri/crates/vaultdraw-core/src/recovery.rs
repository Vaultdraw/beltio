//! Crash-recovery store (`.excalidraw-vault/recovery`): a snapshot is written before every
//! drawing commit and removed after it succeeds.

use crate::error::{err, ioerr, Result};
use crate::fsops::{current_revision, ensure_json, read_bounded, write_atomic_new_with};
use crate::paths::{now_ms, random_id, revision, safe_path, validate_relative, MAX_DRAWING_BYTES, META_DIR};
use crate::vault::Vault;
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

pub const MAX_RECOVERY_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_RECOVERY_RECORD_BYTES: u64 = MAX_DRAWING_BYTES * 2 + 8192;
pub const RECOVERY_DIR: &str = "recovery";

/// Borrowed when serializing (the snapshot is never copied), owned when `list_recovery` parses it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[doc(hidden)]
pub struct RecoveryRecord<'a> {
    pub path: Cow<'a, str>,
    pub expected_revision: Option<Cow<'a, str>>,
    pub operation_id: Cow<'a, str>,
    pub json: Cow<'a, str>,
    pub created_at: u64,
}

pub fn checked_recovery_dir(v: &Vault, create: bool) -> Result<Option<PathBuf>> {
    let meta = v.root.join(META_DIR);
    let metadata = match fs::symlink_metadata(&meta) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => { fs::create_dir(&meta).map_err(ioerr)?; fs::symlink_metadata(&meta).map_err(ioerr)? },
        Err(e) => return Err(ioerr(e)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(err("INVALID_PATH", "Reserved vault metadata is not a real directory"));
    }
    let dir = meta.join(RECOVERY_DIR);
    let metadata = match fs::symlink_metadata(&dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => { fs::create_dir(&dir).map_err(ioerr)?; fs::symlink_metadata(&dir).map_err(ioerr)? },
        Err(e) => return Err(ioerr(e)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(err("INVALID_PATH", "Recovery directory is not a real directory"));
    }
    Ok(Some(dir))
}
pub fn recovery_dir(v: &Vault) -> Result<PathBuf> {
    checked_recovery_dir(v, true)?.ok_or_else(|| err("INTERNAL", "Recovery directory unavailable"))
}
pub fn create_recovery(
    v: &Vault,
    path: &str,
    expected: Option<&str>,
    operation_id: &str,
    json: &str,
) -> Result<PathBuf> {
    let dir = recovery_dir(v)?;
    // One record per drawing path AND process session: a new snapshot replaces only this session's
    // previous failed one, so repeated failed commits never fill the store. A record left by an
    // earlier session (crash, discarded close) keeps its own name and is never replaced or removed
    // by a save; it stays listed for the recovery dialog.
    let prefix = format!("p-{}-", &revision(path.as_bytes())[..32]);
    let file = dir.join(format!("{prefix}{}.json", session_id()));
    let mut total = 0u64;
    // (modified, size, path, group) of other sessions' records, for cap pruning.
    let mut others: Vec<(SystemTime, u64, PathBuf, String)> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let ty = entry.file_type().map_err(ioerr)?;
        if ty.is_symlink() { return Err(err("INVALID_PATH", "Recovery metadata contains a symbolic link")); }
        // The record about to be replaced does not count against the cap.
        if ty.is_file() && entry.path() != file {
            let md = entry.metadata().map_err(ioerr)?;
            total = total.saturating_add(md.len());
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".json") {
                // Group = path hash (`p-<hash>-`); legacy random-named records form their own group.
                let group = name.strip_prefix("p-").and_then(|r| r.get(..32)).map(str::to_string).unwrap_or_else(|| name.clone());
                others.push((md.modified().unwrap_or(SystemTime::UNIX_EPOCH), md.len(), entry.path(), group));
            }
        }
    }
    let record = RecoveryRecord {
        path: path.into(),
        expected_revision: expected.map(Cow::Borrowed),
        operation_id: operation_id.into(),
        json: json.into(),
        created_at: now_ms(SystemTime::now()),
    };
    // Exact serialized size from a counting pass (no allocation), so the caps below hold
    // without materialising the escaped record in memory.
    let mut counter = CountingWriter(0);
    serde_json::to_writer(&mut counter, &record).map_err(|e| err("INTERNAL", e.to_string()))?;
    if counter.0 <= MAX_RECOVERY_RECORD_BYTES && total.saturating_add(counter.0) > MAX_RECOVERY_BYTES {
        // Over the cap: prune the oldest earlier-session records, never the newest per drawing.
        others.sort_by_key(|o| o.0);
        let mut newest: std::collections::HashMap<String, SystemTime> = std::collections::HashMap::new();
        for o in &others { let e = newest.entry(o.3.clone()).or_insert(o.0); if o.0 > *e { *e = o.0; } }
        for o in &others {
            if total.saturating_add(counter.0) <= MAX_RECOVERY_BYTES { break; }
            if newest.get(&o.3) == Some(&o.0) { continue; }
            if fs::remove_file(&o.2).is_ok() { total = total.saturating_sub(o.1); }
        }
    }
    if counter.0 > MAX_RECOVERY_RECORD_BYTES || total.saturating_add(counter.0) > MAX_RECOVERY_BYTES {
        return Err(err(
            "RECOVERY_FULL",
            "Recovery storage is full; discard snapshots before saving",
        ));
    }
    let staged = dir.join(format!("{}.tmp", random_id()));
    write_atomic_new_with(&staged, |f| {
        let mut out = BufWriter::new(f);
        serde_json::to_writer(&mut out, &record)?;
        out.flush()
    })?;
    if let Err(e) = fs::rename(&staged, &file) { let _ = fs::remove_file(&staged); return Err(ioerr(e)); }
    Ok(file)
}
/// Random id of this process run; part of every record name so sessions never overwrite each other.
fn session_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(random_id)
}
/// `Write` sink that only counts bytes.
#[doc(hidden)]
pub struct CountingWriter(pub u64);
impl Write for CountingWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
pub fn remove_recovery(path: &Path) {
    let _ = fs::remove_file(path);
}

pub fn recovery_reveal_target(v: &Vault) -> Result<PathBuf> {
    checked_recovery_dir(v, !v.read_only)?.ok_or_else(|| err("NOT_FOUND", "No recovery folder yet"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: String,
    pub path: String,
    pub modified_at: u64,
    pub json: String,
}

/// Unresolved crash-recovery snapshots (`list_recovery`), oldest first.
pub fn list_recovery(v: &Vault) -> Result<Vec<RecoveryEntry>> {
    let Some(dir) = checked_recovery_dir(v, false)? else { return Ok(Vec::new()); };
    let mut out = Vec::new();
    let mut total = 0u64;
    for entry in fs::read_dir(dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let ty = entry.file_type().map_err(ioerr)?;
        if !ty.is_file()
            || ty.is_symlink()
            || !entry.file_name().to_string_lossy().ends_with(".json")
        {
            continue;
        }
        let md = entry.metadata().map_err(ioerr)?;
        // An over-limit record is skipped (and not counted), not fatal: one bad file must not hide the others.
        if md.len() > MAX_RECOVERY_RECORD_BYTES || total.saturating_add(md.len()) > MAX_RECOVERY_BYTES {
            continue;
        }
        total = total.saturating_add(md.len());
        let data = read_bounded(&entry.path(), MAX_RECOVERY_RECORD_BYTES)?;
        let record: RecoveryRecord<'_> = match serde_json::from_slice(&data) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if ensure_json(&record.json).is_err() || validate_relative(&record.path).is_err() {
            continue;
        }
        // A successfully committed snapshot is stale; a mismatched revision remains recoverable.
        let source = safe_path(&v.root, &record.path, true)?;
        let source_rev = current_revision(&source).ok().flatten();
        if source_rev == Some(revision(record.json.as_bytes())) {
            continue;
        }
        out.push(RecoveryEntry {
            id: entry
                .file_name()
                .to_string_lossy()
                .trim_end_matches(".json")
                .into(),
            path: record.path.into_owned(),
            modified_at: record.created_at,
            json: record.json.into_owned(),
        });
    }
    out.sort_by_key(|r| r.modified_at);
    Ok(out)
}
/// Removes one recovery snapshot by id (`discard_recovery`); the caller checks `writable` and holds the mutation guard.
pub fn discard_recovery_entry(v: &Vault, id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 200 || id.contains('/') || id.contains('\\') || id.contains("..")
    {
        return Err(err("INVALID_ARGUMENT", "Invalid recovery id"));
    }
    let Some(dir) = checked_recovery_dir(v, false)? else { return Err(err("NOT_FOUND", "Recovery entry not found")); };
    let p = dir.join(format!("{id}.json"));
    if fs::symlink_metadata(&p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(err("INVALID_PATH", "Recovery entry is a symbolic link"));
    }
    fs::remove_file(p).map_err(ioerr)
}
