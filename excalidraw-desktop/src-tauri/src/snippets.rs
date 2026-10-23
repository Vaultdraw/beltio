//! User CSS snippets in `<config dir>/snippets/*.css` (decision D10).
//!
//! `list_snippets` returns every snippet's name and path, and the CSS text of
//! the ones named in `enabled` only, so listing a folder of disabled snippets
//! reads no file contents. A missing folder is an empty list and is not
//! created (no startup side effects); `open_snippets_dir` creates it. Per-file
//! problems become entries with an `error`, never a command failure. Symbolic
//! links are never followed. The frontend applies the CSS as-is.
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{config, err, ioerr, read_bounded, Result};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) const SNIPPETS_DIR: &str = "snippets";
const MAX_SNIPPET_BYTES: u64 = 256 * 1024;
const MAX_SNIPPETS: usize = 500;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnippetEntry {
    /// File name without `.css`: the value listed in `appearance.snippets`.
    id: String,
    path: String,
    /// The file's text; only for enabled snippets that could be read.
    css: Option<String>,
    error: Option<String>,
}

/// The stem of `name` when it ends in `.css` (case-insensitive) and has a non-empty stem.
fn css_stem(name: &str) -> Option<&str> {
    let split = name.len().checked_sub(4)?;
    if split == 0 || !name.is_char_boundary(split) || !name[split..].eq_ignore_ascii_case(".css") {
        return None;
    }
    Some(&name[..split])
}

/// Reads one snippet as UTF-8: regular files only, capped at 256 KiB.
fn read_snippet(path: &Path) -> std::result::Result<String, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Cannot read {name}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{name} is a symbolic link; only regular files are read"));
    }
    if !meta.is_file() {
        return Err(format!("{name} is not a regular file"));
    }
    let too_large = || format!("{name} is larger than 256 KiB");
    if meta.len() > MAX_SNIPPET_BYTES {
        return Err(too_large());
    }
    let bytes = read_bounded(path, MAX_SNIPPET_BYTES).map_err(|e| {
        if e.code == "INVALID_FILE" { too_large() } else { format!("Cannot read {name}: {}", e.message) }
    })?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{name} is not valid UTF-8"))?;
    Ok(text.strip_prefix('\u{FEFF}').map(str::to_owned).unwrap_or(text))
}

/// Lists `dir/*.css` sorted by name case-insensitively; reads those in `enabled`
/// (matched case-insensitively). Hidden files and sub-folders are ignored.
pub(crate) fn list_snippets_in(dir: &Path, enabled: &[String]) -> Result<Vec<SnippetEntry>> {
    match fs::symlink_metadata(dir) {
        Ok(m) if m.file_type().is_symlink() => {
            return Err(err("INVALID_PATH", "The snippets folder is a symbolic link; symbolic links are not followed"))
        }
        Ok(m) if !m.is_dir() => return Err(err("INVALID_PATH", "The snippets folder is not a folder")),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(ioerr(e)),
    }
    let enabled: Vec<String> = enabled.iter().map(|s| s.to_lowercase()).collect();
    let mut found: Vec<(String, PathBuf)> = fs::read_dir(dir)
        .map_err(ioerr)?
        .filter_map(|item| item.ok())
        .filter_map(|item| {
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || item.file_type().is_ok_and(|t| t.is_dir()) {
                return None;
            }
            css_stem(&name).map(|stem| (stem.to_string(), item.path()))
        })
        .collect();
    found.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()).then_with(|| a.1.cmp(&b.1)));
    found.truncate(MAX_SNIPPETS);
    Ok(found
        .into_iter()
        .map(|(id, path)| {
            let (css, error) = if enabled.contains(&id.to_lowercase()) {
                match read_snippet(&path) {
                    Ok(css) => (Some(css), None),
                    Err(e) => (None, Some(e)),
                }
            } else {
                (None, None)
            };
            SnippetEntry { id, path: path.to_string_lossy().into_owned(), css, error }
        })
        .collect())
}

fn snippets_dir() -> Result<PathBuf> {
    Ok(config::resolve_dirs()?.config.join(SNIPPETS_DIR))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_snippets(enabled: Vec<String>) -> Result<Vec<SnippetEntry>> {
    list_snippets_in(&snippets_dir()?, &enabled)
}

#[tauri::command]
pub(crate) async fn open_snippets_dir() -> Result<()> {
    config::open_dir(&snippets_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn ids(list: &[SnippetEntry]) -> Vec<&str> {
        list.iter().map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn missing_dir_is_empty_and_not_created() {
        let t = tempdir().unwrap();
        let dir = t.path().join("snippets");
        assert_eq!(list_snippets_in(&dir, &[]).unwrap(), vec![]);
        assert!(!dir.exists());
    }

    #[test]
    fn lists_css_files_sorted_and_reads_only_enabled() {
        let t = tempdir().unwrap();
        let dir = t.path();
        fs::write(dir.join("wide.css"), ".a{}").unwrap();
        fs::write(dir.join("Big Header.CSS"), "\u{FEFF}h1{}").unwrap();
        fs::write(dir.join(".hidden.css"), "x").unwrap();
        fs::write(dir.join("notes.txt"), "x").unwrap();
        fs::write(dir.join(".css"), "x").unwrap();
        fs::create_dir(dir.join("folder.css")).unwrap();
        let list = list_snippets_in(dir, &["big header".into()]).unwrap();
        assert_eq!(ids(&list), ["Big Header", "wide"]);
        assert_eq!(list[0].css.as_deref(), Some("h1{}"));
        assert!(list[1].css.is_none() && list[1].error.is_none());

        let v = serde_json::to_value(&list[1]).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"id": "wide", "path": list[1].path, "css": null, "error": null})
        );
    }

    #[test]
    fn enabled_problems_are_entries_not_failures() {
        let t = tempdir().unwrap();
        let dir = t.path();
        fs::write(dir.join("big.css"), vec![b'a'; (MAX_SNIPPET_BYTES + 1) as usize]).unwrap();
        fs::write(dir.join("bin.css"), [0xff, 0xfe, 0x00]).unwrap();
        let list = list_snippets_in(dir, &["big".into(), "bin".into()]).unwrap();
        assert_eq!(list[0].error.as_deref(), Some("big.css is larger than 256 KiB"));
        assert_eq!(list[1].error.as_deref(), Some("bin.css is not valid UTF-8"));
        assert!(list.iter().all(|e| e.css.is_none()));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed() {
        let t = tempdir().unwrap();
        let dir = t.path().join("snippets");
        fs::create_dir(&dir).unwrap();
        let outside = t.path().join("secret.css");
        fs::write(&outside, "x").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("link.css")).unwrap();
        let list = list_snippets_in(&dir, &["link".into()]).unwrap();
        assert_eq!(list[0].error.as_deref(), Some("link.css is a symbolic link; only regular files are read"));

        let linked = t.path().join("linked");
        std::os::unix::fs::symlink(&dir, &linked).unwrap();
        assert_eq!(list_snippets_in(&linked, &[]).unwrap_err().code, "INVALID_PATH");
    }
}
