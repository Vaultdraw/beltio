//! One-time move of the app folders from the old bundle identifier (`com.excalidraw.vault.local`,
//! releases before 0.1.1) to the new one (`app.vaultdraw`). The OS names Tauri's app folders
//! after the identifier (macOS: `~/Library/Application Support/<id>`, `~/Library/Caches/<id>`,
//! `~/Library/WebKit/<id>`; Windows: `%APPDATA%\<id>`, `%LOCALAPPDATA%\<id>`; elsewhere
//! `$XDG_CONFIG_HOME/<id>`, `$XDG_DATA_HOME/<id>`, `$XDG_CACHE_HOME/<id>`), so an existing install
//! would otherwise start empty. Vaultdraw's own folders (`~/.config/vaultdraw`,
//! `~/.local/state/vaultdraw`) are not identifier-based and need nothing.
//!
//! Rule: for each pair, when the old folder exists and the new one is missing or empty, copy
//! (never move or delete) the old tree across. Symlinks are skipped. Idempotent: a later launch
//! finds the new folder filled and does nothing.

use crate::vault_path::Os;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

/// The bundle identifier since 0.1.1 (`tauri.conf.json`).
pub const BUNDLE_ID: &str = "app.vaultdraw";
/// The bundle identifier of releases before 0.1.1.
pub const LEGACY_BUNDLE_ID: &str = "com.excalidraw.vault.local";

/// Every per-identifier app folder the OS gives an app called `id`, for an injected environment.
/// The first entry is the config dir (Tauri's `app_config_dir()`), the one `recent-vault` lives in.
pub fn app_dirs_with(get: impl Fn(&str) -> Option<OsString>, os: Os, id: &str) -> Vec<PathBuf> {
    let var = |name: &str| get(name).filter(|v| !v.is_empty()).map(PathBuf::from).filter(|p| p.is_absolute());
    let mut dirs = Vec::new();
    match os {
        Os::Macos => {
            if let Some(home) = var("HOME") {
                let lib = home.join("Library");
                dirs.push(lib.join("Application Support").join(id));
                dirs.push(lib.join("Caches").join(id));
                dirs.push(lib.join("WebKit").join(id));
            }
        }
        Os::Windows => {
            dirs.extend(var("APPDATA").map(|a| a.join(id)));
            dirs.extend(var("LOCALAPPDATA").map(|a| a.join(id)));
        }
        Os::Other => {
            let xdg = |name: &str, rel: &str| var(name).or_else(|| var("HOME").map(|h| h.join(rel)));
            dirs.extend(xdg("XDG_CONFIG_HOME", ".config").map(|c| c.join(id)));
            dirs.extend(xdg("XDG_DATA_HOME", ".local/share").map(|d| d.join(id)));
            dirs.extend(xdg("XDG_CACHE_HOME", ".cache").map(|c| c.join(id)));
        }
    }
    dirs
}

/// The config dir Tauri's `app_config_dir()` returns for `id` (where `recent-vault` lives).
pub fn app_config_dir_with(get: impl Fn(&str) -> Option<OsString>, os: Os, id: &str) -> Option<PathBuf> {
    app_dirs_with(get, os, id).into_iter().next()
}

/// `(old, new)` folder pairs for the current platform.
pub fn pairs_with(get: impl Fn(&str) -> Option<OsString>, os: Os) -> Vec<(PathBuf, PathBuf)> {
    let old = app_dirs_with(&get, os, LEGACY_BUNDLE_ID);
    let new = app_dirs_with(&get, os, BUNDLE_ID);
    old.into_iter().zip(new).collect()
}

fn is_missing_or_empty(dir: &Path) -> bool {
    match fs::read_dir(dir) {
        Ok(mut rd) => rd.next().is_none(),
        Err(_) => !dir.exists(),
    }
}

/// Recursive copy of regular files and directories; symlinks and special files are skipped.
/// Returns the number of files copied. A single unreadable file is skipped, not fatal.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<u64> {
    fs::create_dir_all(to)?;
    let mut copied = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if ty.is_dir() {
            copied += copy_tree(&entry.path(), &dest)?;
        } else if ty.is_file() {
            if fs::copy(entry.path(), &dest).is_ok() {
                copied += 1;
            }
        }
    }
    Ok(copied)
}

/// What one launch did for one pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Nothing to migrate: the old folder is absent, or the new one already has content.
    Skipped,
    /// The old tree was copied; `files` regular files landed in the new folder.
    Copied { files: u64 },
    Failed(String),
}

/// Copies `old` to `new` when `old` is a directory and `new` is missing or empty.
pub fn copy_if_new_is_empty(old: &Path, new: &Path) -> Outcome {
    if !old.is_dir() || !is_missing_or_empty(new) {
        return Outcome::Skipped;
    }
    match copy_tree(old, new) {
        Ok(files) => Outcome::Copied { files },
        Err(e) => Outcome::Failed(format!("{}: {e}", old.display())),
    }
}

