//! Hang watchdog: when the page stops answering, a native Wait / Quit dialog.
//!
//! The trigger is WebKit's own responsiveness signal (macOS: the private
//! `_webViewWebProcessDidBecome{Unresponsive,Responsive}:` delegate callbacks, guarded; Linux:
//! WebKitGTK's public `is-web-process-responsive` property, `linux.rs`), so an
//! idle or healthy app pays nothing: no thread, no timer. A hang starts one short-lived grace
//! thread. Settings (`[watchdog] enabled`, `grace_ms`) are read from the config layers when a
//! hang starts, so they are always live. Design: `personal/feature/hang-watchdog/PLAN.md`.

pub mod machine;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(all(feature = "smoke-test", target_os = "macos"))]
pub mod smoke_driver;
#[cfg(target_os = "linux")]
mod linux;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

pub const DEFAULT_GRACE_MS: u64 = 5000;
pub const MIN_GRACE_MS: u64 = 1000;
pub const MAX_GRACE_MS: u64 = machine::MAX_GRACE_MS;
const RECORD_FILE: &str = "last-hang.json";

static FORCE_QUIT: AtomicBool = AtomicBool::new(false);

/// Set when the user chose Quit in the dialog: the exit handler then lets the process go
/// without asking the hung page to save first (it would never answer).
pub fn force_quit() -> bool {
    FORCE_QUIT.load(Ordering::SeqCst)
}

/// Hooks the watchdog onto the main window's web view. Cheap (a few selector checks and two
/// `class_addMethod` calls on the main thread); does nothing on platforms without a signal.
pub fn install(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install(window);
    #[cfg(target_os = "linux")]
    linux::install(window);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = window;
}

/// `VAULTDRAW_WATCHDOG_SMOKE=1` in a smoke-test build: the packaged hang check
/// (`scripts/watchdog-smoke.sh`). Smoke-test builds only; release builds don't have it.
#[cfg(feature = "smoke-test")]
pub fn smoke_requested() -> bool {
    std::env::var("VAULTDRAW_WATCHDOG_SMOKE").as_deref() == Ok("1")
}

/// `[watchdog]`, resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub enabled: bool,
    pub grace_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self { enabled: true, grace_ms: DEFAULT_GRACE_MS }
    }
}

/// Resolves `[watchdog]` from the config tables, highest layer first. A wrong type or an
/// out-of-range value counts as unset (the Settings page reports it as a problem).
pub fn settings_from(tables: &[toml::Table]) -> Settings {
    let value = |key: &str| tables.iter().find_map(|t| t.get("watchdog")?.get(key));
    let d = Settings::default();
    Settings {
        enabled: value("enabled").and_then(|v| v.as_bool()).unwrap_or(d.enabled),
        grace_ms: value("grace_ms")
            .and_then(whole_number)
            .filter(|n| (MIN_GRACE_MS..=MAX_GRACE_MS).contains(n))
            .unwrap_or(d.grace_ms),
    }
}

/// An integer, or a float with no fraction (`8000.0`): the Settings page accepts both.
fn whole_number(v: &toml::Value) -> Option<u64> {
    match v {
        toml::Value::Integer(n) => u64::try_from(*n).ok(),
        toml::Value::Float(f) if f.fract() == 0.0 && *f >= 0.0 && *f <= u64::MAX as f64 => Some(*f as u64),
        _ => None,
    }
}

/// Reads the settings now (a few tens of microseconds; only when a hang starts).
pub fn settings() -> Settings {
    match crate::config::resolve_dirs() {
        Ok(dirs) => settings_from(&vaultdraw_core::control_settings::layered_tables(&dirs)),
        Err(_) => Settings::default(),
    }
}

/// The last hang that reached the dialog. Local only, overwritten, never sent anywhere.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HangRecord {
    /// When the hang ended, in milliseconds since 1970.
    pub at_ms: u64,
    pub seconds_unresponsive: f64,
    /// "wait" is never stored: a hang ends as "recovered" or "quit".
    pub choice: String,
}

fn record_path() -> Option<std::path::PathBuf> {
    crate::config::resolve_dirs().ok().map(|d| d.state.join(RECORD_FILE))
}

pub(crate) fn write_record(seconds_unresponsive: f64, choice: machine::Choice) {
    let Some(path) = record_path() else { return };
    let at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let record = HangRecord { at_ms, seconds_unresponsive, choice: choice.as_str().into() };
    let Ok(bytes) = serde_json::to_vec(&record) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = crate::control::write_file_atomic(&path, &bytes) {
        eprintln!("vaultdraw: hang record not written: {e}");
    }
}

fn read_record(path: &std::path::Path) -> Option<HangRecord> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

/// `watchdog.showLastHang`: the last hang that reached the dialog, or `null`.
#[tauri::command]
pub async fn watchdog_last_hang() -> Option<HangRecord> {
    record_path().and_then(|p| read_record(&p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(texts: &[&str]) -> Vec<toml::Table> {
        texts.iter().map(|t| t.parse().unwrap()).collect()
    }

    #[test]
    fn defaults_when_unset() {
        assert_eq!(settings_from(&[]), Settings { enabled: true, grace_ms: 5000 });
        assert_eq!(settings_from(&tables(&["[editor]\nx = 1\n"])), Settings::default());
    }

    #[test]
    fn higher_layer_wins_key_by_key() {
        let s = settings_from(&tables(&["[watchdog]\nenabled = false\n", "[watchdog]\nenabled = true\ngrace_ms = 2000\n"]));
        assert_eq!(s, Settings { enabled: false, grace_ms: 2000 });
    }

    #[test]
    fn bad_values_count_as_unset() {
        for text in [
            "[watchdog]\nenabled = \"no\"\ngrace_ms = \"5\"\n",
            "[watchdog]\ngrace_ms = 999\n",
            "[watchdog]\ngrace_ms = 60001\n",
            "[watchdog]\ngrace_ms = -1\n",
            "[watchdog]\ngrace_ms = 2.5\n",
            "watchdog = 1\n",
        ] {
            assert_eq!(settings_from(&tables(&[text])), Settings::default(), "{text}");
        }
        // Like the other native keys: a bad value is the default, it does not fall through.
        let s = settings_from(&tables(&["[watchdog]\ngrace_ms = 5\n", "[watchdog]\ngrace_ms = 60000\n"]));
        assert_eq!(s.grace_ms, DEFAULT_GRACE_MS);
        let s = settings_from(&tables(&["[watchdog]\ngrace_ms = 1000\n"]));
        assert_eq!(s.grace_ms, 1000, "range ends are allowed");
        let s = settings_from(&tables(&["[watchdog]\ngrace_ms = 8000.0\n"]));
        assert_eq!(s.grace_ms, 8000, "a whole float counts, like in Settings");
    }

    #[test]
    fn record_round_trips_and_rejects_junk() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join(RECORD_FILE);
        assert_eq!(read_record(&p), None, "no file");
        let r = HangRecord { at_ms: 1, seconds_unresponsive: 9.5, choice: "quit".into() };
        std::fs::write(&p, serde_json::to_vec(&r).unwrap()).unwrap();
        assert_eq!(read_record(&p), Some(r));
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("\"atMs\"") && text.contains("\"secondsUnresponsive\""), "{text}");
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(read_record(&p), None);
        std::fs::write(&p, vec![b' '; 5000]).unwrap();
        assert_eq!(read_record(&p), None, "too big");
    }
}
