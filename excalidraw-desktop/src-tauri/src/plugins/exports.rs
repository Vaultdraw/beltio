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

/// Which export files the plugin wrote: vault path to the sha256 of what it wrote. A file at
/// such a path counts as an export only while its bytes still hash to that value, so a user's own
/// `Logo.png` next to `Logo.excalidraw` (or a file they replaced or edited) is never overwritten,
/// moved or deleted. Kept in the vault's metadata folder, so it travels with the vault.
type Manifest = std::collections::BTreeMap<String, String>;

const MANIFEST: &str = "plugin-exports.json";

fn manifest_path(v: &vaultdraw_core::Vault) -> std::path::PathBuf {
    v.root.join(crate::META_DIR).join(MANIFEST)
}

/// A missing or unreadable manifest reads as empty: every existing file is then "not ours" (safe).
fn load(v: &vaultdraw_core::Vault) -> Manifest {
    fs::read(manifest_path(v)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(v: &vaultdraw_core::Vault, m: &Manifest) -> Result<()> {
    let p = manifest_path(v);
    if m.is_empty() && !p.exists() {
        return Ok(());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    write_atomic(&p, &serde_json::to_vec(m).map_err(|e| err("INTERNAL", e.to_string()))?)
}

fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// True when `path` (already resolved to `abs`) is a regular file the plugin wrote and nobody changed.
fn owned(m: &Manifest, path: &str, abs: &Path) -> bool {
    let Some(want) = m.get(path) else { return false };
    let Ok(meta) = fs::symlink_metadata(abs) else { return false };
    if !meta.is_file() || meta.len() > MAX_EXPORT_BYTES as u64 {
        return false;
    }
    fs::read(abs).is_ok_and(|b| &hash(&b) == want)
}

fn not_an_export(path: &str) -> crate::NativeError {
    err("CONFLICT", format!("{path} already exists and was not made by an export, so it is left alone"))
}

/// Moves a file to the Trash (tests delete it, so they never touch the real Trash).
fn trash_file(p: &Path) -> Result<()> {
    #[cfg(test)]
    {
        fs::remove_file(p).map_err(ioerr)
    }
    #[cfg(not(test))]
    {
        trash::delete(p).map_err(|e| err("TRASH_FAILED", format!("Could not move the export to the Trash: {e}")))
    }
}

/// Every file under `dir` with its vault-relative path (`prefix` is the folder's own path).
fn files_in(dir: &Path, prefix: &str, out: &mut Vec<(String, std::path::PathBuf)>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let rel = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        if entry.file_type().map_err(ioerr)?.is_dir() {
            files_in(&entry.path(), &rel, out)?;
        } else {
            out.push((rel, entry.path()));
        }
    }
    Ok(())
}

/// Removes the empty folders under (and including) `dir`; a folder that still holds a file stays.
fn prune_empty(dir: &Path) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                prune_empty(&e.path());
            }
        }
    }
    let _ = fs::remove_dir(dir);
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
    let mut m = load(v);
    // Replacing an export is the point of `write`, but never a file the plugin did not write.
    if fs::symlink_metadata(&dest).is_ok() && !owned(&m, path, &dest) {
        return Err(not_an_export(path));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    // ...and never a file the user locked.
    vaultdraw_core::fsops::ensure_file_writable(&dest)?;
    write_atomic(&dest, bytes)?;
    m.insert(path.to_string(), hash(bytes));
    save(v, &m)
}

/// Moves one export file, or a folder of exports. False when `from` does not exist or is not
/// (entirely) the plugin's own export.
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
    // A case-only rename on a case-insensitive disk: both names are the same file.
    let same = vaultdraw_core::fsops::same_file(&src, &dest);
    if dest.starts_with(&src) && !same {
        return Err(err("INVALID_PATH", "A folder cannot move into itself"));
    }
    if file == meta.is_dir() {
        return Err(err("INVALID_PATH", "A file and a folder do not exchange places"));
    }
    let mut m = load(v);
    if meta.is_dir() {
        only_images(&src)?;
        let mut all = Vec::new();
        files_in(&src, from, &mut all)?;
        if all.iter().any(|(rel, abs)| !owned(&m, rel, abs)) {
            return Ok(false);
        }
        if !same && dest.exists() {
            return Err(err("CONFLICT", "The destination folder exists"));
        }
    } else {
        if dest.is_dir() {
            return Err(err("INVALID_PATH", "A folder has that name"));
        }
        if !owned(&m, from, &src) {
            return Ok(false);
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(ioerr)?;
    }
    if same {
        fs::rename(&src, &dest).map_err(ioerr)?;
    } else {
        // The kernel refuses a name clash (a file made after the check above included).
        vaultdraw_core::fsops::rename_no_replace(&src, &dest).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists { err("CONFLICT", "The destination exists") } else { ioerr(e) }
        })?;
    }
    let prefix = format!("{from}/");
    let moved: Vec<(String, String)> = m
        .iter()
        .filter(|(k, _)| k.as_str() == from || k.starts_with(&prefix))
        .map(|(k, h)| (format!("{to}{}", &k[from.len()..]), h.clone()))
        .collect();
    m.retain(|k, _| k.as_str() != from && !k.starts_with(&prefix));
    m.extend(moved);
    save(v, &m)?;
    Ok(true)
}

/// Moves the plugin's own export file (or the exports inside a folder) to the Trash. False when
/// nothing of the plugin's is there; a file it did not write is never touched.
pub(crate) fn remove(v: &vaultdraw_core::Vault, path: &str) -> Result<bool> {
    let file = is_image(path);
    check(path, file)?;
    writable(v)?;
    let _guard = mutation_guard(v)?;
    let target = safe_path(&v.root, path, true)?;
    let Ok(meta) = fs::symlink_metadata(&target) else { return Ok(false) };
    let mut m = load(v);
    let mut removed = false;
    if meta.is_dir() {
        only_images(&target)?;
        let mut all = Vec::new();
        files_in(&target, path, &mut all)?;
        for (rel, abs) in all {
            if owned(&m, &rel, &abs) {
                trash_file(&abs)?;
                m.remove(&rel);
                removed = true;
            }
        }
        prune_empty(&target);
    } else if file {
        if owned(&m, path, &target) {
            trash_file(&target)?;
            m.remove(path);
            removed = true;
        }
    } else {
        return Err(err("INVALID_PATH", "Not an export"));
    }
    if removed {
        save(v, &m)?;
    }
    Ok(removed)
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

#[cfg(test)]
mod guard_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn vault(root: &Path) -> vaultdraw_core::Vault {
        vaultdraw_core::Vault::new(root.canonicalize().unwrap(), "t".into(), false, None)
    }
    #[test]
    fn move_never_replaces_and_write_never_replaces_a_locked_file() {
        let t = tempfile::tempdir().unwrap();
        let v = vault(t.path());
        write(&v, "a.png", b"a").unwrap();
        write(&v, "b.png", b"b").unwrap();
        assert_eq!(move_(&v, "a.png", "b.png").unwrap_err().code, "CONFLICT");
        assert_eq!(fs::read_to_string(t.path().join("b.png")).unwrap(), "b");
        fs::set_permissions(t.path().join("b.png"), fs::Permissions::from_mode(0o444)).unwrap();
        assert_eq!(write(&v, "b.png", b"new").unwrap_err().code, "READ_ONLY");
        assert_eq!(fs::read_to_string(t.path().join("b.png")).unwrap(), "b");
    }
}
