//! File history (versions and checkpoints) for vault drawings.
//!
//! Design: personal/feature/file-history/PLAN.md (revision 2). One immutable `.vdh` file per
//! version inside `<vault>/.excalidraw-vault/history/`; a utility-QoS worker per writable vault
//! decides when to version; the save path only clones the committed file and sends a message.
//!
//! This module owns the service (managed state), the hook API called from `lib.rs`, every Tauri
//! command and the events. Bodies of later phases live in the stub modules.
//!
//! Owner (H1): agent B. Codec modules (`names`, `container`, `codec`) are owned by agent A.

#![allow(dead_code)]

pub(crate) mod codec;
pub(crate) mod container;
pub(crate) mod names;

mod export;
mod gc;
mod git;
mod index;
mod lineage;
mod outside;
mod retention;
mod staging;
mod store;
mod worker;
mod writer;

#[cfg(test)]
mod core_tests;
#[cfg(test)]
mod tests;

use crate::{clipboard, err, search, validate_relative, Result};
use names::Reason;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, RwLock,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter as _, State};

pub(crate) use store::HISTORY_DIR;
pub(crate) use writer::{Clock, SystemClock};

const CHANGE_DEBOUNCE: Duration = Duration::from_millis(250);
const INDEX_SAVE_DELAY: Duration = Duration::from_secs(5);
const START_JOIN_TIMEOUT: Duration = Duration::from_secs(2);
const SNAPSHOT_WAIT: Duration = Duration::from_secs(20);
const MAX_PENDING_HEADER_LOADS: usize = 300;

// ---------------------------------------------------------------------------------------------
// IPC types (camelCase on the wire)
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub keep_all_hours: u32,
    pub keep_hourly_hours: u32,
    pub keep_daily_days: u32,
    pub keep_weekly_weeks: u32,
    pub size_cap_mb: u32,
    pub highlight_changes: bool,
}

impl Default for HistorySettings {
    fn default() -> Self {
        HistorySettings { enabled: true, interval_minutes: 5, keep_all_hours: 1, keep_hourly_hours: 24, keep_daily_days: 30, keep_weekly_weeks: 0, size_cap_mb: 500, highlight_changes: true }
    }
}

