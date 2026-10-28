use notify::Event;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "macos")]
mod app_menu;
mod backup;
mod clipboard;
mod config;
mod control;
mod drawing_copy;
mod external;
mod import_folder;
mod links;
mod search;
mod services;
mod launch;
mod library;
mod markdown;
mod notes;
mod note_assets;
mod memory;
mod pdf_import;
mod plugins;
mod pressure;
mod refresh_rate;
mod templates;
mod snippets;
mod network;
mod theme_catalogue;
mod theme_install;
mod themes;
mod vault_settings;
mod vault_watch;
mod history;
mod thumbs;
mod ui_activity;
#[cfg(test)]
mod test_alloc;
#[cfg(feature = "smoke-test")]
mod smoke;
mod watchdog;
mod window_chrome;
#[cfg(test)]
mod plugin_dist_tests;
#[cfg(feature = "smoke-test")]
mod hidden_render;

// Vault logic without a UI lives in `vaultdraw-core`; these re-exports keep the app's modules
// (history, thumbs, links, ...) compiling against `crate::{err, safe_path, ...}` unchanged.
pub(crate) use vaultdraw_core::lock as vault_lock;
pub(crate) use vaultdraw_core::{
    create_folder_at, current_revision, drawing_read_only_at, drawing_revision_at, ensure_json, ensure_no_sibling_collision, err, ioerr, list_directory_in, move_entry_paths, mutation_guard,
    now_ms, random_id, read_bounded, read_drawing_file, read_drawing_parts, recovery_reveal_target, revision, safe_path,
    sync_dirs, validate_relative, write_atomic, write_atomic_new, write_drawing_file, write_drawing_file_rewrite,
    writable, NativeError, DrawingFile, RecoveryEntry, Result, VaultEntry, MAX_DRAWING_BYTES, META_DIR,
};

// Test builds use the counting allocator in test_alloc.rs (a crate has one global allocator).
#[cfg(not(test))]
#[global_allocator]
static ALLOC: memory::ProcessAlloc = memory::PROCESS_ALLOC;

/// Exported files (PNG, SVG, multi-page PDF) may be much larger than a drawing.
const MAX_EXPORT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    handle: String,
    path: String,
    name: String,
    read_only: bool,
    /// Why the vault opened read-only (None when writable).
    read_only_reason: Option<vault_lock::ReadOnlyReason>,
    /// The other Vaultdraw process holding the lock, when that is the reason.
    lock_holder_pid: Option<u32>,
    /// Set when the file watcher could not start natively (Linux inotify limit) and the vault
    /// is polled instead; the UI tells the user once.
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_fallback: Option<vault_watch::Fallback>,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultChange {
    handle: String,
    paths: Vec<String>,
    rescan: bool,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, allow(dead_code))]
struct VaultSettingsChange {
    handle: String,
}
/// An open vault in the app: the shared core vault plus the file watcher. Derefs to the core
/// vault, so `v.root`, `v.handle` and the core functions work on it unchanged.
pub(crate) struct Vault {
    core: vaultdraw_core::Vault,
    /// The file watcher; `None` while `files.auto_reload` is off (or no watcher could start).
    watcher: Mutex<Option<vault_watch::Watching>>,
    /// Where the watcher's events go, kept so the watcher can be started again live.
    watch_tx: mpsc::Sender<notify::Result<Event>>,
}
impl Vault {
    #[cfg(test)]
    pub(crate) fn for_tests(root: PathBuf, handle: &str, read_only: bool) -> Vault {
        Vault {
            core: vaultdraw_core::Vault::new(root, handle.into(), read_only, None),
            watcher: Mutex::new(None),
            watch_tx: mpsc::channel().0,
        }
    }
    /// Starts or stops the file watcher (`files.auto_reload`). Returns true when it was started
    /// just now (events may have been missed while it was off, so the caller asks for a rescan).
    fn set_watching(&self, on: bool) -> bool {
        let mut slot = self.watcher.lock().unwrap_or_else(|p| p.into_inner());
        if !on {
            *slot = None;
            return false;
        }
        if slot.is_some() {
            return false;
        }
        *slot = vault_watch::start(&self.root, self.watch_tx.clone()).watching;
        slot.is_some()
    }
    fn is_watching(&self) -> bool {
        self.watcher.lock().unwrap_or_else(|p| p.into_inner()).is_some()
    }
    /// Tells the content index about an in-app change when no watcher will (`files.auto_reload`
    /// off): saves, moves and trashes keep search current either way. A vault whose index has not
    /// started drops it, like a watcher batch does. Free while the watcher runs.
    pub(crate) fn tell_search(&self, search: Option<&search::SearchService>, paths: &[String]) {
        if let Some(search) = search {
            if !self.is_watching() {
                search.notify(&self.handle, paths, false);
            }
        }
    }
}
impl std::ops::Deref for Vault {
    type Target = vaultdraw_core::Vault;
    fn deref(&self) -> &vaultdraw_core::Vault {
        &self.core
    }
}
#[derive(Default)]
struct Service {
    vaults: Mutex<HashMap<String, Arc<Vault>>>,
    locks: vault_lock::LockRegistry,
}

/// The first open vault (lowest handle): the one the control API acts on.
pub(crate) fn control_active_vault(app: &AppHandle) -> Option<Arc<Vault>> {
    let service = app.try_state::<Service>()?;
    let vaults = service.vaults.lock().ok()?;
    vaults.values().min_by(|a, b| a.handle.cmp(&b.handle)).cloned()
}

/// First open vault as `{name, path, readOnly}` for the control API's `app.status`.
pub(crate) fn control_vault_summary(app: &AppHandle) -> Option<serde_json::Value> {
    control_active_vault(app).map(|v| control::vault_ops::info(&v))
}

