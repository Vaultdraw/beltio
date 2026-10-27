//! User configuration folder (`config.toml`, `themes/`) and machine state (`state.json`): the
//! Tauri commands and the config-dir watcher. The pure read/edit/write side is in
//! `vaultdraw_core::config` (shared with the offline CLI) and re-exported here.
// `run()` (and thus the command/watcher wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{err, ioerr, NativeError, Result};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value as Json;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub(crate) use vaultdraw_core::config::*;

const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_BATCH_DELAY: Duration = Duration::from_millis(1000);

pub(crate) fn resolve_dirs() -> Result<Dirs> {
    #[cfg(feature = "smoke-test")]
    let smoke_root = Some(std::env::temp_dir().join("vaultdraw-smoke"));
    #[cfg(not(feature = "smoke-test"))]
    let smoke_root: Option<PathBuf> = None;
    resolve_dirs_with(|k: &str| std::env::var_os(k), cfg!(windows), smoke_root.as_deref())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConfigChangeEvent {
    paths: Vec<String>,
}


// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn load_settings() -> Result<crate::launch::WithSafeStart<LoadedSettings>> {
    load_settings_in(&resolve_dirs()?).map(crate::launch::with_safe_start)
}

#[tauri::command]
pub(crate) async fn update_config(changes: Vec<LayerChange>) -> Result<()> {
    // Settings writes `overrides.toml` in the state folder; config.toml is yours alone.
    update_overrides_in(&resolve_dirs()?, &changes)
}

#[tauri::command]
pub(crate) async fn write_state(state: Json) -> Result<()> {
    write_state_in(&resolve_dirs()?, &state)
}

#[tauri::command]
pub(crate) async fn open_config_dir() -> Result<()> {
    let dirs = resolve_dirs()?;
    open_dir(&dirs.config)
}

/// Opens `config.toml` with the default app. It is created with the first launch; a missing
/// file is an error that says so, not a new empty file.
#[tauri::command]
pub(crate) async fn open_config_file() -> Result<()> {
    let path = resolve_dirs()?.config_file();
    if !path.is_file() {
        return Err(err("NOT_FOUND", format!("{} does not exist yet", path.display())));
    }
    launch(&[path.as_os_str()], false)
}

/// Shows `overrides.toml` in the file manager (its folder when the file does not exist yet:
/// nothing was changed in Settings).
#[tauri::command]
pub(crate) async fn reveal_overrides() -> Result<()> {
    let dirs = resolve_dirs()?;
    let path = dirs.overrides_file();
    if path.is_file() {
        launch(&[path.as_os_str()], true)
    } else {
        open_dir(&dirs.state)
    }
}

/// Opens an included file with the default app. Only a file that `config.toml` (or a file it
/// includes) names right now can be opened: the path comes from the page, so it is checked.
#[tauri::command]
pub(crate) async fn open_included_file(path: String) -> Result<()> {
    let wanted = PathBuf::from(&path);
    let found = layer_files(&resolve_dirs()?);
    if !found.files.contains(&wanted) || !wanted.is_file() {
        return Err(err("NOT_FOUND", format!("{path} is not an included file")));
    }
    launch(&[wanted.as_os_str()], false)
}

/// "Config: Check config files": every layer against the schema, with lines. Reads only.
#[tauri::command]
pub(crate) async fn config_check() -> Result<CheckReport> {
    Ok(check_config_in(&resolve_dirs()?))
}

/// "Config: Show debug info": the `vaultdraw doctor` report, from inside the app. Reads only.
/// The vault is the one the control API acts on (the first open vault).
#[tauri::command]
pub(crate) async fn doctor_report(app: AppHandle) -> Result<DoctorReport> {
    let dirs = resolve_dirs()?;
    let (socket, socket_state) = crate::control::socket_report();
    let input = DoctorInput {
        cli_version: None,
        app_version: Some(crate::control::APP_VERSION.into()),
        app_state: "this app".into(),
        api_level: vaultdraw_protocol::API_LEVEL,
        socket,
        socket_state,
        vault_from: "the app".into(),
        vault: crate::control_active_vault(&app).map(|v| v.root.clone()),
    };
    Ok(doctor_in(&dirs, &input))
}

