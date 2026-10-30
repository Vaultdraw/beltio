//! Vault path rules (`validate_relative`, `safe_path`), clocks, ids and revision hashing.

use crate::error::{err, ioerr, Result};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_DRAWING_BYTES: u64 = 32 * 1024 * 1024;
pub const META_DIR: &str = ".excalidraw-vault";

#[inline]
pub fn now_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
#[inline]
pub fn revision(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
/// Hex SHA-256 of a stream through a fixed buffer, plus the number of bytes read.
#[inline]
pub fn revision_of_reader(mut reader: impl Read) -> std::io::Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
#[inline]
pub fn random_id() -> String {
    // Monotonic within a process, including multiple IDs generated in one millisecond.
    format!("{:x}-{:x}-{:x}", now_ms(SystemTime::now()), std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

#[inline]
pub fn is_windows_reserved_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9")
}
/// Longest vault-relative path `validate_relative` accepts, in bytes.
pub const MAX_REL_PATH_BYTES: usize = 4096;
/// True when one path component breaks the vault's naming rules (empty, dots, too long, a
/// trailing dot or space, control or reserved characters, Windows device names).
#[inline]
pub fn component_is_invalid(part: &str) -> bool {
    part.is_empty()
        || part == "."
        || part == ".."
        || part.len() > 255
        || part.ends_with('.')
        || part.ends_with(' ')
        || part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c))
        || is_windows_reserved_name(part)
}
/// Why one path component is refused, in plain words, or `None` when it is fine. The same words as
/// `nameProblem` in sdk/api/shared/vaultPaths.ts (shared table: contract/name_rules.json). Windows
/// device names are refused on every system on purpose, so a vault opens everywhere.
pub fn component_problem(part: &str) -> Option<String> {
    let shown = || if part.chars().count() > 40 { format!("\"{}...\"", part.chars().take(37).collect::<String>()) } else { format!("\"{part}\"") };
    if part.is_empty() {
        return Some("A name cannot be empty".into());
    }
    if part == "." || part == ".." {
        return Some("A name cannot be only dots".into());
    }
    if part.len() > 255 {
        return Some(format!("The name {} is too long: {} bytes, and the limit is 255", shown(), part.len()));
    }
    if part.ends_with('.') || part.ends_with(' ') {
        return Some(format!("The name {} ends with a dot or a space, which Windows cannot hold", shown()));
    }
    if part.chars().any(|c| c.is_control()) {
        return Some(format!("The name {} has a control character in it", shown()));
    }
    if let Some(c) = part.chars().find(|c| "<>:\"|?*".contains(*c)) {
        return Some(format!("The character {c} is not allowed in a name ({})", shown()));
    }
    if is_windows_reserved_name(part) {
        let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
        return Some(format!("{stem} is a reserved Windows name, so Vaultdraw refuses it on every system to keep vaults portable ({})", shown()));
    }
    None
}
#[inline]
pub fn validate_relative(path: &str) -> Result<Vec<String>> {
    if path.is_empty() {
        return Ok(Vec::new());
    }
    if path.len() > MAX_REL_PATH_BYTES
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains('\0')
    {
        return Err(err(
            "INVALID_PATH",
            "Path must be a bounded vault-relative path using forward slashes",
        ));
    }
    let mut out = Vec::new();
    for part in path.split('/') {
        if let Some(problem) = component_problem(part) {
            return Err(err("INVALID_PATH", problem));
        }
        if part.eq_ignore_ascii_case(META_DIR) {
            return Err(err(
                "INVALID_PATH",
                "Reserved vault metadata is not user-accessible",
            ));
        }
        out.push(part.to_string());
    }
    Ok(out)
}
#[inline]
pub fn safe_path(root: &Path, path: &str, allow_missing_leaf: bool) -> Result<PathBuf> {
    let parts = validate_relative(path)?;
    let mut cur = root.to_path_buf();
    for (i, part) in parts.iter().enumerate() {
        cur.push(part);
        match fs::symlink_metadata(&cur) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(err(
                    "INVALID_PATH",
                    "Symbolic links are not allowed in a vault",
                ))
            }
            Ok(_) => {}
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    && (allow_missing_leaf || i + 1 < parts.len()) => {}
            Err(e) => return Err(ioerr(e)),
        }
    }
    // Canonicalize the nearest existing ancestor, preventing traversal through replaced parents.
    let mut ancestor = cur.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| err("INVALID_PATH", "Invalid path"))?;
    }
    let canonical = ancestor.canonicalize().map_err(ioerr)?;
    let base = root.canonicalize().map_err(ioerr)?;
    if !canonical.starts_with(&base) {
        return Err(err("INVALID_PATH", "Path escapes the selected vault"));
    }
    Ok(cur)
}

#[cfg(test)]
mod name_contract_tests {
    use super::component_is_invalid;

    /// The table src/tests/nameContract.test.ts also reads: the names the Name dialogs must refuse.
    #[test]
    fn name_contract_table() {
        let table: serde_json::Value = serde_json::from_str(include_str!("contract/entry_names.json")).unwrap();
        for row in table["cases"].as_array().unwrap() {
            let name = match &row["name"] {
                serde_json::Value::String(s) => s.clone(),
                o => o["repeat"].as_str().unwrap().repeat(o["times"].as_u64().unwrap() as usize),
            };
            let component = if row["kind"] == "drawing" { format!("{name}.excalidraw") } else { name.clone() };
            let ok = !component_is_invalid(&component);
            assert_eq!(ok, row["backendOk"].as_bool().unwrap(), "{} ({})", row["label"], row["kind"]);
        }
    }
}
