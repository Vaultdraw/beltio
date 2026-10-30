//! Folder install and uninstall for user plugins. Copies bytes only; nothing is ever executed.
use super::scan::{self, Entry, Source};
use crate::{err, ioerr, random_id, Result};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MAX_TOTAL: u64 = 50 * 1024 * 1024;
const MAX_FILE: u64 = 20 * 1024 * 1024;
const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 16;

#[derive(Default)]
struct Budget {
    files: usize,
    bytes: u64,
}

/// Removes its folder on drop; after a successful rename the path is gone and this is a no-op.
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn skipped(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn copy_tree(src: &Path, dst: &Path, budget: &mut Budget, depth: usize) -> Result<()> {
    if depth > MAX_DEPTH {
        return Err(err("INVALID_FILE", "Plugin folder is nested too deeply"));
    }
    fs::create_dir_all(dst).map_err(ioerr)?;
    for entry in fs::read_dir(src).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let name = entry.file_name();
        if skipped(&name.to_string_lossy()) {
            continue;
        }
        let kind = entry.file_type().map_err(ioerr)?;
        let target = dst.join(&name);
        if kind.is_dir() {
            copy_tree(&entry.path(), &target, budget, depth + 1)?;
        } else if kind.is_file() {
            let len = entry.metadata().map_err(ioerr)?.len();
            budget.files += 1;
            budget.bytes += len;
            if len > MAX_FILE {
                return Err(err("INVALID_FILE", format!("{} is larger than 20 MB", name.to_string_lossy())));
            }
            if budget.files > MAX_FILES || budget.bytes > MAX_TOTAL {
                return Err(err("INVALID_FILE", "Plugin folder is too large (max 50 MB, 2000 files)"));
            }
            fs::copy(entry.path(), &target).map_err(ioerr)?;
        }
        // Symlinks and other entry kinds are skipped.
    }
    Ok(())
}

/// Copies `src` into `<user_root>/<id>` after validating its manifest. Replaces an existing
/// folder only when it holds the same plugin id.
pub(crate) fn install_folder(user_root: &Path, src: &Path, app_version: &str, official: &HashSet<String>) -> Result<scan::PluginInfo> {
    let src = dunce::canonicalize(src).map_err(ioerr)?;
    if !src.is_dir() {
        return Err(err("INVALID_PATH", "Choose a plugin folder"));
    }
    let manifest = scan::load_uncached(&src).map_err(|m| err("INVALID_FILE", m))?;
    check_id(&manifest, official)?;
    fs::create_dir_all(user_root).map_err(ioerr)?;
    let staging = Staging(user_root.join(format!(".staging-{}", random_id())));
    copy_tree(&src, &staging.0, &mut Budget::default(), 0)?;
    scan::load_uncached(&staging.0).map_err(|m| err("INVALID_FILE", m))?;
    let dest = user_root.join(&manifest.id);
    if fs::symlink_metadata(&dest).is_ok() {
        replace_existing(user_root, &dest, &manifest.id, &staging.0)?;
    } else {
        fs::rename(&staging.0, &dest).map_err(ioerr)?;
    }
    scan::info_for_dir(&dest, Source::User, app_version)
}

/// A folder install from the user's disk. What the user confirmed belongs to the code they saw,
/// not to the id: replacing an existing plugin with different code forgets its consent record,
/// so the new code asks again. (A registry update keeps its record: it goes through `install_folder`.)
pub(crate) fn install_folder_with_fresh_consent(
    state_dir: &Path,
    user_root: &Path,
    src: &Path,
    app_version: &str,
    official: &HashSet<String>,
) -> Result<scan::PluginInfo> {
    let info = install_folder(user_root, src, app_version, official)?;
    super::consent::forget(state_dir, &info.manifest.id)?;
    Ok(info)
}

/// An install may not reuse an official plugin's id (it would replace the official plugin and skip
/// its consent prompt). A plugin with `dev = true` may: that is the developer's own copy.
fn check_id(manifest: &super::manifest::Manifest, official: &HashSet<String>) -> Result<()> {
    if super::manifest::is_reserved_id(&manifest.id) {
        return Err(err("NAME_COLLISION", format!("`{}` is the name of a built-in command group. Choose another id.", manifest.id)));
    }
    if official.contains(&manifest.id) && !manifest.dev {
        return Err(err("NAME_COLLISION", format!("`{}` is an official plugin id. Choose another id.", manifest.id)));
    }
    Ok(())
}

/// Swaps `staging` in for `dest` (renaming the old folder aside first, restoring it on failure).
fn replace_existing(user_root: &Path, dest: &Path, id: &str, staging: &Path) -> Result<()> {
    let same = scan::load_uncached(dest).is_ok_and(|m| m.id == id);
    if !same || fs::symlink_metadata(dest).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(err("NAME_COLLISION", format!("A different folder named '{id}' already exists in the plugins folder")));
    }
    let aside = Staging(user_root.join(format!(".staging-old-{}", random_id())));
    fs::rename(dest, &aside.0).map_err(ioerr)?;
    if let Err(e) = fs::rename(staging, dest) {
        let _ = fs::rename(&aside.0, dest);
        return Err(ioerr(e));
    }
    Ok(())
}

/// Deletes a user plugin folder: it must be a real directory that is a direct child of the user root.
pub(crate) fn uninstall_dir(user_root: &Path, dir: &Path) -> Result<()> {
    let root = dunce::canonicalize(user_root).map_err(ioerr)?;
    let meta = fs::symlink_metadata(dir).map_err(ioerr)?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(err("INVALID_PATH", "Not a plugin folder"));
    }
    let canonical = dunce::canonicalize(dir).map_err(ioerr)?;
    if canonical.parent() != Some(root.as_path()) {
        return Err(err("INVALID_PATH", "Plugin folder is outside the user plugins folder"));
    }
    fs::remove_dir_all(canonical).map_err(ioerr)
}

pub(crate) fn uninstall(user_root: &Path, entry: Option<&Entry>) -> Result<()> {
    let entry = entry.ok_or_else(|| err("NOT_FOUND", "Plugin not found"))?;
    if entry.source != Source::User {
        return Err(err("INVALID_ARGUMENT", "Bundled plugins cannot be uninstalled"));
    }
    uninstall_dir(user_root, &entry.dir)
}