/// Deletes `overrides.toml` (the confirmed "reset Settings changes"); `config.toml` is untouched.
/// Returns whether a file was deleted. The watcher reports the change like any other edit.
#[tauri::command]
pub(crate) async fn reset_overrides() -> Result<bool> {
    reset_overrides_in(&resolve_dirs()?)
}

/// Opens a file with the platform's default app, or (`reveal`) selects it in the file manager.
fn launch(args: &[&std::ffi::OsStr], reveal: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    let (program, lead): (&str, Vec<&std::ffi::OsStr>) = ("open", if reveal { vec!["-R".as_ref()] } else { vec![] });
    #[cfg(target_os = "windows")]
    let (program, lead): (&str, Vec<&std::ffi::OsStr>) = ("explorer", vec![]);
    #[cfg(target_os = "linux")]
    let (program, lead): (&str, Vec<&std::ffi::OsStr>) = ("xdg-open", vec![]);
    #[cfg(target_os = "linux")]
    let args: Vec<&std::ffi::OsStr> = if reveal { args.iter().filter_map(|a| Path::new(a).parent().map(Path::as_os_str)).collect() } else { args.to_vec() };
    #[cfg(target_os = "windows")]
    if reveal {
        // Explorer wants one argument: `/select,<path>`.
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(args[0]);
        return std::process::Command::new(program).arg(arg).spawn().map(|_| ()).map_err(ioerr);
    }
    std::process::Command::new(program).args(lead).args(args).spawn().map(|_| ()).map_err(ioerr)
}

/// Creates `dir` if missing and opens it in the platform file manager.
pub(crate) fn open_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(ioerr)?;
    let dir = dir.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(ioerr)
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/// Keeps the config-dir watcher alive for the lifetime of the app (managed state).
pub(crate) struct ConfigWatcher {
    _watcher: Arc<Mutex<RecommendedWatcher>>,
}

/// The included files and folders the watcher reports on. Events from the folders they sit in
/// (a dotfiles checkout, even `~`) are dropped in the notify callback unless they name one of these.
#[derive(Default)]
struct IncludeFilter {
    files: BTreeSet<PathBuf>,
    folders: BTreeSet<PathBuf>,
}

impl IncludeFilter {
    fn matches(&self, p: &Path) -> bool {
        self.files.contains(p)
            || self.folders.contains(p)
            || (p.extension().is_some_and(|x| x == "toml") && p.parent().is_some_and(|d| self.folders.contains(d)))
    }
}

/// Real path of `p`; for a file that does not exist yet, its real folder plus its name.
fn real_path(p: &Path) -> Option<PathBuf> {
    fs::canonicalize(p).ok().or_else(|| Some(fs::canonicalize(p.parent()?).ok()?.join(p.file_name()?)))
}

/// The path and, when it resolves, its real path: events carry either form (macOS reports
/// `/private/...`), and a file created later arrives under its folder's real path.
fn with_real(paths: impl IntoIterator<Item = PathBuf>) -> BTreeSet<PathBuf> {
    paths.into_iter().flat_map(|p| [real_path(&p), Some(p)]).flatten().collect()
}

/// Drops events from outside the config and state folders that do not name an included file or
/// folder. `None` means nothing is left of the event.
fn keep_include_event(roots: &[PathBuf], state_dirs: &[PathBuf], filter: &IncludeFilter, mut event: Event) -> Option<Event> {
    if event.paths.is_empty() {
        return Some(event);
    }
    let known = |p: &Path| {
        roots.iter().any(|r| p.starts_with(r))
            || p.parent().is_some_and(|d| state_dirs.iter().any(|s| s == d))
            || filter.matches(p)
    };
    event.paths.retain(|p| known(p));
    (!event.paths.is_empty()).then_some(event)
}

/// Which folders to start and stop watching to go from `current` to `wanted`.
fn plan_watches(current: &BTreeSet<PathBuf>, wanted: &BTreeSet<PathBuf>) -> (Vec<PathBuf>, Vec<PathBuf>) {
    (wanted.difference(current).cloned().collect(), current.difference(wanted).cloned().collect())
}

