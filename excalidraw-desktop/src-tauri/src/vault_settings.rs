//! Per-vault settings: `<vault>/.excalidraw-vault/settings.toml`.
//!
//! Same comment-preserving TOML handling as `config.toml` (see `config.rs`); values here
//! override the global config for this vault. The file lives in the vault's reserved
//! metadata folder, which `safe_path` never resolves, so it is reached only through
//! [`settings_file`], which refuses symbolic links and anything outside the vault root.
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{
    config::{self, ConfigChange, ConfigError},
    err, ioerr, mutation_guard, vault_for, write_atomic, write_atomic_new, writable, Result,
    Service, Vault, META_DIR,
};
use serde::Serialize;
use serde_json::Value as Json;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

pub(crate) const SETTINGS_FILE: &str = "settings.toml";
const PROFILE_FILE: &str = "profile";
const MAX_SETTINGS_BYTES: u64 = 256 * 1024;
const HEADER: &str = "# Vaultdraw settings for this vault; these override ~/.config/vaultdraw/config.toml\n";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedVaultSettings {
    path: String,
    pub(crate) settings: Option<Json>,
    settings_error: Option<ConfigError>,
}

/// Resolves `<root>/.excalidraw-vault/settings.toml`. The metadata folder must be a real
/// directory (not a symbolic link) inside the vault root; it is created only when
/// `create` is set. Returns `Ok(None)` when the folder is missing and `create` is off.
fn settings_file(root: &Path, create: bool) -> Result<Option<PathBuf>> {
    let meta = root.join(META_DIR);
    let metadata = match fs::symlink_metadata(&meta) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&meta).map_err(ioerr)?;
            fs::symlink_metadata(&meta).map_err(ioerr)?
        }
        Err(e) => return Err(ioerr(e)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(err("INVALID_PATH", "Reserved vault metadata is not a real directory"));
    }
    let base = dunce::canonicalize(root).map_err(ioerr)?;
    if !dunce::canonicalize(&meta).map_err(ioerr)?.starts_with(&base) {
        return Err(err("INVALID_PATH", "Path escapes the selected vault"));
    }
    let file = meta.join(SETTINGS_FILE);
    match fs::symlink_metadata(&file) {
        Ok(m) if m.file_type().is_symlink() => {
            Err(err("INVALID_PATH", "settings.toml is a symbolic link; only regular files are used"))
        }
        Ok(m) if !m.is_file() => Err(err("INVALID_PATH", "settings.toml is not a regular file")),
        _ => Ok(Some(file)),
    }
}

/// Reads the vault's settings. A missing file (or metadata folder) reads as `{}`; the
/// file is never created here.
pub(crate) fn load_vault_settings_at(root: &Path) -> LoadedVaultSettings {
    let path = root.join(META_DIR).join(SETTINGS_FILE);
    let fail = |message: String| LoadedVaultSettings {
        path: path.to_string_lossy().into_owned(),
        settings: None,
        settings_error: Some(ConfigError { message, line: None }),
    };
    let file = match settings_file(root, false) {
        Ok(Some(file)) => file,
        Ok(None) => {
            return LoadedVaultSettings {
                path: path.to_string_lossy().into_owned(),
                settings: Some(Json::Object(Default::default())),
                settings_error: None,
            }
        }
        Err(e) => return fail(e.message),
    };
    let (settings, settings_error) = match config::read_toml_text(&file, SETTINGS_FILE, MAX_SETTINGS_BYTES) {
        Ok(text) => match config::parse_config(&text) {
            Ok(json) => (Some(json), None),
            Err(e) => (None, Some(e)),
        },
        Err(e) if e.code == "NOT_FOUND" => (Some(Json::Object(Default::default())), None),
        Err(e) => (None, Some(ConfigError { message: e.message, line: None })),
    };
    LoadedVaultSettings { path: file.to_string_lossy().into_owned(), settings, settings_error }
}

