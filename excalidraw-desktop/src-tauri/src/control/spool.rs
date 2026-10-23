//! Spool files for `export.spool`: the window streams the rendered bytes in
//! chunks (raw IPC bodies) into `<state>/export-spool/<id>`, and the CLI moves the finished file
//! to its destination. The control channel then carries a path, never the image.
//!
//! Ids are 32 hex digits made here; the page never supplies a path. Nothing runs at startup:
//! `begin` removes spool files older than [`STALE`] (a CLI that died before taking its file).

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

pub(crate) const DIR_NAME: &str = "export-spool";
/// A spool file nobody took within this long is garbage.
const STALE: Duration = Duration::from_secs(60 * 60);

pub(crate) fn dir(state: &Path) -> PathBuf {
    state.join(DIR_NAME)
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:016x}{:016x}", (u64::from(std::process::id()) << 32) | (n & 0xffff_ffff))
}

/// Removes spool files last written more than `max_age` ago. Best effort.
fn sweep(dir: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > max_age);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Creates an empty spool file; returns its id and path.
pub(crate) fn begin(state: &Path) -> std::io::Result<(String, PathBuf)> {
    let dir = dir(state);
    std::fs::create_dir_all(&dir)?;
    sweep(&dir, STALE);
    let id = new_id();
    let path = dir.join(&id);
    File::options().write(true).create_new(true).open(&path)?;
    Ok((id, path))
}

fn path_of(state: &Path, id: &str) -> std::io::Result<PathBuf> {
    if !valid_id(id) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid spool id"));
    }
    Ok(dir(state).join(id))
}

/// Appends `bytes` to an existing spool file (never creates one).
pub(crate) fn append(state: &Path, id: &str, bytes: &[u8]) -> std::io::Result<()> {
    OpenOptions::new().append(true).open(path_of(state, id)?)?.write_all(bytes)
}

/// Deletes a spool file (an export that failed half way). Missing is fine.
pub(crate) fn abort(state: &Path, id: &str) -> std::io::Result<()> {
    match std::fs::remove_file(path_of(state, id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_append_in_order_and_abort_removes_the_file() {
        let t = tempfile::tempdir().unwrap();
        let (id, path) = begin(t.path()).unwrap();
        assert!(valid_id(&id));
        append(t.path(), &id, b"abc").unwrap();
        append(t.path(), &id, &[0, 255, 7]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), [b'a', b'b', b'c', 0, 255, 7]);
        abort(t.path(), &id).unwrap();
        assert!(!path.exists());
        abort(t.path(), &id).unwrap();
    }

    #[test]
    fn ids_never_escape_the_spool_folder_or_create_files() {
        let t = tempfile::tempdir().unwrap();
        for bad in ["", "../x", "..", &"a".repeat(31), &"A".repeat(32), &format!("{}/", "a".repeat(31))] {
            assert!(append(t.path(), bad, b"x").is_err(), "{bad:?}");
            assert!(abort(t.path(), bad).is_err(), "{bad:?}");
        }
        let missing = "0".repeat(32);
        assert!(append(t.path(), &missing, b"x").is_err());
        assert!(!dir(t.path()).join(&missing).exists());
    }

    #[test]
    fn ids_are_unique() {
        let ids: std::collections::HashSet<_> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn begin_sweeps_old_files_only() {
        let t = tempfile::tempdir().unwrap();
        let (_, fresh) = begin(t.path()).unwrap();
        let old = dir(t.path()).join("old");
        std::fs::write(&old, b"x").unwrap();
        sweep(&dir(t.path()), Duration::from_secs(0));
        assert!(!old.exists() && !fresh.exists());
        let (_, fresh) = begin(t.path()).unwrap();
        sweep(&dir(t.path()), Duration::from_secs(3600));
        assert!(fresh.exists());
    }
}
