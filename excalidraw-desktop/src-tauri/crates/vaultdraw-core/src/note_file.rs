//! Guarded read and write of Markdown notes (`.md`): the only way Vaultdraw changes a user's note.
//!
//! Rules (TEAMS.md "Guarded write command"): the path is a vault-relative `.md` file with no
//! dot-folder in it (never `.obsidian`, `.trash`, `.git`); the revision is the hex SHA-256 of the
//! raw bytes; a write needs the revision the caller read (`None` = create only); the previous
//! bytes are copied to the note history before they are replaced; the new bytes go to a temp
//! file that is renamed over the note (atomic), after a second revision check; unchanged
//! content touches nothing, so a vault stays byte-identical unless the user edits a note.

use crate::error::{err, ioerr, Result};
use crate::fsops::{current_revision, ensure_no_sibling_collision, read_bounded, write_atomic_new_with};
use crate::paths::{now_ms, random_id, revision, safe_path, validate_relative, META_DIR};
use crate::vault::{mutation_guard, writable, Vault};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::SystemTime,
};

/// Largest note read or written.
pub const MAX_NOTE_BYTES: u64 = 16 * 1024 * 1024;
/// Copies of a note kept in its history folder.
pub const MAX_NOTE_COPIES: usize = 20;
pub const NOTE_HISTORY_DIR: &str = "note-history";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub content: String,
    pub revision: String,
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteWritten {
    pub revision: String,
    pub bytes: u64,
    pub mtime_ms: u64,
    /// Vault-relative path of the copy of the previous content (None: new note or unchanged).
    pub history_copy: Option<String>,
}

/// True for `x.md` (any case) that is not an Obsidian-Excalidraw `x.excalidraw.md`.
pub fn is_note_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.len() > 3 && lower.ends_with(".md") && !lower.ends_with(".excalidraw.md")
}

/// Path rules shared by read and write.
pub fn check_note_path(path: &str) -> Result<()> {
    let parts = validate_relative(path)?;
    if parts.iter().any(|p| p.starts_with('.')) {
        return Err(err("INVALID_PATH", "Notes inside dot-folders (.obsidian, .trash, .git) are never read or written"));
    }
    if !is_note_path(path) {
        return Err(err("INVALID_PATH", "Only .md notes can be read or written here"));
    }
    Ok(())
}

fn mtime_of(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).map(now_ms).unwrap_or(0)
}

pub fn read_note_file(root: &Path, path: &str) -> Result<NoteFile> {
    check_note_path(path)?;
    let p = safe_path(root, path, false)?;
    let md = fs::metadata(&p).map_err(ioerr)?;
    if !md.is_file() {
        return Err(err("INVALID_FILE", "Not a regular file"));
    }
    let bytes = read_bounded(&p, MAX_NOTE_BYTES)?;
    let content = String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", "Note is not UTF-8 text"))?;
    Ok(NoteFile { revision: revision(content.as_bytes()), size: content.len() as u64, mtime_ms: md.modified().map(now_ms).unwrap_or(0), content })
}

/// `<vault>/.excalidraw-vault/note-history/<id>`: Vaultdraw's own metadata folder, created on the
/// first edit only (opening and browsing a vault never creates it).
fn history_dir(v: &Vault, path: &str) -> Result<PathBuf> {
    let mut dir = v.root.join(META_DIR);
    for part in [NOTE_HISTORY_DIR, &hex::encode(&Sha256::digest(path.as_bytes())[..8])] {
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(err("INVALID_PATH", "Reserved vault metadata is not a real directory")),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&dir).map_err(ioerr)?,
            Err(e) => return Err(ioerr(e)),
        }
        dir.push(part);
    }
    match fs::symlink_metadata(&dir) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(err("INVALID_PATH", "Note history is not a real directory")),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&dir).map_err(ioerr)?,
        Err(e) => return Err(ioerr(e)),
    }
    Ok(dir)
}

/// Keeps the newest `MAX_NOTE_COPIES` files of a history folder (names start with the time).
fn prune_history(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut names: Vec<String> = rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".md")).collect();
    if names.len() <= MAX_NOTE_COPIES {
        return;
    }
    names.sort();
    for n in &names[..names.len() - MAX_NOTE_COPIES] {
        let _ = fs::remove_file(dir.join(n));
    }
}

