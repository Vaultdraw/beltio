//! Dev reload: plugins with `dev = true` are watched (non-recursive: the plugin folder and the
//! folder of its main file); a change to `plugin.toml` or the main file emits `plugins://changed`
//! with `{ id }` after a 150 ms quiet period. No watcher exists while no dev plugin is installed.
use super::scan::PluginInfo;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Runtime};

pub(crate) const EVENT: &str = "plugins://changed";
const QUIET: Duration = Duration::from_millis(150);
/// A save loop must not starve the reload forever.
const MAX_WAIT: Duration = Duration::from_millis(1000);

#[derive(Clone, Serialize)]
struct Changed {
    id: String,
}

/// What one dev plugin watches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub id: String,
    pub dir: PathBuf,
    pub main: PathBuf,
}

/// The real path of `p`. A path that no longer exists (a file mid-save) keeps its folder's real
/// path, so an event for it still compares equal. macOS reports `/private/var/...` for `/var/...`.
pub(crate) fn canonical(p: &Path) -> PathBuf {
    if let Ok(c) = p.canonicalize() {
        return c;
    }
    match (p.parent().and_then(|d| d.canonicalize().ok()), p.file_name()) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => p.to_path_buf(),
    }
}

pub(crate) fn targets(plugins: &[PluginInfo]) -> Vec<Target> {
    plugins
        .iter()
        .filter(|p| p.manifest.dev)
        .map(|p| {
            let dir = canonical(Path::new(&p.dir));
            Target { id: p.manifest.id.clone(), main: canonical(&dir.join(&p.manifest.main)), dir }
        })
        .collect()
}

/// Directories to watch for `targets`: each plugin folder and its main file's folder.
fn watch_dirs(targets: &[Target]) -> BTreeSet<PathBuf> {
    targets
        .iter()
        .flat_map(|t| [Some(t.dir.clone()), t.main.parent().map(Path::to_path_buf)])
        .flatten()
        .collect()
}

/// Ids whose manifest or main file is among `paths`.
pub(crate) fn changed_ids(paths: &[PathBuf], targets: &[Target]) -> BTreeSet<String> {
    let paths: Vec<PathBuf> = paths.iter().map(|p| canonical(p)).collect();
    targets
        .iter()
        .filter(|t| paths.iter().any(|p| *p == t.main || *p == t.dir.join("plugin.toml")))
        .map(|t| t.id.clone())
        .collect()
}

/// Trailing debounce: after `first`, keeps collecting until `quiet` passes without an item
/// (or `max` since `first`).
pub(crate) fn collect_batch<T>(rx: &mpsc::Receiver<T>, first: T, quiet: Duration, max: Duration) -> Vec<T> {
    let started = Instant::now();
    let mut batch = vec![first];
    loop {
        let left = max.saturating_sub(started.elapsed());
        if left.is_zero() {
            break;
        }
        match rx.recv_timeout(quiet.min(left)) {
            Ok(item) => batch.push(item),
            Err(_) => break,
        }
    }
    batch
}

pub(crate) struct DevWatcher {
    _watcher: notify::RecommendedWatcher,
    targets: Arc<Mutex<Vec<Target>>>,
    dirs: BTreeSet<PathBuf>,
}

static WATCHER: Mutex<Option<DevWatcher>> = Mutex::new(None);

fn spawn<R: Runtime>(app: AppHandle<R>, targets: Arc<Mutex<Vec<Target>>>) -> Option<notify::RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    thread::Builder::new()
        .name("plugins-dev-watch".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                let paths: Vec<PathBuf> = collect_batch(&rx, first, QUIET, MAX_WAIT).into_iter().flatten().collect();
                let ids = targets.lock().map(|t| changed_ids(&paths, &t)).unwrap_or_default();
                for id in ids {
                    let _ = app.emit(EVENT, Changed { id });
                }
            }
        })
        .ok()?;
    notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(e) = event {
            if !matches!(e.kind, EventKind::Access(_)) {
                let _ = tx.send(e.paths);
            }
        }
    })
    .ok()
}

