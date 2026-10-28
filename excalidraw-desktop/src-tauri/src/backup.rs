//! Vault backup and restore commands (F25). The work is `vaultdraw_core::backup`; this file
//! holds the one running job, the folder and file dialogs, the progress the page polls, and the
//! optional schedule (`[backup] every`). Nothing here runs until a command is called or, with
//! `every` set, a vault is opened.
use crate::{err, services, vault_for, Result, Service};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::State;
use vaultdraw_core::backup::{self, BackupResult, BackupSettings, Progress};
use vaultdraw_core::NativeError;

#[derive(Default)]
struct Job {
    running: bool,
    kind: &'static str,
    cancel: Arc<AtomicBool>,
    progress: Progress,
    result: Option<BackupResult>,
    error: Option<NativeError>,
}

fn job() -> &'static Mutex<Job> {
    static J: OnceLock<Mutex<Job>> = OnceLock::new();
    J.get_or_init(|| Mutex::new(Job::default()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    kind: &'static str,
    running: bool,
    phase: &'static str,
    files_done: usize,
    files_total: usize,
    bytes_done: u64,
    bytes_total: u64,
    /// Path of the zip (backup) or of the new folder (restore) when it finished.
    path: Option<String>,
    files: Option<usize>,
    error: Option<NativeError>,
}

/// Starts a job unless one runs; `run` does the work on a thread and gets the shared cancel flag.
fn start_job(kind: &'static str, run: impl FnOnce(&AtomicBool, &mut dyn FnMut(&Progress)) -> std::result::Result<BackupResult, NativeError> + Send + 'static) -> Result<()> {
    let cancel = {
        let mut j = job().lock().map_err(|_| err("INTERNAL", "Backup state unavailable"))?;
        if j.running {
            return Err(err("BUSY", "A backup or restore is already running"));
        }
        *j = Job { running: true, kind, cancel: Arc::new(AtomicBool::new(false)), ..Default::default() };
        j.cancel.clone()
    };
    std::thread::Builder::new()
        .name("vaultdraw-backup".into())
        .spawn(move || {
            let mut on = |p: &Progress| {
                if let Ok(mut j) = job().lock() {
                    j.progress = p.clone();
                }
            };
            let r = run(&cancel, &mut on);
            if let Ok(mut j) = job().lock() {
                j.running = false;
                match r {
                    Ok(v) => j.result = Some(v),
                    Err(e) => j.error = Some(e),
                }
            }
        })
        .map_err(|e| err("INTERNAL", e.to_string()))?;
    Ok(())
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> impl std::future::Future<Output = Result<T>> {
    let h = tauri::async_runtime::spawn_blocking(f);
    async move { h.await.map_err(|e| err("INTERNAL", e.to_string())) }
}

fn configured() -> BackupSettings {
    BackupSettings::from_json(&services::read_config())
}

/// "Back up vault…": asks for a folder (unless `dest` is given), then writes the zip in the
/// background. Returns the chosen folder, or `null` when the dialog was cancelled.
#[tauri::command]
pub(crate) async fn backup_start(handle: String, dest: Option<String>, state: State<'_, Service>) -> Result<Option<String>> {
    let root = vault_for(&state, &handle)?.root.clone();
    let dest = match dest {
        Some(d) => Some(PathBuf::from(d)),
        None => {
            let start = configured().folder;
            blocking(move || {
                let mut d = rfd::FileDialog::new().set_title("Choose a folder for the backup");
                if let Some(s) = start.filter(|s| s.is_dir()) {
                    d = d.set_directory(s);
                }
                d.pick_folder()
            })
            .await?
        }
    };
    let Some(dest) = dest else { return Ok(None) };
    let opts = configured().options;
    let shown = dest.to_string_lossy().into_owned();
    start_job("backup", move |cancel, on| backup::create(&root, &dest, opts, cancel, on))?;
    Ok(Some(shown))
}

/// "Restore from backup…": asks for the zip and for a folder to put the restored vault in,
/// then extracts into a NEW folder there. Returns the new folder's path, or `null`.
#[tauri::command]
pub(crate) async fn restore_start() -> Result<Option<String>> {
    let picked = blocking(|| {
        let zip = rfd::FileDialog::new().set_title("Choose a Vaultdraw backup").add_filter("Backup", &["zip"]).pick_file()?;
        let parent = rfd::FileDialog::new().set_title("Choose where to put the restored vault").pick_folder()?;
        Some((zip, parent))
    })
    .await?;
    let Some((zip, parent)) = picked else { return Ok(None) };
    let dest = free_restore_dir(&parent, &zip);
    let shown = dest.to_string_lossy().into_owned();
    start_job("restore", move |cancel, on| backup::restore(&zip, &dest, cancel, on))?;
    Ok(Some(shown))
}

fn free_restore_dir(parent: &Path, zip: &Path) -> PathBuf {
    let stem = zip.file_stem().and_then(|s| s.to_str()).unwrap_or("backup");
    let base = format!("{stem} restored");
    let mut n = 1;
    loop {
        let p = parent.join(if n == 1 { base.clone() } else { format!("{base} {n}") });
        if p.symlink_metadata().is_err() {
            return p;
        }
        n += 1;
    }
}

/// What the running (or last) job is doing; the page polls it about twice a second.
#[tauri::command]
pub(crate) fn backup_status() -> Status {
    let j = job().lock().unwrap_or_else(|e| e.into_inner());
    let (path, files) = match &j.result {
        Some(r) => (Some(r.path.to_string_lossy().into_owned()), Some(r.files)),
        None => (None, None),
    };
    let error = j.error.as_ref().map(|e| NativeError { code: e.code.clone(), message: e.message.clone() });
    Status {
        kind: j.kind,
        running: j.running,
        phase: j.progress.phase,
        files_done: j.progress.files_done,
        files_total: j.progress.files_total,
        bytes_done: j.progress.bytes_done,
        bytes_total: j.progress.bytes_total,
        path,
        files,
        error,
    }
}

#[tauri::command]
pub(crate) fn backup_cancel() {
    if let Ok(j) = job().lock() {
        j.cancel.store(true, Ordering::Relaxed);
    }
}

// ---- schedule ----------------------------------------------------------------------------

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Called when a vault opens. With `[backup] every` off (the default) it does nothing at all;
/// otherwise one thread checks after a minute and then every hour whether a backup is due,
/// and stops when another vault opens or the setting goes off. Changing `every` from off to
/// on takes effect the next time a vault opens.
pub(crate) fn on_vault_open(root: PathBuf) {
    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if configured().every == backup::Every::Off {
        return;
    }
    let _ = std::thread::Builder::new().name("vaultdraw-backup-schedule".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        while GENERATION.load(Ordering::SeqCst) == gen {
            let s = configured();
            if s.every == backup::Every::Off {
                return;
            }
            if let Some(folder) = s.folder.clone().filter(|_| backup::is_due(&s, &root)) {
                let (r, f) = (root.clone(), folder.clone());
                if start_job("backup", move |c, on| backup::create(&r, &f, s.options, c, on)).is_ok() {
                    // Wait for it, then prune what this feature made.
                    while job().lock().map_or(false, |j| j.running) {
                        std::thread::sleep(Duration::from_millis(500));
                    }
                    let _ = backup::prune(&folder, &root, s.keep);
                }
            }
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}
