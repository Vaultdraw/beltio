//! The history worker: trigger logic (`Core`, pure of threads and clocks so it is unit-testable
//! with an injected clock and a fake `Backend`) plus the thread loop that drives it.
//!
//! Triggers (PLAN §2.2): timer (≥ interval since the last version AND ≥ 30 s idle, forced at 3×
//! interval; interval 0 = none), leave (via `history_opened`), shrink rule (x), checkpoint (c),
//! before-restore (r), first edit (f), startup catch-up of pending clones (v).
//! "Dirty" means our own committed revision that is not yet versioned (M2).

use super::{
    names::Reason,
    writer::{Backend, Clock, Outcome, Source, VersionRequest, Written},
    HistorySettings, SnapshotOutcome,
};
use crate::{err, Result};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, mpsc::{channel, Receiver, RecvTimeoutError, Sender}, Arc, Mutex},
    time::Duration,
};

/// Idle time since the last commit before a timed version is made.
pub const IDLE_MS: u64 = 30_000;
/// Forced version after this many intervals of continuous editing.
pub const FORCE_FACTOR: u64 = 3;
pub const SHRINK_MIN_BYTES: u64 = 4096;
const RETRY_MIN_MS: u64 = 60_000;

/// Ordered (urgent) messages: everything that must be seen in the order it was sent.
pub enum Msg {
    Configure(HistorySettings),
    Opened { path: Option<String>, revision: Option<String>, clone: Option<PathBuf> },
    Committed { path: String, revision: String, size: u64, staged: Option<PathBuf> },
    Snapshot { path: String, reason: Reason, ack: Option<Sender<Result<SnapshotOutcome>>> },
    Checkpoint { path: String, name: String, note: String, ack: Sender<Result<Written>> },
    /// Explicit deletes (H3, `gc.rs`); handled by the thread loop, which owns the vault context.
    DeleteCheckpoint { id: String, ack: Sender<Result<()>> },
    DeleteAll { path: String, ack: Sender<Result<()>> },
    /// A drawing or folder moved inside the app (`lineage::apply_moved`).
    Moved { from: String, to: String },
    /// A drawing went to the OS Trash from the app (`lineage::apply_trashed`).
    Trashed { path: String },
    /// Watcher paths (only `.excalidraw` ones are ever queued), see `outside::apply_watched`.
    Watched(Vec<String>),
    /// `history_snapshot_bytes`: the body sits in `temp` (deleted by the worker in every case).
    SnapshotBytes { path: String, reason: Reason, revision: String, temp: PathBuf, ack: Sender<Result<SnapshotOutcome>> },
    /// Links are about to rewrite `path`; `clone` = its live state, if it could be cloned.
    BeforeRewrite { path: String, clone: Option<PathBuf> },
    Stop,
}

/// Background work, run in ≤ 5 ms chunks after the urgent queue is drained.
pub enum Task {
    /// Files appeared/changed under `history/` (sync, other instance): reconcile the index.
    Reconcile,
    /// Read these versions' headers (queued by `history_list`).
    LoadHeaders(Vec<String>),
}

enum Item {
    Msg(Msg),
    Task(Task),
    Wake,
}

/// Worker-side state (touched by the worker thread only, so its mutex is never contended).
struct Rx {
    rx: Receiver<Item>,
    urgent: VecDeque<Msg>,
    bg: VecDeque<Task>,
}

/// Lock-free for senders: `mpsc::Sender::send` never blocks on the receiver, so the save path can't
/// wait behind a descheduled worker (no priority inversion). The worker drains the channel into
/// two local queues and serves urgent messages first.
pub struct Inbox {
    tx: Sender<Item>,
    rx: Mutex<Rx>,
    stopped: AtomicBool,
}

impl Default for Inbox {
    fn default() -> Self {
        let (tx, rx) = channel();
        Inbox { tx, rx: Mutex::new(Rx { rx, urgent: VecDeque::new(), bg: VecDeque::new() }), stopped: AtomicBool::new(false) }
    }
}

pub enum Popped {
    Msg(Msg),
    Task(Task),
    Timeout,
    Stop,
}

impl Rx {
    fn file(&mut self, item: Item) {
        match item {
            Item::Msg(m) => self.urgent.push_back(m),
            Item::Task(t) => self.bg.push_back(t),
            Item::Wake => {}
        }
    }
}

impl Inbox {
    pub fn send(&self, m: Msg) {
        let _ = self.tx.send(Item::Msg(m));
    }
    pub fn send_task(&self, t: Task) {
        let _ = self.tx.send(Item::Task(t));
    }
    /// After a stop: paths of the commits still queued (their clones stay on disk for the next launch;
    /// only the sidecar that names the drawing is missing). Cheap: no encoding, no versions.
    pub fn queued_commit_paths(&self) -> Vec<String> {
        let mut s = self.rx.lock().unwrap_or_else(|p| p.into_inner());
        while let Ok(item) = s.rx.try_recv() {
            s.file(item);
        }
        s.urgent.iter().filter_map(|m| match m {
            Msg::Committed { path, staged: Some(_), .. } => Some(path.clone()),
            _ => None,
        }).collect()
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Item::Wake);
    }
    /// Next item: urgent first, then background; blocks up to `wait` (forever for `None`).
    /// `poll_only` = background chunks pending: block at most `BG_YIELD`, then return `Timeout`.
    pub fn pop(&self, wait: Option<Duration>, poll_only: bool) -> Popped {
        let mut s = self.rx.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            while let Ok(item) = s.rx.try_recv() {
                s.file(item);
            }
            if self.stopped.load(Ordering::SeqCst) {
                return Popped::Stop;
            }
            if let Some(m) = s.urgent.pop_front() {
                return Popped::Msg(m);
            }
            if let Some(t) = s.bg.pop_front() {
                return Popped::Task(t);
            }
            // Background chunks pending: sleep a short slice (an urgent message still wakes the
            // recv at once) so the chunks run at a ~25% duty cycle instead of back-to-back.
            let wait = if poll_only { Some(wait.map_or(BG_YIELD, |w| w.min(BG_YIELD))) } else { wait };
            let got = match wait {
                None => s.rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(d) => s.rx.recv_timeout(d),
            };
            match got {
                Ok(item) => s.file(item),
                Err(RecvTimeoutError::Timeout) => return Popped::Timeout,
                Err(RecvTimeoutError::Disconnected) => return Popped::Stop,
            }
        }
    }
}

