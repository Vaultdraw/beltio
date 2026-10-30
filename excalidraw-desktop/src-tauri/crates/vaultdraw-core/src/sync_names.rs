//! Names that sync services create: conflict copies, iCloud placeholders and temporary or
//! partial files. Decided by the name alone (the TypeScript twin is `src/vault/syncNames.ts`;
//! shared fixtures: `src/vault/fixtures/syncnames.json`).
//!
//! | Service   | Conflict copy                                  |
//! | --------- | ---------------------------------------------- |
//! | Dropbox   | `name (conflicted copy 2026-01-01).ext`, `name (Mac's conflicted copy 2026-01-01).ext` |
//! | Syncthing | `name.sync-conflict-20260101-120000-ABCDEFG.ext` |
//! | iCloud    | `name 2.ext` (only when `name.ext` exists beside it, in a folder iCloud manages) |
//!
//! iCloud placeholders are `.name.ext.icloud` stubs: never read as the file, shown as "not downloaded".

use crate::filekind::{ends_with_ci, file_kind, FileKind};

/// Length of the extension that counts for sync naming (`.excalidraw.md`, `.excalidraw`, `.md`), 0 for other files.
fn ext_len(name: &str) -> usize {
    match file_kind(name) {
        FileKind::Drawing => crate::filekind::DRAWING_EXT.len(),
        FileKind::ExcalidrawMd => crate::filekind::EXCALIDRAW_MD_EXT.len(),
        FileKind::Note => crate::filekind::NOTE_EXT.len(),
        FileKind::Other => 0,
    }
}

