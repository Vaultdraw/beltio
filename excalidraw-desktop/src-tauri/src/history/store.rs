//! On-disk access for `<vault>/.excalidraw-vault/history/`: the checked path builder (a
//! `symlink_metadata` check on every directory level), `O_NOFOLLOW` reads with hard caps, durable
//! writes (`.<final>.tmp` → fsync → rename), free-space guard, and the platform calls
//! (`clonefile`, `fcntl` fsync flavours) declared by hand (D8: no libc crate).
//!
//! Synced history is untrusted input (M13): every name is validated by the callers before it is
//! joined here, anything unexpected is ignored and never deleted (except our own `.tmp` files).

use super::names::{BlobName, VersionName};
use crate::{err, ioerr, META_DIR, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub const HISTORY_DIR: &str = "history";
pub const BLOBS_DIR: &str = "blobs";
pub const FORMAT_MARKER: &str = "format-1";
/// Own in-flight `.tmp` files older than this are leftovers of a crash.
pub const TMP_MAX_AGE: Duration = Duration::from_secs(10 * 60);
pub const MAX_BODY_BYTES: u64 = crate::MAX_DRAWING_BYTES;
/// A header frame is at most 64 KiB plus the 8-byte prefix.
pub const MAX_HEADER_FILE_PREFIX: usize = super::container::MAX_HEADER_BYTES + super::container::PREFIX_LEN;
const FREE_FLOOR_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const ENOSPC: i32 = 28;

// ---------------------------------------------------------------------------------------------
// Fault injection (tests only). In release builds `hit` compiles to `Ok(())`.
// ---------------------------------------------------------------------------------------------

/// Every durable step a history write goes through; tests inject failures at each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Clone,
    BlobTmp,
    BlobSync,
    BlobRename,
    VersionTmp,
    VersionSync,
    VersionRename,
    DirSync,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaultKind {
    Enospc,
    Io,
    /// Simulated process death: the error is returned and the temp file is left behind.
    Crash,
}

#[cfg(test)]
pub(crate) mod fault {
    use super::*;
    use std::cell::RefCell;
    thread_local! { static PLAN: RefCell<Option<(Step, u32, FaultKind)>> = const { RefCell::new(None) }; }
    /// Fails the `nth` (0-based) time `step` is reached on this thread.
    pub fn arm(step: Step, nth: u32, kind: FaultKind) {
        PLAN.with(|p| *p.borrow_mut() = Some((step, nth, kind)));
    }
    pub fn clear() {
        PLAN.with(|p| *p.borrow_mut() = None);
    }
    pub fn hit(step: Step) -> io::Result<()> {
        PLAN.with(|p| {
            let mut p = p.borrow_mut();
            let Some((s, n, kind)) = *p else { return Ok(()) };
            if s != step {
                return Ok(());
            }
            if n > 0 {
                *p = Some((s, n - 1, kind));
                return Ok(());
            }
            *p = None;
            Err(match kind {
                FaultKind::Enospc => io::Error::from_raw_os_error(ENOSPC),
                FaultKind::Io => io::Error::other("injected io failure"),
                FaultKind::Crash => io::Error::other(CRASH_MARK),
            })
        })
    }
}
#[cfg(not(test))]
pub(crate) mod fault {
    use super::*;
    #[inline(always)]
    pub fn hit(_: Step) -> io::Result<()> {
        Ok(())
    }
}
const CRASH_MARK: &str = "injected crash";
fn is_crash(e: &io::Error) -> bool {
    e.to_string() == CRASH_MARK
}

pub fn is_enospc(e: &io::Error) -> bool {
    e.raw_os_error() == Some(ENOSPC)
}

// ---------------------------------------------------------------------------------------------
// Platform calls
// ---------------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod sys {
    use std::ffi::{c_char, c_int};
    extern "C" {
        pub fn clonefile(src: *const c_char, dst: *const c_char, flags: u32) -> c_int;
        pub fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
    }
    pub const F_FULLFSYNC: c_int = 51;
    pub const F_BARRIERFSYNC: c_int = 85;
    pub const O_NOFOLLOW: i32 = 0x0100;
    pub const SF_DATALESS: u32 = 0x4000_0000;
}

