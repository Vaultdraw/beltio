//! Plugin host backend (API v0): manifest scan, folder install, host-disabled state and the
//! `vdplugin` scheme. Contract: personal/feature/plugins/PLUGIN-API.md.
// `run()` (and thus the command wiring) is compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

mod consent;
mod devlog;
mod install;
mod launch;
mod manifest;
mod scan;
mod scheme;
mod state;
mod term;
#[cfg(test)]
mod tests;
mod watch;

use crate::{config, err, Result};
use scan::{Index, PluginInfo, PluginsList, Roots, Scanned};
use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) use scheme::register as register_scheme;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const PLUGINS_DIR: &str = "plugins";

/// Last scan result: the list for the frontend and the index the scheme handler reads.
struct Snapshot {
    list: PluginsList,
    index: Arc<Index>,
}
static SNAPSHOT: RwLock<Option<Arc<Snapshot>>> = RwLock::new(None);

fn roots<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Roots> {
    let user = config::resolve_dirs()?.config.join(PLUGINS_DIR);
    let bundled = app.path().resource_dir().ok().map(|d| d.join(PLUGINS_DIR)).filter(|d| d.is_dir());
    Ok(Roots { user, bundled })
}

fn rescan<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Arc<Snapshot>> {
    let dirs = config::resolve_dirs()?;
    let Scanned { list, index, .. } = scan::scan(&roots(app)?, Some(&scan::cache_path(&dirs.state)), APP_VERSION);
    watch::sync(app, &list.plugins);
    let snap = Arc::new(Snapshot { list, index: Arc::new(index) });
    *SNAPSHOT.write().map_err(|_| err("INTERNAL", "Plugin state unavailable"))? = Some(Arc::clone(&snap));
    Ok(snap)
}

fn snapshot<R: tauri::Runtime>(app: &AppHandle<R>, force: bool) -> Result<Arc<Snapshot>> {
    if !force {
        if let Some(s) = SNAPSHOT.read().ok().and_then(|g| g.clone()) {
            return Ok(s);
        }
    }
    rescan(app)
}