impl HistorySettings {
    /// Clamps every field into its valid range (interval 0 = no timed versions, cap 0 = none).
    pub fn clamped(mut self) -> HistorySettings {
        self.interval_minutes = self.interval_minutes.min(24 * 60);
        self.keep_all_hours = self.keep_all_hours.min(720);
        self.keep_hourly_hours = self.keep_hourly_hours.min(8760);
        self.keep_daily_days = self.keep_daily_days.min(3650);
        self.keep_weekly_weeks = self.keep_weekly_weeks.min(5200);
        self.size_cap_mb = self.size_cap_mb.min(1_000_000);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LastError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStatus {
    pub handle: String,
    pub state: &'static str,
    pub total_bytes: u64,
    pub cap_bytes: u64,
    pub checkpoint_bytes: u64,
    pub over_cap: &'static str,
    pub staging: bool,
    pub gc_blocked: bool,
    pub format_newer: bool,
    pub git_repo: bool,
    /// The vault's `.gitignore` already excludes the history folder (N2; the notice hides).
    pub git_excluded: bool,
    pub last_error: Option<LastError>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub lineage: String,
    pub created_at: u64,
    pub device: String,
    pub own_device: bool,
    pub reason: &'static str,
    pub name: Option<String>,
    pub note: Option<String>,
    pub kind: &'static str,
    pub size_bytes: u64,
    pub element_count: Option<u32>,
    pub availability: &'static str,
    pub header_loaded: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListing {
    pub path: String,
    pub lineages: Vec<String>,
    pub versions: Vec<VersionInfo>,
    pub last_version_at: Option<u64>,
    pub enabled: bool,
    pub read_only: bool,
    pub format_newer: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotOutcome {
    pub id: Option<String>,
    pub skipped: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    pub handle: String,
    pub paths: Vec<String>,
    pub lineages: Vec<String>,
}

#[derive(Clone, Debug)]
pub enum HistoryEvent {
    Change(ChangeEvent),
    Status(HistoryStatus),
}

/// Receives events for the webview (`history-change`, `history-status`).
pub(crate) type Emitter = Arc<dyn Fn(HistoryEvent) + Send + Sync>;

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn tauri_emitter(app: &AppHandle) -> Emitter {
    let app = app.clone();
    Arc::new(move |e| match e {
        HistoryEvent::Change(c) => {
            let _ = app.emit("history-change", c);
        }
        HistoryEvent::Status(s) => {
            let _ = app.emit("history-status", s);
        }
    })
}

fn off() -> crate::NativeError {
    err("HISTORY_OFF", "File history is turned off")
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

// ---------------------------------------------------------------------------------------------
// Per-vault state
// ---------------------------------------------------------------------------------------------

/// Debounces `history-change` / `history-status` (250 ms) and tracks the index save deadline.
#[derive(Default)]
pub(crate) struct Notifier {
    pub(crate) paths: BTreeSet<String>,
    pub(crate) lineages: BTreeSet<String>,
    pub(crate) due: Option<Instant>,
    pub(crate) status_dirty: bool,
    pub(crate) change: bool,
    pub(crate) index_dirty_since: Option<Instant>,
}

impl Notifier {
    fn touch(&mut self) {
        self.due.get_or_insert_with(|| Instant::now() + CHANGE_DEBOUNCE);
    }
    pub(crate) fn changed(&mut self, path: &str, lineage: &str) {
        if !path.is_empty() {
            self.paths.insert(path.to_string());
        }
        if !lineage.is_empty() {
            self.lineages.insert(lineage.to_string());
        }
        self.status_dirty = true;
        self.change = true;
        self.index_dirty_since.get_or_insert_with(Instant::now);
        self.touch();
    }
    pub(crate) fn status_changed(&mut self) {
        self.status_dirty = true;
        self.touch();
    }
    /// Time until the next flush or index save, if any.
    pub(crate) fn wait(&self) -> Option<Duration> {
        let now = Instant::now();
        let a = self.due.map(|d| d.saturating_duration_since(now));
        let b = self.index_dirty_since.map(|t| (t + INDEX_SAVE_DELAY).saturating_duration_since(now));
        match (a, b) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

pub struct VaultHistory {
    pub(crate) handle: String,
    pub(crate) root: PathBuf,
    pub(crate) vault_id: String,
    /// `<state>/history`
    pub(crate) state_hist: PathBuf,
    /// `<state>/history/<vault-id>`
    pub(crate) vault_state: PathBuf,
    pub(crate) staged_dir: PathBuf,
    pub(crate) store: store::Store,
    pub(crate) flags: Arc<staging::Flags>,
    pub(crate) index: Arc<RwLock<index::Index>>,
    pub(crate) inbox: Arc<worker::Inbox>,
    settings: Mutex<HistorySettings>,
    pub(crate) last_error: Mutex<Option<LastError>>,
    format_newer: AtomicBool,
    pub(crate) writing: Arc<AtomicBool>,
    loaded: Mutex<bool>,
    pub(crate) notifier: Arc<Mutex<Notifier>>,
    pub(crate) emit: Emitter,
    /// A worker thread exists (writable vault).
    pub(crate) has_worker: bool,
    /// Generation token of this vault id (a newer `start` bumps it).
    pub(crate) gen: Arc<AtomicU64>,
    pub(crate) my_gen: u64,
    /// Trash marks and orphan times (H3, `lineage.rs`).
    pub(crate) lineage: Mutex<lineage::State>,
    /// Result of the last GC sweep (H3, `gc.rs`).
    pub(crate) gc: Mutex<gc::Report>,
}

impl VaultHistory {
    pub(crate) fn read_index(&self) -> std::sync::RwLockReadGuard<'_, index::Index> {
        self.index.read().unwrap_or_else(|p| p.into_inner())
    }

    /// Loads `index.bin` once. Read-only instances (no worker) also reconcile with the disk here.
    pub(crate) fn ensure_loaded(&self) {
        let mut loaded = lock(&self.loaded);
        if *loaded {
            return;
        }
        let fold = !store::volume_case_sensitive(&self.root);
        self.flags.fold.store(fold, Ordering::Relaxed);
        let idx = index::load(&self.vault_state.join("index.bin")).filter(|i| i.fold == fold).unwrap_or_else(|| index::Index::new(fold));
        *self.index.write().unwrap_or_else(|p| p.into_inner()) = idx;
        if !self.has_worker {
            index::scan_all(&self.store, &self.index, crate::now_ms(std::time::SystemTime::now()));
        }
        *loaded = true;
    }

    pub(crate) fn own_device(&self) -> Option<String> {
        let raw = std::fs::read_to_string(self.state_hist.join("device")).ok()?;
        raw.split_whitespace().next().filter(|d| names::is_device(d)).map(str::to_string)
    }

    fn read_only(&self) -> bool {
        self.flags.read_only.load(Ordering::Relaxed)
    }

    fn effective_state(&self) -> &'static str {
        if self.read_only() {
            "read-only"
        } else if !self.flags.configured.load(Ordering::Relaxed) || !self.flags.enabled.load(Ordering::Relaxed) {
            "off"
        } else if self.last_error_view().is_some() {
            "error"
        } else if self.writing.load(Ordering::Relaxed) {
            "writing"
        } else {
            "idle"
        }
    }

    /// The stored error, or `HISTORY_DISK_LOW` while the save path is skipping clones.
    fn last_error_view(&self) -> Option<LastError> {
        lock(&self.last_error).clone().or_else(|| self.flags.disk_low.load(Ordering::Relaxed).then(|| LastError { code: "HISTORY_DISK_LOW".into(), message: "Free disk space is low; history is paused".into() }))
    }

    pub fn status(&self) -> HistoryStatus {
        self.ensure_loaded();
        let (total, checkpoints) = {
            let g = self.read_index();
            (g.total_bytes(), g.checkpoint_bytes())
        };
        let cap = u64::from(lock(&self.settings).size_cap_mb) * 1024 * 1024;
        let (over_cap, gc_blocked) = {
            let r = lock(&self.gc);
            (r.over_cap, r.gc_blocked)
        };
        HistoryStatus {
            handle: self.handle.clone(),
            state: self.effective_state(),
            total_bytes: total,
            cap_bytes: cap,
            checkpoint_bytes: checkpoints,
            over_cap,
            staging: self.flags.staging_supported(),
            gc_blocked,
            format_newer: self.format_newer.load(Ordering::Relaxed),
            git_repo: git::is_git_repo(&self.root),
            git_excluded: git::is_excluded(&self.root),
            last_error: self.last_error_view(),
        }
    }

    pub fn configure(&self, settings: HistorySettings) {
        let s = settings.clamped();
        self.flags.enabled.store(s.enabled, Ordering::Relaxed);
        self.flags.configured.store(true, Ordering::Relaxed);
        *lock(&self.settings) = s.clone();
        if self.has_worker {
            self.inbox.send(worker::Msg::Configure(s));
        }
        (self.emit)(HistoryEvent::Status(self.status()));
    }

    pub fn opened(&self, path: Option<String>, revision: Option<String>) -> Result<()> {
        if let Some(p) = &path {
            validate_relative(p)?;
        }
        if let Some(r) = &revision {
            if r.len() != 64 || !r.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(err("INVALID_ARGUMENT", "Invalid revision"));
            }
        }
        if self.has_worker {
            if let (Some(p), true) = (&path, self.flags.history_on()) {
                // Names the drawing for a crash-survivor clone, even before any revision is known.
                staging::write_sidecar(&self.staged_dir, &staging::key_for(p, self.flags.fold.load(Ordering::Relaxed)), p);
            }
            // Cloned here (on the command thread), not on the worker: the state at open time must be
            // captured before any later save can replace the file.
            let clone = match (&path, &revision) {
                (Some(p), Some(r)) => staging::clone_open(&self.flags, &self.staged_dir, &self.root, p, r),
                _ => None,
            };
            self.inbox.send(worker::Msg::Opened { path, revision, clone });
        }
        Ok(())
    }

    /// The save-path hook (called under the vault's mutation guard after the commit succeeded):
    /// one `clonefile` plus one queue push; never fails the save.
    pub fn after_commit(&self, rel: &str, revision: &str, size: u64) {
        if !self.flags.history_on() {
            return;
        }
        let staged = staging::stage_after_commit(&self.flags, &self.staged_dir, &self.root, rel, revision);
        self.inbox.send(worker::Msg::Committed { path: rel.to_string(), revision: revision.to_string(), size, staged });
    }

    pub fn list(&self, path: &str) -> Result<HistoryListing> {
        validate_relative(path)?;
        self.ensure_loaded();
        let own = self.own_device();
        let (listing, unloaded) = {
            let g = self.read_index();
            let entries = g.entries_for_path(path);
            let versions: Vec<VersionInfo> = entries.iter().map(|(lin, e)| version_info(&g, lin, e, own.as_deref())).collect();
            let lineages = g.lineages_for(path).into_iter().map(str::to_string).collect();
            let unloaded = g.unloaded_for_path(path, MAX_PENDING_HEADER_LOADS);
            let last = versions.first().map(|v| v.created_at);
            (
                HistoryListing {
                    path: path.to_string(),
                    lineages,
                    versions,
                    last_version_at: last,
                    enabled: self.flags.enabled.load(Ordering::Relaxed) && self.flags.configured.load(Ordering::Relaxed),
                    read_only: self.read_only(),
                    format_newer: self.format_newer.load(Ordering::Relaxed),
                },
                unloaded,
            )
        };
        if !unloaded.is_empty() {
            if self.has_worker {
                self.inbox.send_task(worker::Task::LoadHeaders(unloaded));
            } else {
                for id in unloaded.iter().take(200) {
                    index::ensure_head(&self.store, &self.index, id);
                }
            }
        }
        Ok(listing)
    }

    pub fn snapshot(&self, path: &str, reason: &str, wait: bool) -> Result<SnapshotOutcome> {
        validate_relative(path)?;
        let reason = match reason {
            "leave" => Reason::Leave,
            "before-restore" => Reason::BeforeRestore,
            _ => return Err(err("INVALID_ARGUMENT", "Unknown snapshot reason")),
        };
        if !self.has_worker {
            return Ok(SnapshotOutcome { id: None, skipped: Some("read-only".into()) });
        }
        if !wait {
            self.inbox.send(worker::Msg::Snapshot { path: path.to_string(), reason, ack: None });
            return Ok(SnapshotOutcome { id: None, skipped: None });
        }
        let (tx, rx) = mpsc::channel();
        self.inbox.send(worker::Msg::Snapshot { path: path.to_string(), reason, ack: Some(tx) });
        rx.recv_timeout(SNAPSHOT_WAIT).map_err(|_| err("IO_ERROR", "History did not answer in time"))?
    }

    pub fn checkpoint(&self, path: &str, name: &str, note: &str) -> Result<VersionInfo> {
        validate_relative(path)?;
        let name = name.trim();
        let n = name.chars().count();
        if n == 0 || n > container::MAX_NAME_CHARS || note.chars().count() > container::MAX_NOTE_CHARS || name.chars().any(char::is_control) {
            return Err(err("INVALID_ARGUMENT", "A checkpoint needs a name (1–120 characters) and a note of at most 2000"));
        }
        if self.read_only() || !self.has_worker {
            return Err(err("HISTORY_READ_ONLY", "History is read-only in this window"));
        }
        let (tx, rx) = mpsc::channel();
        self.inbox.send(worker::Msg::Checkpoint { path: path.to_string(), name: name.to_string(), note: note.to_string(), ack: tx });
        let written = rx.recv_timeout(SNAPSHOT_WAIT).map_err(|_| err("IO_ERROR", "History did not answer in time"))??;
        let own = self.own_device();
        let g = self.read_index();
        let (lin, e) = g.entry(&written.id).ok_or_else(|| err("INTERNAL", "Checkpoint missing from the index"))?;
        Ok(version_info(&g, lin, e, own.as_deref()))
    }

    /// `<meta JSON>\n<stripped scene JSON>` of version `id` (never on the worker thread).
    pub fn read_version(&self, id: &str) -> Result<Vec<u8>> {
        use sha2::{Digest, Sha256};
        if !names::is_ulid(id) {
            return Err(err("INVALID_ARGUMENT", "Invalid version id"));
        }
        self.ensure_loaded();
        let (lin, name, dataless) = {
            let g = self.read_index();
            let (l, e) = g.entry(id).ok_or_else(|| err("VERSION_GONE", "This version is not available"))?;
            (l.to_string(), e.name.clone(), e.dataless)
        };
        if dataless {
            return Err(err("VERSION_DOWNLOADING", "This version is still downloading"));
        }
        let io = |e: std::io::Error| if e.kind() == std::io::ErrorKind::NotFound { err("VERSION_GONE", "This version is not available") } else { err("VERSION_CORRUPT", "This version could not be read") };
        let file = self.store.read_version_file(&lin, &name).map_err(io)?;
        let header = container::read_header(&file)?;
        index::check_header(&header, &lin, &name)?;
        let body = container::read_body(&file, store::MAX_BODY_BYTES as usize)?;
        drop(file);
        let text = if header.kind == "delta" {
            let key_id = header.keyframe.as_deref().filter(|k| names::is_ulid(k)).ok_or_else(|| err("VERSION_CORRUPT", "Delta without a keyframe"))?;
            let kname = {
                let g = self.read_index();
                g.entry(key_id).filter(|(l, e)| *l == lin && e.name.dev == name.dev && e.name.is_keyframe()).map(|(_, e)| e.name.clone())
            };
            let kname = kname.ok_or_else(|| err("VERSION_GONE", "This version's keyframe is not available yet"))?;
            let kfile = self.store.read_version_file(&lin, &kname).map_err(io)?;
            index::check_header(&container::read_header(&kfile)?, &lin, &kname)?;
            let kbody = container::read_body(&kfile, store::MAX_BODY_BYTES as usize)?;
            drop(kfile);
            codec::reconstruct(&kbody, Some(&body))?
        } else {
            body
        };
        if hex::encode(Sha256::digest(&text)) != header.stripped_hash {
            return Err(err("VERSION_CORRUPT", "This version failed its integrity check"));
        }
        let meta = serde_json::json!({ "id": id, "fileRevision": header.file_revision, "exact": true }).to_string();
        let mut out = Vec::with_capacity(meta.len() + 1 + text.len());
        out.extend_from_slice(meta.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(&text);
        Ok(out)
    }

    pub fn read_blob(&self, blob: &str) -> Result<Vec<u8>> {
        self.store.read_blob_any(blob)
    }

    /// Explicit deletes run on the worker (urgent channel), never beside a write.
    fn delete(&self, make: impl FnOnce(mpsc::Sender<Result<()>>) -> worker::Msg) -> Result<()> {
        if self.read_only() || !self.has_worker {
            return Err(err("HISTORY_READ_ONLY", "History is read-only in this window"));
        }
        let (tx, rx) = mpsc::channel();
        self.inbox.send(make(tx));
        rx.recv_timeout(SNAPSHOT_WAIT).map_err(|_| err("IO_ERROR", "History did not answer in time"))?
    }

    pub fn delete_checkpoint(&self, id: &str) -> Result<()> {
        if !names::is_ulid(id) {
            return Err(err("INVALID_ARGUMENT", "Invalid version id"));
        }
        self.delete(|ack| worker::Msg::DeleteCheckpoint { id: id.to_string(), ack })
    }

    pub fn delete_all(&self, path: &str) -> Result<()> {
        validate_relative(path)?;
        self.delete(|ack| worker::Msg::DeleteAll { path: path.to_string(), ack })
    }

    pub(crate) fn stop(&self) {
        self.flags.active.store(false, Ordering::Relaxed);
        self.inbox.send(worker::Msg::Stop);
        self.inbox.stop();
    }

    /// Hook for the file watcher: only foreign or unknown files under `history/` need a reconcile.
    fn watched(&self, history: &[String], rescan: bool) {
        if !self.has_worker {
            return;
        }
        let own = self.own_device();
        if rescan || history.iter().any(|p| !is_own_history_path(p, own.as_deref())) {
            self.inbox.send_task(worker::Task::Reconcile);
        }
    }
}

/// A path written by this device (or an in-flight dotfile): nothing to learn from it.
fn is_own_history_path(p: &str, own: Option<&str>) -> bool {
    let file = p.rsplit('/').next().unwrap_or("");
    if file.starts_with('.') {
        return true;
    }
    match own {
        Some(dev) => names::VersionName::parse(file).is_some_and(|n| n.dev == dev) || names::BlobName::parse(file).is_some_and(|b| b.dev == dev),
        None => false,
    }
}

fn version_info(g: &index::Index, lineage: &str, e: &index::Entry, own: Option<&str>) -> VersionInfo {
    let head = e.head.as_ref();
    let availability = if e.dataless {
        "downloading"
    } else if e.keyframe_id().is_some_and(|k| g.entry(k).is_none_or(|(l, ke)| l != lineage || ke.name.dev != e.name.dev)) {
        "missing"
    } else {
        "local"
    };
    VersionInfo {
        id: e.name.id.clone(),
        lineage: lineage.to_string(),
        created_at: e.name.time_ms(),
        device: e.name.dev.clone(),
        own_device: own == Some(e.name.dev.as_str()),
        reason: e.reason().as_str(),
        name: head.and_then(|h| h.name.clone()),
        note: head.and_then(|h| h.note.clone()),
        kind: if e.name.is_keyframe() { "keyframe" } else { "delta" },
        size_bytes: e.size,
        element_count: head.map(|h| h.element_count),
        availability,
        header_loaded: head.is_some(),
    }
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

struct Slot {
    gen: Arc<AtomicU64>,
    join: Option<JoinHandle<()>>,
}

pub struct HistoryService {
    vaults: RwLock<HashMap<String, Arc<VaultHistory>>>,
    slots: Mutex<HashMap<String, Slot>>,
    /// `VAULTDRAW_HISTORY=0`: no thread, no save-path work, commands answer `HISTORY_OFF`.
    hard_off: bool,
    state_override: Option<PathBuf>,
    clock: Arc<dyn Clock>,
    free_probe: Mutex<Option<Arc<dyn Fn() -> bool + Send + Sync>>>,
    /// Opened vaults whose history has not started (`history.start` = idle or use):
    /// root, read-only flag and emitter, kept for the first `ensure` or history command.
    pending: Mutex<HashMap<String, (PathBuf, bool, Emitter)>>,
}

impl Default for HistoryService {
    fn default() -> Self {
        HistoryService {
            vaults: RwLock::default(),
            slots: Mutex::default(),
            hard_off: std::env::var("VAULTDRAW_HISTORY").is_ok_and(|v| v == "0"),
            state_override: None,
            clock: Arc::new(SystemClock),
            free_probe: Mutex::new(None),
            pending: Mutex::default(),
        }
    }
}

impl HistoryService {
    /// Tests: state directory and clock injected (no env, no machine state).
    #[cfg(test)]
    pub(crate) fn for_tests(state_dir: PathBuf, clock: Arc<dyn Clock>) -> HistoryService {
        HistoryService { state_override: Some(state_dir), clock, hard_off: false, ..Default::default() }
    }
    #[cfg(test)]
    pub(crate) fn hard_off_for_tests(state_dir: PathBuf) -> HistoryService {
        HistoryService { state_override: Some(state_dir), hard_off: true, ..Default::default() }
    }
    /// Overrides the free-space probe of workers started afterwards (tests inject low disk space).
    #[cfg(test)]
    pub(crate) fn set_free_probe(&self, f: Arc<dyn Fn() -> bool + Send + Sync>) {
        *lock(&self.free_probe) = Some(f);
    }

    pub(crate) fn get(&self, handle: &str) -> Option<Arc<VaultHistory>> {
        self.vaults.read().unwrap_or_else(|p| p.into_inner()).get(handle).cloned()
    }

    /// The vault's history, starting it first if it is pending (lazy start on first use).
    pub(crate) fn vault(&self, handle: &str) -> Result<Arc<VaultHistory>> {
        if self.hard_off {
            return Err(off());
        }
        self.ensure(handle);
        self.get(handle).ok_or_else(|| err("NOT_FOUND", "Vault handle is no longer active"))
    }

    fn state_dir(&self) -> Option<PathBuf> {
        self.state_override.clone().or_else(|| crate::config::resolve_dirs().ok().map(|d| d.state))
    }

    /// Records an opened vault without starting its history (`open_vault`).
    pub(crate) fn register(&self, handle: &str, root: PathBuf, read_only: bool, emit: Emitter) {
        if self.hard_off {
            return;
        }
        lock(&self.pending).insert(handle.to_string(), (root, read_only, emit));
    }

    /// Starts a registered vault's history if it is still pending; a no-op otherwise.
    pub(crate) fn ensure(&self, handle: &str) {
        // Held across the start so a concurrent caller waits for it instead of missing the vault.
        let mut pending = lock(&self.pending);
        if let Some((root, read_only, emit)) = pending.remove(handle) {
            self.start(handle, root, read_only, emit);
        }
    }

    /// Opens history for a vault. Joins the previous worker for the same vault id
    /// (≤ 2 s) so an A→B→A switch never has two writers; a generation token stops stragglers.
    pub(crate) fn start(&self, handle: &str, root: PathBuf, read_only: bool, emit: Emitter) {
        if self.hard_off {
            return;
        }
        let Some(state) = self.state_dir() else { return };
        let vault_id = search::vault_id(&root);
        let state_hist = state.join("history");
        let vault_state = state_hist.join(&vault_id);
        let staged_dir = vault_state.join("staged");
        let store = store::Store::new(&root);
        let format_newer = store.format_newer();
        let read_only = read_only || format_newer;

        // Only a writable start owns the generation: a read-only second instance must neither
        // supersede the writer nor wait for it (it would block `open_vault` and stop all writes).
        let (gen, my_gen, old) = if read_only {
            (Arc::new(AtomicU64::new(0)), 0, None)
        } else {
            let mut slots = lock(&self.slots);
            let slot = slots.entry(vault_id.clone()).or_insert_with(|| Slot { gen: Arc::new(AtomicU64::new(0)), join: None });
            let my_gen = slot.gen.fetch_add(1, Ordering::SeqCst) + 1;
            (slot.gen.clone(), my_gen, slot.join.take())
        };
        if let Some(old) = old {
            let t0 = Instant::now();
            while !old.is_finished() && t0.elapsed() < START_JOIN_TIMEOUT {
                std::thread::sleep(Duration::from_millis(5));
            }
            if old.is_finished() {
                let _ = old.join();
            }
        }

        let flags = Arc::new(staging::Flags::default());
        flags.read_only.store(read_only, Ordering::Relaxed);
        flags.active.store(!read_only, Ordering::Relaxed);
        let vh = Arc::new(VaultHistory {
            handle: handle.to_string(),
            root,
            vault_id: vault_id.clone(),
            state_hist,
            vault_state,
            staged_dir,
            store,
            flags,
            index: Arc::new(RwLock::new(index::Index::default())),
            inbox: Arc::new(worker::Inbox::default()),
            settings: Mutex::new(HistorySettings::default()),
            last_error: Mutex::new(None),
            format_newer: AtomicBool::new(format_newer),
            writing: Arc::new(AtomicBool::new(false)),
            loaded: Mutex::new(false),
            notifier: Arc::new(Mutex::new(Notifier::default())),
            emit,
            has_worker: !read_only,
            gen,
            my_gen,
            lineage: Mutex::new(lineage::State::default()),
            gc: Mutex::new(gc::Report::default()),
        });
        if !read_only {
            // Clones left by a crash or quit are collected before any new clone can exist
            // (nothing is staged until `history_configure` arrives).
            let survivors = worker::collect_survivors(&vh.staged_dir);
            let free_probe = lock(&self.free_probe).clone();
            let clock = self.clock.clone();
            let vh2 = vh.clone();
            let live = worker::LiveGuard::new(&vault_id);
            match std::thread::Builder::new().name("vaultdraw-history".into()).spawn(move || {
                let _live = live;
                worker::run(vh2, survivors, clock, free_probe)
            }) {
                Ok(j) => {
                    if let Some(slot) = lock(&self.slots).get_mut(&vault_id) {
                        slot.join = Some(j);
                    }
                }
                Err(e) => {
                    eprintln!("vaultdraw: history worker not started: {e}");
                    vh.flags.active.store(false, Ordering::Relaxed);
                }
            }
        }
        if let Some(old) = self.vaults.write().unwrap_or_else(|p| p.into_inner()).insert(handle.to_string(), vh) {
            old.stop();
        }
    }

    pub(crate) fn stop(&self, handle: &str) {
        lock(&self.pending).remove(handle);
        let vh = self.vaults.write().unwrap_or_else(|p| p.into_inner()).remove(handle);
        if let Some(vh) = vh {
            vh.stop();
        }
    }

    // ---- hooks called from lib.rs ----

    /// Save path: after the commit succeeded, still under the mutation guard.
    pub(crate) fn after_commit(&self, handle: &str, rel: &str, revision: &str, size: u64) {
        if let Some(vh) = self.vaults.read().unwrap_or_else(|p| p.into_inner()).get(handle) {
            vh.after_commit(rel, revision, size);
        }
    }

    pub(crate) fn moved(&self, handle: &str, from: &str, to: &str) {
        if let Some(vh) = self.get(handle) {
            lineage::moved(&vh, from, to);
        }
    }

    pub(crate) fn trashed(&self, handle: &str, path: &str) {
        if let Some(vh) = self.get(handle) {
            lineage::trashed(&vh, path);
        }
    }

    /// Links are about to rewrite `path` (D-R2): keep its pre-rewrite state.
    pub(crate) fn before_link_rewrite(&self, handle: &str, path: &str) {
        if let Some(vh) = self.get(handle) {
            outside::before_rewrite(&vh, path);
        }
    }

    /// Watcher batch: `entries` are vault paths, `history` paths under `.excalidraw-vault/history/`.
    pub(crate) fn watched(&self, handle: &str, entries: &[String], history: &[String], rescan: bool) {
        let Some(vh) = self.get(handle) else { return };
        outside::watched(&vh, entries);
        if !history.is_empty() || rescan {
            vh.watched(history, rescan);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| err("INTERNAL", format!("History task failed: {e}")))?
}

#[tauri::command]
pub(crate) async fn history_configure(handle: String, settings: HistorySettings, state: State<'_, HistoryService>) -> Result<()> {
    state.vault(&handle)?.configure(settings);
    Ok(())
}

#[tauri::command]
pub(crate) async fn history_status(handle: String, state: State<'_, HistoryService>) -> Result<HistoryStatus> {
    let vh = state.vault(&handle)?;
    blocking(move || Ok(vh.status())).await
}

#[tauri::command]
pub(crate) async fn history_opened(handle: String, path: Option<String>, revision: Option<String>, state: State<'_, HistoryService>) -> Result<()> {
    state.vault(&handle)?.opened(path, revision)
}

#[tauri::command]
pub(crate) async fn history_list(handle: String, path: String, state: State<'_, HistoryService>) -> Result<HistoryListing> {
    let vh = state.vault(&handle)?;
    blocking(move || vh.list(&path)).await
}

#[tauri::command]
pub(crate) async fn history_snapshot(handle: String, path: String, reason: String, wait: bool, state: State<'_, HistoryService>) -> Result<SnapshotOutcome> {
    let vh = state.vault(&handle)?;
    blocking(move || vh.snapshot(&path, &reason, wait)).await
}

#[tauri::command]
pub(crate) async fn history_checkpoint(handle: String, path: String, name: String, note: String, state: State<'_, HistoryService>) -> Result<VersionInfo> {
    let vh = state.vault(&handle)?;
    blocking(move || vh.checkpoint(&path, &name, &note)).await
}

#[tauri::command]
pub(crate) async fn history_read_version(handle: String, id: String, state: State<'_, HistoryService>) -> Result<tauri::ipc::Response> {
    let vh = state.vault(&handle)?;
    let bytes = blocking(move || vh.read_version(&id)).await?;
    crate::memory::schedule_release();
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn history_read_blob(handle: String, blob: String, state: State<'_, HistoryService>) -> Result<tauri::ipc::Response> {
    let vh = state.vault(&handle)?;
    let bytes = blocking(move || vh.read_blob(&blob)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Raw body = UTF-8 scene JSON; headers `x-handle`, `x-path`, `x-reason`, `x-revision` (percent-encoded).
#[tauri::command]
pub(crate) async fn history_snapshot_bytes(request: tauri::ipc::Request<'_>, state: State<'_, HistoryService>) -> Result<SnapshotOutcome> {
    let get = |name: &str| clipboard::percent_decode(&clipboard::header_value(request.headers(), name)?);
    let handle = get("x-handle")?;
    let vh = state.vault(&handle)?;
    let (path, reason, revision) = (get("x-path")?, get("x-reason")?, get("x-revision")?);
    let body = clipboard::raw_body(&request)?;
    validate_relative(&path)?;
    outside::snapshot_bytes(&vh, &path, &reason, &revision, body)
}

#[tauri::command]
pub(crate) async fn history_restore_copy(handle: String, id: String, state: State<'_, HistoryService>) -> Result<export::RestoredCopy> {
    let vh = state.vault(&handle)?;
    blocking(move || export::restore_copy(&vh, &id)).await
}

#[tauri::command]
pub(crate) async fn history_export_file(handle: String, id: String, state: State<'_, HistoryService>) -> Result<bool> {
    let vh = state.vault(&handle)?;
    blocking(move || export::export_file(&vh, &id)).await
}

#[tauri::command]
pub(crate) async fn history_delete_checkpoint(handle: String, id: String, state: State<'_, HistoryService>) -> Result<()> {
    let vh = state.vault(&handle)?;
    blocking(move || vh.delete_checkpoint(&id)).await
}

#[tauri::command]
pub(crate) async fn history_delete_all(handle: String, path: String, state: State<'_, HistoryService>) -> Result<()> {
    let vh = state.vault(&handle)?;
    blocking(move || vh.delete_all(&path)).await
}

#[tauri::command]
pub(crate) async fn history_exclude_from_git(handle: String, state: State<'_, HistoryService>) -> Result<()> {
    let vh = state.vault(&handle)?;
    blocking(move || git::exclude_from_git(&vh)).await
}
