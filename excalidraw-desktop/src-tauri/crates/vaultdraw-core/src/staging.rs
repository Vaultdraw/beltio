//! Staged-clone naming shared with the app's file history, and the pre-write clone the CLI makes
//! before overwriting a drawing while the app is closed (the app's next start versions it as
//! "Recovered"). Names: `<key>.<rev16>.excalidraw` plus a `<key>.path` sidecar holding the
//! vault-relative path; `<key>` = FNV-1a 64 of the (case-folded) path, 16 hex.

use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
mod sys {
    use std::ffi::{c_char, c_int, c_long};
    extern "C" {
        pub fn pathconf(path: *const c_char, name: c_int) -> c_long;
    }
    pub const PC_CASE_SENSITIVE: c_int = 11;
}

#[inline]
pub fn key_for(rel: &str, fold: bool) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |b: u8| {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    };
    if fold {
        rel.to_lowercase().bytes().for_each(&mut feed);
    } else {
        rel.bytes().for_each(&mut feed);
    }
    format!("{h:016x}")
}

#[inline]
pub fn rev16(revision: &str) -> Option<&str> {
    revision.get(..16).filter(|r| r.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[inline]
pub fn clone_name(key: &str, rev16: &str) -> String {
    format!("{key}.{rev16}.excalidraw")
}

/// `false` when the volume holding `path` is case-insensitive (APFS default); `true` when unknown.
pub fn volume_case_sensitive(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        if let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) {
            // SAFETY: valid NUL-terminated path; pathconf only reads it.
            let r = unsafe { sys::pathconf(c.as_ptr(), sys::PC_CASE_SENSITIVE) };
            if r == 0 {
                return false;
            }
        }
    }
    let _ = path;
    true
}

/// `<state>/history/<vault_id>/staged`.
pub fn staged_dir(state_dir: &Path, root: &Path) -> PathBuf {
    state_dir.join("history").join(crate::search::store::vault_id(root)).join("staged")
}

/// Before an offline overwrite of `<root>/<rel>`: copies the file's current bytes into the app's
/// staging area as a pending clone plus the `.path` sidecar. `None` (nothing staged) when the file
/// does not exist, when a clone for the key already exists, or on any error: never fails a write.
pub fn stage_before_overwrite(state_dir: &Path, root: &Path, rel: &str) -> Option<PathBuf> {
    let bytes = fs::read(root.join(rel)).ok()?;
    let dir = staged_dir(state_dir, root);
    let key = key_for(rel, !volume_case_sensitive(root));
    if has_clone(&dir, &key) {
        return None;
    }
    ensure_dir(&dir).ok()?;
    let dst = dir.join(clone_name(&key, &crate::revision(&bytes)[..16]));
    fs::write(&dst, &bytes).ok()?;
    if fs::write(dir.join(format!("{key}.path")), rel).is_err() {
        let _ = fs::remove_file(&dst);
        return None;
    }
    Some(dst)
}

fn has_clone(dir: &Path, key: &str) -> bool {
    let (pending, open) = (format!("{key}."), format!("o-{key}."));
    fs::read_dir(dir).is_ok_and(|rd| {
        rd.flatten().any(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            n.ends_with(".excalidraw") && (n.starts_with(&pending) || n.starts_with(&open))
        })
    })
}

fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let (state, root) = (d.path().join("state"), d.path().join("vault"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        (d, state, root)
    }

    fn listing(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
        v.sort();
        v
    }

    #[test]
    fn offline_write_stages_previous_content() {
        let (_d, state, root) = setup();
        fs::write(root.join("a.excalidraw"), b"old bytes").unwrap();
        let clone = stage_before_overwrite(&state, &root, "a.excalidraw").unwrap();
        let dir = staged_dir(&state, &root);
        let key = key_for("a.excalidraw", !volume_case_sensitive(&root));
        let rev = crate::revision(b"old bytes");
        assert_eq!(clone, dir.join(clone_name(&key, &rev[..16])));
        assert_eq!(fs::read(&clone).unwrap(), b"old bytes");
        assert_eq!(fs::read_to_string(dir.join(format!("{key}.path"))).unwrap(), "a.excalidraw");
        assert_eq!(listing(&dir).len(), 2);

        let (_d2, state2, root2) = setup();
        assert_eq!(stage_before_overwrite(&state2, &root2, "new.excalidraw"), None);
        assert!(listing(&state2).is_empty(), "a missing file stages nothing and creates nothing");
    }

    #[test]
    fn existing_clone_is_not_replaced() {
        let (_d, state, root) = setup();
        fs::write(root.join("a.excalidraw"), b"v1").unwrap();
        let dir = staged_dir(&state, &root);
        fs::create_dir_all(&dir).unwrap();
        let key = key_for("a.excalidraw", !volume_case_sensitive(&root));
        fs::write(dir.join(clone_name(&key, "0123456789abcdef")), b"app pending").unwrap();
        let before = listing(&dir);
        assert_eq!(stage_before_overwrite(&state, &root, "a.excalidraw"), None);
        assert_eq!(listing(&dir), before);

        // A state "dir" that is a plain file cannot hold the staged dir: None, no panic.
        let blocked = root.parent().unwrap().join("blocked");
        fs::write(&blocked, b"x").unwrap();
        assert_eq!(stage_before_overwrite(&blocked, &root, "a.excalidraw"), None);
    }
}