fn vault_for<'a>(s: &'a Service, handle: &str) -> Result<Arc<Vault>> {
    s.vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .get(handle)
        .cloned()
        .ok_or_else(|| err("NOT_FOUND", "Vault handle is no longer active"))
}
#[derive(Debug, PartialEq, Eq)]
enum WatchedPath {
    /// Vault metadata, the lock file or our own temp files.
    Ignore,
    /// `<root>/library.excalidrawlib` (root level only, exact name).
    Library,
    /// `.excalidraw-vault/settings.toml` (or the metadata folder itself) changed.
    Settings,
    /// A path under `.excalidraw-vault/history/` (file history; kept out of `vault-change`).
    History(String),
    /// A user-visible vault-relative path.
    Entry(String),
    /// Outside the root or not a valid vault path: the frontend should rescan.
    Rescan,
}
/// Classifies a watcher event path for `vault-change` / `vault-settings-change`.
fn classify_vault_event(root: &Path, p: &Path) -> WatchedPath {
    let Ok(rel) = p.strip_prefix(root) else { return WatchedPath::Rescan };
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.split('/').any(|part| part.starts_with(".excalidraw-tmp-")) {
        return WatchedPath::Ignore;
    }
    // Sync services' temporary and partial files (`~$x`, `x.tmp`, `.syncthing.x.tmp`, `x.sb-..`): the finished
    // file arrives under its real name. (A folder called `x.tmp` is not reported until the next rescan.)
    if text.rsplit('/').next().is_some_and(vaultdraw_core::sync_names::is_sync_temp_name) {
        return WatchedPath::Ignore;
    }
    if text == library::LIBRARY_FILE
        || text == format!("{META_DIR}/{}", library::LIBRARIES_DIR)
        || text.starts_with(&format!("{META_DIR}/{}/", library::LIBRARIES_DIR))
    {
        return WatchedPath::Library;
    }
    // The metadata folder itself (deleted, renamed or replaced) may take settings.toml with it.
    if text == META_DIR || text == format!("{META_DIR}/{}", vault_settings::SETTINGS_FILE) {
        return WatchedPath::Settings;
    }
    if text.starts_with(&format!("{META_DIR}/{}/", history::HISTORY_DIR)) {
        return WatchedPath::History(text);
    }
    if text.starts_with(&format!("{META_DIR}/")) || text == format!("{META_DIR}.lock") {
        return WatchedPath::Ignore;
    }
    // Dot-folders (`.obsidian`, `.trash`, `.git`) are never reported: Obsidian rewrites them constantly.
    if vaultdraw_core::filekind::has_hidden_component(&text) {
        return WatchedPath::Ignore;
    }
    if validate_relative(&text).is_ok() {
        WatchedPath::Entry(text)
    } else {
        WatchedPath::Rescan
    }
}
fn open_vault(root: PathBuf, app: &AppHandle, service: &Service) -> Result<VaultInfo> {
    let root = root.canonicalize().map_err(ioerr)?;
    if !root.is_dir() {
        return Err(err("INVALID_PATH", "Vault must be a directory"));
    }
    let handle = random_id();
    let outcome = service.locks.acquire(&root, &format!("{META_DIR}.lock"));
    let read_only = outcome.lock.is_none();
    let lock = outcome.lock;
    let h = handle.clone();
    let r = root.clone();
    let app_handle = app.clone();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            let deadline = Instant::now() + Duration::from_millis(600);
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() { break; }
                match rx.recv_timeout(remaining.min(Duration::from_millis(160))) {
                    Ok(event) => batch.push(event),
                    Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => continue,
                    Err(_) => break,
                }
            }
            let mut paths = Vec::new();
            let mut history_paths = Vec::new();
            let mut rescan = false;
            let mut settings_changed = false;
            let mut library_changed = false;
            for event in batch {
                match event {
                    Ok(e) => {
                        for p in e.paths {
                            match classify_vault_event(&r, &p) {
                                WatchedPath::Ignore => {}
                                WatchedPath::Settings => settings_changed = true,
                                WatchedPath::Library => library_changed = true,
                                WatchedPath::History(text) => history_paths.push(text),
                                WatchedPath::Entry(text) => paths.push(text),
                                WatchedPath::Rescan => rescan = true,
                            }
                        }
                    }
                    Err(_) => {
                        rescan = true;
                        settings_changed = true;
                        library_changed = true;
                    }
                }
            }
            paths.sort();
            paths.dedup();
            if let Some(search) = app_handle.try_state::<search::SearchService>() {
                search.notify(&h, &paths, rescan);
            }
            if let Some(history) = app_handle.try_state::<history::HistoryService>() {
                history.watched(&h, &paths, &history_paths, rescan);
            }
            if settings_changed {
                let _ = app_handle.emit("vault-settings-change", VaultSettingsChange { handle: h.clone() });
            }
            if library_changed {
                library::emit_change(&app_handle, Some(h.clone()));
            }
            if !paths.is_empty() || rescan {
                control::events::vault_changed(&paths, rescan);
                let _ = app_handle.emit(
                    "vault-change",
                    VaultChange {
                        handle: h.clone(),
                        paths,
                        rescan,
                    },
                );
            }
        }
    });
    // `files.auto_reload = false`: no watcher at all (no FSEvents stream, no polling); Refresh updates.
    let config = services::read_config();
    let (watcher, watch_fallback) = if vault_watch::auto_reload_from(&config) {
        let vault_watch::Started { watching, fallback } = vault_watch::start(&root, tx.clone());
        if watching.is_none() {
            let _ = app.emit("vault-change", VaultChange { handle: handle.clone(), paths: Vec::new(), rescan: true });
        }
        (watching, fallback)
    } else {
        (None, None)
    };
    let vault = Arc::new(Vault {
        core: vaultdraw_core::Vault::new(root.clone(), handle.clone(), read_only, lock),
        watcher: Mutex::new(watcher),
        watch_tx: tx,
    });
    service
        .vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .insert(handle.clone(), vault.clone());
    // Registered; started here only when its `start` mode is "open" (services.rs).
    let modes = services::modes_of(&config);
    if let Some(search) = app.try_state::<search::SearchService>() {
        search.register(&handle, root.clone(), search::tauri_emitter(app));
    }
    links::on_vault_open(app, vault);
    backup::on_vault_open(root.clone());
    if let Some(history) = app.try_state::<history::HistoryService>() {
        let settings_root = root.clone();
        let settings: history::SettingsLoader = Arc::new(move || services::load_history_settings(&settings_root));
        history.register(&handle, root.clone(), read_only, history::tauri_emitter(app), Some(settings));
    }
    let wanted = services::wanted_with_off(&config, services::core_safe_start(), &launch::bisect_off());
    services::start_open(&modes, &wanted, &handle, app);
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Vault")
        .to_string();
    Ok(VaultInfo {
        handle,
        path: root.to_string_lossy().into_owned(),
        name,
        read_only,
        read_only_reason: outcome.reason,
        lock_holder_pid: outcome.holder_pid,
        watch_fallback,
    })
}