/// A clone that survived a crash/quit: version it with reason `v`.
pub struct CatchUp {
    pub path: String,
    pub file: PathBuf,
    pub rev16: String,
}

#[derive(Clone, Debug)]
pub(super) struct Pending {
    pub(super) rev: String,
    pub(super) size: u64,
    /// Size without `isDeleted` tombstones (what the shrink rule compares).
    live: u64,
    pub(super) staged: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub(super) struct OpenClone {
    pub(super) file: PathBuf,
    pub(super) rev: String,
    pub(super) size: u64,
    live: u64,
}

/// The staged state of a drawing: what its live file looked like at the last commit (pending) or
/// at open time. `pending` = unversioned committed state.
#[derive(Clone, Debug)]
pub(super) struct Staged {
    pub(super) file: PathBuf,
    pub(super) rev: String,
    pub(super) size: u64,
    pub(super) pending: bool,
}

#[derive(Default)]
pub(super) struct Track {
    pub(super) pending: Option<Pending>,
    pub(super) open_clone: Option<OpenClone>,
    /// Stat of the staged clone (file, size, mtime), cached for the outside-change identity check.
    ident: Option<(PathBuf, u64, Option<std::time::SystemTime>)>,
    /// Reference for the interval rule: time of the newest known version (or first dirty time).
    base_ms: Option<u64>,
    last_commit_ms: u64,
    retry_at: Option<u64>,
    first_done: bool,
    noted: bool,
}

pub struct Core<B: Backend> {
    pub b: B,
    clock: Arc<dyn Clock>,
    settings: Option<HistorySettings>,
    pub(super) tracks: HashMap<String, Track>,
    open: Option<String>,
    /// An orphan appeared or an unlinked drawing showed up: a relink pass is wanted (read by the loop).
    pub(super) want_relink: bool,
}

fn skipped(why: &str) -> SnapshotOutcome {
    SnapshotOutcome { id: None, skipped: Some(why.to_string()) }
}

impl<B: Backend> Core<B> {
    pub fn new(b: B, clock: Arc<dyn Clock>) -> Core<B> {
        Core { b, clock, settings: None, tracks: HashMap::new(), open: None, want_relink: false }
    }

    /// Configured and enabled (unconfigured = off, Minor 3).
    pub fn on(&self) -> bool {
        self.settings.as_ref().is_some_and(|s| s.enabled)
    }
    pub fn is_configured(&self) -> bool {
        self.settings.is_some()
    }
    pub fn settings(&self) -> Option<&HistorySettings> {
        self.settings.as_ref()
    }
    fn interval_ms(&self) -> u64 {
        self.settings.as_ref().map_or(0, |s| u64::from(s.interval_minutes) * 60_000)
    }
    pub fn is_dirty(&self, path: &str) -> bool {
        self.tracks.get(path).is_some_and(|t| t.pending.is_some())
    }
    pub fn tracked_pending(&self) -> usize {
        self.tracks.values().filter(|t| t.pending.is_some()).count()
    }

    pub fn configure(&mut self, s: HistorySettings) {
        let was_on = self.on();
        self.settings = Some(s);
        if was_on && !self.on() {
            // Disabled: stop tracking and free the clones (the live files hold every state).
            let tracks = std::mem::take(&mut self.tracks);
            for (_, t) in tracks {
                if let Some(p) = t.pending.and_then(|p| p.staged) {
                    self.b.remove_clone(&p);
                }
                if let Some(o) = t.open_clone {
                    self.b.remove_clone(&o.file);
                }
            }
        }
    }

    pub fn catch_up(&mut self, items: Vec<CatchUp>) {
        for it in items {
            if !self.on() {
                self.b.remove_clone(&it.file);
                continue;
            }
            let req = VersionRequest {
                path: it.path.clone(),
                reason: Reason::Recovered,
                name: None,
                note: None,
                source: Source::Clone(it.file.clone()),
                revision: None,
                size: None,
                verify: true,
                allow_unchanged: false,
                rev_prefix: Some(it.rev16.clone()),
            };
            match self.b.write(&req) {
                Ok(Outcome::Written(w)) => {
                    self.b.changed(&it.path, &w.lineage);
                    self.b.remove_clone(&it.file);
                }
                Ok(Outcome::DiskLow) => {
                    let keep = self.keep_set();
                    self.b.disk_low(&keep);
                }
                Ok(Outcome::Skipped("stopped")) => {}
                Ok(Outcome::Skipped(_)) => self.b.remove_clone(&it.file),
                Err(e) => self.b.error(&e.code, &e.message),
            }
        }
    }

    fn keep_set(&self) -> HashSet<PathBuf> {
        self.tracks.values().filter_map(|t| t.pending.as_ref().and_then(|p| p.staged.clone())).collect()
    }

