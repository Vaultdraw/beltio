//! Profiles: named sets of settings you switch between (like VS Code profiles or Neovim's
//! `NVIM_APPNAME`). A profile is a folder `profiles/<name>/` in the config folder:
//!
//! - `config.toml`: your hand-written keys, layered over the main `config.toml`
//! - `overrides.toml`: what Settings and `vaultdraw config set` save while the profile is active
//!
//! With no profile active (the default), nothing here is read and the config is as before.
//! The choice is `$VAULTDRAW_PROFILE` (also `vaultdraw --profile <name>`), else the one-line
//! file `profile` in the state folder (written by `vaultdraw profile use`).

use super::*;

pub const PROFILES_DIR: &str = "profiles";
pub const PROFILE_FILE: &str = "profile";
pub const PROFILE_ENV: &str = "VAULTDRAW_PROFILE";
/// The name that means "no profile": the main config and overrides.
pub const DEFAULT_PROFILE: &str = "default";
const MAX_NAME: usize = 48;

/// A profile name: 1 to 48 of `A-Z a-z 0-9 _ -`, and not `default` (reserved).
pub fn valid_profile_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !name.eq_ignore_ascii_case(DEFAULT_PROFILE)
}

fn check_name(name: &str) -> Result<()> {
    if valid_profile_name(name) {
        Ok(())
    } else {
        Err(err("INVALID_ARGUMENT", format!("Invalid profile name \"{name}\": use 1 to {MAX_NAME} letters, digits, _ or -, and not \"default\"")))
    }
}

impl Dirs {
    pub fn profiles_dir(&self) -> PathBuf {
        self.config.join(PROFILES_DIR)
    }
    pub fn profile_dir(&self, name: &str) -> PathBuf {
        self.profiles_dir().join(name)
    }
    pub fn profile_config_file(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join(CONFIG_FILE)
    }
    pub fn profile_overrides_file(&self, name: &str) -> PathBuf {
        self.profile_dir(name).join(OVERRIDES_FILE)
    }
    fn profile_pointer(&self) -> PathBuf {
        self.state.join(PROFILE_FILE)
    }
}

/// The active profile, or `None` for the default. A named profile whose folder is missing from
/// the state file counts as none (so deleting a folder by hand falls back to the default); the
/// environment variable is trusted, so `--profile new-name` can start a profile from scratch.
pub fn active_profile(dirs: &Dirs) -> Option<String> {
    active_profile_with(dirs, std::env::var(PROFILE_ENV).ok().as_deref())
}

pub fn active_profile_with(dirs: &Dirs, env: Option<&str>) -> Option<String> {
    if let Some(e) = env.map(str::trim).filter(|e| !e.is_empty()) {
        return valid_profile_name(e).then(|| e.to_owned());
    }
    let text = fs::read_to_string(dirs.profile_pointer()).ok()?;
    let name = text.trim();
    (valid_profile_name(name) && dirs.profile_dir(name).is_dir()).then(|| name.to_owned())
}

/// Profile folders, sorted by name (real folders only, with a valid name).
pub fn list_profiles(dirs: &Dirs) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dirs.profiles_dir()) else { return Vec::new() };
    let mut out: Vec<String> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| valid_profile_name(n))
        .collect();
    out.sort_by_key(|n| n.to_lowercase());
    out
}

fn exists_ci(dirs: &Dirs, name: &str) -> bool {
    list_profiles(dirs).iter().any(|n| n.eq_ignore_ascii_case(name))
}

fn profile_header(name: &str) -> String {
    format!("# Profile \"{name}\": layered over config.toml (same keys), above it and below Settings changes.\n# Put the keys, hotkeys and settings only this profile should change here.\n")
}