/// A temporary or partial file a sync service or an editor leaves beside the real one: never
/// listed, scanned, indexed or watched. Folders are not checked (a folder may be called `x.tmp`).
pub fn is_sync_temp_name(name: &str) -> bool {
    name.starts_with("~$")
        || name.starts_with(".~lock.")
        || name.starts_with(".syncthing.")
        || name.starts_with(".dropbox")
        || [".tmp", ".temp", ".part", ".partial", ".crdownload", ".download"].iter().any(|e| ends_with_ci(name, e))
        || name.rsplit_once(".sb-").is_some_and(|(_, id)| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

/// `.name.ext.icloud` is an iCloud placeholder: returns the real name (`name.ext`).
pub fn placeholder_real_name(name: &str) -> Option<&str> {
    let inner = name.strip_prefix('.')?.strip_suffix(".icloud")?;
    (!inner.is_empty() && file_kind(inner) != FileKind::Other).then_some(inner)
}

/// Dropbox: `name (conflicted copy DATE).ext` or `name (Someone's conflicted copy DATE).ext`
/// (optionally followed by ` (2)`). Returns the original's file name.
fn dropbox_original(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    let at = lower.find("conflicted copy")?;
    let open = name[..at].rfind(" (")?;
    let close = at + name[at..].find(')')?;
    if open == 0 {
        return None;
    }
    let mut rest = &name[close + 1..];
    // Repeated conflicts add ` (1)`, ` (2)`.
    if let Some(r) = rest.strip_prefix(" (") {
        if let Some((n, tail)) = r.split_once(')') {
            if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) {
                rest = tail;
            }
        }
    }
    let original = format!("{}{}", &name[..open], rest);
    (file_kind(&original) != FileKind::Other).then_some(original)
}

/// Syncthing: `name.sync-conflict-YYYYMMDD-HHMMSS[-DEVICE].ext`. Returns the original's file name.
fn syncthing_original(name: &str) -> Option<String> {
    const TAG: &str = ".sync-conflict-";
    let at = name.find(TAG)?;
    if at == 0 {
        return None;
    }
    let after = &name[at + TAG.len()..];
    let (date, tail) = after.split_once('-')?;
    if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // `HHMMSS` then an optional `-DEVICEID`, then the extension.
    let time_end = tail.find(|c: char| !c.is_ascii_digit()).unwrap_or(tail.len());
    if time_end != 6 {
        return None;
    }
    let mut rest = &tail[time_end..];
    if let Some(r) = rest.strip_prefix('-') {
        let id_end = r.find('.').unwrap_or(r.len());
        rest = &r[id_end..];
    }
    let original = format!("{}{}", &name[..at], rest);
    (file_kind(&original) != FileKind::Other).then_some(original)
}

/// The original of a name-based conflict copy (Dropbox, Syncthing), or `None`.
pub fn conflict_original(name: &str) -> Option<String> {
    dropbox_original(name).or_else(|| syncthing_original(name))
}

/// iCloud's `name 2.ext` copy: the candidate original `name.ext`. The caller must check that
/// it exists beside the copy, or a file legitimately called "Plan 2" would be flagged.
pub fn numbered_copy_original(name: &str) -> Option<String> {
    let ext = ext_len(name);
    if ext == 0 || name.len() <= ext {
        return None;
    }
    let (stem, ext_text) = name.split_at(name.len() - ext);
    let (base, n) = stem.rsplit_once(' ')?;
    let num: u32 = n.parse().ok()?;
    (!base.is_empty() && (2..=99).contains(&num) && n.bytes().all(|b| b.is_ascii_digit())).then(|| format!("{base}{ext_text}"))
}

/// iCloud Drive keeps its folders under `~/Library/Mobile Documents/` (Obsidian's iCloud vaults
/// too). With no placeholder in sight, this is the only sign that a folder is iCloud's.
pub fn in_icloud_drive(root: &str) -> bool {
    root.replace('\\', "/").contains("/Library/Mobile Documents/")
}

/// Whether `name 2.ext` beside `name.ext` is an iCloud conflict copy: only in a folder iCloud
/// manages (the vault is in iCloud Drive, or the folder holds an iCloud placeholder). Elsewhere it
/// is the next free name the app and Obsidian give a new file ("Untitled 2", "Plan copy 2").
pub fn numbered_copies_are_conflicts(root: &str, folder_has_placeholder: bool) -> bool {
    folder_has_placeholder || in_icloud_drive(root)
}

/// Asks iCloud to download a placeholder (`.name.ext.icloud` beside `path`). Returns at once: the
/// real file appears when the download finishes and the watcher reports it. macOS only; the
/// placeholder is never read as the file.
pub fn request_download(v: &crate::vault::Vault, path: &str) -> crate::error::Result<()> {
    use crate::error::err;
    if file_kind(path) == FileKind::Other {
        return Err(err("INVALID_PATH", "Only drawings and notes can be downloaded"));
    }
    let real = crate::paths::safe_path(&v.root, path, true)?;
    let name = real.file_name().and_then(|n| n.to_str()).ok_or_else(|| err("INVALID_PATH", "File has no name"))?;
    let stub = real.with_file_name(format!(".{name}.icloud"));
    if real.exists() || !stub.is_file() {
        return Err(err("NOT_FOUND", "No iCloud placeholder for this file"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("brctl")
            .arg("download")
            .arg(&real)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|mut child| { std::thread::spawn(move || { let _ = child.wait(); }); })
            .map_err(|e| err("INTERNAL", format!("Could not ask iCloud to download: {e}")))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(err("UNSUPPORTED", "iCloud downloads are only available on macOS"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropbox_conflicts() {
        assert_eq!(conflict_original("Plan (conflicted copy 2026-01-01).excalidraw").as_deref(), Some("Plan.excalidraw"));
        assert_eq!(conflict_original("Plan (Mac's conflicted copy 2026-01-01).excalidraw").as_deref(), Some("Plan.excalidraw"));
        assert_eq!(conflict_original("Plan (Ana's MacBook Pro's conflicted copy 2026-01-01) (1).md").as_deref(), Some("Plan.md"));
        assert_eq!(conflict_original("Plan (CONFLICTED COPY x).excalidraw.md").as_deref(), Some("Plan.excalidraw.md"));
        assert_eq!(conflict_original("(conflicted copy x).excalidraw"), None);
        assert_eq!(conflict_original("Plan (conflicted copy x).png"), None);
        assert_eq!(conflict_original("Plan.excalidraw"), None);
    }

    #[test]
    fn syncthing_conflicts() {
        assert_eq!(conflict_original("Plan.sync-conflict-20260101-120000-ABCDEFG.excalidraw").as_deref(), Some("Plan.excalidraw"));
        assert_eq!(conflict_original("Plan.sync-conflict-20260101-120000.md").as_deref(), Some("Plan.md"));
        assert_eq!(conflict_original("a.b.sync-conflict-20260101-120000-XYZ.excalidraw.md").as_deref(), Some("a.b.excalidraw.md"));
        assert_eq!(conflict_original("Plan.sync-conflict-2026-120000-ABC.excalidraw"), None);
        assert_eq!(conflict_original("Plan.sync-conflict-20260101-12-ABC.excalidraw"), None);
        assert_eq!(conflict_original(".sync-conflict-20260101-120000-A.excalidraw"), None);
        assert_eq!(conflict_original("Plan.sync-conflict-20260101-120000-A.png"), None);
    }

    #[test]
    fn icloud_numbered_copies() {
        assert_eq!(numbered_copy_original("Plan 2.excalidraw").as_deref(), Some("Plan.excalidraw"));
        assert_eq!(numbered_copy_original("My Plan 12.md").as_deref(), Some("My Plan.md"));
        assert_eq!(numbered_copy_original("Plan 2.excalidraw.md").as_deref(), Some("Plan.excalidraw.md"));
        assert_eq!(numbered_copy_original("Plan 1.excalidraw"), None);
        assert_eq!(numbered_copy_original("Plan 2024.excalidraw"), None);
        assert_eq!(numbered_copy_original("Plan2.excalidraw"), None);
        assert_eq!(numbered_copy_original(" 2.excalidraw"), None);
        assert_eq!(numbered_copy_original("Plan 2.png"), None);
    }

    #[test]
    fn numbered_copies_count_only_where_icloud_manages_the_folder() {
        assert!(numbered_copies_are_conflicts("/Users/a/Library/Mobile Documents/com~apple~CloudDocs/V", false));
        assert!(numbered_copies_are_conflicts("/Users/a/Notes", true), "a placeholder beside it");
        assert!(!numbered_copies_are_conflicts("/Users/a/Notes", false), "\"Untitled 2\" is the next free name");
    }

    #[test]
    fn icloud_placeholders() {
        assert_eq!(placeholder_real_name(".Plan.excalidraw.icloud"), Some("Plan.excalidraw"));
        assert_eq!(placeholder_real_name(".Notes.md.icloud"), Some("Notes.md"));
        assert_eq!(placeholder_real_name(".photo.png.icloud"), None);
        assert_eq!(placeholder_real_name("Plan.excalidraw.icloud"), None);
        assert_eq!(placeholder_real_name("..icloud"), None);
    }

    #[test]
    fn download_needs_a_placeholder_and_a_safe_path() {
        let t = tempfile::tempdir().unwrap();
        let v = crate::vault::Vault::new(dunce::canonicalize(t.path()).unwrap(), "t".into(), false, None);
        assert_eq!(request_download(&v, "a.excalidraw").unwrap_err().code, "NOT_FOUND");
        assert_eq!(request_download(&v, "../a.excalidraw").unwrap_err().code, "INVALID_PATH");
        assert_eq!(request_download(&v, "a.png").unwrap_err().code, "INVALID_PATH");
        std::fs::write(t.path().join("a.excalidraw"), "{}").unwrap();
        std::fs::write(t.path().join(".a.excalidraw.icloud"), "").unwrap();
        assert_eq!(request_download(&v, "a.excalidraw").unwrap_err().code, "NOT_FOUND", "the real file is there");
    }

    #[test]
    fn matches_the_shared_fixtures() {
        let fx: serde_json::Value = serde_json::from_str(include_str!("../../../../src/vault/fixtures/syncnames.json")).unwrap();
        let opt = |v: &serde_json::Value| v.as_str().map(str::to_owned);
        for c in fx["conflict"].as_array().unwrap() { assert_eq!(conflict_original(c[0].as_str().unwrap()), opt(&c[1]), "{}", c[0]); }
        for c in fx["numbered"].as_array().unwrap() { assert_eq!(numbered_copy_original(c[0].as_str().unwrap()), opt(&c[1]), "{}", c[0]); }
        for c in fx["placeholder"].as_array().unwrap() { assert_eq!(placeholder_real_name(c[0].as_str().unwrap()).map(str::to_owned), opt(&c[1]), "{}", c[0]); }
        for c in fx["temp"].as_array().unwrap() { assert_eq!(is_sync_temp_name(c[0].as_str().unwrap()), c[1].as_bool().unwrap(), "{}", c[0]); }
        for c in fx["icloud_root"].as_array().unwrap() { assert_eq!(in_icloud_drive(c[0].as_str().unwrap()), c[1].as_bool().unwrap(), "{}", c[0]); }
    }

    #[test]
    fn temp_and_partial_files() {
        for n in ["~$Plan.md", ".~lock.a.md#", ".syncthing.Plan.excalidraw.tmp", ".dropbox.cache", "a.excalidraw.tmp", "a.md.PART", "a.excalidraw.crdownload", "a.excalidraw.sb-1a2b3c4d-AbCdEf"] {
            assert!(is_sync_temp_name(n), "{n}");
        }
        for n in ["Plan.excalidraw", "Plan.md", "tmp.excalidraw", "a.sb-.md", "Plan 2.excalidraw", "Plan (conflicted copy x).excalidraw"] {
            assert!(!is_sync_temp_name(n), "{n}");
        }
    }
}