    pub fn dispatch(&mut self, m: Msg) {
        match m {
            Msg::Configure(s) => self.configure(s),
            Msg::Opened { path, revision, clone } => self.on_opened(path, revision, clone),
            Msg::Committed { path, revision, size, staged } => self.on_committed(path, revision, size, staged),
            Msg::Snapshot { path, reason, ack } => {
                let r = self.snapshot(&path, reason);
                if let Some(a) = ack {
                    let _ = a.send(r);
                }
            }
            Msg::Checkpoint { path, name, note, ack } => {
                let _ = ack.send(self.checkpoint(&path, &name, &note));
            }
            Msg::DeleteCheckpoint { ack, .. } | Msg::DeleteAll { ack, .. } => {
                // Only the thread loop (which has the vault) can run deletes.
                let _ = ack.send(Err(err("INTERNAL", "Delete reached the trigger core")));
            }
            Msg::SnapshotBytes { path, reason, revision, temp, ack } => {
                let r = self.snapshot_bytes(&path, reason, &revision, &temp);
                self.b.remove_clone(&temp);
                let _ = ack.send(r);
            }
            Msg::BeforeRewrite { path, clone } => self.before_rewrite(&path, clone),
            // Vault-level messages are handled by the thread loop (they need the index).
            Msg::Moved { .. } | Msg::Trashed { .. } | Msg::Watched(_) | Msg::Stop => {}
        }
    }

    pub(super) fn clock_ms(&self) -> u64 {
        self.clock.now_ms()
    }

    pub(super) fn request(&self, path: &str, reason: Reason, source: Source, revision: Option<String>, size: Option<u64>, verify: bool) -> VersionRequest {
        VersionRequest { path: path.to_string(), reason, name: None, note: None, source, revision, size, verify, allow_unchanged: false, rev_prefix: None }
    }

    /// Writes `req` and applies the bookkeeping common to every outcome. `Ok(Some)` = written.
    pub(super) fn run(&mut self, req: &VersionRequest) -> Result<Outcome> {
        let out = self.b.write(req);
        match &out {
            Ok(Outcome::Written(w)) => {
                self.b.disk_ok();
                self.b.changed(&req.path, &w.lineage);
            }
            Ok(Outcome::DiskLow) => {
                let keep = self.keep_set();
                self.b.disk_low(&keep);
            }
            Err(e) => self.b.error(&e.code, &e.message),
            _ => {}
        }
        out
    }

    pub(super) fn mark_versioned(&mut self, path: &str, now: u64) {
        if let Some(t) = self.tracks.get_mut(path) {
            if let Some(p) = t.pending.take() {
                if let Some(f) = p.staged {
                    self.b.remove_clone(&f);
                }
            }
            t.base_ms = Some(now);
            t.retry_at = None;
        }
    }

    /// Versions the latest pending state of `path`. Returns true when nothing is pending anymore.
    pub(super) fn version_pending(&mut self, path: &str, reason: Reason) -> bool {
        let now = self.clock.now_ms();
        let Some(p) = self.tracks.get(path).and_then(|t| t.pending.clone()) else { return true };
        let source = p.staged.clone().map_or(Source::Live, Source::Clone);
        let req = self.request(path, reason, source, Some(p.rev), Some(p.size), false);
        match self.run(&req) {
            Ok(Outcome::Written(_)) => {
                self.mark_versioned(path, now);
                true
            }
            // Nothing left to do for this state: it is already versioned or no longer obtainable.
            Ok(Outcome::Skipped(why)) if why != "stopped" => {
                self.mark_versioned(path, now);
                true
            }
            // A newer worker owns the vault: nothing to write, and no busy loop while waiting for the stop.
            Ok(Outcome::Skipped(_)) | Ok(Outcome::DiskLow) | Err(_) => {
                let retry = now + self.interval_ms().max(RETRY_MIN_MS);
                if let Some(t) = self.tracks.get_mut(path) {
                    t.retry_at = Some(retry);
                }
                false
            }
        }
    }

    /// `clone` = the open-time clone made when the command arrived (so a quick first save can't beat it).
    pub fn on_opened(&mut self, path: Option<String>, revision: Option<String>, clone: Option<PathBuf>) {
        if let Some(prev) = self.open.take() {
            self.leave(&prev);
        }
        self.open = path.clone();
        let (Some(path), Some(revision)) = (path, revision) else {
            if let Some(c) = clone {
                self.b.remove_clone(&c);
            }
            return;
        };
        if !self.on() {
            if let Some(c) = clone {
                self.b.remove_clone(&c);
            }
            return;
        }
        if let Some(old) = self.tracks.entry(path.clone()).or_default().open_clone.take() {
            self.b.remove_clone(&old.file);
        }
        self.tracks.entry(path.clone()).or_default().first_done = false;
        self.b.note_path(&path);
        self.tracks.entry(path.clone()).or_default().noted = true;
        if let Some(file) = clone {
            let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            let live = self.b.live_size(&file, size);
            if let Some(t) = self.tracks.get_mut(&path) {
                t.open_clone = Some(OpenClone { file, rev: revision, size, live });
            }
        }
    }

    fn leave(&mut self, path: &str) {
        if self.on() && self.is_dirty(path) {
            self.version_pending(path, Reason::Leave);
        }
        let Some(t) = self.tracks.get_mut(path) else { return };
        if let Some(o) = t.open_clone.take() {
            self.b.remove_clone(&o.file);
        }
        if t.pending.is_none() {
            self.tracks.remove(path);
        }
    }

