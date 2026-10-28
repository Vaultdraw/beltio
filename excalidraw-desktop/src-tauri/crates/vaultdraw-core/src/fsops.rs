//! Atomic file writes, bounded reads, revision of a file on disk, folder create and move.

use crate::error::{err, ioerr, Result};
use crate::paths::{random_id, revision_of_reader, safe_path, MAX_DRAWING_BYTES};
use serde::Deserialize;
use std::{
    borrow::Cow,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

/// Full Unicode case folding plus normalisation, so `Été`, `été` and the decomposed `e` + accent
/// forms are one name (APFS and most sync tools treat them as the same name).
pub fn fold_name(name: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    name.nfc().collect::<String>().to_lowercase().nfc().collect()
}

/// True when both paths are the same file or folder (same device and inode): a case-only rename.
pub fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (fs::canonicalize(a), fs::canonicalize(b)) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
    }
}

pub fn ensure_no_sibling_collision(path: &Path) -> Result<()> {
    ensure_no_sibling_collision_except(path, None)
}

/// Refuses a name that folds to an existing sibling's name. `except` is the entry being renamed:
/// it is the same file, so a case-only rename of it is allowed.
pub fn ensure_no_sibling_collision_except(path: &Path, except: Option<&Path>) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "Entry has no parent"))?;
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Err(err("INVALID_PATH", "Invalid entry name"));
    };
    if !parent.is_dir() {
        return Err(err("NOT_FOUND", "Parent directory not found"));
    }
    let want = fold_name(name);
    for item in fs::read_dir(parent).map_err(ioerr)? {
        let item = item.map_err(ioerr)?;
        if fold_name(&item.file_name().to_string_lossy()) != want {
            continue;
        }
        if except.is_some_and(|src| same_file(src, &item.path())) {
            continue;
        }
        return Err(err(
            "NAME_COLLISION",
            format!(
                "A file named '{}' already exists here (names that differ only in capitals or accents count as the same)",
                item.file_name().to_string_lossy()
            ),
        ));
    }
    Ok(())
}

fn is_unsupported(e: &std::io::Error) -> bool {
    matches!(
        e.raw_os_error(),
        Some(c) if c == libc_codes::ENOTSUP || c == libc_codes::EINVAL || c == libc_codes::ENOSYS
    )
}
#[cfg(unix)]
mod libc_codes {
    pub const ENOTSUP: i32 = libc::ENOTSUP;
    pub const EINVAL: i32 = libc::EINVAL;
    pub const ENOSYS: i32 = libc::ENOSYS;
}
#[cfg(not(unix))]
mod libc_codes {
    pub const ENOTSUP: i32 = -1;
    pub const EINVAL: i32 = -1;
    pub const ENOSYS: i32 = -1;
}

/// The kernel's own no-replace rename: fails with `AlreadyExists` instead of replacing `dst`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn rename_excl(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let s = CString::new(src.as_os_str().as_bytes()).map_err(|_| std::io::ErrorKind::InvalidInput)?;
    let d = CString::new(dst.as_os_str().as_bytes()).map_err(|_| std::io::ErrorKind::InvalidInput)?;
    #[cfg(target_os = "macos")]
    let rc = unsafe { libc::renamex_np(s.as_ptr(), d.as_ptr(), libc::RENAME_EXCL) };
    #[cfg(target_os = "linux")]
    let rc = unsafe {
        libc::syscall(libc::SYS_renameat2, libc::AT_FDCWD, s.as_ptr(), libc::AT_FDCWD, d.as_ptr(), 1u32 /* RENAME_NOREPLACE */) as i32
    };
    if rc == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn rename_excl(_src: &Path, _dst: &Path) -> std::io::Result<()> {
    Err(std::io::Error::from_raw_os_error(libc_codes::ENOTSUP))
}

/// Last resort for file systems without no-replace rename: claim the destination name
/// exclusively (`O_EXCL` file, or `mkdir` for a folder), then rename over our own placeholder.
pub fn rename_via_claim(src: &Path, dst: &Path) -> std::io::Result<()> {
    let is_dir = fs::symlink_metadata(src)?.is_dir();
    if is_dir { fs::create_dir(dst)?; } else { OpenOptions::new().write(true).create_new(true).open(dst)?; }
    fs::rename(src, dst).inspect_err(|_| {
        let _ = if is_dir { fs::remove_dir(dst) } else { fs::remove_file(dst) };
    })
}

