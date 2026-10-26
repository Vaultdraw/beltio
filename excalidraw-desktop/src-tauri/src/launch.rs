//! Launch crash counter and safe start. `<state>/plugins-launch.json` records whether the previous
//! launch ended cleanly. Two scopes:
//! - `plugins`: two unclean launches with plugins enabled, the Option key at launch, or "Restart in
//!   safe mode" start with plugins off (P2b, unchanged).
//! - `core`: only by hand (`--safe`, `VAULTDRAW_SAFE=1`, "Restart in safe start"). Built-in
//!   extensions are off and plugins are not loaded.
//! `VAULTDRAW_NO_AUTO_SAFE=1` switches the crash counter off (test harnesses that kill the app).
//! The file keeps its P2b name so existing records still work.
use crate::plugins::is_valid_plugin_id;
use crate::{config, err, read_bounded, write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    time::Instant,
};
use tauri::AppHandle;

const FILE: &str = "plugins-launch.json";
const MAX_BYTES: u64 = 64 * 1024;
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
/// Consecutive crashed launches that trigger safe mode.
pub(crate) const CRASH_LIMIT: u32 = 2;
/// Command line flag for a core-only safe start.
pub(crate) const SAFE_FLAG: &str = "--safe";
const ENV_SAFE: &str = "VAULTDRAW_SAFE";
const ENV_NO_AUTO: &str = "VAULTDRAW_NO_AUTO_SAFE";
/// Event sent to the window when a second launch asks for a safe start.
pub(crate) const SAFE_REQUESTED_EVENT: &str = "launch-safe-requested";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Reason {
    User,
    Crashes,
    Modifier,
    Flag,
    Env,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Scope {
    Plugins,
    Core,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeStart {
    pub reason: Reason,
    pub scope: Scope,
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
    /// One-shot request from "Restart in safe mode" (plugins scope).
    safe_mode_next: bool,
    /// One-shot request from "Restart in safe start" (core scope).
    safe_start_next: bool,
}

/// What this launch was told by hand, read once from argv and the environment.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Triggers {
    pub modifier: bool,
    pub flag: bool,
    pub env: bool,
    pub no_auto: bool,
}

/// This launch's safe start, set once by `begin`.
static CURRENT: OnceLock<Option<SafeStart>> = OnceLock::new();

pub(crate) fn current() -> Option<SafeStart> {
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

/// Whether argv (without the program name) asks for a core-only safe start.
pub(crate) fn argv_has_safe<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> bool {
    args.into_iter().any(|a| a.as_ref() == SAFE_FLAG)
}

/// A variable counts as on when it is set to anything but empty, `0` or `false`.
fn env_on(v: Option<std::ffi::OsString>) -> bool {
    v.and_then(|v| v.into_string().ok()).is_some_and(|v| !matches!(v.trim(), "" | "0" | "false"))
}

fn triggers_now() -> Triggers {
    Triggers {
        modifier: option_held(),
        flag: argv_has_safe(std::env::args().skip(1)),
        env: env_on(std::env::var_os(ENV_SAFE)),
        no_auto: env_on(std::env::var_os(ENV_NO_AUTO)),
    }
}

/// Pure transition: the safe start for this launch and the record to persist.
/// Core triggers are all manual and win over the plugin ones.
fn next_launch(prev: &Launch, enabled: &[String], t: Triggers) -> (Option<SafeStart>, Launch) {
    let crashed = if !t.no_auto && prev.in_progress && !prev.plugins.is_empty() { prev.crashed_launches + 1 } else { 0 };
    let picked = if prev.safe_start_next {
        Some((Reason::User, Scope::Core))
    } else if t.flag {
        Some((Reason::Flag, Scope::Core))
    } else if t.env {
        Some((Reason::Env, Scope::Core))
    } else if prev.safe_mode_next {
        Some((Reason::User, Scope::Plugins))
    } else if t.modifier {
        Some((Reason::Modifier, Scope::Plugins))
    } else if crashed >= CRASH_LIMIT {
        Some((Reason::Crashes, Scope::Plugins))
    } else {
        None
    };
    match picked {
        // Safe start loads nothing, so the next launch starts from a clean counter.
        Some((reason, scope)) => {
            let mode = SafeStart { reason, scope, crashed_launches: crashed, plugins_at_crash: prev.plugins.clone() };
            (Some(mode), Launch { in_progress: !t.no_auto, ..Launch::default() })
        }
        None if t.no_auto => (None, Launch::default()),
        None => (None, Launch { in_progress: true, crashed_launches: crashed, plugins: enabled.to_vec(), ..Launch::default() }),
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
        .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|s| is_valid_plugin_id(s)).map(str::to_string).collect())
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
            let prev = load(&dirs.state);
            let (mode, record) = next_launch(&prev, &enabled, triggers_now());
            if record != prev {
                if let Err(e) = store(&dirs.state, &record) {
                    eprintln!("vaultdraw: launch state not written: {}", e.message);
                }
            }
            mode
        }
        Err(_) => None,
    };
    let _ = CURRENT.set(mode);
    eprintln!("vaultdraw: launch check {:.2} ms", started.elapsed().as_secs_f64() * 1000.0);
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