/// What `sync_includes` keeps between batches.
#[derive(Default)]
struct IncludeWatch {
    watched: BTreeSet<PathBuf>,
}

/// Brings the include watches in line with `config.toml` and what it includes. Folders inside the
/// config folder are already covered by its recursive watch. A watch that cannot be added is only
/// logged: that include then needs the Reload button.
fn sync_includes(watcher: &Mutex<RecommendedWatcher>, filter: &Mutex<IncludeFilter>, state: &Mutex<IncludeWatch>, dirs: &Dirs, roots: &[PathBuf]) {
    let found = layer_files(dirs);
    let wanted: BTreeSet<PathBuf> = found
        .dirs
        .iter()
        .filter(|d| d.is_dir() && !roots.iter().any(|r| d.starts_with(r)) && **d != dirs.state)
        .map(|d| fs::canonicalize(d).unwrap_or_else(|_| d.clone()))
        .collect();
    if let Ok(mut f) = filter.lock() {
        f.files = with_real(found.files);
        f.folders = with_real(found.folders);
    }
    let Ok(mut state) = state.lock() else { return };
    let (add, remove) = plan_watches(&state.watched, &wanted);
    if add.is_empty() && remove.is_empty() {
        return;
    }
    let Ok(mut w) = watcher.lock() else { return };
    for d in remove {
        let _ = w.unwatch(&d);
        state.watched.remove(&d);
    }
    for d in add {
        match w.watch(&d, RecursiveMode::NonRecursive) {
            Ok(()) => {
                state.watched.insert(d);
            }
            Err(e) => eprintln!("vaultdraw: not watching include folder {}: {e} (use Reload)", d.display()),
        }
    }
}

fn is_temp_file(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(TEMP_PREFIX))
}

/// Splits `<config>/library.excalidrawlib` out of a batch of changed paths: it is reported
/// by `library-change` instead of `config-change`. Returns the remaining paths and whether
/// the library file was among them.
fn split_library_paths(roots: &[PathBuf], paths: Vec<String>) -> (Vec<String>, bool) {
    let is_library = |p: &str| {
        let p = Path::new(p);
        p.parent().is_some_and(|d| roots.iter().any(|r| r == d)) && p.file_name().is_some_and(|n| n == super::library::LIBRARY_FILE)
    };
    let is_lock = |p: &str| Path::new(p).file_name().is_some_and(|n| n == super::library::LOCK_FILE);
    let (library, rest): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| is_library(p));
    (rest.into_iter().filter(|p| !is_lock(p)).collect(), !library.is_empty())
}

/// Drops the state-folder part of a watcher event: only `overrides.toml` there matters, so a
/// `state.json` write (every few seconds while you work) never starts a batch. Events outside
/// the state folder pass unchanged, because the theme registry reads their paths. `None` means
/// nothing is left of the event.
fn keep_state_event(state_dirs: &[PathBuf], mut event: Event) -> Option<Event> {
    if event.paths.is_empty() {
        return Some(event);
    }
    let in_state = |p: &Path| p.parent().is_some_and(|d| state_dirs.iter().any(|s| s == d));
    event.paths.retain(|p| !in_state(p) || (p.file_name().is_some_and(|n| n == OVERRIDES_FILE)));
    (!event.paths.is_empty()).then_some(event)
}