#[cfg(target_os = "macos")]
const O_NOFOLLOW: i32 = sys::O_NOFOLLOW;
#[cfg(all(not(target_os = "macos"), target_arch = "aarch64"))]
const O_NOFOLLOW: i32 = 0o100000;
#[cfg(all(not(target_os = "macos"), not(target_arch = "aarch64")))]
const O_NOFOLLOW: i32 = 0o400000;

/// `clonefile(src → dst)` (APFS copy-on-write clone, size-independent). `ENOTSUP`/`EXDEV` mean
/// this volume pair can't clone: staging is unsupported there.
pub fn clone_file(src: &Path, dst: &Path) -> io::Result<()> {
    fault::hit(Step::Clone)?;
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let c = |p: &Path| std::ffi::CString::new(p.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput));
        let (s, d) = (c(src)?, c(dst)?);
        // SAFETY: both pointers are valid NUL-terminated strings for the duration of the call.
        if unsafe { sys::clonefile(s.as_ptr(), d.as_ptr(), 0) } == 0 {
            return Ok(());
        }
        Err(io::Error::last_os_error())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (src, dst);
        Err(io::Error::from(io::ErrorKind::Unsupported))
    }
}

pub fn clone_unsupported(e: &io::Error) -> bool {
    // ENOTSUP (45 on macOS) and EXDEV (18); `Unsupported` for non-macOS builds.
    e.kind() == io::ErrorKind::Unsupported || matches!(e.raw_os_error(), Some(45) | Some(18) | Some(102))
}

/// Flushes `f`: `F_FULLFSYNC` when `full`, else `F_BARRIERFSYNC` (ordering without the full flush).
pub fn sync_file(f: &File, full: bool) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        let cmd = if full { sys::F_FULLFSYNC } else { sys::F_BARRIERFSYNC };
        // SAFETY: plain fcntl on a valid open descriptor.
        if unsafe { sys::fcntl(f.as_raw_fd(), cmd) } == 0 {
            return Ok(());
        }
    }
    let _ = full;
    f.sync_all()
}

pub fn sync_dir(dir: &Path) -> io::Result<()> {
    fault::hit(Step::DirSync)?;
    sync_file(&File::open(dir)?, true)
}

pub use vaultdraw_core::staging::volume_case_sensitive;

pub fn is_dataless(md: &fs::Metadata) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        md.st_flags() & sys::SF_DATALESS != 0
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = md;
        false
    }
}

/// `max(2 GB, 3% of the volume)` (M11).
pub fn free_floor(total: u64) -> u64 {
    FREE_FLOOR_BYTES.max(total / 100 * 3)
}

/// Whether the volume holding `path` has more than the floor free. Unknown = true (never block on a
/// failed probe).
pub fn free_space_ok(path: &Path) -> bool {
    match (fs2::available_space(path), fs2::total_space(path)) {
        (Ok(free), Ok(total)) => free > free_floor(total),
        _ => true,
    }
}

// ---------------------------------------------------------------------------------------------
// Checked paths and bounded reads
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Store {
    pub root: PathBuf,
    pub hist: PathBuf,
}

/// `Ok(true)` for a real directory, `Ok(false)` when missing; symlinks and files are errors.
fn real_dir(p: &Path) -> Result<bool> {
    match fs::symlink_metadata(p) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => Err(err("INVALID_PATH", "History path is not a real directory")),
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(ioerr(e)),
    }
}

impl Store {
    pub fn new(root: &Path) -> Store {
        Store { root: root.to_path_buf(), hist: root.join(META_DIR).join(HISTORY_DIR) }
    }

