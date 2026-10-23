//! Content-addressed thumbnail files: `<cache>/<rev[0..2]>/<rev>.v<N>.png` and `<rev>.v<N>.fail`,
//! where N is the renderer version (it changes when the output changes, e.g. pixel density).
//! Pure functions on paths; validation of every externally supplied name lives here.
use crate::{err, ioerr, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// A 640x480 thumbnail of a drawing with photos can pass 512 KB; 1 MB bounds a pathological one.
pub(super) const MAX_PNG_BYTES: usize = 1024 * 1024;
pub(super) const REV_LEN: usize = 64;
pub(super) const VAULT_ID_LEN: usize = 16;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Kind {
    Png,
    Fail,
}

pub(super) fn parse_kind(value: &str) -> Result<Kind> {
    match value {
        "png" => Ok(Kind::Png),
        "fail" => Ok(Kind::Fail),
        other => Err(err("INVALID_ARGUMENT", format!("Unknown thumbnail kind: {other}"))),
    }
}

/// Lowercase hex of exactly `len` characters (so a name can never contain `/`, `.` or `%`).
pub(super) fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(super) fn validate_rev(rev: &str) -> Result<()> {
    if is_lower_hex(rev, REV_LEN) {
        Ok(())
    } else {
        Err(err("INVALID_ARGUMENT", "Revision must be 64 lowercase hex characters"))
    }
}

pub(super) fn png_path(cache: &Path, rev: &str, render_version: u32) -> PathBuf {
    cache.join(&rev[..2]).join(format!("{rev}.v{render_version}.png"))
}

/// Delete the other renderings of `rev` (older versions, other densities, pre-v2 `<rev>.png`)
/// once `keep` is written: a re-render replaces the low-res thumbnail instead of adding to it.
pub(super) fn remove_other_pngs(keep: &Path, rev: &str) {
    let (Some(dir), Some(keep_name)) = (keep.parent(), keep.file_name()) else { return };
    let Ok(files) = fs::read_dir(dir) else { return };
    let prefix = format!("{rev}.");
    for f in files.flatten() {
        let name = f.file_name();
        let n = name.to_string_lossy();
        if name != keep_name && n.starts_with(&prefix) && n.ends_with(".png") {
            let _ = fs::remove_file(f.path());
        }
    }
}

pub(super) fn fail_path(cache: &Path, rev: &str, render_version: u32) -> PathBuf {
    cache.join(&rev[..2]).join(format!("{rev}.v{render_version}.fail"))
}

/// Validate the body for `kind` (PNG magic + size cap, or an empty fail marker).
pub(super) fn validate_body(kind: Kind, body: &[u8]) -> Result<()> {
    match kind {
        Kind::Png => {
            if body.len() > MAX_PNG_BYTES {
                return Err(err("INVALID_FILE", "Thumbnail exceeds 1 MB"));
            }
            crate::clipboard::validate_png(body)
        }
        Kind::Fail if body.is_empty() => Ok(()),
        Kind::Fail => Err(err("INVALID_ARGUMENT", "A fail marker must have an empty body")),
    }
}

static TMP_ID: AtomicU64 = AtomicU64::new(0);

/// A temp name that cannot be guessed: process id, a counter and 64 random bits.
pub(super) fn temp_name() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(TMP_ID.load(Ordering::Relaxed));
    format!(".{}-{}-{:016x}.tmp", std::process::id(), TMP_ID.fetch_add(1, Ordering::Relaxed), h.finish())
}

/// Create a new file at an unused temp name. `create_new` fails on anything already there
/// (including a symlink planted at that name) instead of following it.
fn create_temp(dir: &Path) -> std::io::Result<(PathBuf, fs::File)> {
    let mut last = None;
    for _ in 0..8 {
        let tmp = dir.join(temp_name());
        match fs::OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => return Ok((tmp, f)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => last = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::from(std::io::ErrorKind::AlreadyExists)))
}

/// Write `bytes` to `dest` through a sibling temp file + rename (never leaves a partial file).
pub(super) fn write_atomic(dest: &Path, bytes: &[u8]) -> Result<()> {
    let dir = dest.parent().ok_or_else(|| err("INTERNAL", "Thumbnail path has no parent"))?;
    fs::create_dir_all(dir).map_err(ioerr)?;
    let (tmp, mut f) = create_temp(dir).map_err(ioerr)?;
    let res = (|| {
        f.write_all(bytes)?;
        drop(f);
        fs::rename(&tmp, dest)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(ioerr(e));
    }
    Ok(())
}

/// Write the file for `kind`; returns its size on disk (0 for fail markers).
pub(super) fn write_entry(cache: &Path, rev: &str, kind: Kind, render_version: u32, body: &[u8]) -> Result<u64> {
    validate_rev(rev)?;
    validate_body(kind, body)?;
    let dest = match kind {
        Kind::Png => png_path(cache, rev, render_version),
        Kind::Fail => fail_path(cache, rev, render_version),
    };
    write_atomic(&dest, body)?;
    if kind == Kind::Png {
        remove_other_pngs(&dest, rev);
    }
    Ok(body.len() as u64)
}