/// Arms the one-shot plugin safe-mode flag for the next launch.
pub(crate) fn request_safe_mode() -> Result<()> {
    let dirs = config::resolve_dirs()?;
    let mut l = load(&dirs.state);
    l.in_progress = false;
    l.safe_mode_next = true;
    store(&dirs.state, &l)
}

/// Arms the one-shot core safe-start flag for the next launch.
fn request_safe_start_in(dir: &Path) -> Result<()> {
    let mut l = load(dir);
    l.in_progress = false;
    l.safe_start_next = true;
    store(dir, &l)
}

/// Drops both one-shot requests (the restart that carried one was cancelled, or a normal restart
/// was asked for).
pub(crate) fn cancel_safe_mode() -> Result<()> {
    let dirs = config::resolve_dirs()?;
    cancel_safe_mode_in(&dirs.state)
}

fn cancel_safe_mode_in(dir: &Path) -> Result<()> {
    let mut l = load(dir);
    if l.safe_mode_next || l.safe_start_next {
        l.safe_mode_next = false;
        l.safe_start_next = false;
        store(dir, &l)?;
    }
    Ok(())
}

static NORMAL_RESTART: AtomicBool = AtomicBool::new(false);

/// Restarts through the normal quit path, then starts the app again in safe start (core only).
#[tauri::command]
pub(crate) async fn app_restart_safe(app: AppHandle) -> Result<()> {
    let dirs = config::resolve_dirs()?;
    tauri::async_runtime::spawn_blocking(move || request_safe_start_in(&dirs.state))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))??;
    set_normal_restart(false);
    crate::plugins::restart(&app);
    Ok(())
}

/// Restarts into a normal start: drops one-shot flags, and the next launch ignores `--safe` and
/// `VAULTDRAW_SAFE` that this one was started with.
#[tauri::command]
pub(crate) async fn app_restart_normally(app: AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(cancel_safe_mode).await.map_err(|e| err("INTERNAL", e.to_string()))??;
    set_normal_restart(true);
    crate::plugins::restart(&app);
    Ok(())
}

pub(crate) fn set_normal_restart(on: bool) {
    NORMAL_RESTART.store(on, Ordering::SeqCst);
}

/// Whether the pending restart is a "restart normally" one.
pub(crate) fn normal_restart_pending() -> bool {
    NORMAL_RESTART.load(Ordering::SeqCst)
}

/// A normal restart must not carry `--safe` or the safe env var into the new process.
pub(crate) fn without_safe(args: Vec<std::ffi::OsString>) -> Vec<std::ffi::OsString> {
    args.into_iter().filter(|a| a != SAFE_FLAG).collect()
}

/// Drops the safe env var from this process (the restarted app inherits the environment).
pub(crate) fn clear_safe_env() {
    std::env::remove_var(ENV_SAFE);
}

/// The settings reply: what `load_settings` returns plus this launch's safe start.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WithSafeStart<T: Serialize> {
    #[serde(flatten)]
    pub inner: T,
    pub safe_start: Option<SafeStart>,
}

pub(crate) fn with_safe_start<T: Serialize>(inner: T) -> WithSafeStart<T> {
    WithSafeStart { inner, safe_start: current() }
}

