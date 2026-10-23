//! Lazy start of the per-vault services (D8). `open_vault` registers search and history and
//! starts natively those whose `start` mode in config.toml is "open" (history by default, so
//! no version is missed before the webview mounts). The webview starts the others per their
//! mode (`services_start`), and any native caller that needs a pending service starts it
//! first (`SearchService::vault`, `HistoryService::vault`, history's save path).

use crate::{config, err, history, links, search, Result};
use serde_json::Value as Json;
use std::{
    collections::HashMap,
    path::Path,
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, Once},
};
use tauri::State;

// ---- pending starts ----

struct Entry<T> {
    data: Mutex<Option<T>>,
    once: Once,
    cancelled: AtomicBool,
}

/// Registered-but-not-started services per vault handle. `ensure` runs the start once per
/// handle; concurrent callers for that handle wait for it, other handles never do (the map
/// lock is held only to look the entry up).
pub(crate) struct PendingStarts<T> {
    map: Mutex<HashMap<String, Arc<Entry<T>>>>,
}

impl<T> Default for PendingStarts<T> {
    fn default() -> Self {
        PendingStarts { map: Mutex::default() }
    }
}

impl<T> PendingStarts<T> {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Entry<T>>>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub(crate) fn register(&self, handle: &str, data: T) {
        let entry = Arc::new(Entry { data: Mutex::new(Some(data)), once: Once::new(), cancelled: AtomicBool::new(false) });
        if let Some(old) = self.map().insert(handle.to_string(), entry) {
            old.cancelled.store(true, Ordering::SeqCst);
        }
    }

    pub(crate) fn is_pending(&self, handle: &str) -> bool {
        self.map().contains_key(handle)
    }

    /// Runs `start` with the registered data if `handle` is pending, once. Returns true when
    /// the vault was closed (`cancel`) while it started: the caller must stop what it started.
    pub(crate) fn ensure(&self, handle: &str, start: impl FnOnce(T)) -> bool {
        let Some(entry) = self.map().get(handle).cloned() else { return false };
        entry.once.call_once(|| {
            let data = entry.data.lock().unwrap_or_else(|p| p.into_inner()).take();
            if let Some(data) = data {
                start(data);
            }
        });
        let mut map = self.map();
        if map.get(handle).is_some_and(|e| Arc::ptr_eq(e, &entry)) {
            map.remove(handle);
        }
        entry.cancelled.load(Ordering::SeqCst)
    }

    /// The vault closed: forget a pending start (a start in flight sees `cancelled`).
    pub(crate) fn cancel(&self, handle: &str) {
        if let Some(entry) = self.map().remove(handle) {
            entry.cancelled.store(true, Ordering::SeqCst);
        }
    }
}

// ---- modes and settings from config.toml ----

/// `[search|links|history] start`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Open,
    Idle,
    Use,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Modes {
    pub search: Mode,
    pub links: Mode,
    pub history: Mode,
}

fn mode(config: &Json, table: &str, default: Mode) -> Mode {
    match config.get(table).and_then(|t| t.get("start")).and_then(Json::as_str) {
        Some("open") => Mode::Open,
        Some("idle") => Mode::Idle,
        Some("use") => Mode::Use,
        _ => default,
    }
}

/// The modes in `config` (defaults: search and links idle, history open).
pub(crate) fn modes_of(config: &Json) -> Modes {
    Modes { search: mode(config, "search", Mode::Idle), links: mode(config, "links", Mode::Idle), history: mode(config, "history", Mode::Open) }
}

/// The global config.toml, or `null` when missing or invalid (every key then defaults).
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn read_config() -> Json {
    config::resolve_dirs()
        .ok()
        .and_then(|d| config::read_toml_text(&d.config.join("config.toml"), "config.toml", 1024 * 1024).ok())
        .and_then(|text| config::parse_config(&text).ok())
        .unwrap_or(Json::Null)
}

/// History settings as the webview would send them: `[history]` of config.toml, overridden
/// per key by the vault's settings.toml; invalid values keep the default, then clamped.
pub(crate) fn history_settings_of(config: &Json, vault: &Json) -> history::HistorySettings {
    let mut s = history::HistorySettings::default();
    for table in [config.get("history"), vault.get("history")].into_iter().flatten() {
        let num = |k: &str| table.get(k).and_then(Json::as_u64).and_then(|n| u32::try_from(n).ok());
        let flag = |k: &str| table.get(k).and_then(Json::as_bool);
        if let Some(v) = flag("enabled") { s.enabled = v; }
        if let Some(v) = num("interval_minutes") { s.interval_minutes = v; }
        if let Some(v) = num("keep_all_hours") { s.keep_all_hours = v; }
        if let Some(v) = num("keep_hourly_hours") { s.keep_hourly_hours = v; }
        if let Some(v) = num("keep_daily_days") { s.keep_daily_days = v; }
        if let Some(v) = num("keep_weekly_weeks") { s.keep_weekly_weeks = v; }
        if let Some(v) = num("size_cap_mb") { s.size_cap_mb = v; }
        if let Some(v) = flag("highlight_changes") { s.highlight_changes = v; }
    }
    s.clamped()
}