/// Renames without ever replacing an existing `dst` (`AlreadyExists` instead).
pub fn rename_no_replace(src: &Path, dst: &Path) -> std::io::Result<()> {
    match rename_excl(src, dst) {
        Err(e) if is_unsupported(&e) => rename_via_claim(src, dst),
        r => r,
    }
}

/// No-clobber commit of a finished temp file: a hard link (atomic), or on file systems without
/// hard links (exFAT, FAT) the exclusive rename. The temp file is gone afterwards.
pub fn commit_no_clobber(temp: &Path, path: &Path) -> std::io::Result<()> {
    commit_no_clobber_with(temp, path, |t, p| fs::hard_link(t, p))
}
pub fn commit_no_clobber_with(temp: &Path, path: &Path, link: impl FnOnce(&Path, &Path) -> std::io::Result<()>) -> std::io::Result<()> {
    match link(temp, path) {
        Ok(()) => fs::remove_file(temp),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(e),
        Err(_) => rename_no_replace(temp, path),
    }
}

/// True when the user made the file read-only: a mode without write bits, or Finder "Locked".
pub fn metadata_read_only(md: &fs::Metadata) -> bool {
    #[allow(unused_mut)]
    let mut locked = md.permissions().readonly();
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        locked |= md.st_flags() & 0x2 /* UF_IMMUTABLE */ != 0;
    }
    locked
}
/// Refuses to overwrite a file the user made read-only (mode without write bits, or Finder "Locked").
pub fn ensure_file_writable(path: &Path) -> Result<()> {
    let Ok(md) = fs::metadata(path) else { return Ok(()) };
    if metadata_read_only(&md) {
        return Err(err("READ_ONLY", "This file is read-only; make it writable to save"));
    }
    Ok(())
}

