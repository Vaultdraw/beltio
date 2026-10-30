//! The vault's single-writer lock (`.excalidraw-vault.lock`, an flock).
//!
//! The flock keeps a second Vaultdraw *process* from writing the same vault.
//! Inside one process the lock is shared: every handle opened on the same root
//! holds the same `Arc<VaultLock>`, so re-opening a vault (a webview reload, the
//! vault switcher picking the open vault, "Retry writable") never fails against
//! the process's own lock. The fd closes, and the flock is released, when the
//! last handle on that root is dropped.
//!
//! When a vault opens read-only, `LockOutcome::reason` says why, and for a lock
//! held by another process `holder_pid` names it (each holder writes its pid
//! into the lock file).

use fs2::FileExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadOnlyReason {
    /// The folder (or its lock file) can't be written by this user.
    NotWritable,
    /// Another Vaultdraw process holds the vault's lock.
    LockedByOtherProcess,
    /// The lock file is unusable (a symlink, not a file, or flock unsupported).
    LockUnavailable,
}

/// An acquired flock; dropping the last reference closes the fd and releases it.
pub struct VaultLock {
    _file: File,
}

pub struct LockOutcome {
    pub lock: Option<Arc<VaultLock>>,
    pub reason: Option<ReadOnlyReason>,
    pub holder_pid: Option<u32>,
}

impl LockOutcome {
    fn read_only(reason: ReadOnlyReason, holder_pid: Option<u32>) -> Self {
        Self { lock: None, reason: Some(reason), holder_pid }
    }
}

/// Process-wide map from canonical vault root to its live lock.
#[derive(Default)]
pub struct LockRegistry {
    held: Mutex<HashMap<PathBuf, Weak<VaultLock>>>,
}

impl LockRegistry {
    /// Locks `root` (already canonical) for writing, or says why it can't.
    pub fn acquire(&self, root: &Path, lock_name: &str) -> LockOutcome {
        let dir_read_only = fs::metadata(root).map(|m| m.permissions().readonly()).unwrap_or(true);
        if dir_read_only {
            return LockOutcome::read_only(ReadOnlyReason::NotWritable, None);
        }
        let mut held = self.held.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(lock) = held.get(root).and_then(Weak::upgrade) {
            return LockOutcome { lock: Some(lock), reason: None, holder_pid: None };
        }
        let mut file = match open_lock_file(&root.join(lock_name)) {
            Ok(f) => f,
            Err(ErrorKind::PermissionDenied) => return LockOutcome::read_only(ReadOnlyReason::NotWritable, None),
            Err(_) => return LockOutcome::read_only(ReadOnlyReason::LockUnavailable, None),
        };
        if let Err(e) = file.try_lock_exclusive() {
            return if e.raw_os_error() == fs2::lock_contended_error().raw_os_error() {
                LockOutcome::read_only(ReadOnlyReason::LockedByOtherProcess, read_pid(&mut file))
            } else {
                LockOutcome::read_only(ReadOnlyReason::LockUnavailable, None)
            };
        }
        write_pid(&mut file);
        let lock = Arc::new(VaultLock { _file: file });
        held.retain(|_, w| w.strong_count() > 0);
        held.insert(root.to_path_buf(), Arc::downgrade(&lock));
        LockOutcome { lock: Some(lock), reason: None, holder_pid: None }
    }
}

/// Opens (or creates) the lock file; refuses symlinks and non-files.
pub fn open_lock_file(lock_path: &Path) -> Result<File, ErrorKind> {
    let open = |create: bool| {
        let mut o = OpenOptions::new();
        o.read(true).write(true);
        if create {
            o.create_new(true);
        }
        o.open(lock_path).map_err(|e| e.kind())
    };
    match fs::symlink_metadata(lock_path) {
        Ok(m) if m.file_type().is_symlink() || !m.is_file() => Err(ErrorKind::InvalidInput),
        Ok(_) => open(false),
        Err(e) if e.kind() == ErrorKind::NotFound => open(true),
        Err(e) => Err(e.kind()),
    }
}

/// Records the holder's pid so a blocked process can say who has the vault.
fn write_pid(file: &mut File) {
    let _ = file.set_len(0);
    let _ = file.seek(SeekFrom::Start(0));
    let _ = file.write_all(std::process::id().to_string().as_bytes());
}

fn read_pid(file: &mut File) -> Option<u32> {
    let mut text = String::new();
    file.seek(SeekFrom::Start(0)).ok()?;
    file.take(32).read_to_string(&mut text).ok()?;
    text.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAME: &str = ".excalidraw-vault.lock";

    fn root() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let r = dunce::canonicalize(t.path()).unwrap();
        (t, r)
    }

    #[test]
    fn reopening_in_the_same_process_shares_the_lock() {
        let (_t, r) = root();
        let reg = LockRegistry::default();
        let first = reg.acquire(&r, NAME);
        let second = reg.acquire(&r, NAME);
        assert!(first.lock.is_some() && first.reason.is_none());
        assert!(second.lock.is_some(), "second open in one process must stay writable");
        assert!(Arc::ptr_eq(first.lock.as_ref().unwrap(), second.lock.as_ref().unwrap()));
    }

    #[test]
    fn dropping_every_handle_releases_the_flock() {
        let (_t, r) = root();
        let reg = LockRegistry::default();
        let a = reg.acquire(&r, NAME).lock;
        let b = reg.acquire(&r, NAME).lock;
        let other = File::open(r.join(NAME)).unwrap();
        drop(a);
        assert!(other.try_lock_exclusive().is_err(), "a live handle keeps the lock");
        drop(b);
        assert!(other.try_lock_exclusive().is_ok(), "last handle gone: lock released");
    }

    #[test]
    fn another_process_holding_the_lock_is_reported_with_its_pid() {
        let (_t, r) = root();
        // A second registry stands in for another process: its flock is on a
        // different open file description, exactly like a separate process.
        let other_process = LockRegistry::default();
        let held = other_process.acquire(&r, NAME);
        assert!(held.lock.is_some());
        let outcome = LockRegistry::default().acquire(&r, NAME);
        assert!(outcome.lock.is_none());
        assert_eq!(outcome.reason, Some(ReadOnlyReason::LockedByOtherProcess));
        assert_eq!(outcome.holder_pid, Some(std::process::id()));
        drop(held);
        let retry = LockRegistry::default().acquire(&r, NAME);
        assert!(retry.lock.is_some(), "retry succeeds once the other process lets go");
    }

    #[cfg(unix)]
    #[test]
    fn read_only_folder_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let (_t, r) = root();
        fs::set_permissions(&r, fs::Permissions::from_mode(0o555)).unwrap();
        let outcome = LockRegistry::default().acquire(&r, NAME);
        fs::set_permissions(&r, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(outcome.lock.is_none());
        assert_eq!(outcome.reason, Some(ReadOnlyReason::NotWritable));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_lock_file_is_refused() {
        let (_t, r) = root();
        let target = r.join("elsewhere");
        fs::write(&target, b"").unwrap();
        std::os::unix::fs::symlink(&target, r.join(NAME)).unwrap();
        assert!(open_lock_file(&r.join(NAME)).is_err());
        let outcome = LockRegistry::default().acquire(&r, NAME);
        assert_eq!(outcome.reason, Some(ReadOnlyReason::LockUnavailable));
    }
}