/// Applies `changes` to the vault's settings file, creating it (with a header comment)
/// on the first write. Callers hold the vault's mutation guard.
pub(crate) fn update_vault_settings_at(v: &Vault, changes: &[ConfigChange]) -> Result<()> {
    writable(v)?;
    // Removing keys from a file that doesn't exist is a no-op; don't create it for that.
    let only_removals = changes.iter().all(|c| c.value.is_null());
    let Some(file) = settings_file(&v.root, !only_removals)? else {
        // Still validate the keys so a bad call fails the same way with or without a file.
        config::apply_toml_changes("", changes, SETTINGS_FILE, MAX_SETTINGS_BYTES)?;
        return Ok(());
    };
    match config::read_toml_text(&file, SETTINGS_FILE, MAX_SETTINGS_BYTES) {
        Ok(text) => {
            // A file holding only comments (e.g. the header after every setting was
            // removed) is rebuilt like a new one, so its comments stay on top.
            let comments_only = matches!(config::parse_config(&text), Ok(Json::Object(m)) if m.is_empty());
            let updated = if comments_only && !only_removals {
                with_head(text.trim_end(), changes)?
            } else {
                config::apply_toml_changes(&text, changes, SETTINGS_FILE, MAX_SETTINGS_BYTES)?
            };
            if updated != text {
                write_atomic(&file, updated.as_bytes())?;
            }
            Ok(())
        }
        Err(e) if e.code == "NOT_FOUND" => {
            let text = with_head(HEADER.trim_end(), changes)?;
            if only_removals {
                return Ok(());
            }
            write_atomic_new(&file, text.as_bytes())
        }
        Err(e) => Err(e),
    }
}

/// Renders `changes` applied to an empty document below the comment block `head`.
/// Comments in an otherwise empty document trail it in toml_edit, so the head is
/// prepended to the rendered body rather than parsed with it.
fn with_head(head: &str, changes: &[ConfigChange]) -> Result<String> {
    config::with_head(head, changes, SETTINGS_FILE, MAX_SETTINGS_BYTES)
}

#[tauri::command]
pub(crate) async fn load_vault_settings(handle: String, state: State<'_, Service>) -> Result<LoadedVaultSettings> {
    let v = vault_for(&state, &handle)?;
    Ok(load_vault_settings_at(&v.root))
}

#[tauri::command]
pub(crate) async fn update_vault_settings(
    handle: String,
    changes: Vec<ConfigChange>,
    state: State<'_, Service>,
) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    update_vault_settings_at(&v, &changes)
}

/// The profile this vault asks for: the one-line file `<vault>/.excalidraw-vault/profile`
/// (a valid profile name, else nothing). Read once when the vault opens.
pub(crate) fn vault_profile_at(root: &Path) -> Option<String> {
    let dir = settings_file(root, false).ok()??.with_file_name(PROFILE_FILE);
    let text = fs::read_to_string(dir).ok()?;
    let name = text.trim();
    config::valid_profile_name(name).then(|| name.to_owned())
}