/// Gives the new file the old file's mode and extended attributes (Finder tags, labels), best effort.
pub fn copy_file_attrs(old: &Path, new: &Path, new_file: &File) {
    if let Ok(md) = fs::metadata(old) {
        let _ = new_file.set_permissions(md.permissions());
    }
    copy_xattrs(old, new);
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn copy_xattrs(old: &Path, new: &Path) {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let (Ok(o), Ok(n)) = (CString::new(old.as_os_str().as_bytes()), CString::new(new.as_os_str().as_bytes())) else { return };
    unsafe {
        #[cfg(target_os = "macos")]
        let list = |buf: *mut libc::c_char, len: usize| libc::listxattr(o.as_ptr(), buf, len, libc::XATTR_NOFOLLOW);
        #[cfg(target_os = "linux")]
        let list = |buf: *mut libc::c_char, len: usize| libc::llistxattr(o.as_ptr(), buf, len);
        let size = list(std::ptr::null_mut(), 0);
        if size <= 0 { return; }
        let mut names = vec![0u8; size as usize];
        let got = list(names.as_mut_ptr() as *mut libc::c_char, names.len());
        if got <= 0 { return; }
        for name in names[..got as usize].split(|b| *b == 0).filter(|n| !n.is_empty()) {
            let Ok(name) = CString::new(name) else { continue };
            #[cfg(target_os = "macos")]
            let get = |buf: *mut libc::c_void, len: usize| libc::getxattr(o.as_ptr(), name.as_ptr(), buf, len, 0, libc::XATTR_NOFOLLOW);
            #[cfg(target_os = "linux")]
            let get = |buf: *mut libc::c_void, len: usize| libc::lgetxattr(o.as_ptr(), name.as_ptr(), buf, len);
            let vsize = get(std::ptr::null_mut(), 0);
            if vsize < 0 { continue; }
            let mut value = vec![0u8; vsize as usize];
            let vgot = get(value.as_mut_ptr() as *mut libc::c_void, value.len());
            if vgot < 0 { continue; }
            #[cfg(target_os = "macos")]
            libc::setxattr(n.as_ptr(), name.as_ptr(), value.as_ptr() as *const libc::c_void, vgot as usize, 0, libc::XATTR_NOFOLLOW);
            #[cfg(target_os = "linux")]
            libc::lsetxattr(n.as_ptr(), name.as_ptr(), value.as_ptr() as *const libc::c_void, vgot as usize, 0);
        }
    }
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn copy_xattrs(_old: &Path, _new: &Path) {}

/// Only the field the validator needs; serde skips (but still syntax-checks) the rest,
/// so a large scene is validated without building a `serde_json::Value` tree.
#[derive(Deserialize)]
struct SceneProbe<'a> {
    #[serde(rename = "type")]
    kind: Option<Cow<'a, str>>,
}
pub fn ensure_json(json: &str) -> Result<()> {
    if json.len() as u64 > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "Drawing exceeds the 32 MiB limit"));
    }
    let probe: SceneProbe = serde_json::from_str(json)
        .map_err(|e| err("INVALID_FILE", format!("Invalid JSON: {e}")))?;
    // A derived struct also accepts a JSON array, so require an object explicitly.
    if !json.trim_start().starts_with('{') || probe.kind.as_deref() != Some("excalidraw") {
        return Err(err("INVALID_FILE", "Drawing JSON must be an Excalidraw scene object"));
    }
    Ok(())
}
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(bytes)?;
        // The swapped-in file keeps the old file's mode and extended attributes (Finder tags).
        if path.exists() {
            copy_file_attrs(path, &temp, &f);
        }
        f.sync_all()?;
        // Same-directory rename is atomic on the primary macOS target. Windows replacement
        // may refuse existing destinations; fail closed rather than remove the source first.
        fs::rename(&temp, path)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(ioerr)
}
pub fn write_atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    write_atomic_new_with(path, |f| f.write_all(bytes))
}
/// No-clobber atomic create where `fill` streams the content into the temp file.
pub fn write_atomic_new_with(path: &Path, fill: impl FnOnce(&mut File) -> std::io::Result<()>) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        fill(&mut f)?;
        f.sync_all()?;
        // A hard link is an atomic no-clobber commit; exFAT/FAT fall back to the exclusive rename.
        commit_no_clobber(&temp, path)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            err("NAME_COLLISION", "Destination already exists")
        } else {
            ioerr(e)
        }
    })
}
pub fn current_revision(path: &Path) -> Result<Option<String>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ioerr(e)),
    };
    let (rev, total) = revision_of_reader(file.take(MAX_DRAWING_BYTES + 1)).map_err(ioerr)?;
    if total > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(Some(rev))
}
/// What a stat says about a file at one moment: size, modification time, device and inode.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Stamp { size: u64, mtime: Option<std::time::SystemTime>, ctime: (i64, i64), id: (u64, u64) }
impl Stamp {
    fn of(md: &fs::Metadata) -> Stamp {
        #[cfg(unix)]
        let (id, ctime) = { use std::os::unix::fs::MetadataExt; ((md.dev(), md.ino()), (md.ctime(), md.ctime_nsec())) };
        #[cfg(not(unix))]
        let (id, ctime) = ((0, 0), (0, 0));
        Stamp { size: md.len(), mtime: md.modified().ok(), ctime, id }
    }
}
/// Window after a modification in which a second write can still leave the same modification time
/// (coarse file-system clocks); a file modified more recently than this is always re-hashed.
const RACY_WINDOW: std::time::Duration = std::time::Duration::from_millis(100);

