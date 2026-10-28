//! The file watcher of an open vault, with a polling fallback on Linux.
//!
//! The native watcher (inotify on Linux, FSEvents on macOS) is tried first. On Linux inotify
//! needs one watch per folder, and a big vault (a Git history, `node_modules`) can pass
//! `fs.inotify.max_user_watches`: the watcher then fails to start. Without a watcher the tree
//! and search go stale silently, so on Linux the vault falls back to `notify`'s `PollWatcher`
//! and tells the user once (`VaultInfo.watch_fallback`). macOS and Windows keep the old
//! behaviour: no fallback, one rescan event.

use notify::{Config, ErrorKind, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{path::Path, sync::mpsc::Sender, time::Duration};

/// A running watcher; dropping it stops watching.
pub(crate) enum Watching {
    Native(#[allow(dead_code)] RecommendedWatcher),
    Poll(#[allow(dead_code)] PollWatcher),
}

/// Why the native watcher could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FallbackReason {
    /// The inotify watch limit (`fs.inotify.max_user_watches`) is reached.
    LimitReached,
    /// Any other start failure.
    Failed,
}

/// Carried to the UI in `VaultInfo`, so the notice is shown once, when the vault opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Fallback {
    pub reason: FallbackReason,
    pub interval_ms: u64,
}

pub(crate) struct Started {
    pub watching: Option<Watching>,
    pub fallback: Option<Fallback>,
}

pub(crate) const DEFAULT_POLL_MS: u64 = 5000;
pub(crate) const MIN_POLL_MS: u64 = 500;
pub(crate) const MAX_POLL_MS: u64 = 600_000;

/// `files.watch_poll_ms` from the config tables, highest layer first. A wrong type or an
/// out-of-range value counts as unset.
pub(crate) fn poll_interval_from(tables: &[toml::Table]) -> u64 {
    tables
        .iter()
        .find_map(|t| t.get("files")?.get("watch_poll_ms"))
        .and_then(|v| match v {
            toml::Value::Integer(n) => u64::try_from(*n).ok(),
            toml::Value::Float(f) if f.fract() == 0.0 && *f >= 0.0 && *f <= u64::MAX as f64 => Some(*f as u64),
            _ => None,
        })
        .filter(|n| (MIN_POLL_MS..=MAX_POLL_MS).contains(n))
        .unwrap_or(DEFAULT_POLL_MS)
}

/// `files.auto_reload` from the merged config (default on; a wrong type counts as unset).
pub(crate) fn auto_reload_from(config: &serde_json::Value) -> bool {
    config.get("files").and_then(|f| f.get("auto_reload")).and_then(|v| v.as_bool()).unwrap_or(true)
}

/// Read only when the fallback is needed, so the normal path never touches the config.
fn configured_poll_ms() -> u64 {
    match crate::config::resolve_dirs() {
        Ok(dirs) => poll_interval_from(&vaultdraw_core::control_settings::layered_tables(&dirs)),
        Err(_) => DEFAULT_POLL_MS,
    }
}

/// True when the error means the OS ran out of file watches.
pub(crate) fn is_watch_limit(e: &notify::Error) -> bool {
    match &e.kind {
        ErrorKind::MaxFilesWatch => true,
        ErrorKind::Io(io) => io.raw_os_error() == Some(libc::ENOSPC),
        _ => false,
    }
}

/// Starts watching `root` recursively; events go to `tx`.
pub(crate) fn start(root: &Path, tx: Sender<notify::Result<Event>>) -> Started {
    start_with(root, tx, cfg!(target_os = "linux"), configured_poll_ms, native)
}

fn native(root: &Path, tx: Sender<notify::Result<Event>>) -> notify::Result<Watching> {
    let mut w = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let _ = tx.send(event);
    })?;
    w.configure(Config::default().with_poll_interval(Duration::from_millis(500)))?;
    w.watch(root, RecursiveMode::Recursive)?;
    Ok(Watching::Native(w))
}