/// Remembers the vault for the next launch (`recent-vault`); not in smoke runs.
fn remember_vault(app: &AppHandle, info: &VaultInfo) {
    #[cfg(feature = "smoke-test")]
    if smoke::enabled() {
        return;
    }
    // An isolated instance (`$VAULTDRAW_VAULT`, e.g. `vaultdraw-plugin dev --sandbox`) never
    // touches the user's real `recent-vault`; only the state-dir copy below is written.
    if !vaultdraw_core::vault_path::is_isolated_with(|k| std::env::var_os(k)) {
        if let Ok(dir) = app.path().app_config_dir() {
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(dir.join("recent-vault"), &info.path);
        }
    }
    // The state-dir copy is what the offline CLI reads first (and isolates test/perf instances).
    // Best effort: a failure here never fails the open.
    match config::resolve_dirs() {
        Ok(dirs) => {
            if let Err(e) = vaultdraw_core::vault_path::remember(&dirs.state, Path::new(&info.path)) {
                eprintln!("vaultdraw: recent-vault not saved in the state dir: {} ({})", e.message, e.code);
            }
        }
        Err(e) => eprintln!("vaultdraw: recent-vault not saved in the state dir: {}", e.message),
    }
}
/// A folder given by path (the control API's `vault.open`): same as choosing it in the dialog.
fn existing_vault_dir(path: &str) -> Result<PathBuf> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err(err("INVALID_PATH", "Vault path must be absolute")); }
    let canonical = p.canonicalize().map_err(ioerr)?;
    if !canonical.is_dir() { return Err(err("INVALID_PATH", "Vault must be a directory")); }
    Ok(canonical)
}
#[tauri::command]
async fn open_vault_at(path: String, app: AppHandle, state: State<'_, Service>) -> Result<VaultInfo> {
    let info = open_vault(existing_vault_dir(&path)?, &app, &state)?;
    remember_vault(&app, &info);
    Ok(info)
}
#[tauri::command]
async fn choose_vault(
    create: bool,
    app: AppHandle,
    state: State<'_, Service>,
) -> Result<Option<VaultInfo>> {
    #[cfg(feature = "smoke-test")]
    let selected = if smoke::enabled() {
        Some(smoke::choose_dir().map_err(|e| err("SMOKE_CONFIG", e))?)
    } else {
        rfd::FileDialog::new()
            .set_title(if create { "Choose or create a Vaultdraw vault" } else { "Open a Vaultdraw vault" })
            .pick_folder()
    };
    #[cfg(not(feature = "smoke-test"))]
    let selected = rfd::FileDialog::new()
        .set_title(if create { "Choose or create a Vaultdraw vault" } else { "Open a Vaultdraw vault" })
        .pick_folder();
    let Some(path) = selected else { return Ok(None); };
    let info = open_vault(path, &app, &state)?;
    remember_vault(&app, &info);
    Ok(Some(info))
}
#[tauri::command]
async fn reopen_vault(app: AppHandle, state: State<'_, Service>) -> Result<Option<VaultInfo>> {
    #[cfg(feature = "smoke-test")]
    if smoke::enabled() { return Ok(None); }
    let tauri_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| err("IO_ERROR", e.to_string()))?;
    // With `$VAULTDRAW_VAULT` set (an isolated instance) only that folder opens: the user's
    // real `recent-vault` is never read.
    let Some(path) = vaultdraw_core::vault_path::gui_reopen_with(|k| std::env::var_os(k), || {
        let text = fs::read_to_string(tauri_dir.join("recent-vault")).ok()?;
        Some(PathBuf::from(text.trim())).filter(|p| p.is_dir())
    }) else {
        return Ok(None);
    };
    if vaultdraw_core::vault_path::is_isolated_with(|k| std::env::var_os(k)) {
        eprintln!("vaultdraw: isolated instance, opening the vault from VAULTDRAW_VAULT: {}", path.display());
    }
    open_vault(path, &app, &state).map(Some)
}
/// Drops a handle and its services; the vault lock goes with the last handle on that root.
fn release_handle(app: &AppHandle, service: &Service, handle: &str) -> Result<()> {
    service
        .vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .remove(handle);
    if let Some(search) = app.try_state::<search::SearchService>() {
        search.stop(handle);
    }
    if let Some(history) = app.try_state::<history::HistoryService>() {
        history.stop(handle);
    }
    thumbs::release(app, handle);
    Ok(())
}
/// A (re)loaded page starts with no vault: the previous page's handles are dead,
/// so release them (and their locks, watchers and indexes) instead of leaking them.
fn release_all_handles(app: &AppHandle) {
    let Some(service) = app.try_state::<Service>() else { return };
    let handles: Vec<String> = service.vaults.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    for handle in handles {
        let _ = release_handle(app, &service, &handle);
    }
}
#[tauri::command]
async fn release_vault(handle: String, app: AppHandle, state: State<'_, Service>) -> Result<()> {
    release_handle(&app, &state, &handle)
}
/// Opens the vault behind `handle` again (a new handle) so a read-only vault can
/// become writable once its lock is free; the caller swaps handles and releases the old one.
#[tauri::command]
async fn retry_vault(handle: String, app: AppHandle, state: State<'_, Service>) -> Result<VaultInfo> {
    let root = vault_for(&state, &handle)?.root.clone();
    open_vault(root, &app, &state)
}
/// `files.auto_reload` changed (Settings or config.toml): starts or stops the vault's file watcher.
/// Turning it on asks the UI for a rescan, since changes made while it was off were not seen.
#[tauri::command]
async fn set_vault_watching(handle: String, enabled: bool, app: AppHandle, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    if v.set_watching(enabled) {
        let _ = app.emit("vault-change", VaultChange { handle, paths: Vec::new(), rescan: true });
    }
    Ok(())
}
#[tauri::command]
async fn list_directory(
    handle: String,
    path: String,
    state: State<'_, Service>,
) -> Result<Vec<VaultEntry>> {
    ui_activity::touch();
    let v = vault_for(&state, &handle)?;
    list_directory_in(&v, &path)
}
#[tauri::command]
async fn read_drawing(handle: String, path: String, state: State<'_, Service>) -> Result<tauri::ipc::Response> {
    ui_activity::touch();
    let v = vault_for(&state, &handle)?;
    let framed = read_drawing_file(&v.root, &path)?;
    memory::schedule_release();
    Ok(tauri::ipc::Response::new(framed))
}
#[tauri::command]
async fn drawing_revision(handle: String, path: String, state: State<'_, Service>) -> Result<Option<String>> {
    let v = vault_for(&state, &handle)?;
    drawing_revision_at(&v.root, &path)
}
/// Whether the drawing file is read-only now (the editor lifts its banner when this turns false).
#[tauri::command]
async fn drawing_read_only(handle: String, path: String, state: State<'_, Service>) -> Result<bool> {
    let v = vault_for(&state, &handle)?;
    drawing_read_only_at(&v.root, &path)
}
/// Asks iCloud to download a placeholder file ("not downloaded" in the tree); returns at once.
#[tauri::command]
async fn sync_download_placeholder(handle: String, path: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    vaultdraw_core::sync_names::request_download(&v, &path)
}
/// Arguments carried in the headers of the raw `write_drawing` request (percent-encoded).
#[derive(Debug)]
struct WriteHeaders { handle: String, path: String, expected_revision: Option<String>, operation_id: String }
fn parse_write_headers(headers: &tauri::http::HeaderMap) -> Result<WriteHeaders> {
    let required = |name: &str| clipboard::percent_decode(&clipboard::header_value(headers, name)?);
    // Absent or empty expected revision means create-only.
    let expected = match clipboard::header_value(headers, "x-expected-revision") {
        Ok(v) => Some(clipboard::percent_decode(&v)?).filter(|v| !v.is_empty()),
        Err(_) => None,
    };
    Ok(WriteHeaders { handle: required("x-handle")?, path: required("x-path")?, expected_revision: expected, operation_id: required("x-operation-id")? })
}
/// The one drawing commit for the app, the control API and plugins: the read-only flag, the
/// vault mutation guard, the atomic core write with its revision check, then (only after a
/// successful commit) file history, `file.saved` and a memory release.
pub(crate) fn commit_drawing(
    v: &Vault,
    history: Option<&history::HistoryService>,
    search: Option<&search::SearchService>,
    path: &str,
    json: &str,
    expected_revision: Option<&str>,
    operation_id: &str,
) -> Result<serde_json::Value> {
    writable(v)?;
    let _mutation = mutation_guard(v)?;
    let result = write_drawing_file(v, path, json, expected_revision, operation_id);
    // File history: one clonefile + one queue push, only after a successful commit (errors ignored).
    if let Some(rev) = result.as_ref().ok().and_then(|o| o["revision"].as_str()) {
        let disk_len = result.as_ref().ok().and_then(|o| o["bytes"].as_u64()).unwrap_or(json.len() as u64);
        if let Some(history) = history {
            history.after_commit(&v.handle, path, rev, disk_len);
        }
        control::events::file_saved(path, rev);
        v.tell_search(search, &[path.to_string()]);
    }
    memory::schedule_release();
    result
}
#[tauri::command]
async fn write_drawing(request: tauri::ipc::Request<'_>, state: State<'_, Service>, history: State<'_, history::HistoryService>, search: State<'_, search::SearchService>) -> Result<serde_json::Value> {
    let args = parse_write_headers(request.headers())?;
    let body = clipboard::raw_body(&request)?;
    let v = vault_for(&state, &args.handle)?;
    write_drawing_raw(&v, Some(&history), Some(&search), &args, body)
}
/// The raw body is the UTF-8 scene JSON; it is validated in place, never copied into a String.
fn write_drawing_raw(v: &Vault, history: Option<&history::HistoryService>, search: Option<&search::SearchService>, args: &WriteHeaders, body: &[u8]) -> Result<serde_json::Value> {
    let json = std::str::from_utf8(body).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    commit_drawing(v, history, search, &args.path, json, args.expected_revision.as_deref(), &args.operation_id)
}
#[tauri::command]
async fn create_folder(handle: String, path: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    create_folder_at(&v.root, &path)
}
#[tauri::command]
async fn move_entry(
    handle: String,
    from: String,
    to: String,
    state: State<'_, Service>,
    history: State<'_, history::HistoryService>,
    search: State<'_, search::SearchService>,
) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    move_entry_paths(&v.root, &from, &to)?;
    history.moved(&handle, &from, &to);
    v.tell_search(Some(&search), &[from, to]);
    Ok(())
}
/// `move_entry` that also keeps links between drawings working (see `links::types`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn move_entry_with_links(
    app: AppHandle,
    handle: String,
    from: String,
    to: String,
    open_path: Option<String>,
    rewrite: bool,
    state: State<'_, Service>,
    search: State<'_, search::SearchService>,
    links: State<'_, links::LinksState>,
    history: State<'_, history::HistoryService>,
) -> Result<links::MoveResult> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    if !rewrite {
        let _mutation = mutation_guard(&v)?;
        move_entry_paths(&v.root, &from, &to)?;
        history.moved(&handle, &from, &to);
        v.tell_search(Some(&search), &[from, to]);
        return Ok(links::MoveResult::default());
    }
    let moved = links::move_command(&app, &v, &from, &to, open_path.as_deref(), &search, &links)?;
    history.moved(&handle, &from, &to);
    v.tell_search(Some(&search), &[from, to]);
    Ok(moved)
}
/// Most items `count_folder_items` walks before it stops and reports "N or more".
const FOLDER_COUNT_CAP: usize = 1000;
#[derive(serde::Serialize)]
struct FolderCount {
    count: usize,
    capped: bool,
}
/// Files under `dir` (folders are walked, not counted; symlinks count as one item and are never followed).
/// Hidden entries (`.DS_Store`, `.git/…`) are not counted, as in Finder: a folder that looks empty
/// reads "0 items" (bug hunt BH-6). Stops after `cap` items.
fn count_items(dir: &Path, cap: usize) -> FolderCount {
    let mut count = 0usize;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                stack.push(e.path());
            } else {
                count += 1;
                if count >= cap {
                    return FolderCount { count, capped: true };
                }
            }
        }
    }
    FolderCount { count, capped: false }
}
/// Vault-relative paths of every non-hidden file under `dir` (symlinks listed, never followed).
fn files_under(root: &Path, dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out
}
/// Trashes `path` (a file or a whole folder, empty or not) through `trasher`.
/// Returns the vault paths of the files it held, for the history bookkeeping.
fn trash_in(root: &Path, path: &str, trasher: impl FnOnce(&Path) -> std::result::Result<(), String>) -> Result<Vec<String>> {
    // safe_path refuses symlinks anywhere in `path` and anything outside the vault.
    let p = safe_path(root, path, false)?;
    if p == root {
        return Err(err("INVALID_PATH", "Cannot trash the vault root"));
    }
    // Links inside a folder are moved with it as links; their targets are never touched.
    let files = if p.is_dir() { files_under(root, &p) } else { vec![path.to_string()] };
    trasher(&p).map_err(|e| err("TRASH_FAILED", format!("Could not move item to OS trash: {e}")))?;
    Ok(files)
}
#[tauri::command]
async fn trash_entry(handle: String, path: String, state: State<'_, Service>, history: State<'_, history::HistoryService>, search: State<'_, search::SearchService>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    let files = trash_in(&v.root, &path, |p| trash::delete(p).map_err(|e| e.to_string()))?;
    for f in &files {
        history.trashed(&handle, f);
    }
    v.tell_search(Some(&search), &files);
    Ok(())
}
/// How many files a folder holds (stops at 1,000), for the "Move to Trash" confirmation.
#[tauri::command]
async fn count_folder_items(handle: String, path: String, state: State<'_, Service>) -> Result<FolderCount> {
    let v = vault_for(&state, &handle)?;
    let p = safe_path(&v.root, &path, false)?;
    Ok(count_items(&p, FOLDER_COUNT_CAP))
}
#[tauri::command]
async fn reveal_recovery_dir(handle: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    config::open_dir(&recovery_reveal_target(&v)?)
}
#[tauri::command]
async fn reveal_entry(handle: String, path: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    let p = safe_path(&v.root, &path, false)?;
    #[cfg(target_os = "macos")]
    let (program, args) = (
        "open",
        vec!["-R".to_string(), p.to_string_lossy().into_owned()],
    );
    #[cfg(target_os = "windows")]
    let (program, args) = (
        "explorer",
        vec!["/select,".to_string(), p.to_string_lossy().into_owned()],
    );
    #[cfg(target_os = "linux")]
    return external::reveal_linux(&p);
    #[cfg(not(target_os = "linux"))]
    external::spawn_reaped(std::process::Command::new(program).args(args)).map_err(ioerr)
}
#[tauri::command]
async fn export_file(request: tauri::ipc::Request<'_>) -> Result<bool> {
    let name = clipboard::percent_decode(&clipboard::header(&request, "x-file-name")?)?;
    // Not clipboard::raw_body: its 64 MiB clipboard cap is too small for a PDF.
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() => bytes.as_slice(),
        _ => return Err(err("INVALID_ARGUMENT", "Expected a non-empty raw binary body")),
    };
    if bytes.len() as u64 > MAX_EXPORT_BYTES {
        return Err(err("INVALID_FILE", "Export exceeds 256 MiB"));
    }
    save_with_dialog(&name, bytes)
}
/// Asks for a destination with the native save dialog (suggesting `name`) and
/// writes `bytes` there as a new file. Ok(false) = the user cancelled.
fn save_with_dialog(name: &str, bytes: &[u8]) -> Result<bool> {
    let clean = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty() && !s.contains('/') && !s.contains('\\'))
        .unwrap_or("drawing.excalidraw");
    #[cfg(feature = "smoke-test")]
    let selected_path = if smoke::enabled() {
        let dir = smoke::export_dir().map_err(|e| err("SMOKE_CONFIG", e))?;
        Some(dir.join(clean))
    } else {
        rfd::FileDialog::new().set_title("Save as").set_file_name(clean).save_file()
    };
    #[cfg(not(feature = "smoke-test"))]
    let selected_path = rfd::FileDialog::new().set_title("Save as").set_file_name(clean).save_file();
    let Some(path) = selected_path else { return Ok(false); };
    if path.exists() {
        return Err(err(
            "NAME_COLLISION",
            "Export destination already exists; choose another name",
        ));
    }
    write_atomic_new(&path, bytes)?;
    Ok(true)
}
#[tauri::command]
async fn list_recovery(handle: String, state: State<'_, Service>) -> Result<Vec<RecoveryEntry>> {
    let v = vault_for(&state, &handle)?;
    vaultdraw_core::list_recovery(&v)
}
#[tauri::command]
async fn discard_recovery(handle: String, id: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    vaultdraw_core::discard_recovery_entry(&v, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    const SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[],"appState":{},"files":{}}"#;
    fn vault(root: &Path) -> Vault {
        Vault::for_tests(root.canonicalize().unwrap(), "test", false)
    }
    #[test]
    fn trash_takes_a_non_empty_nested_folder_and_lists_its_files() {
        let d = tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("Ideas/deep")).unwrap();
        std::fs::write(root.join("Ideas/a.excalidraw"), SCENE).unwrap();
        std::fs::write(root.join("Ideas/deep/b.md"), "x").unwrap();
        let bin = tempdir().unwrap();
        let files = trash_in(&root, "Ideas", |p| std::fs::rename(p, bin.path().join("Ideas")).map_err(|e| e.to_string())).unwrap();
        let mut files = files;
        files.sort();
        assert_eq!(files, vec!["Ideas/a.excalidraw", "Ideas/deep/b.md"]);
        assert!(!root.join("Ideas").exists());
        assert!(bin.path().join("Ideas/deep/b.md").exists());
    }
    #[cfg(unix)]
    #[test]
    fn trash_keeps_a_symlink_inside_a_folder_as_a_link() {
        let d = tempdir().unwrap();
        let root = d.path().join("v");
        let outside = d.path().join("outside");
        std::fs::create_dir_all(root.join("F")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("F/link")).unwrap();
        let root = root.canonicalize().unwrap();
        let bin = tempdir().unwrap();
        let files = trash_in(&root, "F", |p| std::fs::rename(p, bin.path().join("F")).map_err(|e| e.to_string())).unwrap();
        assert_eq!(files, vec!["F/link"]);
        assert!(outside.join("keep.txt").exists(), "the link target outside the vault is untouched");
        assert!(std::fs::symlink_metadata(bin.path().join("F/link")).unwrap().file_type().is_symlink());
        assert_eq!(count_items(&outside, 10).count, 1);
    }
    #[cfg(unix)]
    #[test]
    fn trash_refuses_a_symlink_entry_itself_and_paths_through_one() {
        let d = tempdir().unwrap();
        let root = d.path().join("v");
        let outside = d.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let root = root.canonicalize().unwrap();
        let hit = std::cell::Cell::new(false);
        assert_eq!(trash_in(&root, "link", |_| { hit.set(true); Ok(()) }).unwrap_err().code, "INVALID_PATH");
        assert_eq!(trash_in(&root, "link/x", |_| { hit.set(true); Ok(()) }).unwrap_err().code, "INVALID_PATH");
        assert!(!hit.get());
    }
    #[test]
    fn trash_refuses_the_vault_root_and_escapes() {
        let d = tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        let hit = std::cell::Cell::new(false);
        for bad in ["", ".", "..", "../x", "/etc"] {
            assert!(trash_in(&root, bad, |_| { hit.set(true); Ok(()) }).is_err(), "{bad}");
        }
        assert!(!hit.get());
    }
    #[test]
    fn count_items_counts_files_and_stops_at_the_cap() {
        let d = tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("a/b")).unwrap();
        for i in 0..5 {
            std::fs::write(d.path().join(format!("a/{i}.md")), "x").unwrap();
        }
        std::fs::write(d.path().join("a/b/c.md"), "x").unwrap();
        let all = count_items(&d.path().join("a"), 1000);
        assert_eq!((all.count, all.capped), (6, false));
        let some = count_items(&d.path().join("a"), 3);
        assert_eq!((some.count, some.capped), (3, true));
        // Hidden files and folders are not items, as in Finder.
        std::fs::create_dir_all(d.path().join("e/.git/objects")).unwrap();
        std::fs::write(d.path().join("e/.DS_Store"), "x").unwrap();
        std::fs::write(d.path().join("e/.git/objects/1"), "x").unwrap();
        assert_eq!(count_items(&d.path().join("e"), 1000).count, 0);
    }
    #[test]
    fn trash_entry_refuses_read_only_vaults() {
        // writable() is the guard trash_entry calls first.
        let d = tempdir().unwrap();
        let v = Vault::for_tests(d.path().canonicalize().unwrap(), "test", true);
        assert_eq!(writable(&v).unwrap_err().code, "READ_ONLY");
    }
    #[test]
    fn the_watcher_starts_and_stops_live_with_auto_reload() {
        let d = tempdir().unwrap();
        let v = vault(d.path());
        assert!(v.watcher.lock().unwrap().is_none(), "a vault from for_tests starts without a watcher");
        assert!(v.set_watching(true), "turning it on starts the watcher (the UI then rescans)");
        assert!(!v.set_watching(true), "already running: nothing to restart");
        assert!(v.watcher.lock().unwrap().is_some());
        assert!(!v.set_watching(false));
        assert!(v.watcher.lock().unwrap().is_none(), "off drops the watcher");
        assert!(v.set_watching(true));
    }
    #[test]
    fn open_by_path_needs_an_existing_absolute_directory() {
        let d = tempfile::tempdir().unwrap();
        let ok = existing_vault_dir(d.path().to_str().unwrap()).unwrap();
        assert_eq!(ok, d.path().canonicalize().unwrap());
        assert_eq!(existing_vault_dir("relative/dir").unwrap_err().code, "INVALID_PATH");
        assert_eq!(existing_vault_dir(d.path().join("nope").to_str().unwrap()).unwrap_err().code, "NOT_FOUND");
        let f = d.path().join("f.txt");
        std::fs::write(&f, "x").unwrap();
        assert_eq!(existing_vault_dir(f.to_str().unwrap()).unwrap_err().code, "INVALID_PATH");
    }
    #[test]
    fn watcher_routes_settings_file_separately_from_vault_entries() {
        let root = Path::new("/v");
        let c = |p: &str| classify_vault_event(root, &root.join(p));
        assert_eq!(c(".excalidraw-vault/settings.toml"), WatchedPath::Settings);
        assert_eq!(c(".excalidraw-vault"), WatchedPath::Settings);
        assert_eq!(c(".excalidraw-vault/recovery/x.json"), WatchedPath::Ignore);
        assert_eq!(c(".excalidraw-vault/.excalidraw-tmp-1-2"), WatchedPath::Ignore);
        assert_eq!(c(".excalidraw-vault.lock"), WatchedPath::Ignore);
        assert_eq!(c("library.excalidrawlib"), WatchedPath::Library);
        assert_eq!(c(".excalidraw-vault/libraries/Flow.excalidrawlib"), WatchedPath::Library);
        assert_eq!(c(".excalidraw-vault/libraries"), WatchedPath::Library);
        assert_eq!(c("sub/library.excalidrawlib"), WatchedPath::Entry("sub/library.excalidrawlib".into()));
        assert_eq!(c("Library.excalidrawlib"), WatchedPath::Entry("Library.excalidrawlib".into()));
        assert_eq!(c(".obsidian/workspace.json"), WatchedPath::Ignore);
        assert_eq!(c("notes/.trash/a.md"), WatchedPath::Ignore);
        assert_eq!(c("notes/a.md"), WatchedPath::Entry("notes/a.md".into()));
        assert_eq!(c(".excalidraw-tmp-1-2"), WatchedPath::Ignore);
        assert_eq!(c("a/b.excalidraw"), WatchedPath::Entry("a/b.excalidraw".into()));
        assert_eq!(c("a/.excalidraw-tmp-1"), WatchedPath::Ignore);
        assert_eq!(c("a/~$b.md"), WatchedPath::Ignore);
        assert_eq!(c("a/b.excalidraw.tmp"), WatchedPath::Ignore);
        assert_eq!(c(".syncthing.b.excalidraw.tmp"), WatchedPath::Ignore);
        assert_eq!(c("a/b.excalidraw.sb-1a2b-c3d4"), WatchedPath::Ignore);
        assert_eq!(c("a/b (conflicted copy 2026-01-01).excalidraw"), WatchedPath::Entry("a/b (conflicted copy 2026-01-01).excalidraw".into()));
        assert_eq!(c("bad?.excalidraw"), WatchedPath::Rescan);
        assert_eq!(classify_vault_event(root, Path::new("/elsewhere/x")), WatchedPath::Rescan);
    }
    #[test]
    fn write_headers_decode_and_empty_expected_means_create_only() {
        let mut h = tauri::http::HeaderMap::new();
        h.insert("x-handle", "h%2F1".parse().unwrap());
        h.insert("x-path", "f%C3%B6lder%2Fa%20b.excalidraw".parse().unwrap());
        h.insert("x-operation-id", "op-1".parse().unwrap());
        let a = parse_write_headers(&h).unwrap();
        assert_eq!((a.handle.as_str(), a.path.as_str(), a.operation_id.as_str()), ("h/1", "földer/a b.excalidraw", "op-1"));
        assert_eq!(a.expected_revision, None);
        h.insert("x-expected-revision", "".parse().unwrap());
        assert_eq!(parse_write_headers(&h).unwrap().expected_revision, None);
        h.insert("x-expected-revision", "abc123".parse().unwrap());
        assert_eq!(parse_write_headers(&h).unwrap().expected_revision.as_deref(), Some("abc123"));
        h.remove("x-path");
        assert_eq!(parse_write_headers(&h).unwrap_err().code, "INVALID_ARGUMENT");
    }
    /// The three `generate_handler!` lists (smoke build, test build, release) must register the
    /// same app commands; the smoke list may add its own `smoke::`/`refresh_rate::`/clipboard probes.
    #[test]
    fn handler_lists_do_not_drift() {
        let src = include_str!("lib.rs");
        let lists: Vec<std::collections::BTreeSet<String>> = src
            // Split so this test's own source does not match.
            .split(concat!("tauri::generate_", "handler!["))
            .skip(1)
            .map(|rest| {
                let body = &rest[..rest.find(']').unwrap()];
                body.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
            })
            .collect();
        assert_eq!(lists.len(), 3);
        let probe = |s: &String| s.starts_with("smoke::") || s.starts_with("refresh_rate::") || s == "clipboard::smoke_read_clipboard";
        let smoke: std::collections::BTreeSet<String> = lists[0].iter().filter(|s| !probe(s)).cloned().collect();
        assert_eq!(smoke, lists[1], "smoke list differs from the test list");
        assert_eq!(lists[1], lists[2], "test list differs from the release list");
        for cmd in ["plugins::plugin_call", "plugins::plugin_call_raw", "plugins::plugins_data_list", "plugins::plugins_data_delete"] {
            assert!(lists[2].contains(cmd), "{cmd}");
        }
    }
    #[test]
    fn raw_write_path_is_guarded_and_returns_revision() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        let args = |expected: Option<&str>| WriteHeaders { handle: "test".into(), path: "a.excalidraw".into(), expected_revision: expected.map(str::to_owned), operation_id: "op".into() };
        let created = write_drawing_raw(&v, None, None, &args(None), SCENE.as_bytes()).unwrap();
        assert_eq!(created["revision"], revision(SCENE.as_bytes()));
        assert_eq!(write_drawing_raw(&v, None, None, &args(None), SCENE.as_bytes()).unwrap_err().code, "CONFLICT");
        let next = SCENE.replace("[]", "[{\"id\":1}]");
        let rev = created["revision"].as_str().unwrap().to_owned();
        assert_eq!(write_drawing_raw(&v, None, None, &args(Some(&rev)), next.as_bytes()).unwrap()["revision"], revision(next.as_bytes()));
        assert_eq!(fs::read_to_string(t.path().join("a.excalidraw")).unwrap(), next);
        assert_eq!(write_drawing_raw(&v, None, None, &args(Some(&rev)), SCENE.as_bytes()).unwrap_err().code, "CONFLICT");
        assert_eq!(write_drawing_raw(&v, None, None, &args(None), &[0xff]).unwrap_err().code, "INVALID_FILE");
    }

}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// WKWebView configuration for the main window.
///
/// WebKit caps page rendering near 60fps by default, even on 120Hz ProMotion
/// displays. The cap is a private WebKit feature flag that only takes effect
/// when set before the webview is created, so the window is built here instead
/// of from tauri.conf.json. See `refresh_rate` (logs loudly if the flag can't
/// be applied).
#[cfg(all(target_os = "macos", not(test)))]
fn webview_configuration(
    mtm: objc2::MainThreadMarker,
) -> objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration> {
    use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};

    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // A supplied configuration bypasses the window's `incognito` setting, so
    // keep website data non-persistent here.
    unsafe { config.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm)) };
    refresh_rate::disable_near_60fps_cap(&*unsafe { config.preferences() });
    config
}