/// Loads the effective history settings of the vault at `root` from disk (native start).
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn load_history_settings(root: &Path) -> history::HistorySettings {
    let vault = crate::vault_settings::load_vault_settings_at(root).settings.unwrap_or(Json::Null);
    history_settings_of(&read_config(), &vault)
}

/// One service of `services_start`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Service {
    Search,
    /// Search plus the link index built from it, ready before the first links query.
    Links,
    History,
}

impl Service {
    pub(crate) fn parse(name: &str) -> Option<Service> {
        match name {
            "search" => Some(Service::Search),
            "links" => Some(Service::Links),
            "history" => Some(Service::History),
            _ => None,
        }
    }
}

/// Starts `service` for `handle` now if it is still pending. Idempotent.
pub(crate) fn start(service: Service, handle: &str, search: &search::SearchService, history: &history::HistoryService) {
    match service {
        Service::Search => search.ensure(handle),
        Service::Links => {
            if let Ok(vi) = search.vault(handle) {
                links::prewarm(vi);
            }
        }
        Service::History => history.ensure(handle),
    }
}

/// At vault open: starts natively every service whose mode is "open".
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn start_open(modes: &Modes, handle: &str, app: &tauri::AppHandle) {
    use tauri::Manager as _;
    let (Some(search), Some(history)) = (app.try_state::<search::SearchService>(), app.try_state::<history::HistoryService>()) else { return };
    for (mode, service) in [(modes.history, Service::History), (modes.search, Service::Search), (modes.links, Service::Links)] {
        if mode == Mode::Open {
            start(service, handle, &search, &history);
        }
    }
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn services_start(
    handle: String,
    service: String,
    search: State<'_, search::SearchService>,
    history: State<'_, history::HistoryService>,
) -> Result<()> {
    let service = Service::parse(&service).ok_or_else(|| err("INVALID_ARGUMENT", "Service must be search, links or history"))?;
    start(service, &handle, &search, &history);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_default_to_idle_idle_open_and_read_config() {
        // Review #5: history defaults to "open", which open_vault starts natively.
        let none = modes_of(&Json::Null);
        assert_eq!(none, Modes { search: Mode::Idle, links: Mode::Idle, history: Mode::Open });
        let cfg = serde_json::json!({"search": {"start": "use"}, "links": {"start": "open"}, "history": {"start": "bogus"}});
        assert_eq!(modes_of(&cfg), Modes { search: Mode::Use, links: Mode::Open, history: Mode::Open });
    }

    #[test]
    fn history_settings_merge_vault_over_global_and_skip_bad_values() {
        let global = serde_json::json!({"history": {"interval_minutes": 9, "enabled": false, "size_cap_mb": "x"}});
        let vault = serde_json::json!({"history": {"enabled": true, "keep_all_hours": 2, "interval_minutes": 99999}});
        let s = history_settings_of(&global, &vault);
        assert!(s.enabled);
        assert_eq!(s.interval_minutes, 24 * 60, "clamped");
        assert_eq!(s.keep_all_hours, 2);
        assert_eq!(s.size_cap_mb, history::HistorySettings::default().size_cap_mb);
        assert_eq!(history_settings_of(&Json::Null, &Json::Null), history::HistorySettings::default());
    }

    #[test]
    fn a_slow_start_blocks_only_callers_of_the_same_vault() {
        // Review #2: no global lock is held across a start.
        let pending: Arc<PendingStarts<u32>> = Arc::default();
        pending.register("a", 1);
        pending.register("b", 2);
        let started = Arc::new(Mutex::new(Vec::new()));
        let slow = {
            let (p, s) = (pending.clone(), started.clone());
            std::thread::spawn(move || {
                p.ensure("a", |v| {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    s.lock().unwrap().push(v);
                })
            })
        };
        std::thread::sleep(std::time::Duration::from_millis(50));
        let t = std::time::Instant::now();
        pending.ensure("b", |v| started.lock().unwrap().push(v));
        assert!(t.elapsed() < std::time::Duration::from_millis(200), "b waited for a");
        assert!(pending.is_pending("a"), "a is still starting");
        // A second caller for "a" waits for the first start and does not start again.
        pending.ensure("a", |_| panic!("started twice"));
        assert_eq!(*started.lock().unwrap(), vec![2, 1]);
        assert!(!slow.join().unwrap());
        assert!(!pending.is_pending("a"));
    }

    #[test]
    fn a_vault_closed_while_starting_is_reported() {
        let pending: Arc<PendingStarts<u32>> = Arc::default();
        pending.register("a", 1);
        let p = pending.clone();
        let closed = pending.ensure("a", move |_| p.cancel("a"));
        assert!(closed);
        assert!(!pending.ensure("a", |_| panic!("not pending any more")));
    }

    #[test]
    fn parses_the_three_services_only() {
        assert_eq!(Service::parse("search"), Some(Service::Search));
        assert_eq!(Service::parse("links"), Some(Service::Links));
        assert_eq!(Service::parse("history"), Some(Service::History));
        assert_eq!(Service::parse("graph"), None);
        assert_eq!(Service::parse(""), None);
    }

    #[test]
    fn links_start_starts_search_and_builds_the_link_index() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.excalidraw"), r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#).unwrap();
        let search = search::SearchService::default();
        search.register_with("h", dir.path().to_path_buf(), std::sync::Arc::new(|_| {}), None);
        let history = history::HistoryService::hard_off_for_tests(dir.path().join("state"));
        start(Service::Links, "h", &search, &history);
        assert!(!search.is_pending("h"));
        let vi = search.vault("h").unwrap();
        for _ in 0..400 {
            if vi.read().links().is_some() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        panic!("link index was not pre-built");
    }

    fn cpu_ms() -> f64 {
        // SAFETY: getrusage fills a plain struct for this process.
        let mut u: libc::rusage = unsafe { std::mem::zeroed() };
        unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) };
        let t = |v: libc::timeval| v.tv_sec as f64 * 1000.0 + v.tv_usec as f64 / 1000.0;
        t(u.ru_utime) + t(u.ru_stime)
    }

    fn rss_mb() -> f64 {
        std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map_or(0.0, |kb| kb / 1024.0)
    }

    /// Startup work of one vault open, eager (`start = "open"`, the old behaviour) vs
    /// registered (`idle`/`use`): CPU time and RSS growth in the first `WINDOW` after open,
    /// cold (no snapshot) and warm (snapshot present). Ignored by default:
    /// `cargo test --release bench_open_startup_work -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_open_startup_work() {
        const WINDOW: std::time::Duration = std::time::Duration::from_millis(1500);
        let count: usize = std::env::var("BENCH_DRAWINGS").ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let (bytes, _) = vaultdraw_core::search::testgen::generate(&root, count);
        println!("vault: {count} drawings, {:.1} MB", bytes as f64 / 1e6);
        let snap = dir.path().join("state/index.bin");
        let history = history::HistoryService::hard_off_for_tests(dir.path().join("hstate"));
        for (label, warm) in [("cold", false), ("warm", true)] {
            if !warm {
                let _ = std::fs::remove_file(&snap);
            }
            for eager in [true, false] {
                let svc = search::SearchService::default();
                let (c0, r0, t0) = (cpu_ms(), rss_mb(), std::time::Instant::now());
                svc.register_with("h", root.clone(), std::sync::Arc::new(|_| {}), Some(snap.clone()));
                if eager {
                    start(Service::Search, "h", &svc, &history);
                }
                std::thread::sleep(WINDOW);
                let (cpu, rss) = (cpu_ms() - c0, rss_mb() - r0);
                let ready = if eager {
                    while !svc.status("h").is_ok_and(|s| s.state == search::IndexState::Ready) {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    format!("{:.0} ms", t0.elapsed().as_secs_f64() * 1000.0)
                } else {
                    "-".into()
                };
                println!("{label} {:<6} first {}ms: cpu {cpu:.0} ms, rss +{rss:.1} MB, ready at {ready}", if eager { "open" } else { "lazy" }, WINDOW.as_millis());
                svc.stop("h");
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            // Leave a snapshot for the warm round.
            let svc = search::SearchService::default();
            svc.start_with("h", root.clone(), std::sync::Arc::new(|_| {}), Some(snap.clone()));
            while !svc.status("h").is_ok_and(|s| s.state == search::IndexState::Ready) {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            std::thread::sleep(std::time::Duration::from_secs(6)); // snapshot save is debounced 5 s
            svc.stop("h");
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }
}