/// Like `current_revision`, plus a stamp of the exact file that was hashed (taken from the open
/// handle, so it describes the bytes read) and whether it is old enough to trust later.
pub fn current_revision_stamped(path: &Path) -> Result<Option<(String, Option<Stamp>)>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ioerr(e)),
    };
    let md = file.metadata().map_err(ioerr)?;
    let local = local_fine_fs(&file);
    let (rev, total) = revision_of_reader(file.take(MAX_DRAWING_BYTES + 1)).map_err(ioerr)?;
    if total > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    let stamp = Stamp::of(&md);
    // A whole-second modification time hints at a coarse clock (FAT keeps 2 s, HFS+ 1 s): not trusted.
    let fine_clock = stamp.mtime.is_some_and(|m| m.duration_since(std::time::UNIX_EPOCH).is_ok_and(|d| d.subsec_nanos() != 0));
    let stable = fine_clock && local && stamp.mtime.is_some_and(|m| std::time::SystemTime::now().duration_since(m).is_ok_and(|age| age > RACY_WINDOW));
    Ok(Some((rev, stable.then_some(stamp))))
}
/// True only on local file systems with a fine-grained clock (APFS, ext4, btrfs, xfs, f2fs, tmpfs).
/// FAT/exFAT, HFS+, network drives and unknown file systems always re-hash.
pub fn local_fine_fs(file: &File) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::io::AsRawFd;
        let mut st: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstatfs(file.as_raw_fd(), &mut st) } != 0 { return false; }
        let name: Vec<u8> = st.f_fstypename.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
        name == b"apfs" && st.f_flags & (libc::MNT_LOCAL as u32) != 0
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::io::AsRawFd;
        let mut st: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstatfs(file.as_raw_fd(), &mut st) } != 0 { return false; }
        matches!(st.f_type as u64, 0xEF53 | 0x9123683E | 0x58465342 | 0xF2F52010 | 0x01021994)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { let _ = file; false }
}
/// True when the file at `path` still has exactly this stamp (same inode, size and modification time).
pub fn stamp_unchanged(path: &Path, stamp: &Stamp) -> bool {
    fs::metadata(path).is_ok_and(|md| &Stamp::of(&md) == stamp)
}
pub fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    File::open(path).map_err(ioerr)?.take(limit.saturating_add(1)).read_to_end(&mut data).map_err(ioerr)?;
    if data.len() as u64 > limit { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(data)
}
/// fsyncs directories (best effort), making renames into them durable.
pub fn sync_dirs<'a>(dirs: impl IntoIterator<Item = &'a PathBuf>) {
    for d in dirs { if let Ok(f) = File::open(d) { let _ = f.sync_all(); } }
}
/// Refuses a path with a dot-named component (`.obsidian`, `.trash`, `.git`): those are never written,
/// listed or watched, so a file or folder created there would silently vanish from the tree.
pub fn reject_hidden(path: &str) -> Result<()> {
    if crate::filekind::has_hidden_component(path) {
        return Err(err("INVALID_PATH", "Names starting with a dot are reserved and never listed or written"));
    }
    Ok(())
}
pub fn create_folder_at(root: &Path, path: &str) -> Result<()> {
    if path.is_empty() { return Err(err("INVALID_PATH", "Cannot create the vault root")); }
    reject_hidden(path)?;
    let p = safe_path(root, path, true)?;
    ensure_no_sibling_collision(&p)?;
    fs::create_dir(p).map_err(ioerr)
}
pub fn move_entry_paths(root: &Path, from: &str, to: &str) -> Result<()> {
    if from.is_empty() || to.is_empty() || from == to || to.starts_with(&format!("{from}/")) { return Err(err("INVALID_PATH", "Cannot move an entry into itself")); }
    reject_hidden(to)?;
    let src = safe_path(root, from, false)?;
    let dst = safe_path(root, to, true)?;
    if !src.exists() { return Err(err("NOT_FOUND", "Source entry not found")); }
    ensure_no_sibling_collision_except(&dst, Some(&src))?;
    if let Some(parent) = dst.parent() { if !parent.is_dir() { return Err(err("NOT_FOUND", "Destination folder not found")); } }
    // The same file under another spelling (case-only rename): a plain rename is safe. Anything else
    // goes through the kernel's no-replace rename, so a clash our name check missed never overwrites.
    if same_file(&src, &dst) { return fs::rename(src, dst).map_err(ioerr); }
    rename_no_replace(&src, &dst).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { err("NAME_COLLISION", format!("A file named '{}' already exists here (names that differ only in capitals or accents count as the same)", dst.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())) } else { ioerr(e) })
}

#[cfg(test)]
mod fs_safety_tests {
    use super::*;
    use tempfile::tempdir;