/// Creates a profile. `from` copies another profile's files (`default` copies the Settings
/// changes in `overrides.toml`; the shared `config.toml` is the base of every profile anyway).
/// Never overwrites: an existing name is an error.
pub fn create_profile(dirs: &Dirs, name: &str, from: Option<&str>) -> Result<()> {
    check_name(name)?;
    let _guard = write_guard()?;
    if exists_ci(dirs, name) {
        return Err(err("NAME_COLLISION", format!("Profile \"{name}\" already exists")));
    }
    let (config_src, overrides_src) = match from {
        None => (None, None),
        Some(f) if f.eq_ignore_ascii_case(DEFAULT_PROFILE) => (None, Some(dirs.overrides_file_of(None))),
        Some(f) => {
            check_name(f)?;
            if !dirs.profile_dir(f).is_dir() {
                return Err(err("NOT_FOUND", format!("Profile \"{f}\" does not exist")));
            }
            (Some(dirs.profile_config_file(f)), Some(dirs.profile_overrides_file(f)))
        }
    };
    fs::create_dir_all(dirs.profiles_dir()).map_err(ioerr)?;
    // Built in a temporary folder and renamed into place: a failed copy leaves no half-made profile.
    let tmp = dirs.profiles_dir().join(format!(".new-{name}"));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir(&tmp).map_err(ioerr)?;
    let built = (|| -> Result<()> {
    let copy = |src: Option<PathBuf>, dst: PathBuf, fallback: Option<String>| -> Result<()> {
        match src.map(|s| read_toml_text(&s, "profile file", MAX_CONFIG_BYTES)) {
            Some(Ok(text)) => write_atomic_new(&dst, text.as_bytes()),
            Some(Err(e)) if e.code != "NOT_FOUND" => Err(e),
            _ => fallback.map_or(Ok(()), |t| write_atomic_new(&dst, t.as_bytes())),
        }
    };
    copy(config_src, tmp.join(CONFIG_FILE), Some(profile_header(name)))?;
    copy(overrides_src, tmp.join(OVERRIDES_FILE), None)
    })();
    if let Err(e) = built {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    crate::fsops::rename_no_replace(&tmp, &dirs.profile_dir(name)).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            err("NAME_COLLISION", format!("Profile \"{name}\" already exists"))
        } else {
            ioerr(e)
        }
    })
}

/// Moves a profile folder to `profiles/.removed/` (recoverable by hand; the caller asks first). If it was the saved choice, the default
/// applies again. A profile named by `$VAULTDRAW_PROFILE` stays selected and starts empty.
pub fn delete_profile(dirs: &Dirs, name: &str) -> Result<()> {
    check_name(name)?;
    let _guard = write_guard()?;
    let dir = dirs.profile_dir(name);
    let meta = fs::symlink_metadata(&dir).map_err(|_| err("NOT_FOUND", format!("Profile \"{name}\" does not exist")))?;
    if !meta.is_dir() {
        return Err(err("INVALID_PATH", format!("profiles/{name} is not a folder")));
    }
    let removed = dirs.profiles_dir().join(".removed");
    fs::create_dir_all(&removed).map_err(ioerr)?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut moved = false;
    for n in 0..1000u32 {
        let to = removed.join(if n == 0 { format!("{name}-{stamp}") } else { format!("{name}-{stamp}-{n}") });
        match crate::fsops::rename_no_replace(&dir, &to) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            r => {
                r.map_err(ioerr)?;
                moved = true;
                break;
            }
        }
    }
    if !moved {
        return Err(err("CONFLICT", "Too many removed copies of that profile"));
    }
    if fs::read_to_string(dirs.profile_pointer()).is_ok_and(|t| t.trim() == name) {
        let _ = fs::remove_file(dirs.profile_pointer());
    }
    Ok(())
}

/// Saves the choice: `Some(name)` (an existing profile) or `None` / `default` for no profile.
pub fn use_profile(dirs: &Dirs, name: Option<&str>) -> Result<()> {
    let _guard = write_guard()?;
    match name.filter(|n| !n.eq_ignore_ascii_case(DEFAULT_PROFILE)) {
        None => match fs::remove_file(dirs.profile_pointer()) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(ioerr(e)),
        },
        Some(n) => {
            check_name(n)?;
            if !dirs.profile_dir(n).is_dir() {
                return Err(err("NOT_FOUND", format!("Profile \"{n}\" does not exist. Create it with `vaultdraw profile new {n}`")));
            }
            fs::create_dir_all(&dirs.state).map_err(ioerr)?;
            write_atomic(&dirs.profile_pointer(), format!("{n}\n").as_bytes())
        }
    }
}