    pub fn on_committed(&mut self, path: String, revision: String, size: u64, staged: Option<PathBuf>) {
        if !self.on() {
            if let Some(f) = staged {
                self.b.remove_clone(&f);
            }
            return;
        }
        let now = self.clock.now_ms();
        // Live size (tombstones excluded) of this commit, computed here on the worker, never on the save path.
        let live = staged.as_ref().map_or(size, |f| self.b.live_size(f, size));
        if staged.is_some() && !self.tracks.get(&path).is_some_and(|t| t.noted) {
            self.b.note_path(&path);
            self.tracks.entry(path.clone()).or_default().noted = true;
        }
        let no_lineage = self.b.latest(&path).is_none();
        let (prev_pending, open) = {
            let t = self.tracks.entry(path.clone()).or_default();
            (t.pending.clone(), t.open_clone.clone())
        };
        // First edit (f): the drawing has no history yet, so its open-time state is the original.
        if no_lineage && !self.tracks.get(&path).is_some_and(|t| t.first_done) {
            if let Some(oc) = open.clone() {
                let req = self.request(&path, Reason::First, Source::Clone(oc.file.clone()), Some(oc.rev.clone()), Some(oc.size), true);
                if matches!(self.run(&req), Ok(Outcome::Written(_))) {
                    self.b.remove_clone(&oc.file);
                    if let Some(t) = self.tracks.get_mut(&path) {
                        t.open_clone = None;
                        t.base_ms = Some(now);
                    }
                }
            }
            if let Some(t) = self.tracks.get_mut(&path) {
                t.first_done = true;
            }
        } else if let Some((src_size, source, rev, vsize, verify)) = Self::previous_state(&prev_pending, &open) {
            // Shrink rule (x): a commit ≤ 50% of the previous state (previous ≥ 4 KB) versions the
            // previous state first (Cmd+Delete, select-all + Delete, paste-over, clear canvas).
            if src_size >= SHRINK_MIN_BYTES && live * 2 <= src_size {
                let req = self.request(&path, Reason::BeforeClear, source, Some(rev), Some(vsize), verify);
                if matches!(self.run(&req), Ok(Outcome::Written(_))) {
                    if let Some(t) = self.tracks.get_mut(&path) {
                        t.base_ms = Some(now);
                    }
                }
            }
        }
        let base_fallback = if self.tracks.get(&path).is_some_and(|t| t.base_ms.is_none()) { self.b.latest(&path).map(|l| l.created_ms).or(Some(now)) } else { None };
        let t = self.tracks.entry(path).or_default();
        if t.base_ms.is_none() {
            t.base_ms = base_fallback;
        }
        // The open-time state is older than this commit now: the pending state (or a version of it)
        // is the "previous state" from here on, so a stale open clone must never feed the shrink rule.
        let stale_open = t.open_clone.take();
        // Coalescing: only the latest pending clone is kept; superseded ones are deleted.
        let old = t.pending.replace(Pending { rev: revision, size, live, staged: staged.clone() });
        t.last_commit_ms = now;
        t.retry_at = None;
        if let Some(o) = stale_open {
            self.b.remove_clone(&o.file);
        }
        if let Some(o) = old.and_then(|o| o.staged) {
            if Some(&o) != staged.as_ref() {
                self.b.remove_clone(&o);
            }
        }
    }

    /// The previous state a shrink can still version: the pending clone, else the open-time clone.
    #[allow(clippy::type_complexity)]
    fn previous_state(pending: &Option<Pending>, open: &Option<OpenClone>) -> Option<(u64, Source, String, u64, bool)> {
        if let Some(p) = pending {
            return p.staged.clone().map(|f| (p.live, Source::Clone(f), p.rev.clone(), p.size, false));
        }
        open.as_ref().map(|o| (o.live, Source::Clone(o.file.clone()), o.rev.clone(), o.size, true))
    }

    pub fn snapshot(&mut self, path: &str, reason: Reason) -> Result<SnapshotOutcome> {
        if !self.on() {
            return Ok(skipped("off"));
        }
        self.version_now(path, reason, None, None, false).map(|o| match o {
            Ok(w) => SnapshotOutcome { id: Some(w.id), skipped: None },
            Err(why) => skipped(why),
        })
    }

    pub fn checkpoint(&mut self, path: &str, name: &str, note: &str) -> Result<Written> {
        if !self.on() {
            return Err(err("HISTORY_OFF", "File history is turned off"));
        }
        match self.version_now(path, Reason::Checkpoint, Some(name.to_string()), Some(note.to_string()), true)? {
            Ok(w) => Ok(w),
            Err(why) => Err(err("IO_ERROR", format!("Checkpoint was not saved ({why})"))),
        }
    }

    /// Versions the current committed state of `path` (pending clone, else the live file).
    fn version_now(&mut self, path: &str, reason: Reason, name: Option<String>, note: Option<String>, allow_unchanged: bool) -> Result<std::result::Result<Written, &'static str>> {
        let now = self.clock.now_ms();
        let p = self.tracks.get(path).and_then(|t| t.pending.clone());
        let (source, rev, size) = match &p {
            Some(p) => (p.staged.clone().map_or(Source::Live, Source::Clone), Some(p.rev.clone()), Some(p.size)),
            None => (Source::Live, None, None),
        };
        let mut req = self.request(path, reason, source, rev, size, false);
        req.name = name;
        req.note = note;
        req.allow_unchanged = allow_unchanged;
        match self.run(&req)? {
            Outcome::Written(w) => {
                if p.is_some() {
                    self.mark_versioned(path, now);
                } else if let Some(t) = self.tracks.get_mut(path) {
                    t.base_ms = Some(now);
                }
                Ok(Ok(w))
            }
            Outcome::Skipped(why) => {
                if why == "unchanged" && p.is_some() {
                    self.mark_versioned(path, now);
                }
                Ok(Err(why))
            }
            Outcome::DiskLow => Err(err("HISTORY_DISK_LOW", "Free disk space is low; history is paused")),
        }
    }

    // ---- H3: moves, staged identity, outside changes ----

    /// The staged state of `path` (pending clone first, else the open-time clone).
    pub(super) fn staged_state(&self, path: &str) -> Option<Staged> {
        let t = self.tracks.get(path)?;
        if let Some(p) = &t.pending {
            return p.staged.clone().map(|file| Staged { file, rev: p.rev.clone(), size: p.size, pending: true });
        }
        t.open_clone.as_ref().map(|o| Staged { file: o.file.clone(), rev: o.rev.clone(), size: o.size, pending: false })
    }