/// Saves (or clears with `None`) the vault's profile file.
pub(crate) fn set_vault_profile_at(v: &Vault, name: Option<&str>) -> Result<()> {
    writable(v)?;
    match name {
        Some(n) if !config::valid_profile_name(n) => Err(err("INVALID_ARGUMENT", format!("Invalid profile name \"{n}\""))),
        Some(n) => {
            let Some(file) = settings_file(&v.root, true)? else { return Ok(()) };
            write_atomic(&file.with_file_name(PROFILE_FILE), format!("{n}\n").as_bytes())
        }
        None => {
            let Some(file) = settings_file(&v.root, false)? else { return Ok(()) };
            match fs::remove_file(file.with_file_name(PROFILE_FILE)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(ioerr(e)),
                _ => Ok(()),
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn vault_profile(handle: String, state: State<'_, Service>) -> Result<Option<String>> {
    let v = vault_for(&state, &handle)?;
    Ok(vault_profile_at(&v.root))
}

#[tauri::command]
pub(crate) async fn set_vault_profile(handle: String, name: Option<String>, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    let _mutation = mutation_guard(&v)?;
    set_vault_profile_at(&v, name.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn vault(root: &Path, read_only: bool) -> Vault {
        Vault::for_tests(dunce::canonicalize(root).unwrap(), "test", read_only)
    }
    fn change(key: &str, value: Json) -> ConfigChange {
        ConfigChange { key: key.into(), value }
    }
    fn file(root: &Path) -> PathBuf {
        root.join(META_DIR).join(SETTINGS_FILE)
    }

    #[test]
    fn graph_table_round_trips_next_to_other_tables_and_comments() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        update_vault_settings_at(&v, &[change("saving.autosave_delay_ms", json!(750))]).unwrap();
        let groups = json!([{ "query": "tag:#a", "colour": "#ff0000" }, { "query": "path:Notes", "colour": "#00ff00" }]);
        update_vault_settings_at(
            &v,
            &[
                change("graph.show_orphans", json!(false)),
                change("graph.force_repel", json!(7.5)),
                change("graph.colour_by", json!("mono")),
                change("graph.groups", groups.clone()),
            ],
        )
        .unwrap();
        let loaded = load_vault_settings_at(t.path());
        let settings = loaded.settings.unwrap();
        assert_eq!(settings["saving"]["autosave_delay_ms"], json!(750));
        assert_eq!(settings["graph"]["show_orphans"], json!(false));
        assert_eq!(settings["graph"]["force_repel"], json!(7.5));
        assert_eq!(settings["graph"]["colour_by"], json!("mono"));
        assert_eq!(settings["graph"]["groups"], groups);

        update_vault_settings_at(
            &v,
            &[
                change("graph.show_orphans", Json::Null),
                change("graph.force_repel", Json::Null),
                change("graph.colour_by", Json::Null),
                change("graph.groups", Json::Null),
            ],
        )
        .unwrap();
        let settings = load_vault_settings_at(t.path()).settings.unwrap();
        assert_eq!(settings["saving"]["autosave_delay_ms"], json!(750));
        assert!(settings.get("graph").is_none_or(|g| g.as_object().is_some_and(|o| o.is_empty())));
    }

    #[test]
    fn missing_file_loads_as_empty_without_creating_anything() {
        let t = tempdir().unwrap();
        let loaded = load_vault_settings_at(t.path());
        assert_eq!(loaded.settings, Some(json!({})));
        assert!(loaded.settings_error.is_none());
        assert!(!t.path().join(META_DIR).exists());
        let out = serde_json::to_value(&loaded).unwrap();
        assert_eq!(out["path"], file(t.path()).to_string_lossy().as_ref());
        assert!(out["settingsError"].is_null());
        assert_eq!(out["settings"], json!({}));

        // Metadata folder present (e.g. recovery), file missing: still {}.
        fs::create_dir(t.path().join(META_DIR)).unwrap();
        assert_eq!(load_vault_settings_at(t.path()).settings, Some(json!({})));
        assert!(!file(t.path()).exists());
    }

    #[test]
    fn first_update_creates_header_and_values_then_preserves_comments() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", json!("Sketches")), change("navigator.sort", json!("modified"))]).unwrap();
        let text = fs::read_to_string(file(t.path())).unwrap();
        assert!(text.starts_with(HEADER), "{text}");
        assert_eq!(
            load_vault_settings_at(t.path()).settings,
            Some(json!({"files": {"new_drawing_folder": "Sketches"}, "navigator": {"sort": "modified"}}))
        );

        // A hand-added comment survives the next GUI edit.
        fs::write(file(t.path()), text.replace("[navigator]\n", "[navigator]\n# mine\n")).unwrap();
        update_vault_settings_at(&v, &[change("navigator.sort", json!("name")), change("files.new_drawing_folder", Json::Null)]).unwrap();
        let text = fs::read_to_string(file(t.path())).unwrap();
        assert!(text.starts_with(HEADER));
        assert!(text.contains("[navigator]\n# mine\nsort = \"name\"\n"), "{text}");
        assert!(!text.contains("new_drawing_folder"));
        // No temp files are left behind.
        assert_eq!(fs::read_dir(t.path().join(META_DIR)).unwrap().count(), 1);
    }

    #[test]
    fn removing_the_last_key_prunes_its_empty_table() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", json!("Sketches"))]).unwrap();
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", Json::Null)]).unwrap();
        let text = fs::read_to_string(file(t.path())).unwrap();
        assert!(!text.contains("[files]"), "{text}");
        assert!(text.starts_with(HEADER), "{text}");
        assert_eq!(load_vault_settings_at(t.path()).settings, Some(json!({})));

        // With two tables, the header stays on top of the one that is left.
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", json!("A")), change("navigator.sort", json!("name"))]).unwrap();
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", Json::Null)]).unwrap();
        let text = fs::read_to_string(file(t.path())).unwrap();
        assert_eq!(text, format!("{HEADER}\n[navigator]\nsort = \"name\"\n"));
        update_vault_settings_at(&v, &[change("navigator.sort", Json::Null)]).unwrap();
        let text = fs::read_to_string(file(t.path())).unwrap();
        assert!(!text.contains('['), "{text}");
        assert_eq!(load_vault_settings_at(t.path()).settings, Some(json!({})));

        // A table with a comment of its own is kept, and so is a removed key's comment.
        fs::write(file(t.path()), "# mine\n[files]\nnew_drawing_folder = \"A\"\n\n[navigator] # keep\nsort = \"x\"\n\n[x]\n# about y\ny = 1\n").unwrap();
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", Json::Null), change("navigator.sort", Json::Null), change("x.y", Json::Null)]).unwrap();
        assert_eq!(fs::read_to_string(file(t.path())).unwrap(), "# mine\n[files]\n\n[navigator] # keep\n\n[x]\n# about y\n");
    }

    #[test]
    fn removals_without_a_file_create_nothing_and_bad_keys_still_fail() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        update_vault_settings_at(&v, &[change("navigator.sort", Json::Null)]).unwrap();
        assert!(!t.path().join(META_DIR).exists());
        assert_eq!(update_vault_settings_at(&v, &[change("a b.c", Json::Null)]).unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(update_vault_settings_at(&v, &[change("x.y", json!({"o": {"p": 1}}))]).unwrap_err().code, "INVALID_ARGUMENT");
        assert!(!file(t.path()).exists());
    }

    #[test]
    fn parse_error_reports_line_and_blocks_updates() {
        let t = tempdir().unwrap();
        fs::create_dir(t.path().join(META_DIR)).unwrap();
        let broken = "# mine\n[navigator]\nsort = \n";
        fs::write(file(t.path()), broken).unwrap();
        let loaded = load_vault_settings_at(t.path());
        assert!(loaded.settings.is_none());
        assert_eq!(loaded.settings_error.unwrap().line, Some(3));
        let e = update_vault_settings_at(&vault(t.path(), false), &[change("navigator.sort", json!("name"))]).unwrap_err();
        assert_eq!(e.code, "CONFIG_INVALID");
        assert!(e.message.contains("settings.toml"), "{}", e.message);
        assert_eq!(fs::read_to_string(file(t.path())).unwrap(), broken);
    }

    #[test]
    fn read_only_vaults_are_refused() {
        let t = tempdir().unwrap();
        let e = update_vault_settings_at(&vault(t.path(), true), &[change("navigator.sort", json!("name"))]).unwrap_err();
        assert_eq!(e.code, "READ_ONLY");
        assert!(!t.path().join(META_DIR).exists());
    }

    #[test]
    fn oversized_file_is_reported_and_not_rewritten() {
        let t = tempdir().unwrap();
        fs::create_dir(t.path().join(META_DIR)).unwrap();
        fs::write(file(t.path()), vec![b'#'; MAX_SETTINGS_BYTES as usize + 1]).unwrap();
        let loaded = load_vault_settings_at(t.path());
        assert!(loaded.settings.is_none());
        let e = loaded.settings_error.unwrap();
        assert_eq!(e.line, None);
        assert!(e.message.contains("256 KiB"), "{}", e.message);
        let e = update_vault_settings_at(&vault(t.path(), false), &[change("a.b", json!(1))]).unwrap_err();
        assert_eq!(e.code, "INVALID_FILE");
        let big = "x".repeat(MAX_SETTINGS_BYTES as usize);
        let t2 = tempdir().unwrap();
        assert_eq!(update_vault_settings_at(&vault(t2.path(), false), &[change("a.b", json!(big))]).unwrap_err().code, "INVALID_FILE");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_file_or_metadata_folder_is_refused() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap();
        let root = t.path().join("root");
        let outside = t.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();

        // settings.toml -> file outside the vault
        fs::create_dir(root.join(META_DIR)).unwrap();
        let target = outside.join("settings.toml");
        fs::write(&target, "x = 1\n").unwrap();
        symlink(&target, file(&root)).unwrap();
        let loaded = load_vault_settings_at(&root);
        assert!(loaded.settings.is_none());
        assert!(loaded.settings_error.is_some());
        assert_eq!(update_vault_settings_at(&vault(&root, false), &[change("x.y", json!(2))]).unwrap_err().code, "INVALID_PATH");
        assert_eq!(fs::read_to_string(&target).unwrap(), "x = 1\n");

        // .excalidraw-vault -> folder outside the vault
        fs::remove_file(file(&root)).unwrap();
        fs::remove_dir(root.join(META_DIR)).unwrap();
        symlink(&outside, root.join(META_DIR)).unwrap();
        assert!(load_vault_settings_at(&root).settings_error.is_some());
        assert_eq!(update_vault_settings_at(&vault(&root, false), &[change("x.y", json!(2))]).unwrap_err().code, "INVALID_PATH");
        assert_eq!(fs::read_to_string(&target).unwrap(), "x = 1\n");
    }

    #[test]
    fn settings_path_stays_inside_the_vault_metadata_folder() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        update_vault_settings_at(&v, &[change("files.new_drawing_folder", json!("../escape"))]).unwrap();
        let path = PathBuf::from(load_vault_settings_at(&v.root).path);
        assert_eq!(path, v.root.join(META_DIR).join(SETTINGS_FILE));
        assert!(dunce::canonicalize(path).unwrap().starts_with(&v.root));
        // Only the metadata folder was created in the vault root.
        let names: Vec<_> = fs::read_dir(&v.root).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(META_DIR)]);
        // The user-facing path API still refuses the metadata folder.
        assert!(super::super::safe_path(&v.root, &format!("{META_DIR}/{SETTINGS_FILE}"), true).is_err());
    }

    #[test]
    fn a_vault_names_its_profile_in_a_one_line_file_and_can_clear_it() {
        let t = tempdir().unwrap();
        let v = vault(t.path(), false);
        assert_eq!(vault_profile_at(t.path()), None);
        set_vault_profile_at(&v, Some("work")).unwrap();
        assert_eq!(vault_profile_at(t.path()).as_deref(), Some("work"));
        assert_eq!(set_vault_profile_at(&v, Some("../x")).unwrap_err().code, "INVALID_ARGUMENT");
        set_vault_profile_at(&v, None).unwrap();
        assert_eq!(vault_profile_at(t.path()), None);
        assert!(set_vault_profile_at(&vault(t.path(), true), Some("work")).is_err(), "a read-only vault is not written");
    }
}