/// The profile layer of `read_layers`: the active profile's `config.toml`.
pub(super) fn profile_layer(dirs: &Dirs, name: &str) -> LayerInfo {
    let path = dirs.profile_config_file(name);
    let mut l = read_layer(254, "profile", &path, &format!("{PROFILES_DIR}/{name}/{CONFIG_FILE}"), MAX_CONFIG_BYTES);
    // Like overrides.toml, a profile file never pulls in other files.
    if l.config.as_ref().is_some_and(|c| c.get("include").is_some()) {
        l.config.as_mut().and_then(|c| c.as_object_mut()).map(|m| m.remove("include"));
    }
    l
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn dirs(root: &Path) -> Dirs {
        Dirs { config: root.join("config"), state: root.join("state") }
    }

    #[test]
    fn names_are_checked() {
        for ok in ["work", "Work-2", "a_b", "x"] {
            assert!(valid_profile_name(ok), "{ok}");
        }
        for bad in ["", "default", "Default", "a b", "a/b", "..", ".x", &"x".repeat(49)] {
            assert!(!valid_profile_name(bad), "{bad}");
        }
    }

    #[test]
    fn no_profile_by_default_and_the_state_file_or_env_selects() {
        let t = tempdir().unwrap();
        let d = dirs(t.path());
        assert_eq!(active_profile_with(&d, None), None);
        create_profile(&d, "work", None).unwrap();
        use_profile(&d, Some("work")).unwrap();
        assert_eq!(active_profile_with(&d, None).as_deref(), Some("work"));
        assert_eq!(active_profile_with(&d, Some("play")).as_deref(), Some("play"), "env wins and may name a new profile");
        assert_eq!(active_profile_with(&d, Some("default")), None, "env \"default\" is not a name");
        use_profile(&d, Some("default")).unwrap();
        assert_eq!(active_profile_with(&d, None), None);
    }

    #[test]
    fn a_profile_overlays_config_and_gets_its_own_overrides() {
        let t = tempdir().unwrap();
        let d = dirs(t.path());
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config_file(), "[editor]\nfont_size = 14\n[interface]\nzoom = 120\n").unwrap();
        create_profile(&d, "work", None).unwrap();
        fs::write(d.profile_config_file("work"), "[editor]\nfont_size = 18\n").unwrap();
        use_profile(&d, Some("work")).unwrap();
        let cfg = layered_config_in(&d).unwrap();
        assert_eq!(cfg["editor"]["font_size"], 18);
        assert_eq!(cfg["interface"]["zoom"], 120, "the base config.toml still applies");
        // Settings writes go to the profile's overrides.toml, not the main one.
        update_overrides_in(&d, &[LayerChange { key: "interface.zoom".into(), value: serde_json::json!(90), default: None }]).unwrap();
        assert!(fs::read_to_string(d.profile_overrides_file("work")).unwrap().contains("zoom = 90"));
        assert!(!d.overrides_file_of(None).exists());
        assert_eq!(layered_config_in(&d).unwrap()["interface"]["zoom"], 90);
        // Back to the default: the profile's values are gone from the effective config.
        use_profile(&d, None).unwrap();
        let cfg = layered_config_in(&d).unwrap();
        assert_eq!(cfg["editor"]["font_size"], 14);
        assert_eq!(cfg["interface"]["zoom"], 120);
    }

    #[test]
    fn create_copies_never_overwrites_and_delete_falls_back() {
        let t = tempdir().unwrap();
        let d = dirs(t.path());
        fs::create_dir_all(&d.state).unwrap();
        fs::write(d.overrides_file_of(None), "[interface]\nzoom = 80\n").unwrap();
        create_profile(&d, "a", Some("default")).unwrap();
        assert!(fs::read_to_string(d.profile_overrides_file("a")).unwrap().contains("zoom = 80"));
        fs::write(d.profile_config_file("a"), "[editor]\nfont_size = 22\n").unwrap();
        create_profile(&d, "b", Some("a")).unwrap();
        assert!(fs::read_to_string(d.profile_config_file("b")).unwrap().contains("22"));
        assert_eq!(create_profile(&d, "B", None).unwrap_err().code, "NAME_COLLISION");
        assert_eq!(create_profile(&d, "c", Some("nope")).unwrap_err().code, "NOT_FOUND");
        assert!(!d.profile_dir("c").exists(), "a failed copy leaves nothing behind");
        use_profile(&d, Some("b")).unwrap();
        delete_profile(&d, "b").unwrap();
        assert_eq!(active_profile_with(&d, None), None);
        assert_eq!(list_profiles(&d), vec!["a".to_string()]);
        assert_eq!(delete_profile(&d, "b").unwrap_err().code, "NOT_FOUND");
        assert_eq!(use_profile(&d, Some("b")).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn a_copy_that_fails_leaves_no_profile_and_delete_keeps_a_recoverable_copy() {
        let t = tempfile::tempdir().unwrap();
        let d = dirs(t.path());
        create_profile(&d, "a", None).unwrap();
        fs::write(d.profile_config_file("a"), vec![b'#'; MAX_CONFIG_BYTES as usize + 1]).unwrap();
        assert!(create_profile(&d, "big", Some("a")).is_err());
        assert!(!d.profile_dir("big").exists());
        assert_eq!(list_profiles(&d), vec!["a".to_string()]);
        let leftovers: Vec<_> = fs::read_dir(d.profiles_dir()).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "no .new-big folder remains");
        delete_profile(&d, "a").unwrap();
        assert_eq!(list_profiles(&d), Vec::<String>::new());
        assert_eq!(fs::read_dir(d.profiles_dir().join(".removed")).unwrap().count(), 1);
        create_profile(&d, "a", None).unwrap();
        delete_profile(&d, "a").unwrap();
        assert_eq!(fs::read_dir(d.profiles_dir().join(".removed")).unwrap().count(), 2);
    }
}