    /// (size, mtime) of the staged clone of `path`, stat'ed once per clone and cached. `clonefile`
    /// keeps the source's mtime on APFS, so the live file of our own save has the same identity.
    pub(super) fn staged_identity(&mut self, st: &Staged, path: &str) -> Option<(u64, Option<std::time::SystemTime>)> {
        let t = self.tracks.get_mut(path)?;
        if let Some((f, size, mtime)) = &t.ident {
            if *f == st.file {
                return Some((*size, *mtime));
            }
        }
        let md = std::fs::metadata(&st.file).ok()?;
        let id = (md.len(), md.modified().ok());
        t.ident = Some((st.file.clone(), id.0, id.1));
        Some(id)
    }

    /// Versions the staged state of `path` with `reason` (verified against its revision) and
    /// settles it (pending dropped / open clone removed). `false` = kept for a retry.
    pub(super) fn version_staged(&mut self, path: &str, reason: Reason) -> bool {
        let Some(st) = self.staged_state(path) else { return false };
        let now = self.clock.now_ms();
        let req = self.request(path, reason, Source::Clone(st.file.clone()), Some(st.rev.clone()), Some(st.size), true);
        let settled = match self.run(&req) {
            Ok(Outcome::Written(_)) => true,
            // Already versioned, or the clone no longer holds that state: nothing more to keep.
            Ok(Outcome::Skipped(why)) => why != "stopped",
            Ok(Outcome::DiskLow) | Err(_) => false,
        };
        if settled {
            if st.pending {
                self.mark_versioned(path, now);
            } else if let Some(t) = self.tracks.get_mut(path) {
                if let Some(o) = t.open_clone.take() {
                    self.b.remove_clone(&o.file);
                }
            }
        }
        settled
    }

    /// Drops the track of a drawing that is gone (clones removed).
    pub(super) fn drop_track(&mut self, path: &str) {
        if let Some(t) = self.tracks.remove(path) {
            if let Some(f) = t.pending.and_then(|p| p.staged) {
                self.b.remove_clone(&f);
            }
            if let Some(o) = t.open_clone {
                self.b.remove_clone(&o.file);
            }
        }
        if self.open.as_deref() == Some(path) {
            self.open = None;
        }
    }

    /// A drawing or folder moved: tracks, pending/open clones and sidecars follow (pending commits
    /// are versioned into the right lineage even after a crash).
    pub(super) fn on_moved(&mut self, from: &str, to: &str, fold: bool) {
        let moves: Vec<(String, String)> = self.tracks.keys().filter_map(|k| rebase(k, from, to, fold).map(|n| (k.clone(), n))).collect();
        for (old, new) in moves {
            let Some(mut t) = self.tracks.remove(&old) else { continue };
            if old != new {
                self.drop_track(&new);
            }
            if let Some(p) = t.pending.as_mut() {
                if let Some(nf) = p.staged.as_ref().and_then(|f| self.b.rename_clone(f, &old, &new)) {
                    p.staged = Some(nf);
                }
            }
            if let Some(o) = t.open_clone.as_mut() {
                if let Some(nf) = self.b.rename_clone(&o.file, &old, &new) {
                    o.file = nf;
                }
            }
            t.ident = None;
            self.tracks.insert(new.clone(), t);
            self.b.drop_sidecar(&old, &new);
        }
        if let Some(n) = self.open.as_deref().and_then(|o| rebase(o, from, to, fold)) {
            self.open = Some(n);
        }
    }

    /// `history_snapshot_bytes` (M15, Minor 14): the exact bytes sit in `temp`, `revision` = their sha256.
    /// `before-outside-change` only when that is the path's unversioned commit (staging off or
    /// unsupported: no clone exists, so the frontend's copy is the only one); `discarded-edits` always.
    pub(super) fn snapshot_bytes(&mut self, path: &str, reason: Reason, revision: &str, temp: &std::path::Path) -> Result<SnapshotOutcome> {
        if !self.on() {
            return Ok(skipped("off"));
        }
        let before = reason == Reason::BeforeOutside;
        if before && self.tracks.get(path).and_then(|t| t.pending.as_ref()).map(|p| p.rev.as_str()) != Some(revision) {
            return Ok(skipped("not-pending"));
        }
        let now = self.clock.now_ms();
        let req = self.request(path, reason, Source::Clone(temp.to_path_buf()), Some(revision.to_string()), None, true);
        match self.run(&req)? {
            Outcome::Written(w) => {
                if before {
                    self.mark_versioned(path, now);
                }
                Ok(SnapshotOutcome { id: Some(w.id), skipped: None })
            }
            Outcome::Skipped(why) => {
                if before && why == "unchanged" {
                    self.mark_versioned(path, now);
                }
                Ok(skipped(why))
            }
            Outcome::DiskLow => Err(err("HISTORY_DISK_LOW", "Free disk space is low; history is paused")),
        }
    }

    /// Links are about to rewrite `path` (D-R2): keep the pre-rewrite state. A pending state is
    /// that state; otherwise the cloned live file is versioned unless it equals the newest version.
    pub(super) fn before_rewrite(&mut self, path: &str, clone: Option<PathBuf>) {
        if self.on() && self.tracks.get(path).is_some_and(|t| t.pending.is_some()) {
            self.version_pending(path, Reason::BeforeOutside);
        } else if let (true, Some(c)) = (self.on(), clone.as_ref()) {
            let req = self.request(path, Reason::BeforeOutside, Source::Clone(c.clone()), None, None, true);
            // "unchanged" (equals the newest version) is the common case: nothing to do.
            let _ = self.run(&req);
        }
        if let Some(c) = clone {
            self.b.remove_clone(&c);
        }
    }