    /// The directory `history/<parts…>`, every level checked (no symlinks). `Ok(None)` when it
    /// doesn't exist and `create` is false. `parts` must already be validated names.
    pub fn dir(&self, parts: &[&str], create: bool) -> Result<Option<PathBuf>> {
        let mut cur = self.root.join(META_DIR);
        let levels = std::iter::once(HISTORY_DIR).chain(parts.iter().copied());
        if !real_dir(&cur)? {
            if !create {
                return Ok(None);
            }
            create_dir_ok(&cur)?;
            real_dir(&cur)?;
        }
        for part in levels {
            cur.push(part);
            if !real_dir(&cur)? {
                if !create {
                    return Ok(None);
                }
                create_dir_ok(&cur)?;
                real_dir(&cur)?;
            }
        }
        Ok(Some(cur))
    }

    /// Creates `history/`, `history/blobs/` and the create-only `format-1` marker.
    pub fn ensure_layout(&self) -> Result<()> {
        let hist = self.dir(&[], true)?.ok_or_else(|| err("INTERNAL", "History directory unavailable"))?;
        self.dir(&[BLOBS_DIR], true)?;
        match OpenOptions::new().write(true).create_new(true).custom_flags(O_NOFOLLOW).open(hist.join(FORMAT_MARKER)) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(ioerr(e)),
        }
    }

    /// A `format-N` marker with N > 1 means a newer app owns this history: read-only for us.
    pub fn format_newer(&self) -> bool {
        let Ok(rd) = fs::read_dir(&self.hist) else { return false };
        rd.flatten().any(|e| {
            e.file_name().to_str().and_then(|n| n.strip_prefix("format-")).and_then(|n| n.parse::<u32>().ok()).is_some_and(|n| n > 1)
        })
    }

    pub fn lineage_dir(&self, lineage: &str, create: bool) -> Result<Option<PathBuf>> {
        self.dir(&[lineage], create)
    }

    pub fn blob_dir(&self, shard: &str, create: bool) -> Result<Option<PathBuf>> {
        self.dir(&[BLOBS_DIR, shard], create)
    }

    /// Own current-epoch blob copy exists (a `stat`, B1).
    pub fn blob_exists(&self, name: &BlobName) -> bool {
        match self.blob_dir(name.shard(), false) {
            Ok(Some(d)) => fs::symlink_metadata(d.join(name.format())).is_ok_and(|m| m.is_file()),
            _ => false,
        }
    }

    pub fn write_blob(&self, name: &BlobName, bytes: &[u8], full: bool) -> io::Result<()> {
        let existed = full && matches!(self.blob_dir(name.shard(), false), Ok(Some(_)));
        let dir = self.blob_dir(name.shard(), true).ok().flatten().ok_or_else(|| io::Error::other("blob directory unavailable"))?;
        if full && !existed {
            sync_dir(&self.hist.join(BLOBS_DIR))?;
        }
        durable_write(&dir, &name.format(), bytes, full, WriteKind::Blob)
    }

    pub fn write_version(&self, lineage: &str, name: &VersionName, bytes: &[u8], full: bool) -> io::Result<()> {
        let existed = full && matches!(self.lineage_dir(lineage, false), Ok(Some(_)));
        let dir = self.lineage_dir(lineage, true).ok().flatten().ok_or_else(|| io::Error::other("lineage directory unavailable"))?;
        // A new folder's own directory entry must be durable too, or a synced-to-disk checkpoint
        // vanishes with its folder after a power loss.
        if full && !existed {
            sync_dir(&self.hist)?;
        }
        durable_write(&dir, &name.format(), bytes, full, WriteKind::Version)
    }

    pub fn version_path(&self, lineage: &str, name: &VersionName) -> PathBuf {
        self.hist.join(lineage).join(name.format())
    }

    /// First bytes of a version file (the header frame normally fits in 4 KiB; longer headers are
    /// read in full up to the 64 KiB cap).
    pub fn read_prefix(&self, lineage: &str, name: &VersionName) -> io::Result<Vec<u8>> {
        let f = open_regular(&self.version_path(lineage, name))?;
        let mut buf = vec![0u8; 4096];
        let n = read_full(&f, &mut buf)?;
        buf.truncate(n);
        if let Ok(len) = super::container::header_len(&buf) {
            let want = (super::container::PREFIX_LEN + len).min(MAX_HEADER_FILE_PREFIX);
            if want > buf.len() {
                let mut big = vec![0u8; want];
                let f = open_regular(&self.version_path(lineage, name))?;
                let n = read_full(&f, &mut big)?;
                big.truncate(n);
                return Ok(big);
            }
        }
        Ok(buf)
    }

    pub fn read_version_file(&self, lineage: &str, name: &VersionName) -> io::Result<Vec<u8>> {
        read_capped(&self.version_path(lineage, name), MAX_BODY_BYTES + MAX_HEADER_FILE_PREFIX as u64)
    }

    /// Bytes of any device's copy of `<sha>.<ext>`, verified against the sha (a corrupt or
    /// partial copy is skipped in favour of another one).
    pub fn read_blob_any(&self, sha_ext: &str) -> Result<Vec<u8>> {
        use sha2::{Digest, Sha256};
        if !super::names::is_sha_ext(sha_ext) {
            return Err(err("INVALID_ARGUMENT", "Invalid blob name"));
        }
        let sha = &sha_ext[..64];
        let dir = match self.blob_dir(&sha[..2], false)? {
            Some(d) => d,
            None => return Err(err("VERSION_GONE", "Image is not available")),
        };
        let mut names: Vec<String> = fs::read_dir(&dir)
            .map_err(ioerr)?
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| BlobName::parse(n).is_some_and(|b| b.sha_ext() == sha_ext))
            .collect();
        names.sort();
        for n in names {
            let Ok(bytes) = read_capped(&dir.join(&n), crate::clipboard::MAX_PAYLOAD_BYTES as u64) else { continue };
            if hex::encode(Sha256::digest(&bytes)) == sha {
                return Ok(bytes);
            }
        }
        Err(err("VERSION_GONE", "Image is not available"))
    }

    /// Deletes one version file (validated name, symlink-checked directory, regular file only).
    /// `Ok(false)` when it was already gone (another device deleted it).
    pub fn remove_version(&self, lineage: &str, name: &VersionName) -> io::Result<bool> {
        let dir = self.lineage_dir(lineage, false).map_err(|e| io::Error::other(e.message))?;
        match dir {
            Some(d) => remove_regular(&d.join(name.format())),
            None => Ok(false),
        }
    }

    /// Deletes one blob copy (same rules as `remove_version`).
    pub fn remove_blob(&self, name: &BlobName) -> io::Result<bool> {
        match self.blob_dir(name.shard(), false).map_err(|e| io::Error::other(e.message))? {
            Some(d) => remove_regular(&d.join(name.format())),
            None => Ok(false),
        }
    }

    /// Best effort: removes the lineage folder when nothing is left in it (an unknown or invalid
    /// file keeps it; those are never deleted).
    pub fn remove_lineage_dir_if_empty(&self, lineage: &str) {
        if let Ok(Some(d)) = self.lineage_dir(lineage, false) {
            let _ = fs::remove_dir(d);
        }
    }

    /// Best effort: removes an empty blob shard folder.
    pub fn remove_blob_shard_if_empty(&self, shard: &str) {
        if let Ok(Some(d)) = self.blob_dir(shard, false) {
            let _ = fs::remove_dir(d);
        }
    }

    /// Removes our own `.<final>.tmp` leftovers older than `older_than` in `dir` (never anything else).
    pub fn clean_own_tmp(dir: &Path, dev: &str, older_than: Duration) -> usize {
        let Ok(rd) = fs::read_dir(dir) else { return 0 };
        let mut removed = 0;
        for e in rd.flatten() {
            let Ok(file) = e.file_name().into_string() else { continue };
            let Some(final_name) = file.strip_prefix('.').and_then(|n| n.strip_suffix(".tmp")) else { continue };
            let own = VersionName::parse(final_name).is_some_and(|n| n.dev == dev) || BlobName::parse(final_name).is_some_and(|b| b.dev == dev);
            if !own {
                continue;
            }
            let old = e.metadata().ok().filter(|m| m.is_file()).and_then(|m| m.modified().ok()).is_some_and(|t| SystemTime::now().duration_since(t).unwrap_or_default() >= older_than);
            if old && fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
        removed
    }
}

