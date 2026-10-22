//! Which vault an offline command works on. Ladder, first hit wins:
//! `--vault` (explicit) > `$VAULTDRAW_VAULT` > `<state>/recent-vault` > the Tauri
//! `app_config_dir/recent-vault` (current identifier, then the pre-0.1.1 one). The result is
//! canonical and a directory, else `NO_VAULT`.
//!
//! The app writes `recent-vault` (one absolute path) into both the state dir and, as before, the
//! Tauri config dir; a perf or test instance with its own `$VAULTDRAW_STATE_DIR` is isolated by
//! the state-dir copy.

use crate::error::{err, ioerr, NativeError, Result};
use crate::fsops::write_atomic;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};
use vaultdraw_protocol::dirs::resolve_dirs_with;

pub use crate::migrate::{BUNDLE_ID, LEGACY_BUNDLE_ID};
pub const RECENT_VAULT_FILE: &str = "recent-vault";
pub const ENV_VAULT: &str = "VAULTDRAW_VAULT";

/// Platform table for [`app_config_dir_with`] and [`legacy_app_config_dir_with`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Macos,
    Windows,
    Other,
}
impl Os {
    pub const CURRENT: Os = if cfg!(target_os = "macos") {
        Os::Macos
    } else if cfg!(windows) {
        Os::Windows
    } else {
        Os::Other
    };
}

fn no_vault(detail: impl std::fmt::Display) -> NativeError {
    err("NO_VAULT", format!("{detail}; open the app once or pass --vault"))
}

/// Where Tauri's `app_config_dir()` points for [`BUNDLE_ID`].
pub fn app_config_dir_with(get: impl Fn(&str) -> Option<OsString>, os: Os) -> Option<PathBuf> {
    crate::migrate::app_config_dir_with(get, os, BUNDLE_ID)
}

/// Where Tauri's `app_config_dir()` pointed for [`LEGACY_BUNDLE_ID`] (releases before 0.1.1).
pub fn legacy_app_config_dir_with(get: impl Fn(&str) -> Option<OsString>, os: Os) -> Option<PathBuf> {
    crate::migrate::app_config_dir_with(get, os, LEGACY_BUNDLE_ID)
}

/// `path` as a canonical directory.
fn as_vault_dir(path: &Path) -> Result<PathBuf> {
    let canonical = path.canonicalize().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => no_vault(format!("{} does not exist", path.display())),
        _ => ioerr(e),
    })?;
    if !canonical.is_dir() {
        return Err(no_vault(format!("{} is not a directory", path.display())));
    }
    Ok(canonical)
}

/// The path stored in a `recent-vault` file (`<dir>/recent-vault`), if it names a directory.
fn read_recent(dir: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(dir.join(RECENT_VAULT_FILE)).ok()?;
    // Only the line ending goes: a folder name may end in a space. A relative path would resolve
    // against the caller's cwd, so it is ignored.
    let path = Path::new(text.strip_suffix('\n').map_or(text.as_str(), |t| t.strip_suffix('\r').unwrap_or(t)));
    if !path.is_absolute() {
        return None;
    }
    as_vault_dir(path).ok()
}

/// The ladder with an injected environment (`get`), platform and state dir.
pub fn resolve_with(explicit: Option<&Path>, get: impl Fn(&str) -> Option<OsString>, os: Os, state: &Path) -> Result<PathBuf> {
    // An explicit choice never falls through: a wrong `--vault` or `$VAULTDRAW_VAULT` is an error.
    if let Some(p) = explicit {
        return as_vault_dir(p);
    }
    if let Some(p) = get(ENV_VAULT).filter(|v| !v.is_empty()) {
        return as_vault_dir(Path::new(&p));
    }
    if let Some(p) = read_recent(state) {
        return Ok(p);
    }
    if let Some(p) = app_config_dir_with(&get, os).and_then(|d| read_recent(&d)) {
        return Ok(p);
    }
    if let Some(p) = legacy_app_config_dir_with(&get, os).and_then(|d| read_recent(&d)) {
        return Ok(p);
    }
    Err(no_vault("no vault is known"))
}