    /// Next time a timer needs attention (ms, wall clock); `None` = nothing to wait for.
    pub fn next_deadline(&self) -> Option<u64> {
        if !self.on() {
            return None;
        }
        let interval = self.interval_ms();
        self.tracks
            .values()
            .filter(|t| t.pending.is_some())
            .filter_map(|t| {
                if let Some(r) = t.retry_at {
                    return Some(r);
                }
                if interval == 0 {
                    return None;
                }
                let base = t.base_ms.unwrap_or(t.last_commit_ms);
                let due = (base + interval).max(t.last_commit_ms + IDLE_MS);
                Some(due.min(base + FORCE_FACTOR * interval))
            })
            .min()
    }

    /// Runs every timer that is due.
    pub fn tick(&mut self) {
        if !self.on() {
            return;
        }
        let now = self.clock.now_ms();
        let due: Vec<String> = self
            .tracks
            .iter()
            .filter(|(_, t)| t.pending.is_some())
            .filter(|(_, t)| {
                let interval = self.interval_ms();
                let d = if let Some(r) = t.retry_at {
                    Some(r)
                } else if interval == 0 {
                    None
                } else {
                    let base = t.base_ms.unwrap_or(t.last_commit_ms);
                    Some(((base + interval).max(t.last_commit_ms + IDLE_MS)).min(base + FORCE_FACTOR * interval))
                };
                d.is_some_and(|d| d <= now)
            })
            .map(|(p, _)| p.clone())
            .collect();
        for p in due {
            self.version_pending(&p, Reason::Auto);
        }
    }
}

/// `path` after moving `from` → `to`: the path itself, or something under the moved folder.
pub(super) fn rebase(path: &str, from: &str, to: &str, fold: bool) -> Option<String> {
    let (p, f) = if fold { (path.to_lowercase(), from.to_lowercase()) } else { (path.to_string(), from.to_string()) };
    if p == f {
        return Some(to.to_string());
    }
    let rest = p.strip_prefix(&f)?.strip_prefix('/')?;
    // `rest` is as long in bytes as the original tail only when folding kept lengths: slice the original.
    let tail = path.get(path.len() - rest.len()..)?;
    Some(format!("{to}/{tail}"))
}

// ---------------------------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------------------------

use super::{index, staging, store, writer, HistoryEvent, ChangeEvent, VaultHistory};
use std::{path::Path, time::Instant};

const CHUNK: Duration = Duration::from_millis(5);
/// Pause between background chunks: 5 ms of work per ~15 ms pause is a ~25% duty cycle, and the
/// pause is a blocking recv, so an urgent message (a save snapshot) wakes the worker immediately.
const BG_YIELD: Duration = Duration::from_millis(15);
const STATE_SWEEP_MS: u64 = 90 * 24 * 3600 * 1000;

/// What the previous run left in the staged dir: clones to turn into `v` versions, files to drop.
#[derive(Default)]
pub struct Survivors {
    pub catch_up: Vec<CatchUp>,
    pub delete: Vec<PathBuf>,
}

/// Newest pending clone per drawing (attributed through its sidecar); everything else is dropped:
/// older clones, open-time clones (their editor is gone) and clones without a known drawing.
pub fn collect_survivors(staged_dir: &Path) -> Survivors {
    let mut out = Survivors::default();
    if writer::ensure_plain_dir(staged_dir).is_err() {
        return out;
    }
    // Scratch files of `history_snapshot_bytes` and link rewrites never outlive their request.
    out.delete.extend(staging::list_temps(staged_dir));
    let mut by_key: HashMap<String, Vec<staging::StagedFile>> = HashMap::new();
    for c in staging::list_clones(staged_dir) {
        if c.name.open {
            out.delete.push(c.path);
        } else {
            by_key.entry(c.name.key.clone()).or_default().push(c);
        }
    }
    for (key, mut files) in by_key {
        files.sort_by_key(|f| f.mtime);
        let newest = files.pop();
        out.delete.extend(files.into_iter().map(|f| f.path));
        match (newest, staging::read_sidecar(staged_dir, &key)) {
            (Some(f), Some(path)) => out.catch_up.push(CatchUp { path, file: f.path, rev16: f.name.rev16 }),
            (Some(f), None) => out.delete.push(f.path),
            _ => {}
        }
    }
    out
}

static LIVE: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Marks a vault id as having a live worker in this process (state sweeps leave it alone).
pub(crate) struct LiveGuard(String);
impl LiveGuard {
    pub(crate) fn new(id: &str) -> LiveGuard {
        LIVE.lock().unwrap_or_else(|p| p.into_inner()).push(id.to_string());
        LiveGuard(id.to_string())
    }
}
impl Drop for LiveGuard {
    fn drop(&mut self) {
        let mut l = LIVE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(i) = l.iter().position(|x| *x == self.0) {
            l.swap_remove(i);
        }
    }
}