    const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

    fn setup(names: &[(&str, &str)]) -> tempfile::TempDir {
        let t = tempdir().unwrap();
        for (n, c) in names { fs::write(t.path().join(n), c).unwrap(); }
        t
    }

    #[test]
    fn rename_onto_accent_case_name_is_refused_and_keeps_both() {
        let t = setup(&[("été.excalidraw", "KEEP"), ("notes.excalidraw", "other")]);
        let e = move_entry_paths(t.path(), "notes.excalidraw", "Été.excalidraw").unwrap_err();
        assert_eq!(e.code, "NAME_COLLISION");
        assert_eq!(fs::read_to_string(t.path().join("été.excalidraw")).unwrap(), "KEEP");
        assert_eq!(fs::read_to_string(t.path().join("notes.excalidraw")).unwrap(), "other");
    }

    #[test]
    fn rename_onto_other_unicode_form_is_refused() {
        let nfc = "caf\u{e9}.excalidraw";
        let nfd = "cafe\u{301}.excalidraw";
        let t = setup(&[(nfc, "KEEP"), ("x.excalidraw", "other")]);
        assert_eq!(move_entry_paths(t.path(), "x.excalidraw", nfd).unwrap_err().code, "NAME_COLLISION");
        assert_eq!(fs::read_to_string(t.path().join(nfc)).unwrap(), "KEEP");
        assert_eq!(fold_name(nfc), fold_name(nfd));
    }

    #[test]
    fn case_only_rename_of_the_same_file_works() {
        let t = setup(&[("notes.excalidraw", "body")]);
        move_entry_paths(t.path(), "notes.excalidraw", "Notes.excalidraw").unwrap();
        let names: Vec<String> = fs::read_dir(t.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
        assert_eq!(names, vec!["Notes.excalidraw".to_string()]);
        assert_eq!(fs::read_to_string(t.path().join("Notes.excalidraw")).unwrap(), "body");
        // A decomposed-to-composed spelling of the same file is also a plain rename.
        fs::write(t.path().join("cafe\u{301}.md"), "x").unwrap();
        move_entry_paths(t.path(), "cafe\u{301}.md", "caf\u{e9}.md").unwrap();
    }

    #[test]
    fn rename_no_replace_never_replaces() {
        let t = setup(&[("a", "A"), ("b", "B")]);
        let (a, b) = (t.path().join("a"), t.path().join("b"));
        assert_eq!(rename_no_replace(&a, &b).unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&b).unwrap(), "B");
        // The claim fallback (file systems without no-replace rename) refuses too, and works when free.
        assert_eq!(rename_via_claim(&a, &b).unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&b).unwrap(), "B");
        let c = t.path().join("c");
        rename_via_claim(&a, &c).unwrap();
        assert_eq!(fs::read_to_string(&c).unwrap(), "A");
        assert!(!a.exists());
        // Folders too.
        fs::create_dir(t.path().join("d1")).unwrap();
        fs::create_dir(t.path().join("d2")).unwrap();
        assert!(rename_via_claim(&t.path().join("d1"), &t.path().join("d2")).is_err());
        rename_via_claim(&t.path().join("d1"), &t.path().join("d3")).unwrap();
    }

    #[test]
    fn create_falls_back_when_hard_links_are_unsupported() {
        let t = setup(&[("taken", "KEEP")]);
        let no_link = |_: &Path, _: &Path| -> std::io::Result<()> { Err(std::io::Error::from_raw_os_error(libc::EPERM)) };
        let temp = t.path().join("tmp1");
        fs::write(&temp, "NEW").unwrap();
        commit_no_clobber_with(&temp, &t.path().join("fresh"), no_link).unwrap();
        assert_eq!(fs::read_to_string(t.path().join("fresh")).unwrap(), "NEW");
        assert!(!temp.exists());
        // Existing destination: still refused, nothing replaced, temp left for the caller to remove.
        let temp2 = t.path().join("tmp2");
        fs::write(&temp2, "NEW2").unwrap();
        let e = commit_no_clobber_with(&temp2, &t.path().join("taken"), no_link).unwrap_err();
        assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(t.path().join("taken")).unwrap(), "KEEP");
    }

    #[cfg(unix)]
    #[test]
    fn saving_over_a_read_only_drawing_is_refused_and_mode_is_kept() {
        use std::os::unix::fs::PermissionsExt;
        use crate::{paths::revision, vault::Vault, write_drawing_file};
        let t = tempdir().unwrap();
        let v = Vault::new(t.path().canonicalize().unwrap(), "test".into(), false, None);
        let p = t.path().join("a.excalidraw");
        fs::write(&p, SCENE).unwrap();
        let rev = revision(SCENE.as_bytes());
        let next = SCENE.replace("\"version\":2", "\"version\":3");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
        let e = write_drawing_file(&v, "a.excalidraw", &next, Some(&rev), "op1").unwrap_err();
        assert_eq!(e.code, "READ_ONLY");
        assert_eq!(fs::read_to_string(&p).unwrap(), SCENE);
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o444);
        // A writable drawing keeps its mode across a save.
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        write_drawing_file(&v, "a.excalidraw", &next, Some(&rev), "op2").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), next);
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn save_keeps_finder_tags() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let t = setup(&[("a.excalidraw", SCENE)]);
        let p = t.path().join("a.excalidraw");
        let cp = CString::new(p.as_os_str().as_bytes()).unwrap();
        let name = CString::new("com.apple.metadata:_kMDItemUserTags").unwrap();
        let tag = b"bplist00-test";
        let rc = unsafe { libc::setxattr(cp.as_ptr(), name.as_ptr(), tag.as_ptr() as *const _, tag.len(), 0, 0) };
        assert_eq!(rc, 0);
        write_atomic(&p, SCENE.replace("2", "3").as_bytes()).unwrap();
        let mut buf = [0u8; 64];
        let n = unsafe { libc::getxattr(cp.as_ptr(), name.as_ptr(), buf.as_mut_ptr() as *mut _, buf.len(), 0, 0) };
        assert_eq!(&buf[..n.max(0) as usize], tag);
    }
}