/// Watches the config dir recursively, and `overrides.toml` in the state dir, and emits
/// debounced `config-change` events.
pub(crate) fn start_watcher(app: &AppHandle) -> std::result::Result<ConfigWatcher, NativeError> {
    let dirs = resolve_dirs()?;
    {
        let _guard = write_guard()?;
        ensure_config_files(&dirs)?;
    }
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    // The state folder may not exist yet; it has to before it can be watched.
    let state_inside_config = dirs.state.starts_with(&dirs.config);
    let state_watched = !state_inside_config && fs::create_dir_all(&dirs.state).is_ok();
    let mut state_dirs = vec![dirs.state.clone()];
    if let Ok(real) = fs::canonicalize(&dirs.state) {
        state_dirs.push(real);
    }
    let app = app.clone();
    let root = dirs.config.clone();
    let mut roots = vec![dirs.config.clone()];
    if let Ok(real) = fs::canonicalize(&dirs.config) {
        roots.push(real);
    }
    let filter = Arc::new(Mutex::new(IncludeFilter::default()));
    let watcher_cell: Arc<Mutex<Option<Arc<Mutex<RecommendedWatcher>>>>> = Arc::new(Mutex::new(None));
    let include_state = Arc::new(Mutex::new(IncludeWatch::default()));
    let thread_state = include_state.clone();
    let thread_filter = filter.clone();
    let thread_cell = watcher_cell.clone();
    let thread_dirs = dirs.clone();
    let thread_roots = roots.clone();
    thread::Builder::new()
        .name("config-watcher".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut batch = vec![first];
                let started = Instant::now();
                // Trailing debounce: wait for DEBOUNCE of quiet, bounded by MAX_BATCH_DELAY.
                loop {
                    let left = MAX_BATCH_DELAY.saturating_sub(started.elapsed());
                    if left.is_zero() {
                        break;
                    }
                    match rx.recv_timeout(DEBOUNCE.min(left)) {
                        Ok(event) => batch.push(event),
                        Err(_) => break,
                    }
                }
                let mut paths = Vec::new();
                let mut failed = false;
                for event in batch {
                    match event {
                        Ok(e) => paths.extend(
                            e.paths
                                .into_iter()
                                .filter(|p| !is_temp_file(p))
                                .map(|p| p.to_string_lossy().into_owned()),
                        ),
                        Err(_) => failed = true,
                    }
                }
                paths.sort();
                paths.dedup();
                let (paths, library_changed) = split_library_paths(&thread_roots, paths);
                let mut paths = paths;
                if library_changed || failed {
                    super::library::emit_change(&app, None);
                }
                if paths.is_empty() && failed {
                    paths.push(root.to_string_lossy().into_owned());
                }
                if !paths.is_empty() {
                    super::control::events::config_changed();
                    let _ = app.emit("config-change", ConfigChangeEvent { paths });
                }
                // The include set may have changed with this batch.
                let watcher = thread_cell.lock().ok().and_then(|c| c.clone());
                if let Some(w) = watcher {
                    sync_includes(&w, &thread_filter, &thread_state, &thread_dirs, &thread_roots);
                }
            }
        })
        .map_err(ioerr)?;
    let callback_filter = filter.clone();
    let callback_roots = roots.clone();
    let callback_state = state_dirs.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let event = match event {
            Ok(e) => {
                let Some(e) = keep_state_event(&state_dirs, e) else { return };
                let kept = match callback_filter.lock() {
                    Ok(f) => keep_include_event(&callback_roots, &callback_state, &f, e),
                    Err(_) => Some(e),
                };
                match kept {
                    Some(e) => Ok(e),
                    None => return,
                }
            }
            err => err,
        };
        let _ = tx.send(event);
    })
    .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    watcher
        .watch(&dirs.config, RecursiveMode::Recursive)
        .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    if state_watched {
        // Best effort: without it a hand-edited overrides.toml needs the Reload button.
        let _ = watcher.watch(&dirs.state, RecursiveMode::NonRecursive);
    }
    let watcher = Arc::new(Mutex::new(watcher));
    // Included files: one pass now (a few microseconds without an `[include]`), then after every batch.
    sync_includes(&watcher, &filter, &include_state, &dirs, &roots);
    if let Ok(mut cell) = watcher_cell.lock() {
        *cell = Some(watcher.clone());
    }
    Ok(ConfigWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::EventKind;

    fn event(paths: &[&str]) -> Event {
        let mut e = Event::new(EventKind::Any);
        e.paths = paths.iter().map(PathBuf::from).collect();
        e
    }

    #[test]
    fn only_overrides_toml_passes_from_the_state_folder() {
        let state = vec![PathBuf::from("/s/vaultdraw")];
        assert!(keep_state_event(&state, event(&["/s/vaultdraw/state.json"])).is_none());
        assert!(keep_state_event(&state, event(&["/s/vaultdraw/.excalidraw-tmp-1"])).is_none());
        let kept = keep_state_event(&state, event(&["/s/vaultdraw/.excalidraw-tmp-1", "/s/vaultdraw/overrides.toml"])).unwrap();
        assert_eq!(kept.paths, vec![PathBuf::from("/s/vaultdraw/overrides.toml")]);
        // Config-folder events are untouched (the theme registry reads them), as are events with no path.
        let themes = keep_state_event(&state, event(&["/c/vaultdraw/themes/x.json"])).unwrap();
        assert_eq!(themes.paths, vec![PathBuf::from("/c/vaultdraw/themes/x.json")]);
        assert!(keep_state_event(&state, event(&[])).is_some());
        // A same-named file elsewhere is not the state folder's.
        assert!(keep_state_event(&state, event(&["/c/vaultdraw/sub/state.json"])).is_some());
    }

    /// Real watcher on a temp state folder: a state.json write emits nothing, overrides.toml does.
    #[test]
    fn a_state_json_write_emits_nothing_but_overrides_toml_does() {
        let t = tempfile::tempdir().unwrap();
        let state = t.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let mut dirs = vec![state.clone()];
        if let Ok(real) = fs::canonicalize(&state) {
            dirs.push(real);
        }
        let (tx, rx) = mpsc::channel();
        let mut w = notify::recommended_watcher(move |e: notify::Result<Event>| {
            if let Some(e) = e.ok().and_then(|e| keep_state_event(&dirs, e)) {
                let _ = tx.send(e);
            }
        })
        .unwrap();
        w.watch(&state, RecursiveMode::NonRecursive).unwrap();
        fs::write(state.join("state.json"), "{}").unwrap();
        fs::write(state.join("state.json"), "{\"a\":1}").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "state.json must not wake the loop");
        fs::write(state.join(OVERRIDES_FILE), "a = 1\n").unwrap();
        let e = rx.recv_timeout(Duration::from_secs(5)).expect("overrides.toml event");
        assert!(e.paths.iter().all(|p| p.file_name().is_some_and(|n| n == OVERRIDES_FILE)), "{:?}", e.paths);
    }

    fn filter(files: &[&str], folders: &[&str]) -> IncludeFilter {
        IncludeFilter { files: files.iter().map(PathBuf::from).collect(), folders: folders.iter().map(PathBuf::from).collect() }
    }

    #[test]
    fn include_events_pass_only_for_named_files_and_folders() {
        let roots = vec![PathBuf::from("/c/vaultdraw")];
        let state = vec![PathBuf::from("/s/vaultdraw")];
        let f = filter(&["/dots/colors.toml"], &["/dots/machine"]);
        let keep = |p: &str| keep_include_event(&roots, &state, &f, event(&[p])).is_some();
        assert!(keep("/c/vaultdraw/themes/x.json"), "config folder events are untouched");
        assert!(keep("/s/vaultdraw/overrides.toml"));
        assert!(keep("/dots/colors.toml"));
        assert!(keep("/dots/machine/new.toml"), "a toml created in a named folder");
        assert!(keep("/dots/machine"));
        assert!(!keep("/dots/other.toml"), "a neighbour in the same folder");
        assert!(!keep("/dots/machine/notes.txt"));
        assert!(!keep("/dots/machine/sub/deep.toml"));
        assert!(keep_include_event(&roots, &state, &f, event(&[])).is_some());
        let mixed = keep_include_event(&roots, &state, &f, event(&["/dots/other.toml", "/dots/colors.toml"])).unwrap();
        assert_eq!(mixed.paths, vec![PathBuf::from("/dots/colors.toml")]);
    }

    #[test]
    fn watch_plan_adds_and_removes_only_the_difference() {
        let set = |v: &[&str]| v.iter().map(PathBuf::from).collect::<BTreeSet<_>>();
        let (add, remove) = plan_watches(&set(&["/a", "/b"]), &set(&["/b", "/c"]));
        assert_eq!((add, remove), (vec![PathBuf::from("/c")], vec![PathBuf::from("/a")]));
        assert_eq!(plan_watches(&set(&["/a"]), &set(&["/a"])), (vec![], vec![]));
    }

    /// Real watcher: an include outside the config folder is watched after `sync_includes`, an
    /// edit to it reaches the callback, a neighbour file does not, and removing the `[include]`
    /// drops the watch.
    #[test]
    fn a_changed_include_outside_the_config_folder_emits_and_its_neighbour_does_not() {
        let t = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(t.path()).unwrap();
        let dirs = Dirs { config: root.join("config"), state: root.join("state") };
        let dots = root.join("dots");
        fs::create_dir_all(&dirs.config).unwrap();
        fs::create_dir_all(&dots).unwrap();
        fs::write(dirs.config.join("config.toml"), format!("[include]\nfiles = [{:?}]\n", dots.join("colors.toml").to_string_lossy())).unwrap();
        fs::write(dots.join("colors.toml"), "[editor]\nfont_size = 1\n").unwrap();
        let roots = vec![dirs.config.clone()];
        let filter = Arc::new(Mutex::new(IncludeFilter::default()));
        let (tx, rx) = mpsc::channel();
        let (cb_filter, cb_roots) = (filter.clone(), roots.clone());
        let watcher = notify::recommended_watcher(move |e: notify::Result<Event>| {
            if let Some(e) = e.ok().and_then(|e| keep_include_event(&cb_roots, &[], &cb_filter.lock().unwrap(), e)) {
                let _ = tx.send(e);
            }
        })
        .unwrap();
        let watcher = Mutex::new(watcher);
        let state = Mutex::new(IncludeWatch::default());
        sync_includes(&watcher, &filter, &state, &dirs, &roots);
        assert_eq!(state.lock().unwrap().watched.len(), 1);
        fs::write(dots.join("other.toml"), "x = 1\n").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err(), "a neighbour file must not wake the loop");
        fs::write(dots.join("colors.toml"), "[editor]\nfont_size = 2\n").unwrap();
        let e = rx.recv_timeout(Duration::from_secs(5)).expect("include event");
        assert!(e.paths.iter().all(|p| p.file_name().is_some_and(|n| n == "colors.toml")), "{:?}", e.paths);
        fs::write(dirs.config.join("config.toml"), "[editor]\nfont_size = 3\n").unwrap();
        sync_includes(&watcher, &filter, &state, &dirs, &roots);
        assert!(state.lock().unwrap().watched.is_empty(), "no [include]: no watch");
    }

    #[test]
    fn library_path_is_split_from_config_changes() {
        let root = &[PathBuf::from("/c/vaultdraw")];
        let s = |v: &[&str]| v.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        assert_eq!(split_library_paths(root, s(&["/c/vaultdraw/library.excalidrawlib"])), (vec![], true));
        // Our lock and temp files never count as a library (or config) change.
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/.library.excalidrawlib.lock"])),
            (vec![], false)
        );
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/config.toml", "/c/vaultdraw/library.excalidrawlib"])),
            (s(&["/c/vaultdraw/config.toml"]), true)
        );
        assert_eq!(
            split_library_paths(root, s(&["/c/vaultdraw/themes/library.excalidrawlib", "/c/vaultdraw/config.toml"])),
            (s(&["/c/vaultdraw/themes/library.excalidrawlib", "/c/vaultdraw/config.toml"]), false)
        );
    }

    /// FSEvents reports real paths: a config folder reached through a symlink (stowed dotfiles,
    /// `app/.cache -> ../.cache`) must still raise `library-change`.
    #[test]
    fn library_path_is_found_under_the_real_path_of_a_symlinked_config_folder() {
        let roots = &[PathBuf::from("/link/vaultdraw"), PathBuf::from("/real/vaultdraw")];
        let s = |v: &[&str]| v.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        assert_eq!(split_library_paths(roots, s(&["/real/vaultdraw/library.excalidrawlib"])), (vec![], true));
        assert_eq!(split_library_paths(roots, s(&["/link/vaultdraw/library.excalidrawlib"])), (vec![], true));
    }
}