/// Env-gated startup timing (`VAULTDRAW_STARTUP_TRACE=1`): prints ms since `run()` began.
pub(crate) fn startup_trace(label: &str) {
    use std::sync::OnceLock;
    static T0: OnceLock<(Instant, bool)> = OnceLock::new();
    let (t0, on) = T0.get_or_init(|| (Instant::now(), std::env::var_os("VAULTDRAW_STARTUP_TRACE").is_some()));
    if *on {
        eprintln!("[startup] {:>7.1} ms  {label}", t0.elapsed().as_secs_f64() * 1000.0);
    }
}

pub fn run() {
    startup_trace("run");
    config::apply_profile_arg(std::env::args().skip(1));
    control::instance::claim_or_forward();
    #[cfg(not(test))]
    {
        let builder = tauri::Builder::default()
            .manage(Service::default())
            .manage(search::SearchService::default())
            .manage(links::LinksState::default())
            .manage(history::HistoryService::default())
            .manage(thumbs::ThumbsService::default())
            // A webview reload (or crash recovery) starts a fresh frontend that will
            // reopen the vault; free the old page's handles first (toimprove #39).
            .on_page_load(|webview, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    release_all_handles(webview.app_handle());
                    control::on_page_load_started();
                }
            })
            .setup(|app| {
                startup_trace("setup begin");
                // First launch under the `app.vaultdraw` identifier: carry over the app folders
                // of a pre-0.1.1 install (copy, never move). Does nothing when they're filled.
                vaultdraw_core::migrate::run_for_current_platform();
                plugins::on_setup();
                // The main window is declared in tauri.conf.json with `create: false`
                // and built here so macOS can use a custom webview configuration.
                let window_config = app
                    .config()
                    .app
                    .windows
                    .first()
                    .cloned()
                    .ok_or("missing main window config")?;
                #[cfg(feature = "smoke-test")]
                smoke::background_test_app(app);
                let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
                #[cfg(feature = "smoke-test")]
                let builder = builder.focused(!smoke::background_test());
                #[cfg(feature = "smoke-test")]
                let builder = if smoke::hidden_render() {
                    builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                } else {
                    builder
                };
                #[cfg(target_os = "macos")]
                let builder = {
                    let mtm = objc2::MainThreadMarker::new()
                        .ok_or("window setup must run on the main thread")?;
                    builder.with_webview_configuration(webview_configuration(mtm))
                };
                // Linux: one title bar. `custom` builds the window undecorated and tells the page.
                #[cfg(target_os = "linux")]
                let builder = if window_chrome::custom() {
                    builder.decorations(false).initialization_script(window_chrome::CUSTOM_CHROME_SCRIPT)
                } else {
                    builder
                };
                startup_trace("window config ready");
                let main_window = builder.build()?;
                startup_trace("window built");
                control::spawn(app.handle());
                control::uri::on_startup_argv(app.handle());
                #[cfg(feature = "smoke-test")]
                {
                    smoke::harden_test_webview(&main_window);
                    smoke::front_test_window(&main_window);
                }
                // Hang watchdog: hooks WebKit's responsiveness callbacks; no thread or timer.
                // Test builds skip it (an unanswered modal dialog would stall a smoke or perf
                // run on a loaded machine) unless VAULTDRAW_WATCHDOG=1 asks for it.
                #[cfg(feature = "smoke-test")]
                if std::env::var("VAULTDRAW_WATCHDOG").as_deref() == Ok("1") || watchdog::smoke_requested() {
                    watchdog::install(&main_window);
                    // Packaged check (scripts/watchdog-smoke.sh): hangs the page on purpose.
                    #[cfg(target_os = "macos")]
                    if watchdog::smoke_requested() {
                        watchdog::smoke_driver::start(&main_window);
                    }
                }
                #[cfg(feature = "smoke-test")]
                hidden_render::watch_window_state(&main_window);
                #[cfg(not(feature = "smoke-test"))]
                watchdog::install(&main_window);
                // Memory pressure: return free pages and let the webview purge its caches.
                pressure::start(app.handle());
                // Live-reload of the config folder, started off the setup path (it creates the
                // config files and registers an FSEvents stream); a failure only disables live reload.
                let handle = app.handle().clone();
                let spawned = thread::Builder::new().name("config-watcher-init".into()).spawn(move || {
                    match config::start_watcher(&handle) {
                        Ok(watcher) => {
                            handle.manage(watcher);
                        }
                        Err(e) => eprintln!("vaultdraw: config watcher not started: {} ({})", e.message, e.code),
                    }
                    startup_trace("watcher started");
                });
                if let Err(e) = spawned {
                    eprintln!("vaultdraw: config watcher not started: {e}");
                }
                Ok(())
            });
        #[cfg(target_os = "macos")]
        let builder = builder
            .menu(|handle| app_menu::build(handle))
            .on_menu_event(app_menu::on_event);
        let builder = thumbs::register_scheme(builder);
        let builder = plugins::register_scheme(builder);
        // Test runs must not take focus at launch (a window manager would follow it).
        #[cfg(all(feature = "smoke-test", target_os = "macos"))]
        let builder = builder.activate_ignoring_other_apps(!smoke::background_test());
        #[cfg(feature = "smoke-test")]
        let builder = if smoke::enabled() {
            builder.invoke_handler(tauri::generate_handler![
                choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, set_vault_watching, list_directory, read_drawing, drawing_revision, drawing_read_only, sync_download_placeholder,
                write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, count_folder_items, reveal_entry, reveal_recovery_dir,
                export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, watchdog::watchdog_last_hang, list_recovery, discard_recovery,
                config::load_settings, config::update_config, config::profile_use, config::profile_create, config::profile_delete, config::network_grant, config::write_state, config::open_config_dir, config::open_config_file, config::open_included_file, config::reveal_overrides, config::reset_overrides, config::config_check, config::doctor_report, external::open_external_url, external::system_info,
                themes::list_themes, themes::open_themes_dir, theme_install::theme_resolve, theme_install::theme_fetch, theme_install::theme_write, theme_install::theme_installed, theme_install::theme_update_fetch, theme_install::theme_uninstall, theme_catalogue::theme_catalogue_cached, theme_catalogue::theme_catalogue_index, theme_catalogue::theme_catalogue_preview, plugins::registry::plugin_registry_cached, plugins::registry::plugin_registry_index, plugins::registry::plugin_registry_install, snippets::list_snippets, snippets::open_snippets_dir,
                vault_settings::load_vault_settings, vault_settings::update_vault_settings, vault_settings::vault_profile, vault_settings::set_vault_profile,
                services::services_start, search::search_vault, search::search_index_status, search::search_rescan, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
                library::read_library, library::write_library, library::list_libraries, library::create_library, library::rename_library, library::delete_library, library::pick_library_file, markdown::markdown_parse, markdown::markdown_parse_file, notes::read_note, notes::write_note, note_assets::read_note_asset, import_folder::import_target_root, backup::backup_start, backup::restore_start, backup::backup_status, backup::backup_cancel,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
                templates::list_global_templates, templates::read_global_template,
                templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                plugins::plugins_list, plugins::plugins_install_folder, plugins::plugins_uninstall, plugins::plugins_consent_confirm, plugins::plugins_set_host_disabled, plugins::plugins_open_dir,
                plugins::plugins_pick_folder, plugins::plugins_dev_log, plugins::plugins_launch_ok, plugins::plugins_restart_safe_mode, plugins::plugins_restart, plugins::plugins_restart_cancel, launch::app_restart_safe, launch::app_restart_normally, launch::launch_bisect_set, launch::launch_bisect_get, plugins::plugin_call, plugins::plugin_call_raw, plugins::plugins_data_list, plugins::plugins_data_delete,
                control::uri::uri_open, control::files::external_file_read, control::linux_handlers::links_handlers_plan, control::linux_handlers::links_handlers_apply, control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_spool_begin, control::bridge::control_spool_append, control::bridge::control_spool_abort, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event,
                smoke::smoke_environment, smoke::smoke_log, smoke::smoke_finish, smoke::perf_process_ids, smoke::perf_layer_tree, smoke::perf_footprint,
                refresh_rate::probes::perf_display_info, refresh_rate::probes::perf_native_input,
                refresh_rate::probes::perf_window_maximize, refresh_rate::probes::perf_process_cpu,
                clipboard::smoke_read_clipboard
            ])
        } else {
            builder.invoke_handler(tauri::generate_handler![
                choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, set_vault_watching, list_directory, read_drawing, drawing_revision, drawing_read_only, sync_download_placeholder,
                write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, count_folder_items, reveal_entry, reveal_recovery_dir,
                export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, watchdog::watchdog_last_hang, list_recovery, discard_recovery,
                config::load_settings, config::update_config, config::profile_use, config::profile_create, config::profile_delete, config::network_grant, config::write_state, config::open_config_dir, config::open_config_file, config::open_included_file, config::reveal_overrides, config::reset_overrides, config::config_check, config::doctor_report, external::open_external_url, external::system_info,
                themes::list_themes, themes::open_themes_dir, theme_install::theme_resolve, theme_install::theme_fetch, theme_install::theme_write, theme_install::theme_installed, theme_install::theme_update_fetch, theme_install::theme_uninstall, theme_catalogue::theme_catalogue_cached, theme_catalogue::theme_catalogue_index, theme_catalogue::theme_catalogue_preview, plugins::registry::plugin_registry_cached, plugins::registry::plugin_registry_index, plugins::registry::plugin_registry_install, snippets::list_snippets, snippets::open_snippets_dir,
                vault_settings::load_vault_settings, vault_settings::update_vault_settings, vault_settings::vault_profile, vault_settings::set_vault_profile,
                services::services_start, search::search_vault, search::search_index_status, search::search_rescan, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
                library::read_library, library::write_library, library::list_libraries, library::create_library, library::rename_library, library::delete_library, library::pick_library_file, markdown::markdown_parse, markdown::markdown_parse_file, notes::read_note, notes::write_note, note_assets::read_note_asset, import_folder::import_target_root, backup::backup_start, backup::restore_start, backup::backup_status, backup::backup_cancel,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
                templates::list_global_templates, templates::read_global_template,
                templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                plugins::plugins_list, plugins::plugins_install_folder, plugins::plugins_uninstall, plugins::plugins_consent_confirm, plugins::plugins_set_host_disabled, plugins::plugins_open_dir,
                plugins::plugins_pick_folder, plugins::plugins_dev_log, plugins::plugins_launch_ok, plugins::plugins_restart_safe_mode, plugins::plugins_restart, plugins::plugins_restart_cancel, launch::app_restart_safe, launch::app_restart_normally, launch::launch_bisect_set, launch::launch_bisect_get, plugins::plugin_call, plugins::plugin_call_raw, plugins::plugins_data_list, plugins::plugins_data_delete,
                control::uri::uri_open, control::files::external_file_read, control::linux_handlers::links_handlers_plan, control::linux_handlers::links_handlers_apply, control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_spool_begin, control::bridge::control_spool_append, control::bridge::control_spool_abort, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event
            ])
        };
        #[cfg(not(feature = "smoke-test"))]
        let builder = builder.invoke_handler(tauri::generate_handler![
            choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, set_vault_watching, list_directory, read_drawing, drawing_revision, drawing_read_only, sync_download_placeholder,
            write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, count_folder_items, reveal_entry, reveal_recovery_dir,
            export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, watchdog::watchdog_last_hang, list_recovery, discard_recovery,
            config::load_settings, config::update_config, config::profile_use, config::profile_create, config::profile_delete, config::network_grant, config::write_state, config::open_config_dir, config::open_config_file, config::open_included_file, config::reveal_overrides, config::reset_overrides, config::config_check, config::doctor_report, external::open_external_url, external::system_info,
            themes::list_themes, themes::open_themes_dir, theme_install::theme_resolve, theme_install::theme_fetch, theme_install::theme_write, theme_install::theme_installed, theme_install::theme_update_fetch, theme_install::theme_uninstall, theme_catalogue::theme_catalogue_cached, theme_catalogue::theme_catalogue_index, theme_catalogue::theme_catalogue_preview, plugins::registry::plugin_registry_cached, plugins::registry::plugin_registry_index, plugins::registry::plugin_registry_install, snippets::list_snippets, snippets::open_snippets_dir,
            vault_settings::load_vault_settings, vault_settings::update_vault_settings, vault_settings::vault_profile, vault_settings::set_vault_profile,
            services::services_start, search::search_vault, search::search_index_status, search::search_rescan, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
            library::read_library, library::write_library, library::list_libraries, library::create_library, library::rename_library, library::delete_library, library::pick_library_file, markdown::markdown_parse, markdown::markdown_parse_file, notes::read_note, notes::write_note, note_assets::read_note_asset, import_folder::import_target_root, backup::backup_start, backup::restore_start, backup::backup_status, backup::backup_cancel,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
            templates::list_global_templates, templates::read_global_template,
            templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                plugins::plugins_list, plugins::plugins_install_folder, plugins::plugins_uninstall, plugins::plugins_consent_confirm, plugins::plugins_set_host_disabled, plugins::plugins_open_dir,
                plugins::plugins_pick_folder, plugins::plugins_dev_log, plugins::plugins_launch_ok, plugins::plugins_restart_safe_mode, plugins::plugins_restart, plugins::plugins_restart_cancel, launch::app_restart_safe, launch::app_restart_normally, launch::launch_bisect_set, launch::launch_bisect_get, plugins::plugin_call, plugins::plugin_call_raw, plugins::plugins_data_list, plugins::plugins_data_delete,
                control::uri::uri_open, control::files::external_file_read, control::linux_handlers::links_handlers_plan, control::linux_handlers::links_handlers_apply, control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_spool_begin, control::bridge::control_spool_append, control::bridge::control_spool_abort, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event
        ]);
        startup_trace("builder configured");
        let app = builder
            .build(tauri::generate_context!())
            .expect("error while building Vaultdraw");
        startup_trace("app built");
        app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                control::on_exit();
                plugins::on_exit(handle);
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                control::uri::on_opened(handle, urls);
                return;
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // Quit from the hang dialog: the page can't answer the save round trip.
                if watchdog::force_quit() {
                    return;
                }
                // The test runner intentionally exits after writing its report.
                #[cfg(feature = "smoke-test")]
                if smoke::enabled() {
                    return;
                }
                // Cmd+Q / the native Quit menu must use the same awaited save
                // barrier as closing a window. Once the renderer has flushed
                // and destroyed the last window, normal process exit is safe.
                if !handle.webview_windows().is_empty() {
                    api.prevent_exit();
                    let _ = handle.emit("vault-quit-request", ());
                }
            }
        });
    }
}