/// `start` with the pieces a test can replace: whether the fallback is allowed (Linux only in
/// the app), the interval source and the native starter (a test forces the limit error).
pub(crate) fn start_with(
    root: &Path,
    tx: Sender<notify::Result<Event>>,
    fallback_allowed: bool,
    poll_ms: impl FnOnce() -> u64,
    native: impl FnOnce(&Path, Sender<notify::Result<Event>>) -> notify::Result<Watching>,
) -> Started {
    let error = match native(root, tx.clone()) {
        Ok(w) => return Started { watching: Some(w), fallback: None },
        Err(e) => e,
    };
    if !fallback_allowed {
        return Started { watching: None, fallback: None };
    }
    let interval_ms = poll_ms();
    let polled = PollWatcher::new(
        move |event: notify::Result<Event>| {
            let _ = tx.send(event);
        },
        Config::default().with_poll_interval(Duration::from_millis(interval_ms)),
    )
    .and_then(|mut w| w.watch(root, RecursiveMode::Recursive).map(|()| w));
    match polled {
        Ok(w) => Started {
            watching: Some(Watching::Poll(w)),
            fallback: Some(Fallback {
                reason: if is_watch_limit(&error) { FallbackReason::LimitReached } else { FallbackReason::Failed },
                interval_ms,
            }),
        },
        Err(_) => Started { watching: None, fallback: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn limit_error() -> notify::Error {
        notify::Error::new(ErrorKind::MaxFilesWatch)
    }

    #[test]
    fn recognises_the_watch_limit_errors() {
        assert!(is_watch_limit(&limit_error()));
        assert!(is_watch_limit(&notify::Error::io(std::io::Error::from_raw_os_error(libc::ENOSPC))));
        assert!(!is_watch_limit(&notify::Error::generic("x")));
        assert!(!is_watch_limit(&notify::Error::io(std::io::Error::from_raw_os_error(libc::EACCES))));
    }

    #[test]
    fn a_forced_limit_error_falls_back_to_polling_that_sees_changes() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let started = start_with(dir.path(), tx, true, || 500, |_, _| Err(limit_error()));
        assert!(matches!(started.watching, Some(Watching::Poll(_))));
        assert_eq!(started.fallback, Some(Fallback { reason: FallbackReason::LimitReached, interval_ms: 500 }));
        std::fs::write(dir.path().join("new.excalidraw"), "{}").unwrap();
        let mut seen = false;
        for _ in 0..40 {
            if let Ok(Ok(e)) = rx.recv_timeout(Duration::from_millis(250)) {
                seen |= e.paths.iter().any(|p| p.ends_with("new.excalidraw"));
                if seen { break; }
            }
        }
        assert!(seen, "the poll watcher reports the new file");
    }

    #[test]
    fn another_start_failure_also_falls_back_but_is_not_called_a_limit() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel();
        let started = start_with(dir.path(), tx, true, || 1000, |_, _| Err(notify::Error::generic("boom")));
        assert_eq!(started.fallback.map(|f| f.reason), Some(FallbackReason::Failed));
    }

    #[test]
    fn without_the_fallback_nothing_changes() {
        // macOS and Windows: a failed start leaves no watcher and no notice (the caller sends a rescan).
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel();
        let started = start_with(dir.path(), tx, false, || unreachable!("the interval is not read"), |_, _| Err(limit_error()));
        assert!(started.watching.is_none() && started.fallback.is_none());
    }

    #[test]
    fn a_working_native_watcher_reads_no_config_and_shows_no_notice() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = mpsc::channel();
        let started = start_with(dir.path(), tx, true, || unreachable!("the interval is not read"), native);
        assert!(matches!(started.watching, Some(Watching::Native(_))));
        assert!(started.fallback.is_none());
    }

    /// Collects the paths the native watcher reports for `act`, waiting up to ~3 s.
    fn native_paths(root: &Path, act: impl FnOnce(), want: &str) -> Vec<(String, notify::EventKind)> {
        let (tx, rx) = mpsc::channel();
        let started = start_with(root, tx, false, || 0, native);
        assert!(started.watching.is_some());
        std::thread::sleep(Duration::from_millis(500));
        act();
        let mut seen = Vec::new();
        for _ in 0..30 {
            if let Ok(Ok(e)) = rx.recv_timeout(Duration::from_millis(100)) {
                for p in &e.paths {
                    seen.push((p.strip_prefix(root).unwrap_or(p).to_string_lossy().into_owned(), e.kind));
                }
                if seen.iter().any(|(p, _)| p == want) { break; }
            }
        }
        seen
    }

    #[test]
    fn external_folder_delete_create_and_rename_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("gone/inner")).unwrap();
        std::fs::write(root.join("gone/inner/a.excalidraw"), "{}").unwrap();
        std::fs::write(root.join("file.excalidraw"), "{}").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let r = root.clone();
        let seen = native_paths(&root, || std::fs::remove_dir_all(r.join("gone")).unwrap(), "gone");
        eprintln!("folder delete: {seen:?}");
        assert!(seen.iter().any(|(p, _)| p == "gone"), "folder removal reports the folder: {seen:?}");
        let r = root.clone();
        let seen = native_paths(&root, || std::fs::remove_file(r.join("file.excalidraw")).unwrap(), "file.excalidraw");
        eprintln!("file delete: {seen:?}");
        assert!(seen.iter().any(|(p, _)| p == "file.excalidraw"), "{seen:?}");
        let r = root.clone();
        let seen = native_paths(&root, || std::fs::create_dir(r.join("new")).unwrap(), "new");
        eprintln!("create: {seen:?}");
        assert!(seen.iter().any(|(p, _)| p == "new"), "{seen:?}");
    }

    #[test]
    fn moving_a_folder_out_of_the_vault_like_the_trash_is_reported() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().canonicalize().unwrap().join("vault");
        let trash = outer.path().canonicalize().unwrap().join("trash");
        std::fs::create_dir_all(root.join("gone/inner")).unwrap();
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(root.join("gone/inner/a.excalidraw"), "{}").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let (r, t) = (root.clone(), trash.clone());
        let seen = native_paths(&root, || std::fs::rename(r.join("gone"), t.join("gone")).unwrap(), "gone");
        eprintln!("move out: {seen:?}");
        assert!(seen.iter().any(|(p, _)| p == "gone"), "{seen:?}");
        // and a rename inside the vault
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let r = root.clone();
        let seen = native_paths(&root, || std::fs::rename(r.join("a"), r.join("b")).unwrap(), "b");
        eprintln!("rename: {seen:?}");
        assert!(seen.iter().any(|(p, _)| p == "a") && seen.iter().any(|(p, _)| p == "b"), "{seen:?}");
    }

    #[test]
    fn auto_reload_defaults_on_and_reads_false() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert!(auto_reload_from(&serde_json::Value::Null));
        assert!(auto_reload_from(&j(r#"{"files":{}}"#)));
        assert!(auto_reload_from(&j(r#"{"files":{"auto_reload":"no"}}"#)));
        assert!(!auto_reload_from(&j(r#"{"files":{"auto_reload":false}}"#)));
    }

    #[test]
    fn the_interval_key_defaults_and_ignores_bad_values() {
        let t = |s: &str| s.parse::<toml::Table>().unwrap();
        assert_eq!(poll_interval_from(&[]), DEFAULT_POLL_MS);
        assert_eq!(poll_interval_from(&[t("[files]\nwatch_poll_ms = 2000\n")]), 2000);
        assert_eq!(poll_interval_from(&[t("[files]\nwatch_poll_ms = 100\n")]), DEFAULT_POLL_MS);
        assert_eq!(poll_interval_from(&[t("[files]\nwatch_poll_ms = \"5\"\n")]), DEFAULT_POLL_MS);
        assert_eq!(poll_interval_from(&[t("[files]\nwatch_poll_ms = 1500.0\n")]), 1500);
        assert_eq!(
            poll_interval_from(&[t("[files]\nwatch_poll_ms = 3000\n"), t("[files]\nwatch_poll_ms = 9000\n")]),
            3000,
            "the first (highest) layer wins"
        );
    }
}
