//! Launch crash counter and safe mode. `<state>/plugins-launch.json` records whether the previous
//! launch ended cleanly; two unclean launches with plugins enabled start the next one in safe mode.
use super::manifest::is_valid_id;
use crate::{config, err, read_bounded, write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::OnceLock, time::Instant};

const FILE: &str = "plugins-launch.json";
const MAX_BYTES: u64 = 64 * 1024;
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
/// Consecutive crashed launches that trigger safe mode.
pub(crate) const CRASH_LIMIT: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Reason {
    User,
    Crashes,
    Modifier,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeMode {
    pub reason: Reason,
    pub crashed_launches: u32,
    pub plugins_at_crash: Vec<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Launch {
    /// Set at launch, cleared by `plugins_launch_ok` or a clean exit.
    in_progress: bool,
    crashed_launches: u32,
    /// Plugins enabled by the launch that set `in_progress`.
    plugins: Vec<String>,
    /// One-shot request from "Restart in safe mode".
    safe_mode_next: bool,
}

/// This launch's safe mode, set once by `begin`.
static CURRENT: OnceLock<Option<SafeMode>> = OnceLock::new();

pub(crate) fn current() -> Option<SafeMode> {
    CURRENT.get().cloned().flatten()
}

fn load(dir: &Path) -> Launch {
    read_bounded(&dir.join(FILE), MAX_BYTES)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store(dir: &Path, l: &Launch) -> Result<()> {
    fs::create_dir_all(dir).map_err(crate::ioerr)?;
    let bytes = serde_json::to_vec(l).map_err(|e| err("INTERNAL", e.to_string()))?;
    write_atomic(&dir.join(FILE), &bytes)
}

/// Pure transition: the safe mode for this launch and the record to persist.
fn next_launch(prev: &Launch, enabled: &[String], modifier: bool) -> (Option<SafeMode>, Launch) {
    let crashed = if prev.in_progress && !prev.plugins.is_empty() { prev.crashed_launches + 1 } else { 0 };
    let reason = if prev.safe_mode_next {
        Some(Reason::User)
    } else if modifier {
        Some(Reason::Modifier)
    } else if crashed >= CRASH_LIMIT {
        Some(Reason::Crashes)
    } else {
        None
    };
    match reason {
        // Safe mode loads nothing, so the next launch starts from a clean counter.
        Some(reason) => {
            let mode = SafeMode { reason, crashed_launches: crashed, plugins_at_crash: prev.plugins.clone() };
            (Some(mode), Launch { in_progress: true, ..Launch::default() })
        }
        None => (None, Launch { in_progress: true, crashed_launches: crashed, plugins: enabled.to_vec(), safe_mode_next: false }),
    }
}

/// `[plugins] enabled` from config.toml; anything unreadable counts as none.
fn enabled_plugins(config_file: &Path) -> Vec<String> {
    let Ok(text) = config::read_toml_text(config_file, "config.toml", MAX_CONFIG_BYTES) else { return Vec::new() };
    let Ok(table) = text.parse::<toml::Table>() else { return Vec::new() };
    table
        .get("plugins")
        .and_then(|p| p.get("enabled"))
        .and_then(|e| e.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|s| is_valid_id(s)).map(str::to_string).collect())
        .unwrap_or_default()
}

/// Whether Option is held right now (macOS only).
fn option_held() -> bool {
    #[cfg(target_os = "macos")]
    {
        objc2_app_kit::NSEvent::modifierFlags_class().contains(objc2_app_kit::NSEventModifierFlags::Option)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Runs in setup before the webview loads. Failures never block the launch.
pub(crate) fn begin() {
    let started = Instant::now();
    let mode = match config::resolve_dirs() {
        Ok(dirs) => {
            let enabled = enabled_plugins(&dirs.config_file());
            let (mode, record) = next_launch(&load(&dirs.state), &enabled, option_held());
            if let Err(e) = store(&dirs.state, &record) {
                eprintln!("vaultdraw: plugins launch state not written: {}", e.message);
            }
            mode
        }
        Err(_) => None,
    };
    let _ = CURRENT.set(mode);
    eprintln!("vaultdraw: plugins launch check {:.2} ms", started.elapsed().as_secs_f64() * 1000.0);
}

/// The launch finished cleanly (host started fine, or the app is exiting).
pub(crate) fn mark_ok() {
    let Ok(dirs) = config::resolve_dirs() else { return };
    let mut l = load(&dirs.state);
    if l.in_progress || l.crashed_launches != 0 {
        l.in_progress = false;
        l.crashed_launches = 0;
        let _ = store(&dirs.state, &l);
    }
}

/// Arms the one-shot safe-mode flag for the next launch.
pub(crate) fn request_safe_mode() -> Result<()> {
    let dirs = config::resolve_dirs()?;
    let mut l = load(&dirs.state);
    l.in_progress = false;
    l.safe_mode_next = true;
    store(&dirs.state, &l)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }
    fn crashed(n: u32) -> Launch {
        Launch { in_progress: true, crashed_launches: n, plugins: ids(&["a"]), safe_mode_next: false }
    }

    #[test]
    fn clean_previous_launch_resets_the_counter() {
        let prev = Launch { in_progress: false, crashed_launches: 1, plugins: ids(&["a"]), safe_mode_next: false };
        let (mode, rec) = next_launch(&prev, &ids(&["a"]), false);
        assert_eq!(mode, None);
        assert_eq!((rec.in_progress, rec.crashed_launches, rec.plugins), (true, 0, ids(&["a"])));
    }

    #[test]
    fn unclean_launch_with_plugins_counts() {
        let (mode, rec) = next_launch(&crashed(0), &ids(&["a"]), false);
        assert_eq!(mode, None);
        assert_eq!(rec.crashed_launches, 1);
    }

    #[test]
    fn unclean_launch_without_plugins_does_not_count() {
        let prev = Launch { in_progress: true, crashed_launches: 1, ..Launch::default() };
        let (mode, rec) = next_launch(&prev, &[], false);
        assert_eq!((mode, rec.crashed_launches), (None, 0));
    }

    #[test]
    fn two_crashes_enter_safe_mode_and_reset() {
        let (mode, rec) = next_launch(&crashed(1), &ids(&["a", "b"]), false);
        let mode = mode.unwrap();
        assert_eq!((mode.reason, mode.crashed_launches, mode.plugins_at_crash), (Reason::Crashes, 2, ids(&["a"])));
        assert_eq!((rec.crashed_launches, rec.plugins), (0, vec![]));
    }

    #[test]
    fn safe_mode_next_is_one_shot_and_beats_modifier() {
        let prev = Launch { safe_mode_next: true, ..Launch::default() };
        let (mode, rec) = next_launch(&prev, &ids(&["a"]), true);
        assert_eq!(mode.unwrap().reason, Reason::User);
        assert!(!rec.safe_mode_next);
        let (again, _) = next_launch(&rec, &ids(&["a"]), false);
        assert_eq!(again, None);
    }

    #[test]
    fn modifier_forces_safe_mode() {
        let (mode, _) = next_launch(&Launch::default(), &ids(&["a"]), true);
        assert_eq!(mode.unwrap().reason, Reason::Modifier);
    }

    #[test]
    fn record_round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Launch::default());
        store(dir.path(), &crashed(1)).unwrap();
        assert_eq!(load(dir.path()), crashed(1));
        fs::write(dir.path().join(FILE), "{broken").unwrap();
        assert_eq!(load(dir.path()), Launch::default());
    }

    #[test]
    fn enabled_ids_come_from_the_plugins_table() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("config.toml");
        assert!(enabled_plugins(&f).is_empty());
        fs::write(&f, "[plugins]\nenabled = [\"a-b\", \"Bad Id\", 3]\n").unwrap();
        assert_eq!(enabled_plugins(&f), ids(&["a-b"]));
        fs::write(&f, "not = [toml").unwrap();
        assert!(enabled_plugins(&f).is_empty());
    }
}