/// Index for the scheme handler; the first request triggers a scan if none ran yet.
pub(crate) fn index_snapshot<R: tauri::Runtime>(app: &AppHandle<R>) -> Arc<Index> {
    snapshot(app, false).map(|s| Arc::clone(&s.index)).unwrap_or_default()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

fn review_of(p: &PluginInfo, confirmed: &consent::Record) -> consent::Review {
    consent::review(&p.manifest.permissions, confirmed.get(&p.manifest.id), p.source == scan::Source::Bundled)
}

#[tauri::command]
pub(crate) async fn plugins_list(app: AppHandle, rescan: Option<bool>) -> Result<PluginsList> {
    blocking(move || {
        let snap = snapshot(&app, rescan.unwrap_or(false))?;
        let state_dir = config::resolve_dirs()?.state;
        let disabled = state::load(&state_dir);
        let confirmed = consent::load(&state_dir);
        let mut list = snap.list.clone();
        list.safe_mode = launch::current();
        for p in &mut list.plugins {
            p.host_disabled = disabled.get(&p.manifest.id).cloned();
            p.review = review_of(p, &confirmed);
            if p.source != scan::Source::Bundled && confirmed.contains_key(&p.manifest.id) {
                // Best effort: a failed write only means the old record stays.
                let _ = consent::prune(&state_dir, &p.manifest.id, &p.manifest.permissions);
            }
        }
        Ok(list)
    })
    .await
}

#[tauri::command]
pub(crate) async fn plugins_install_folder(app: AppHandle, path: String) -> Result<PluginInfo> {
    blocking(move || {
        let user_root = roots(&app)?.user;
        let mut info = install::install_folder(&user_root, &PathBuf::from(path), APP_VERSION)?;
        rescan(&app)?;
        let state_dir = config::resolve_dirs()?.state;
        info.host_disabled = state::load(&state_dir).get(&info.manifest.id).cloned();
        info.review = review_of(&info, &consent::load(&state_dir));
        Ok(info)
    })
    .await
}

#[tauri::command]
pub(crate) async fn plugins_uninstall(app: AppHandle, id: String) -> Result<()> {
    blocking(move || {
        let user_root = roots(&app)?.user;
        let snap = snapshot(&app, true)?;
        install::uninstall(&user_root, snap.index.get(&id))?;
        let state_dir = config::resolve_dirs()?.state;
        state::set_host_disabled(&state_dir, &id, None)?;
        consent::forget(&state_dir, &id)?;
        rescan(&app).map(|_| ())
    })
    .await
}

/// The user confirmed the permissions a plugin declares now (the enable dialog or "Review").
/// `seen` is the list the user was shown; it must equal what the manifest declares now, so a
/// manifest that changed under an open dialog is never confirmed unseen (CONFLICT, review again).
#[tauri::command]
pub(crate) async fn plugins_consent_confirm(app: AppHandle, id: String, seen: Vec<String>) -> Result<()> {
    blocking(move || {
        let snap = snapshot(&app, true)?;
        let info = snap.list.plugins.iter().find(|p| p.manifest.id == id).ok_or_else(|| err("NOT_FOUND", "Plugin not found"))?;
        if info.manifest.permissions != seen {
            return Err(err("CONFLICT", "The plugin's permissions changed. Review them again."));
        }
        consent::confirm(&config::resolve_dirs()?.state, &id, &info.manifest.permissions)
    })
    .await
}

#[tauri::command]
pub(crate) async fn plugins_set_host_disabled(id: String, reason: Option<String>) -> Result<()> {
    blocking(move || state::set_host_disabled(&config::resolve_dirs()?.state, &id, reason)).await
}

/// Appends host-side log lines of a `dev = true` plugin to `<state>/plugin-logs/<id>.log`.
/// Any other plugin is refused: the file exists only for developers.
#[tauri::command]
pub(crate) async fn plugins_dev_log(app: AppHandle, id: String, text: String) -> Result<()> {
    blocking(move || {
        let snap = snapshot(&app, false)?;
        let dev = snap.list.plugins.iter().any(|p| p.manifest.id == id && p.manifest.dev);
        if !dev {
            return Err(err("INVALID_ARGUMENT", "Only dev plugins have a dev log"));
        }
        devlog::append(&config::resolve_dirs()?.state, &id, &text)
    })
    .await
}

#[tauri::command]
pub(crate) async fn plugins_open_dir(app: AppHandle, id: Option<String>) -> Result<()> {
    blocking(move || match id {
        None => config::open_dir(&roots(&app)?.user),
        Some(id) => {
            let snap = snapshot(&app, false)?;
            let entry = snap.index.get(&id).ok_or_else(|| err("NOT_FOUND", "Plugin not found"))?;
            config::open_dir(&entry.dir)
        }
    })
    .await
}


/// Folder picker for "Install from folder"; `None` when cancelled.
#[tauri::command]
pub(crate) async fn plugins_pick_folder() -> Result<Option<String>> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("Choose a plugin folder (with plugin.toml)")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

/// The frontend host started fine: the launch counts as clean.
#[tauri::command]
pub(crate) async fn plugins_launch_ok() -> Result<()> {
    blocking(|| {
        launch::mark_ok();
        Ok(())
    })
    .await
}

static RESTART_PENDING: AtomicBool = AtomicBool::new(false);

/// Forgets a restart whose quit was not confirmed. Returns whether one was pending.
fn clear_restart() -> bool {
    RESTART_PENDING.swap(false, Ordering::SeqCst)
}

/// The quit was cancelled (the user kept the window open after a failed save): the app stays
/// running, so it must not relaunch later and the one-shot safe mode request is dropped.
#[tauri::command]
pub(crate) async fn plugins_restart_cancel() -> Result<()> {
    if clear_restart() {
        blocking(launch::cancel_safe_mode).await?;
    }
    Ok(())
}

/// Restart through the normal quit path so open drawings are flushed first.
fn restart<R: tauri::Runtime>(app: &AppHandle<R>) {
    RESTART_PENDING.store(true, Ordering::SeqCst);
    if app.webview_windows().is_empty() {
        app.exit(0);
    } else {
        let _ = app.emit("vault-quit-request", ());
    }
}

#[tauri::command]
pub(crate) async fn plugins_restart_safe_mode(app: AppHandle) -> Result<()> {
    blocking(launch::request_safe_mode).await?;
    restart(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn plugins_restart(app: AppHandle) {
    restart(&app);
}

/// Setup hook, before the webview loads: crash counter and safe-mode decision.
pub(crate) fn on_setup() {
    launch::begin();
    term::install();
}

/// Exit hook: a clean exit clears the in-progress flag; a pending restart relaunches the app.
pub(crate) fn on_exit<R: tauri::Runtime>(app: &AppHandle<R>) {
    launch::mark_ok();
    if RESTART_PENDING.load(Ordering::SeqCst) {
        app.restart();
    }
}