/// Runs the migration for `pairs`; returns one outcome per pair, in order.
pub fn run(pairs: &[(PathBuf, PathBuf)]) -> Vec<Outcome> {
    pairs.iter().map(|(old, new)| copy_if_new_is_empty(old, new)).collect()
}

/// The migration against the process environment. Each copied folder is logged on stderr.
pub fn run_for_current_platform() -> Vec<Outcome> {
    let pairs = pairs_with(|k| std::env::var_os(k), Os::CURRENT);
    let outcomes = run(&pairs);
    for ((old, new), outcome) in pairs.iter().zip(&outcomes) {
        match outcome {
            Outcome::Copied { files } => eprintln!("vaultdraw: copied {files} file(s) from {} to {}", old.display(), new.display()),
            Outcome::Failed(msg) => eprintln!("vaultdraw: app folder migration failed: {msg}"),
            Outcome::Skipped => {}
        }
    }
    outcomes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = vars.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn dirs_per_platform() {
        let g = env(&[("HOME", "/h"), ("APPDATA", "/ad"), ("LOCALAPPDATA", "/lad"), ("XDG_CONFIG_HOME", "/x")]);
        assert_eq!(
            app_dirs_with(&g, Os::Macos, "app.vaultdraw"),
            vec![
                PathBuf::from("/h/Library/Application Support/app.vaultdraw"),
                PathBuf::from("/h/Library/Caches/app.vaultdraw"),
                PathBuf::from("/h/Library/WebKit/app.vaultdraw"),
            ]
        );
        assert_eq!(app_dirs_with(&g, Os::Windows, "x"), vec![PathBuf::from("/ad/x"), PathBuf::from("/lad/x")]);
        assert_eq!(
            app_dirs_with(&g, Os::Other, "x"),
            vec![PathBuf::from("/x/x"), PathBuf::from("/h/.local/share/x"), PathBuf::from("/h/.cache/x")]
        );
        // A relative XDG value is ignored, as the spec requires.
        let rel = env(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "rel")]);
        assert_eq!(app_config_dir_with(&rel, Os::Other, "x").unwrap(), PathBuf::from("/h/.config/x"));
        assert!(app_dirs_with(env(&[]), Os::Macos, "x").is_empty());
    }

    #[test]
    fn pairs_map_old_to_new_in_order() {
        let pairs = pairs_with(env(&[("HOME", "/h")]), Os::Macos);
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0].0, PathBuf::from("/h/Library/Application Support/com.excalidraw.vault.local"));
        assert_eq!(pairs[0].1, PathBuf::from("/h/Library/Application Support/app.vaultdraw"));
        assert_eq!(pairs[2].1, PathBuf::from("/h/Library/WebKit/app.vaultdraw"));
    }

    #[test]
    fn copies_a_tree_once_and_keeps_the_old_one() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join("old");
        let new = t.path().join("new");
        fs::create_dir_all(old.join("sub/deeper")).unwrap();
        fs::write(old.join("recent-vault"), "/vaults/a").unwrap();
        fs::write(old.join("sub/deeper/f.txt"), "x").unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new), Outcome::Copied { files: 2 });
        assert_eq!(fs::read_to_string(new.join("recent-vault")).unwrap(), "/vaults/a");
        assert_eq!(fs::read_to_string(new.join("sub/deeper/f.txt")).unwrap(), "x");
        assert!(old.join("recent-vault").exists(), "copy, never move");
        // Second launch: the new folder has content, so nothing happens even if old changed.
        fs::write(old.join("recent-vault"), "/vaults/b").unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new), Outcome::Skipped);
        assert_eq!(fs::read_to_string(new.join("recent-vault")).unwrap(), "/vaults/a");
    }

    #[test]
    fn empty_new_folder_counts_as_missing_and_absent_old_is_skipped() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join("old");
        let new = t.path().join("new");
        assert_eq!(copy_if_new_is_empty(&old, &new), Outcome::Skipped, "no old folder");
        assert!(!new.exists());
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a"), "1").unwrap();
        fs::create_dir_all(&new).unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new), Outcome::Copied { files: 1 }, "empty new folder is filled");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_skipped() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join("old");
        let new = t.path().join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("real"), "r").unwrap();
        std::os::unix::fs::symlink(t.path(), old.join("loop")).unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new), Outcome::Copied { files: 1 });
        assert!(!new.join("loop").exists());
    }

    #[test]
    fn run_reports_one_outcome_per_pair() {
        let t = tempfile::tempdir().unwrap();
        let a_old = t.path().join("a-old");
        fs::create_dir_all(&a_old).unwrap();
        fs::write(a_old.join("f"), "1").unwrap();
        let pairs = vec![(a_old, t.path().join("a-new")), (t.path().join("b-old"), t.path().join("b-new"))];
        assert_eq!(run(&pairs), vec![Outcome::Copied { files: 1 }, Outcome::Skipped]);
    }
}