/// The ladder against the process environment and the real config/state dirs.
pub fn resolve(explicit: Option<&Path>) -> Result<PathBuf> {
    let get = |k: &str| std::env::var_os(k);
    let state = resolve_dirs_with(get, cfg!(windows), None).map_err(|m| err("CONFIG_DIR", m))?.state;
    resolve_with(explicit, get, Os::CURRENT, &state)
}

/// Records `vault` as the one the next launch (and the CLI) opens: `<state>/recent-vault`, atomically.
/// Reopening the same vault leaves the file alone (no fsync on the common path).
pub fn remember(state: &Path, vault: &Path) -> Result<()> {
    let file = state.join(RECENT_VAULT_FILE);
    let bytes = vault.to_string_lossy();
    if fs::read(&file).is_ok_and(|old| old == bytes.as_bytes()) {
        return Ok(());
    }
    fs::create_dir_all(state).map_err(ioerr)?;
    write_atomic(&file, bytes.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = vars.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |k| map.get(k).cloned()
    }
    fn vault(root: &Path, name: &str) -> PathBuf {
        let p = root.join(name);
        fs::create_dir_all(&p).unwrap();
        p.canonicalize().unwrap()
    }

    #[test]
    fn ladder_order_explicit_env_state_legacy() {
        let t = tempfile::tempdir().unwrap();
        let (a, b, c, d) = (vault(t.path(), "a"), vault(t.path(), "b"), vault(t.path(), "c"), vault(t.path(), "d"));
        let state = t.path().join("state");
        let home = t.path().join("home");
        let legacy = legacy_app_config_dir_with(env(&[("HOME", home.to_str().unwrap())]), Os::Macos).unwrap();
        remember(&state, &c).unwrap();
        remember_to(&legacy, &d);
        let vars = [("HOME", home.to_str().unwrap()), (ENV_VAULT, b.to_str().unwrap())];
        assert_eq!(resolve_with(Some(&a), env(&vars), Os::Macos, &state).unwrap(), a, "explicit wins");
        assert_eq!(resolve_with(None, env(&vars), Os::Macos, &state).unwrap(), b, "env next");
        let no_env = [("HOME", home.to_str().unwrap())];
        assert_eq!(resolve_with(None, env(&no_env), Os::Macos, &state).unwrap(), c, "state recent-vault next");
        fs::remove_file(state.join(RECENT_VAULT_FILE)).unwrap();
        let e = vault(t.path(), "e");
        remember_to(&app_config_dir_with(env(&no_env), Os::Macos).unwrap(), &e);
        assert_eq!(resolve_with(None, env(&no_env), Os::Macos, &state).unwrap(), e, "current app dir next");
        fs::remove_dir_all(app_config_dir_with(env(&no_env), Os::Macos).unwrap()).unwrap();
        assert_eq!(resolve_with(None, env(&no_env), Os::Macos, &state).unwrap(), d, "legacy last");
    }

    fn remember_to(dir: &Path, vault: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(RECENT_VAULT_FILE), format!("{}\n", vault.display())).unwrap();
    }

    #[test]
    fn nothing_known_is_no_vault_with_hint() {
        let t = tempfile::tempdir().unwrap();
        let e = resolve_with(None, env(&[("HOME", t.path().to_str().unwrap())]), Os::Macos, &t.path().join("state")).unwrap_err();
        assert_eq!(e.code, "NO_VAULT");
        assert!(e.message.contains("open the app once or pass --vault"), "{}", e.message);
    }

    #[test]
    fn explicit_and_env_do_not_fall_through() {
        let t = tempfile::tempdir().unwrap();
        let good = vault(t.path(), "good");
        let state = t.path().join("state");
        remember(&state, &good).unwrap();
        let missing = t.path().join("missing");
        let file = t.path().join("file.txt");
        fs::write(&file, "x").unwrap();
        assert_eq!(resolve_with(Some(&missing), env(&[]), Os::Other, &state).unwrap_err().code, "NO_VAULT");
        assert_eq!(resolve_with(Some(&file), env(&[]), Os::Other, &state).unwrap_err().code, "NO_VAULT");
        let bad_env = [(ENV_VAULT, missing.to_str().unwrap())];
        assert_eq!(resolve_with(None, env(&bad_env), Os::Other, &state).unwrap_err().code, "NO_VAULT");
        // An empty variable counts as unset.
        assert_eq!(resolve_with(None, env(&[(ENV_VAULT, "")]), Os::Other, &state).unwrap(), good);
    }

    #[test]
    fn stale_recent_vault_falls_to_the_next_rung() {
        let t = tempfile::tempdir().unwrap();
        let legacy_vault = vault(t.path(), "legacy");
        let state = t.path().join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join(RECENT_VAULT_FILE), t.path().join("deleted").to_str().unwrap()).unwrap();
        let home = t.path().join("home");
        remember_to(&legacy_app_config_dir_with(env(&[("XDG_CONFIG_HOME", home.to_str().unwrap())]), Os::Other).unwrap(), &legacy_vault);
        let vars = [("XDG_CONFIG_HOME", home.to_str().unwrap())];
        assert_eq!(resolve_with(None, env(&vars), Os::Other, &state).unwrap(), legacy_vault);
    }

    #[test]
    fn recent_vault_must_be_absolute_and_only_loses_its_line_ending() {
        let t = tempfile::tempdir().unwrap();
        let state = t.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let file = state.join(RECENT_VAULT_FILE);
        let a = vault(t.path(), "a");
        // A relative path is ignored, even when it would resolve from the cwd.
        fs::write(&file, "relative/vault").unwrap();
        assert!(read_recent(&state).is_none());
        for ending in ["", "\n", "\r\n"] {
            fs::write(&file, format!("{}{ending}", a.display())).unwrap();
            assert_eq!(read_recent(&state).unwrap(), a, "ending {ending:?}");
        }
        // A folder name ending in a space still resolves.
        let spaced = vault(t.path(), "spaced ");
        fs::write(&file, format!("{}\n", spaced.display())).unwrap();
        assert_eq!(read_recent(&state).unwrap(), spaced);
        fs::write(&file, "\n").unwrap();
        assert!(read_recent(&state).is_none());
    }

    #[test]
    fn legacy_dir_per_platform() {
        let g = env(&[("HOME", "/h"), ("APPDATA", "/ad"), ("XDG_CONFIG_HOME", "/x")]);
        assert_eq!(legacy_app_config_dir_with(&g, Os::Macos).unwrap(), PathBuf::from("/h/Library/Application Support/com.excalidraw.vault.local"));
        assert_eq!(legacy_app_config_dir_with(&g, Os::Windows).unwrap(), PathBuf::from("/ad/com.excalidraw.vault.local"));
        assert_eq!(legacy_app_config_dir_with(&g, Os::Other).unwrap(), PathBuf::from("/x/com.excalidraw.vault.local"));
        let h = env(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "rel")]);
        assert_eq!(legacy_app_config_dir_with(&h, Os::Other).unwrap(), PathBuf::from("/h/.config/com.excalidraw.vault.local"));
        assert!(legacy_app_config_dir_with(env(&[]), Os::Macos).is_none());
        assert_eq!(app_config_dir_with(&g, Os::Macos).unwrap(), PathBuf::from("/h/Library/Application Support/app.vaultdraw"));
    }

    #[test]
    fn remember_round_trips_and_replaces() {
        let t = tempfile::tempdir().unwrap();
        let (a, b) = (vault(t.path(), "a"), vault(t.path(), "b"));
        let state = t.path().join("deep/state");
        remember(&state, &a).unwrap();
        remember(&state, &b).unwrap();
        assert_eq!(read_recent(&state).unwrap(), b);
        // The same vault again leaves the file untouched.
        let file = state.join(RECENT_VAULT_FILE);
        let before = fs::metadata(&file).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        remember(&state, &b).unwrap();
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), before);
    }
}
