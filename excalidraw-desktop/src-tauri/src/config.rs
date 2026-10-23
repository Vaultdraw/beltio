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
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
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
pub(crate) async fn load_settings() -> Result<LoadedSettings> {
    load_settings_in(&resolve_dirs()?)
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
    _watcher: Mutex<RecommendedWatcher>,
}

fn is_temp_file(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(TEMP_PREFIX))
}

/// Splits `<config>/library.excalidrawlib` out of a batch of changed paths: it is reported
/// by `library-change` instead of `config-change`. Returns the remaining paths and whether
/// the library file was among them.
fn split_library_paths(root: &Path, paths: Vec<String>) -> (Vec<String>, bool) {
    let is_library = |p: &str| {
        let p = Path::new(p);
        p.parent() == Some(root) && p.file_name().is_some_and(|n| n == super::library::LIBRARY_FILE)
    };
    let is_lock = |p: &str| Path::new(p).file_name().is_some_and(|n| n == super::library::LOCK_FILE);
    let (library, rest): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| is_library(p));
    (rest.into_iter().filter(|p| !is_lock(p)).collect(), !library.is_empty())
}

/// Watches the config dir recursively and emits debounced `config-change` events.
pub(crate) fn start_watcher(app: &AppHandle) -> std::result::Result<ConfigWatcher, NativeError> {
    let dirs = resolve_dirs()?;
    {
        let _guard = write_guard()?;
        ensure_config_files(&dirs)?;
    }
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let app = app.clone();
    let root = dirs.config.clone();
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
                let (paths, library_changed) = split_library_paths(&root, paths);
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
            }
        })
        .map_err(ioerr)?;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let _ = tx.send(event);
    })
    .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    watcher
        .watch(&dirs.config, RecursiveMode::Recursive)
        .map_err(|e| err("WATCH_FAILED", e.to_string()))?;
    Ok(ConfigWatcher { _watcher: Mutex::new(watcher) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_path_is_split_from_config_changes() {
        let root = Path::new("/c/vaultdraw");
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
}