#[cfg(test)]
mod stamp_tests {
    use super::*;

    #[test]
    fn stamp_is_trusted_only_for_an_old_unchanged_file() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a.excalidraw");
        fs::write(&p, "0123456789").unwrap();
        // Just written: inside the racy window, so no stamp is offered and the caller re-hashes.
        assert!(current_revision_stamped(&p).unwrap().unwrap().1.is_none());
        std::thread::sleep(RACY_WINDOW + std::time::Duration::from_millis(50));
        let (rev, stamp) = current_revision_stamped(&p).unwrap().unwrap();
        let stamp = stamp.expect("old file is stable");
        assert_eq!(Some(rev), current_revision(&p).unwrap());
        assert!(stamp_unchanged(&p, &stamp));
        // Same size, new content: the modification time moves, so the stamp no longer matches.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&p, "abcdefghij").unwrap();
        assert!(!stamp_unchanged(&p, &stamp));
        // ctime moves on metadata-only changes that keep size and mtime (permissions, utimes back-dating).
        let (_, s2) = { std::thread::sleep(RACY_WINDOW + std::time::Duration::from_millis(50)); current_revision_stamped(&p).unwrap().unwrap() };
        let s2 = s2.expect("stable");
        let md = fs::metadata(&p).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut perm = md.permissions(); perm.set_readonly(true); fs::set_permissions(&p, perm.clone()).unwrap();
        assert!(!stamp_unchanged(&p, &s2), "a metadata change moves ctime");
        perm.set_readonly(false); fs::set_permissions(&p, perm).unwrap();
        // A whole-second modification time (coarse clock) is never trusted.
        let f = fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000)).unwrap();
        assert!(current_revision_stamped(&p).unwrap().unwrap().1.is_none());
        // Replaced by a new file (new inode), same size and content.
        let again = current_revision_stamped(&p).unwrap().unwrap().1;
        fs::remove_file(&p).unwrap();
        assert!(again.is_none_or(|s| !stamp_unchanged(&p, &s)));
        assert!(current_revision_stamped(&p).unwrap().is_none());
    }
}