pub(crate) fn sweep_old_state(state_hist: &Path, keep: &str, now_ms: u64) {
    let Ok(rd) = std::fs::read_dir(state_hist) else { return };
    for e in rd.flatten() {
        let Ok(n) = e.file_name().into_string() else { continue };
        if n == keep || n.len() != 16 || !n.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        if LIVE.lock().unwrap_or_else(|p| p.into_inner()).contains(&n) {
            continue;
        }
        let touched = std::fs::metadata(e.path().join("last-opened")).or_else(|_| e.metadata()).ok().and_then(|m| m.modified().ok()).map_or(now_ms, crate::now_ms);
        if now_ms.saturating_sub(touched) > STATE_SWEEP_MS {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn flush_events(vh: &VaultHistory, force: bool) {
    let (change, status) = {
        let mut n = super::lock(&vh.notifier);
        if !force && n.due.is_none_or(|d| d > Instant::now()) {
            return;
        }
        n.due = None;
        let status = std::mem::take(&mut n.status_dirty);
        let change = std::mem::take(&mut n.change);
        let ev = ChangeEvent { handle: vh.handle.clone(), paths: std::mem::take(&mut n.paths).into_iter().collect(), lineages: std::mem::take(&mut n.lineages).into_iter().collect() };
        (change.then_some(ev), status)
    };
    if let Some(c) = change {
        (vh.emit)(HistoryEvent::Change(c));
    }
    if status {
        (vh.emit)(HistoryEvent::Status(vh.status()));
    }
}

fn save_index_if_due(vh: &VaultHistory, force: bool) {
    let due = {
        let n = super::lock(&vh.notifier);
        n.index_dirty_since.is_some_and(|t| force || t.elapsed() >= super::INDEX_SAVE_DELAY)
    };
    if due {
        super::lock(&vh.notifier).index_dirty_since = None;
        let _ = index::save(&vh.vault_state.join("index.bin"), &vh.read_index());
    }
}

/// Runs `f` with a GC context (refused while history is unconfigured or off).
fn with_gc<T>(vh: &VaultHistory, core: &Core<writer::RealBackend>, clock: &Arc<dyn Clock>, f: impl FnOnce(&super::gc::Ctx) -> Result<T>) -> Result<T> {
    let Some(settings) = core.settings().filter(|s| s.enabled) else {
        return Err(err("HISTORY_OFF", "File history is turned off"));
    };
    let ctx = super::gc::Ctx { vh, dev: &core.b.writer.dev, now_ms: clock.now_ms(), settings };
    f(&ctx)
}


/// Background work of the worker thread, run in ≤ 5 ms chunks whenever the urgent queue is empty:
/// index reconcile, orphan check, relink, GC sweep. With nothing pending the loop blocks (idle CPU 0).
#[derive(Default)]
struct Bg {
    units: Vec<index::Unit>,
    orphan: Option<super::lineage::OrphanRun>,
    relink: Option<super::lineage::RelinkRun>,
    sweep: Option<super::gc::Sweep>,
    want_orphan: bool,
    want_sweep: bool,
    started: bool,
    /// Next daily orphan check + GC sweep (wall clock ms).
    daily_due: Option<u64>,
    /// Earliest start of the next relink walk (wall clock ms): outside changes coalesce into one walk per gap.
    relink_ok_at: u64,
}

const DAY_MS: u64 = 24 * 3600 * 1000;
/// Minimum gap between relink walks (each walks and hashes the whole vault).
const RELINK_GAP_MS: u64 = 30_000;

impl Bg {
    /// Time until a debounced relink may start (so it still runs when nothing else wakes the worker).
    fn relink_due(&self, core: &Core<writer::RealBackend>, now: u64) -> Option<Duration> {
        (core.on() && core.want_relink && self.relink_ok_at > now).then(|| Duration::from_millis(self.relink_ok_at - now))
    }

    fn pending(&self) -> bool {
        !self.units.is_empty() || self.orphan.is_some() || self.relink.is_some() || self.sweep.is_some()
    }

    /// Queues the open-time and daily jobs, and starts wanted ones once the reconcile is done.
    fn schedule(&mut self, vh: &VaultHistory, core: &mut Core<writer::RealBackend>, clock: &Arc<dyn Clock>, now: u64) {
        if !core.on() {
            self.orphan = None;
            self.relink = None;
            self.sweep = None;
            self.want_orphan = false;
            self.want_sweep = false;
            core.want_relink = false;
            return;
        }
        if !self.started || self.daily_due.is_some_and(|d| now >= d) {
            self.started = true;
            self.want_orphan = true;
            self.want_sweep = true;
            self.daily_due = Some(now + DAY_MS);
        }
        if !self.units.is_empty() {
            return;
        }
        if self.want_orphan && self.orphan.is_none() {
            self.want_orphan = false;
            self.orphan = Some(super::lineage::OrphanRun::new(vh));
        }
        if core.want_relink && self.orphan.is_none() && self.relink.is_none() && now >= self.relink_ok_at {
            core.want_relink = false;
            self.relink_ok_at = now + RELINK_GAP_MS;
            self.relink = super::lineage::RelinkRun::new(vh, core);
        }
        if self.want_sweep && self.sweep.is_none() {
            self.want_sweep = false;
            self.sweep = with_gc(vh, core, clock, |ctx| Ok(super::gc::Sweep::new(ctx))).ok();
        }
    }

    /// One ≤ 5 ms chunk of the first pending job.
    fn step(&mut self, vh: &VaultHistory, core: &mut Core<writer::RealBackend>, clock: &Arc<dyn Clock>) {
        if !self.units.is_empty() {
            if index::reconcile_chunk(&vh.store, &vh.index, &mut self.units, CHUNK, clock.now_ms()) {
                super::lineage::apply_hidden(vh);
                super::lock(&vh.notifier).changed("", "");
            }
        } else if let Some(o) = self.orphan.as_mut() {
            if o.step(vh, core, clock.now_ms(), CHUNK) {
                self.orphan = None;
                core.want_relink |= super::lineage::has_orphans(vh);
            }
        } else if let Some(r) = self.relink.as_mut() {
            if r.step(vh, core, CHUNK) {
                self.relink = None;
            }
        } else if let Some(sw) = self.sweep.as_mut() {
            // Only reached with the urgent queue empty (`Inbox::pop` serves urgent messages first).
            if with_gc(vh, core, clock, |ctx| Ok(sw.step(ctx, CHUNK))).unwrap_or(true) {
                self.sweep = None;
            }
        }
    }
}

/// Retention for every lineage that got a version since the last pass (`gc::after_write`).
fn drain_gc(vh: &VaultHistory, core: &mut Core<writer::RealBackend>, clock: &Arc<dyn Clock>) {
    for lin in core.b.writer.take_written() {
        let _ = with_gc(vh, core, clock, |ctx| {
            super::gc::after_write(ctx, &lin);
            Ok(())
        });
    }
}

/// The worker thread of one writable vault.
pub(crate) fn run(vh: Arc<VaultHistory>, survivors: Survivors, clock: Arc<dyn Clock>, free_probe: Option<Arc<dyn Fn() -> bool + Send + Sync>>) {
    crate::search::lower_priority();
    for f in &survivors.delete {
        staging::remove_clone(f);
    }
    vh.ensure_loaded();
    let now = clock.now_ms();
    index::scan_all(&vh.store, &vh.index, now);
    let _ = std::fs::write(vh.vault_state.join("last-opened"), now.to_string());
    sweep_old_state(&vh.state_hist, &vh.vault_id, now);
    let _ = std::fs::create_dir_all(&vh.state_hist);
    let dev = match super::names::load_or_create_device(&vh.state_hist) {
        Ok(d) => d,
        Err(e) => {
            *super::lock(&vh.last_error) = Some(super::LastError { code: "IO_ERROR".into(), message: format!("History device id unavailable: {e}") });
            vh.flags.active.store(false, Ordering::Relaxed);
            return;
        }
    };
    store::cleanup_own_tmp(&vh.store, &dev, store::TMP_MAX_AGE);
    let ulid = super::names::UlidGen::load(Some(&vh.state_hist));
    let epoch = writer::Epoch::load(Some(vh.vault_state.join("writer")), now);
    let root = vh.store.root.clone();
    let free_ok: Box<dyn Fn() -> bool + Send> = match free_probe {
        Some(p) => Box::new(move || p()),
        None => Box::new(move || store::free_space_ok(&root)),
    };
    let (gen, my_gen) = (vh.gen.clone(), vh.my_gen);
    let is_current: Box<dyn Fn() -> bool + Send> = Box::new(move || gen.load(Ordering::SeqCst) == my_gen);
    let w = writer::Writer::new(vh.store.clone(), vh.index.clone(), dev, ulid, epoch, clock.clone(), free_ok, is_current);
    let (n1, n2, vh2) = (vh.notifier.clone(), vh.notifier.clone(), vh.clone());
    let backend = writer::RealBackend {
        writer: w,
        flags: vh.flags.clone(),
        staged_dir: vh.staged_dir.clone(),
        on_change: Box::new(move |p, l| super::lock(&n1).changed(p, l)),
        on_error: Box::new(move |e| {
            *super::lock(&vh2.last_error) = e.map(|(c, m)| super::LastError { code: c.into(), message: m.into() });
            super::lock(&n2).status_changed();
        }),
        writing: vh.writing.clone(),
    };
    let mut core = Core::new(backend, clock.clone());
    super::lineage::load(&vh);
    let mut survivors = Some(survivors.catch_up);
    let mut bg = Bg::default();
    let mut touched = now;
    loop {
        core.tick();
        drain_gc(&vh, &mut core, &clock);
        // `last-opened` stays fresh while the vault is open (no timer: only when the worker runs anyway).
        let t = clock.now_ms();
        if t.saturating_sub(touched) >= 24 * 3600 * 1000 {
            touched = t;
            let _ = std::fs::write(vh.vault_state.join("last-opened"), t.to_string());
        }
        flush_events(&vh, false);
        save_index_if_due(&vh, false);
        super::lineage::save_if_dirty(&vh);
        let now = clock.now_ms();
        bg.schedule(&vh, &mut core, &clock, now);
        let timer = core.next_deadline().map(|d| Duration::from_millis(d.saturating_sub(now)));
        let daily = bg.daily_due.filter(|_| core.on()).map(|d| Duration::from_millis(d.saturating_sub(now)));
        let relink = bg.relink_due(&core, now);
        vh.bg_busy.store(bg.pending(), Ordering::Relaxed);
        let wait = [timer, super::lock(&vh.notifier).wait(), daily, relink].into_iter().flatten().min();
        match vh.inbox.pop(wait, bg.pending()) {
            Popped::Stop => break,
            Popped::Msg(Msg::Stop) => break,
            Popped::Msg(Msg::DeleteCheckpoint { id, ack }) => {
                let _ = ack.send(with_gc(&vh, &core, &clock, |ctx| super::gc::delete_checkpoint(ctx, &id)));
            }
            Popped::Msg(Msg::DeleteAll { path, ack }) => {
                let _ = ack.send(with_gc(&vh, &core, &clock, |ctx| super::gc::delete_all(ctx, &path).map(|_| ())));
            }
            Popped::Msg(Msg::Moved { from, to }) => super::lineage::apply_moved(&vh, &mut core, &from, &to),
            Popped::Msg(Msg::Trashed { path }) => super::lineage::apply_trashed(&vh, &mut core, &path),
            Popped::Msg(Msg::Watched(paths)) => super::outside::apply_watched(&vh, &mut core, &paths),
            Popped::Msg(m) => {
                let configure = matches!(m, Msg::Configure(_));
                core.dispatch(m);
                if configure {
                    if let Some(items) = survivors.take() {
                        core.catch_up(items);
                    }
                }
            }
            Popped::Task(Task::Reconcile) => {
                bg.units = index::plan_units(&vh.store, &vh.index);
            }
            Popped::Task(Task::LoadHeaders(mut ids)) => {
                let t0 = Instant::now();
                let mut loaded = false;
                while let Some(id) = ids.pop() {
                    loaded |= index::ensure_head(&vh.store, &vh.index, &id);
                    if t0.elapsed() >= CHUNK {
                        break;
                    }
                }
                if !ids.is_empty() {
                    vh.inbox.send_task(Task::LoadHeaders(ids));
                }
                if loaded {
                    super::lock(&vh.notifier).changed("", "");
                }
            }
            Popped::Timeout => bg.step(&vh, &mut core, &clock),
        }
    }
    // Stop wins over versioning work, but a commit queued before it must stay recoverable.
    let fold = vh.flags.fold.load(Ordering::Relaxed);
    for p in vh.inbox.queued_commit_paths() {
        staging::write_sidecar(&vh.staged_dir, &staging::key_for(&p, fold), &p);
    }
    flush_events(&vh, true);
    save_index_if_due(&vh, true);
}