/// Removes this device's stale `.tmp` files (older than `older_than`) from every lineage folder and
/// blob shard. Returns how many were removed.
pub fn cleanup_own_tmp(store: &Store, dev: &str, older_than: Duration) -> usize {
    let mut n = 0;
    let Ok(rd) = fs::read_dir(&store.hist) else { return 0 };
    for e in rd.flatten() {
        let Ok(name) = e.file_name().into_string() else { continue };
        if super::names::is_ulid(&name) && e.file_type().is_ok_and(|t| t.is_dir()) {
            n += Store::clean_own_tmp(&e.path(), dev, older_than);
        }
    }
    if let Ok(rd) = fs::read_dir(store.hist.join(BLOBS_DIR)) {
        for e in rd.flatten() {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                n += Store::clean_own_tmp(&e.path(), dev, older_than);
            }
        }
    }
    n
}

/// Unlinks a regular file (never a symlink or folder). `Ok(false)` when it doesn't exist.
fn remove_regular(p: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_file() => match fs::remove_file(p) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e),
        },
        Ok(_) => Err(io::Error::other("not a regular file")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

fn create_dir_ok(p: &Path) -> Result<()> {
    match fs::create_dir(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(ioerr(e)),
    }
}

/// Opens a regular file without following a final symlink.
pub fn open_regular(p: &Path) -> io::Result<File> {
    let f = OpenOptions::new().read(true).custom_flags(O_NOFOLLOW).open(p)?;
    if !f.metadata()?.is_file() {
        return Err(io::Error::other("not a regular file"));
    }
    Ok(f)
}

fn read_full(mut f: &File, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

/// Reads at most `cap` bytes; a longer file is an error (bounded reads only).
pub fn read_capped(p: &Path, cap: u64) -> io::Result<Vec<u8>> {
    let f = open_regular(p)?;
    let len = f.metadata()?.len();
    if len > cap {
        return Err(io::Error::other("file exceeds its size limit"));
    }
    let mut out = Vec::with_capacity(len as usize);
    f.take(cap + 1).read_to_end(&mut out)?;
    if out.len() as u64 > cap {
        return Err(io::Error::other("file exceeds its size limit"));
    }
    Ok(out)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WriteKind {
    Blob,
    Version,
}

/// `.<name>.tmp` (create-new, never follows a symlink) → fsync → rename onto `name`; a full sync
/// (F_FULLFSYNC + directory fsync) for user-intent versions, a barrier fsync for automatic ones.
/// On failure the temp file is removed (unless a crash is being simulated).
pub fn durable_write(dir: &Path, name: &str, bytes: &[u8], full: bool, kind: WriteKind) -> io::Result<()> {
    let (s_tmp, s_sync, s_rename) = match kind {
        WriteKind::Blob => (Step::BlobTmp, Step::BlobSync, Step::BlobRename),
        WriteKind::Version => (Step::VersionTmp, Step::VersionSync, Step::VersionRename),
    };
    let tmp = dir.join(format!(".{name}.tmp"));
    let result = (|| -> io::Result<()> {
        fault::hit(s_tmp)?;
        let mut f = match OpenOptions::new().write(true).create_new(true).custom_flags(O_NOFOLLOW).open(&tmp) {
            Ok(f) => f,
            // Blob names are content-addressed, so their temp name repeats: a leftover of a killed
            // write (younger than the startup cleanup age) would block every retry. It is ours
            // (own device in the name) and the content is identical by construction.
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && kind == WriteKind::Blob => {
                fs::remove_file(&tmp)?;
                OpenOptions::new().write(true).create_new(true).custom_flags(O_NOFOLLOW).open(&tmp)?
            }
            Err(e) => return Err(e),
        };
        f.write_all(bytes)?;
        fault::hit(s_sync)?;
        sync_file(&f, full)?;
        drop(f);
        fault::hit(s_rename)?;
        fs::rename(&tmp, dir.join(name))?;
        if full {
            sync_dir(dir)?;
        }
        Ok(())
    })();
    if let Err(e) = &result {
        if !is_crash(e) {
            let _ = fs::remove_file(&tmp);
        }
    }
    result
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn checked_dirs_refuse_symlinks_and_files() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path());
        assert!(store.dir(&[], false).unwrap().is_none());
        store.ensure_layout().unwrap();
        store.ensure_layout().unwrap();
        assert!(store.hist.join(FORMAT_MARKER).is_file());
        assert!(store.dir(&[BLOBS_DIR, "ab"], true).unwrap().is_some());
        // a symlinked lineage folder is refused
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), store.hist.join("LINK")).unwrap();
        assert_eq!(store.dir(&["LINK"], true).unwrap_err().code, "INVALID_PATH");
        // a file where a directory belongs is refused
        fs::write(store.hist.join("FILE"), b"x").unwrap();
        assert_eq!(store.dir(&["FILE"], false).unwrap_err().code, "INVALID_PATH");
        // a symlinked history/ itself is refused
        let r2 = tempfile::tempdir().unwrap();
        fs::create_dir(r2.path().join(META_DIR)).unwrap();
        std::os::unix::fs::symlink(outside.path(), r2.path().join(META_DIR).join(HISTORY_DIR)).unwrap();
        assert!(Store::new(r2.path()).ensure_layout().is_err());
    }

    #[test]
    fn nofollow_open_refuses_symlinked_files_and_caps_size() {
        let d = tempfile::tempdir().unwrap();
        let real = d.path().join("real");
        fs::write(&real, vec![1u8; 100]).unwrap();
        std::os::unix::fs::symlink(&real, d.path().join("link")).unwrap();
        assert!(open_regular(&d.path().join("link")).is_err());
        assert_eq!(read_capped(&real, 100).unwrap().len(), 100);
        assert!(read_capped(&real, 99).is_err());
    }

    #[test]
    fn durable_write_is_atomic_and_cleans_up_on_failure() {
        let d = tempfile::tempdir().unwrap();
        durable_write(d.path(), "a.bin", b"hello", false, WriteKind::Version).unwrap();
        durable_write(d.path(), "b.bin", b"hello", true, WriteKind::Blob).unwrap();
        assert_eq!(fs::read(d.path().join("a.bin")).unwrap(), b"hello");
        for step in [Step::VersionTmp, Step::VersionSync, Step::VersionRename] {
            fault::arm(step, 0, FaultKind::Enospc);
            let e = durable_write(d.path(), "c.bin", b"x", false, WriteKind::Version).unwrap_err();
            assert!(is_enospc(&e));
            assert!(!d.path().join("c.bin").exists());
            assert!(!d.path().join(".c.bin.tmp").exists(), "{step:?}");
        }
        fault::arm(Step::VersionRename, 0, FaultKind::Crash);
        assert!(durable_write(d.path(), "c.bin", b"x", false, WriteKind::Version).is_err());
        assert!(d.path().join(".c.bin.tmp").exists(), "a crash leaves the temp file");
        fault::clear();
    }

    #[test]
    fn free_floor_is_two_gb_or_three_percent() {
        assert_eq!(free_floor(100 * 1024 * 1024 * 1024), 3 * (100 * 1024 * 1024 * 1024 / 100));
        assert_eq!(free_floor(10 * 1024 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
    }
}