/// Copies the current bytes of the note to its history folder; returns the vault-relative copy.
fn copy_to_history(v: &Vault, path: &str, p: &Path, rev: &str) -> Result<String> {
    let dir = history_dir(v, path)?;
    let bytes = read_bounded(p, MAX_NOTE_BYTES)?;
    // The copy must hold exactly the revision the caller based its edit on.
    if revision(&bytes) != rev {
        return Err(err("CONFLICT", "Note changed on disk; save was not applied"));
    }
    let name = format!("{:013}-{}.md", now_ms(SystemTime::now()), &rev[..12]);
    let file = dir.join(&name);
    write_atomic_new_with(&file, |f| f.write_all(&bytes)).or_else(|e| if e.code == "NAME_COLLISION" { Ok(()) } else { Err(e) })?;
    prune_history(&dir);
    let rel = file.strip_prefix(&v.root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or(name);
    Ok(rel)
}

/// The guarded write. `expected_revision`: the revision the caller read, or `None` to create a new note.
pub fn write_note_file(v: &Vault, path: &str, content: &str, expected_revision: Option<&str>) -> Result<NoteWritten> {
    writable(v)?;
    check_note_path(path)?;
    if content.len() as u64 > MAX_NOTE_BYTES {
        return Err(err("INVALID_FILE", "Note exceeds the 16 MiB limit"));
    }
    let _mutation = mutation_guard(v)?;
    let p = safe_path(&v.root, path, true)?;
    let current = current_revision(&p)?;
    if current.as_deref() != expected_revision {
        return Err(err("CONFLICT", "Note changed on disk; save was not applied"));
    }
    let new_rev = revision(content.as_bytes());
    if current.as_deref() == Some(new_rev.as_str()) {
        return Ok(NoteWritten { revision: new_rev, bytes: content.len() as u64, mtime_ms: mtime_of(&p), history_copy: None });
    }
    if current.is_some() && !fs::metadata(&p).map_err(ioerr)?.is_file() {
        return Err(err("INVALID_FILE", "Not a regular file"));
    }
    if current.is_none() {
        ensure_no_sibling_collision(&p)?;
    }
    let history_copy = match &current {
        Some(rev) => Some(copy_to_history(v, path, &p, rev)?),
        None => None,
    };
    let parent = p.parent().ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(".excalidraw-tmp-{}-{}", std::process::id(), random_id()));
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(ioerr)?;
        f.write_all(content.as_bytes()).map_err(ioerr)?;
        if current.is_some() {
            // Keep the note's permissions across the rename.
            if let Ok(md) = fs::metadata(&p) {
                let _ = f.set_permissions(md.permissions());
            }
        }
        f.sync_all().map_err(ioerr)?;
        if current_revision(&p)?.as_deref() != expected_revision {
            return Err(err("CONFLICT", "Note changed immediately before commit; save was not applied"));
        }
        if current.is_none() {
            // Create-only: a hard link is an atomic no-clobber commit.
            crate::fsops::commit_no_clobber(&temp, &p).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { err("CONFLICT", "Note was created meanwhile; save was not applied") } else { ioerr(e) })?;
        } else {
            fs::rename(&temp, &p).map_err(ioerr)?;
        }
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    Ok(NoteWritten { revision: new_rev, bytes: content.len() as u64, mtime_ms: mtime_of(&p), history_copy })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn vault(root: &Path) -> Vault {
        Vault::new(root.canonicalize().unwrap(), "t".into(), false, None)
    }

    #[test]
    fn create_read_edit_roundtrip_with_history() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        let w = write_note_file(&v, "a.md", "# One\n", None).unwrap();
        assert_eq!(w.history_copy, None);
        let r = read_note_file(&v.root, "a.md").unwrap();
        assert_eq!((r.content.as_str(), r.revision.as_str()), ("# One\n", w.revision.as_str()));
        let w2 = write_note_file(&v, "a.md", "# Two\r\n", Some(&r.revision)).unwrap();
        assert_eq!(fs::read(v.root.join("a.md")).unwrap(), b"# Two\r\n");
        let copy = w2.history_copy.unwrap();
        assert!(copy.starts_with(".excalidraw-vault/note-history/"));
        assert_eq!(fs::read(v.root.join(&copy)).unwrap(), b"# One\n");
        // no temp file is left behind
        assert!(fs::read_dir(&v.root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".excalidraw-tmp-")));
    }

    #[test]
    fn stale_revision_is_refused_and_nothing_changes() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        let w = write_note_file(&v, "n.md", "v1", None).unwrap();
        fs::write(v.root.join("n.md"), "edited elsewhere").unwrap(); // e.g. Obsidian
        let e = write_note_file(&v, "n.md", "v2", Some(&w.revision)).unwrap_err();
        assert_eq!(e.code, "CONFLICT");
        assert_eq!(fs::read_to_string(v.root.join("n.md")).unwrap(), "edited elsewhere");
        assert!(!v.root.join(META_DIR).exists(), "a refused write leaves no history");
        // create-only over an existing note
        assert_eq!(write_note_file(&v, "n.md", "x", None).unwrap_err().code, "CONFLICT");
        // a missing note with a revision
        assert_eq!(write_note_file(&v, "gone.md", "x", Some(&w.revision)).unwrap_err().code, "CONFLICT");
    }

    #[test]
    fn unchanged_content_touches_nothing() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        fs::write(v.root.join("same.md"), "keep\n").unwrap();
        let past = SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::OpenOptions::new().write(true).open(v.root.join("same.md")).unwrap().set_modified(past).unwrap();
        let r = read_note_file(&v.root, "same.md").unwrap();
        let w = write_note_file(&v, "same.md", "keep\n", Some(&r.revision)).unwrap();
        assert_eq!((w.revision.as_str(), w.history_copy), (r.revision.as_str(), None));
        assert_eq!(mtime_of(&v.root.join("same.md")), r.mtime_ms, "mtime unchanged");
        assert!(!v.root.join(META_DIR).exists());
    }

    #[test]
    fn dot_folders_and_other_kinds_are_refused() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        for p in [".obsidian/x.md", ".trash/x.md", ".git/x.md", "a/.hidden/x.md", ".excalidraw-vault/x.md", "x.txt", "x.excalidraw", "x.excalidraw.md", "../x.md", "/x.md", ".md", "a/b.MD.bak"] {
            assert_eq!(write_note_file(&v, p, "x", None).unwrap_err().code, "INVALID_PATH", "{p}");
            assert_eq!(read_note_file(&v.root, p).unwrap_err().code, "INVALID_PATH", "{p}");
        }
        assert!(write_note_file(&v, "Sub/Note.MD", "x", None).is_err(), "missing folder is not created");
        fs::create_dir(v.root.join("Sub")).unwrap();
        assert!(write_note_file(&v, "Sub/Note.MD", "x", None).is_ok());
    }

    #[test]
    fn read_only_vault_and_bad_content() {
        let d = tempdir().unwrap();
        let ro = Vault::new(d.path().canonicalize().unwrap(), "t".into(), true, None);
        assert_eq!(write_note_file(&ro, "a.md", "x", None).unwrap_err().code, "READ_ONLY");
        fs::write(d.path().join("bin.md"), [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(read_note_file(d.path(), "bin.md").unwrap_err().code, "INVALID_FILE");
        assert_eq!(read_note_file(d.path(), "missing.md").unwrap_err().code, "NOT_FOUND");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_refused_and_permissions_kept() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let d = tempdir().unwrap();
        let v = vault(d.path());
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("o.md"), "secret").unwrap();
        symlink(outside.path().join("o.md"), v.root.join("link.md")).unwrap();
        assert_eq!(write_note_file(&v, "link.md", "x", None).unwrap_err().code, "INVALID_PATH");
        let w = write_note_file(&v, "p.md", "a", None).unwrap();
        fs::set_permissions(v.root.join("p.md"), fs::Permissions::from_mode(0o600)).unwrap();
        write_note_file(&v, "p.md", "b", Some(&w.revision)).unwrap();
        assert_eq!(fs::metadata(v.root.join("p.md")).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn history_keeps_the_last_copies_only() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        let mut rev = write_note_file(&v, "h.md", "0", None).unwrap().revision;
        for i in 1..=MAX_NOTE_COPIES + 5 {
            rev = write_note_file(&v, "h.md", &i.to_string(), Some(&rev)).unwrap().revision;
        }
        let dir = history_dir(&v, "h.md").unwrap();
        assert_eq!(fs::read_dir(dir).unwrap().count(), MAX_NOTE_COPIES);
    }

    #[test]
    fn concurrent_writers_one_wins() {
        let d = tempdir().unwrap();
        let v = std::sync::Arc::new(vault(d.path()));
        let rev = write_note_file(&v, "c.md", "base", None).unwrap().revision;
        let handles: Vec<_> = (0..6)
            .map(|i| {
                let (v, rev) = (v.clone(), rev.clone());
                std::thread::spawn(move || write_note_file(&v, "c.md", &format!("w{i}"), Some(&rev)).is_ok())
            })
            .collect();
        let ok = handles.into_iter().map(|h| h.join().unwrap()).filter(|b| *b).count();
        assert_eq!(ok, 1, "exactly one write against the same revision succeeds");
    }
}