#[cfg(test)]
mod tests {
    use super::*;
    type T = Triggers;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }
    fn crashed(n: u32) -> Launch {
        Launch { in_progress: true, crashed_launches: n, plugins: ids(&["a"]), safe_mode_next: false, safe_start_next: false }
    }

    #[test]
    fn clean_previous_launch_resets_the_counter() {
        let prev = Launch { in_progress: false, crashed_launches: 1, plugins: ids(&["a"]), ..Launch::default() };
        let (mode, rec) = next_launch(&prev, &ids(&["a"]), T::default());
        assert_eq!(mode, None);
        assert_eq!((rec.in_progress, rec.crashed_launches, rec.plugins), (true, 0, ids(&["a"])));
    }

    #[test]
    fn unclean_launch_with_plugins_counts() {
        let (mode, rec) = next_launch(&crashed(0), &ids(&["a"]), T::default());
        assert_eq!(mode, None);
        assert_eq!(rec.crashed_launches, 1);
    }

    #[test]
    fn unclean_launch_without_plugins_does_not_count() {
        let prev = Launch { in_progress: true, crashed_launches: 1, ..Launch::default() };
        let (mode, rec) = next_launch(&prev, &[], T::default());
        assert_eq!((mode, rec.crashed_launches), (None, 0));
    }

    #[test]
    fn two_crashes_enter_safe_mode_and_reset() {
        let (mode, rec) = next_launch(&crashed(1), &ids(&["a", "b"]), T::default());
        let mode = mode.unwrap();
        assert_eq!((mode.reason, mode.scope, mode.crashed_launches, mode.plugins_at_crash), (Reason::Crashes, Scope::Plugins, 2, ids(&["a"])));
        assert_eq!((rec.crashed_launches, rec.plugins), (0, vec![]));
    }

    #[test]
    fn safe_mode_next_is_one_shot_and_beats_modifier() {
        let prev = Launch { safe_mode_next: true, ..Launch::default() };
        let (mode, rec) = next_launch(&prev, &ids(&["a"]), Triggers { modifier: true, ..T::default() });
        assert_eq!(mode.unwrap().reason, Reason::User);
        assert!(!rec.safe_mode_next);
        let (again, _) = next_launch(&rec, &ids(&["a"]), T::default());
        assert_eq!(again, None);
    }

    #[test]
    fn cancelled_restart_drops_the_safe_mode_request() {
        let dir = tempfile::tempdir().unwrap();
        store(dir.path(), &Launch { safe_mode_next: true, safe_start_next: true, ..Launch::default() }).unwrap();
        cancel_safe_mode_in(dir.path()).unwrap();
        assert_eq!(load(dir.path()), Launch::default());
        // Nothing armed: no write, no error.
        cancel_safe_mode_in(dir.path()).unwrap();
    }

    #[test]
    fn modifier_forces_safe_mode() {
        let (mode, _) = next_launch(&Launch::default(), &ids(&["a"]), Triggers { modifier: true, ..T::default() });
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

    fn by(t: Triggers) -> Option<(Reason, Scope)> {
        next_launch(&Launch::default(), &ids(&["a"]), t).0.map(|m| (m.reason, m.scope))
    }

    #[test]
    fn every_reason_maps_to_its_scope() {
        assert_eq!(by(T::default()), None);
        assert_eq!(by(Triggers { modifier: true, ..T::default() }), Some((Reason::Modifier, Scope::Plugins)));
        assert_eq!(by(Triggers { flag: true, ..T::default() }), Some((Reason::Flag, Scope::Core)));
        assert_eq!(by(Triggers { env: true, ..T::default() }), Some((Reason::Env, Scope::Core)));
        let (m, _) = next_launch(&Launch { safe_mode_next: true, ..Launch::default() }, &[], T::default());
        assert_eq!(m.map(|m| (m.reason, m.scope)), Some((Reason::User, Scope::Plugins)));
        let (m, rec) = next_launch(&Launch { safe_start_next: true, ..Launch::default() }, &[], T::default());
        assert_eq!(m.map(|m| (m.reason, m.scope)), Some((Reason::User, Scope::Core)));
        assert!(!rec.safe_start_next);
        let (m, _) = next_launch(&crashed(1), &ids(&["a"]), T::default());
        assert_eq!(m.map(|m| (m.reason, m.scope)), Some((Reason::Crashes, Scope::Plugins)));
    }

    #[test]
    fn core_triggers_win_over_plugin_ones_and_clear_both_flags() {
        let prev = Launch { safe_mode_next: true, safe_start_next: true, ..crashed(1) };
        let t = Triggers { modifier: true, flag: true, ..T::default() };
        let (m, rec) = next_launch(&prev, &ids(&["a"]), t);
        assert_eq!(m.map(|m| (m.reason, m.scope)), Some((Reason::User, Scope::Core)));
        assert!(!rec.safe_mode_next && !rec.safe_start_next);
        let (m, _) = next_launch(&Launch { safe_mode_next: true, ..Launch::default() }, &[], Triggers { env: true, ..T::default() });
        assert_eq!(m.map(|m| m.reason), Some(Reason::Env));
    }

    #[test]
    fn crashes_and_modifier_never_make_a_core_start() {
        assert_eq!(by(Triggers { modifier: true, ..T::default() }).unwrap().1, Scope::Plugins);
        let (m, _) = next_launch(&crashed(5), &ids(&["a"]), T::default());
        assert_eq!(m.unwrap().scope, Scope::Plugins);
    }

    #[test]
    fn no_auto_safe_turns_the_crash_counter_off() {
        let t = Triggers { no_auto: true, ..T::default() };
        let (m, rec) = next_launch(&crashed(5), &ids(&["a"]), t);
        assert_eq!(m, None);
        assert_eq!(rec, Launch::default());
        // Manual triggers still work, and nothing is left in progress to count later.
        let (m, rec) = next_launch(&crashed(5), &ids(&["a"]), Triggers { flag: true, ..t });
        assert_eq!(m.map(|m| (m.reason, m.crashed_launches)), Some((Reason::Flag, 0)));
        assert!(!rec.in_progress);
    }

    #[test]
    fn argv_flag_and_env_parse() {
        assert!(argv_has_safe(["--safe"]));
        assert!(argv_has_safe(["/a/b.excalidraw", "--safe"]));
        assert!(!argv_has_safe(["--safely", "safe", "/a/--safe/b"]));
        assert!(!argv_has_safe(Vec::<String>::new()));
        let os = |s: &str| Some(std::ffi::OsString::from(s));
        assert!(env_on(os("1")) && env_on(os("yes")));
        assert!(!env_on(None) && !env_on(os("")) && !env_on(os("0")) && !env_on(os("false")));
    }

    #[test]
    fn one_shot_core_flag_round_trips_and_cancels() {
        let dir = tempfile::tempdir().unwrap();
        request_safe_start_in(dir.path()).unwrap();
        let l = load(dir.path());
        assert!(l.safe_start_next && !l.in_progress);
        let (m, rec) = next_launch(&l, &[], T::default());
        assert_eq!(m.unwrap().scope, Scope::Core);
        store(dir.path(), &rec).unwrap();
        assert!(!load(dir.path()).safe_start_next);
        request_safe_start_in(dir.path()).unwrap();
        cancel_safe_mode_in(dir.path()).unwrap();
        assert!(!load(dir.path()).safe_start_next);
    }

    #[test]
    fn old_records_without_the_core_flag_still_load() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE), r#"{"inProgress":true,"crashedLaunches":1,"plugins":["a"],"safeModeNext":true}"#).unwrap();
        let l = load(dir.path());
        assert_eq!((l.in_progress, l.crashed_launches, l.safe_mode_next, l.safe_start_next), (true, 1, true, false));
    }

    #[test]
    fn normal_restart_drops_the_safe_flag_only() {
        let args: Vec<std::ffi::OsString> = ["app", "--safe", "x.excalidraw"].iter().map(Into::into).collect();
        assert_eq!(without_safe(args), vec![std::ffi::OsString::from("app"), "x.excalidraw".into()]);
    }

    #[test]
    fn settings_reply_carries_safe_start_flat() {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Inner {
            config_dir: String,
        }
        let none = serde_json::to_value(WithSafeStart { inner: Inner { config_dir: "/c".into() }, safe_start: None }).unwrap();
        assert_eq!(none, serde_json::json!({"configDir": "/c", "safeStart": null}));
        let s = SafeStart { reason: Reason::Flag, scope: Scope::Core, crashed_launches: 0, plugins_at_crash: ids(&["a"]) };
        let some = serde_json::to_value(WithSafeStart { inner: Inner { config_dir: "/c".into() }, safe_start: Some(s) }).unwrap();
        assert_eq!(
            some["safeStart"],
            serde_json::json!({"reason": "flag", "scope": "core", "crashedLaunches": 0, "pluginsAtCrash": ["a"]})
        );
        assert_eq!(some["configDir"], "/c");
    }
}