/// Brings the watcher in line with the current plugin list (called after every scan).
pub(crate) fn sync<R: Runtime>(app: &AppHandle<R>, plugins: &[PluginInfo]) {
    let wanted = targets(plugins);
    let Ok(mut slot) = WATCHER.lock() else { return };
    if wanted.is_empty() {
        *slot = None;
        return;
    }
    let dirs = watch_dirs(&wanted);
    if let Some(w) = slot.as_mut() {
        if w.dirs == dirs {
            if let Ok(mut t) = w.targets.lock() {
                *t = wanted;
            }
            return;
        }
    }
    let shared = Arc::new(Mutex::new(wanted));
    let Some(mut watcher) = spawn(app.clone(), Arc::clone(&shared)) else {
        eprintln!("vaultdraw: plugin dev watcher not started");
        *slot = None;
        return;
    };
    for d in &dirs {
        if let Err(e) = watcher.watch(d, RecursiveMode::NonRecursive) {
            eprintln!("vaultdraw: cannot watch {}: {e}", d.display());
        }
    }
    *slot = Some(DevWatcher { _watcher: watcher, targets: shared, dirs });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str, main: &str) -> Target {
        let dir = PathBuf::from(format!("/p/{id}"));
        Target { id: id.into(), main: dir.join(main), dir }
    }

    #[test]
    fn only_manifest_and_main_files_match() {
        let ts = [target("a", "main.js"), target("b", "dist/main.js")];
        let p = |s: &str| PathBuf::from(s);
        assert_eq!(changed_ids(&[p("/p/a/main.js")], &ts), BTreeSet::from(["a".to_string()]));
        assert_eq!(changed_ids(&[p("/p/b/dist/main.js"), p("/p/b/plugin.toml")], &ts), BTreeSet::from(["b".to_string()]));
        assert!(changed_ids(&[p("/p/a/notes.txt"), p("/p/a/dist/main.js")], &ts).is_empty());
    }

    #[test]
    fn a_symlinked_plugin_folder_matches_the_real_path_events() {
        use std::fs;
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("main.js"), "1").unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        // The folder is registered through the link; events arrive with real paths (or the reverse).
        let t = Target { id: "a".into(), dir: canonical(&link), main: canonical(&link.join("main.js")) };
        let ids = BTreeSet::from(["a".to_string()]);
        assert_eq!(changed_ids(&[real.join("main.js")], &[t.clone()]), ids);
        assert_eq!(changed_ids(&[link.join("main.js")], &[t.clone()]), ids);
        // A file that was just removed still matches (its folder is canonicalised).
        fs::remove_file(real.join("main.js")).unwrap();
        assert_eq!(changed_ids(&[link.join("main.js")], &[t]), ids);
    }

    #[test]
    fn a_real_watcher_reports_a_save_through_a_symlinked_folder() {
        use std::fs;
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real");
        fs::create_dir_all(&real).unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let t = Target { id: "a".into(), dir: canonical(&link), main: canonical(&link.join("main.js")) };
        let (tx, rx) = mpsc::channel();
        let mut w = notify::recommended_watcher(move |e: notify::Result<notify::Event>| {
            if let Ok(e) = e {
                let _ = tx.send(e.paths);
            }
        })
        .unwrap();
        w.watch(&t.dir, RecursiveMode::NonRecursive).unwrap();
        fs::write(link.join("main.js"), "export default {};").unwrap();
        let mut hit = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && !hit {
            if let Ok(paths) = rx.recv_timeout(Duration::from_millis(200)) {
                hit = !changed_ids(&paths, &[t.clone()]).is_empty();
            }
        }
        assert!(hit, "no event matched the canonical target");
    }

    #[test]
    fn watches_plugin_dir_and_main_dir_once() {
        let dirs = watch_dirs(&[target("a", "main.js"), target("b", "dist/main.js")]);
        let want: BTreeSet<PathBuf> = ["/p/a", "/p/b", "/p/b/dist"].iter().map(PathBuf::from).collect();
        assert_eq!(dirs, want);
    }

    #[test]
    fn bursts_collapse_into_one_batch() {
        let (tx, rx) = mpsc::channel();
        for i in 2..=5 {
            tx.send(i).unwrap();
        }
        let batch = collect_batch(&rx, 1, Duration::from_millis(20), Duration::from_millis(500));
        assert_eq!(batch, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn a_steady_stream_is_cut_at_the_max_wait() {
        let (tx, rx) = mpsc::channel();
        let feeder = thread::spawn(move || {
            for i in 0..100 {
                if tx.send(i).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
        });
        let started = Instant::now();
        let batch = collect_batch(&rx, -1, Duration::from_millis(50), Duration::from_millis(120));
        assert!(started.elapsed() < Duration::from_millis(400));
        assert!(batch.len() > 1 && batch.len() < 100);
        drop(rx);
        let _ = feeder.join();
    }
}
