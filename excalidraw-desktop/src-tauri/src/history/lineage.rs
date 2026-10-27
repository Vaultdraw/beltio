//! Lineage identity: path records on in-app moves, relink after outside renames (M9),
//! multi-lineage paths (M10), trash with a 7-day hidden window (N1), orphan tracking.
//!
//! Hooks (`moved`, `trashed`) run on command threads and only queue a worker message; every
//! bit of state below changes on the worker thread (the `lineages.json` file is written there).
//! Contract frozen at the H3 skeleton (PLAN-H3.md §3).
use super::{
    container, index, names,
    names::VersionName,
    store,
    worker::{rebase, Core, Msg},
    writer::{Backend, Outcome, RealBackend},
    VaultHistory,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::Path,
    time::{Duration, Instant},
};

const DAY_MS: u64 = 24 * 3600 * 1000;
/// A trashed drawing's history stays hidden (and re-attachable) this long (N1).
pub(super) const TRASH_MS: u64 = 7 * DAY_MS;
/// Orphaned (no path on disk) this long: automatic versions may go (M7).
pub(super) const ORPHAN_MS: u64 = 30 * DAY_MS;
const STATE_FILE: &str = "lineages.json";
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;
/// Distinct paths looked at per lineage (the current one plus the newest moves).
const MAX_PATHS: usize = 16;
/// Header reads spent re-matching a trashed lineage's revisions after one file appeared.
const MAX_HEAD_LOADS: usize = 400;
/// When a lineage's file size is unknown, at most this many unlinked files are hashed for it.
const UNKNOWN_SIZE_CANDIDATES: usize = 64;
const MAX_WALK_DEPTH: usize = 32;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Mark {
    path: String,
    at: u64,
}

/// Per-vault lineage state persisted in `<state>/history/<vault-id>/lineages.json` (trash marks,
/// orphan-since times). Lives in `VaultHistory::lineage`; written on the worker only.
#[derive(Default, Debug)]
pub(crate) struct State {
    /// lineage → where it was trashed from and when (local observation time).
    trash: BTreeMap<String, Mark>,
    /// lineage → first time every path of it was seen missing.
    orphan_since: BTreeMap<String, u64>,
    dirty: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Disk {
    #[serde(default)]
    trash: BTreeMap<String, Mark>,
    #[serde(default)]
    orphan_since: BTreeMap<String, u64>,
}

impl State {
    /// Tolerant load: an unreadable file is empty state, invalid entries are dropped.
    fn load(file: &Path) -> State {
        let disk = store::read_capped(file, MAX_STATE_BYTES).ok().and_then(|b| serde_json::from_slice::<Disk>(&b).ok()).unwrap_or_default();
        State {
            trash: disk.trash.into_iter().filter(|(l, m)| names::is_ulid(l) && container::is_sane_relative_path(&m.path)).collect(),
            orphan_since: disk.orphan_since.into_iter().filter(|(l, _)| names::is_ulid(l)).collect(),
            dirty: false,
        }
    }

    fn save(&mut self, file: &Path) {
        let disk = Disk { trash: self.trash.clone(), orphan_since: self.orphan_since.clone() };
        let Ok(bytes) = serde_json::to_vec(&disk) else { return };
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // A failed write keeps `dirty`, so the next pass retries.
        self.dirty = crate::write_atomic(file, &bytes).is_err();
    }

    fn set_orphan(&mut self, lineage: &str, since: u64) {
        if !self.orphan_since.contains_key(lineage) {
            self.orphan_since.insert(lineage.to_string(), since);
            self.dirty = true;
        }
    }

    fn clear_orphan(&mut self, lineage: &str) {
        self.dirty |= self.orphan_since.remove(lineage).is_some();
    }
}

fn state_file(vh: &VaultHistory) -> std::path::PathBuf {
    vh.vault_state.join(STATE_FILE)
}

/// Worker start (after the cold scan): loads `lineages.json` and hides the trashed lineages.
pub(super) fn load(vh: &VaultHistory) {
    *super::lock(&vh.lineage) = State::load(&state_file(vh));
    apply_hidden(vh);
}

/// Re-applies the trash marks to the index (idempotent; also after a reconcile brought lineages in).
pub(super) fn apply_hidden(vh: &VaultHistory) {
    let marked: Vec<String> = super::lock(&vh.lineage).trash.keys().cloned().collect();
    if marked.is_empty() {
        return;
    }
    let mut g = vh.index.write().unwrap_or_else(|p| p.into_inner());
    for l in marked {
        g.set_hidden(&l, true);
    }
}

/// Writes `lineages.json` when something changed (cheap check, called every loop pass).
pub(super) fn save_if_dirty(vh: &VaultHistory) {
    let mut s = super::lock(&vh.lineage);
    if s.dirty {
        s.save(&state_file(vh));
    }
}

pub(super) fn has_orphans(vh: &VaultHistory) -> bool {
    !super::lock(&vh.lineage).orphan_since.is_empty()
}

/// Hook (`move_entry`, `move_entry_with_links`): a file or folder moved inside the app.
pub(super) fn moved(vh: &VaultHistory, from: &str, to: &str) {
    if vh.has_worker && vh.flags.history_on() {
        vh.inbox.send(Msg::Moved { from: from.to_string(), to: to.to_string() });
    }
}

/// Hook (`trash_entry`): a file moved to the OS Trash from the app.
pub(super) fn trashed(vh: &VaultHistory, path: &str) {
    if vh.has_worker && vh.flags.history_on() {
        vh.inbox.send(Msg::Trashed { path: path.to_string() });
    }
}

/// What the GC sweep may delete because of lineage state.
#[derive(Default, Debug)]
pub(super) struct SweepInputs {
    /// Orphaned (no current path on disk, not trashed) for ≥ 30 days: automatic versions go.
    pub orphaned: Vec<String>,
    /// Trashed more than 7 days ago and not re-attached: everything goes.
    pub trash_expired: Vec<String>,
}

/// State only (no disk access): cheap enough to call at the start of every sweep.
pub(super) fn sweep_inputs(vh: &VaultHistory, now_ms: u64) -> SweepInputs {
    let s = super::lock(&vh.lineage);
    SweepInputs {
        orphaned: s.orphan_since.iter().filter(|(l, since)| now_ms.saturating_sub(**since) >= ORPHAN_MS && !s.trash.contains_key(*l)).map(|(l, _)| l.clone()).collect(),
        trash_expired: s.trash.iter().filter(|(_, m)| now_ms.saturating_sub(m.at) >= TRASH_MS).map(|(l, _)| l.clone()).collect(),
    }
}

/// GC removed these lineages completely: drop their state.
pub(super) fn forget(vh: &VaultHistory, lineages: &[String]) {
    {
        let mut s = super::lock(&vh.lineage);
        for l in lineages {
            s.dirty |= s.trash.remove(l).is_some();
            s.clear_orphan(l);
        }
    }
    let mut g = vh.index.write().unwrap_or_else(|p| p.into_inner());
    for l in lineages {
        g.set_hidden(l, false);
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// A regular file exists at `rel` (a symlink counts as missing, like everywhere in the vault).
fn is_file(vh: &VaultHistory, rel: &str) -> bool {
    std::fs::symlink_metadata(vh.root.join(rel)).is_ok_and(|m| m.is_file())
}

pub(super) fn sha_of_file(vh: &VaultHistory, rel: &str) -> Option<String> {
    let abs = crate::safe_path(&vh.root, rel, false).ok()?;
    let bytes = store::read_capped(&abs, crate::MAX_DRAWING_BYTES).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

/// Distinct paths of `lineage` known from loaded headers (current first, at most `MAX_PATHS`),
/// plus the ids of path records whose header isn't loaded yet.
fn lineage_paths(vh: &VaultHistory, lineage: &str) -> (Vec<String>, Vec<String>) {
    let g = vh.read_index();
    let Some(l) = g.lineages.get(lineage) else { return (Vec::new(), Vec::new()) };
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut paths: Vec<String> = Vec::new();
    for p in l.path.iter().map(String::as_str).chain(l.versions.values().rev().filter_map(|e| e.head.as_ref()).map(|h| h.path.as_str())) {
        if paths.len() < MAX_PATHS && seen.insert(p) {
            paths.push(p.to_string());
        }
    }
    let unloaded = l.versions.values().filter(|e| e.is_path_record() && e.head.is_none()).map(|e| e.name.id.clone()).collect();
    (paths, unloaded)
}

/// Does any version of `lineage` have file revision `sha`? Loaded headers first; only when none
/// matches are the missing headers read (bounded). `sha` is 64 hex, so the empty revision of a
/// path record can never match.
fn has_revision(vh: &VaultHistory, lineage: &str, sha: &str) -> bool {
    let (hit, unloaded) = {
        let g = vh.read_index();
        let Some(l) = g.lineages.get(lineage) else { return false };
        let hit = l.versions.values().any(|e| e.head.as_ref().is_some_and(|h| h.rev == sha));
        let unloaded: Vec<String> = if hit { Vec::new() } else { l.versions.values().rev().filter(|e| e.head.is_none() && !e.is_path_record()).take(MAX_HEAD_LOADS).map(|e| e.name.id.clone()).collect() };
        (hit, unloaded)
    };
    if hit {
        return true;
    }
    for id in unloaded {
        index::ensure_head(&vh.store, &vh.index, &id);
    }
    let g = vh.read_index();
    g.lineages.get(lineage).is_some_and(|l| l.versions.values().any(|e| e.head.as_ref().is_some_and(|h| h.rev == sha)))
}

/// Newest real version of `lineage`: (revision, file size when its header records one).
fn newest_revision(vh: &VaultHistory, lineage: &str) -> Option<(String, Option<u64>)> {
    let (id, name): (String, VersionName) = {
        let g = vh.read_index();
        let l = g.lineages.get(lineage)?;
        let e = l.versions.values().rev().find(|e| !e.is_path_record())?;
        (e.name.id.clone(), e.name.clone())
    };
    index::ensure_head(&vh.store, &vh.index, &id);
    let rev = vh.read_index().entry(&id)?.1.head.as_ref()?.rev.clone();
    let size = vh.store.read_prefix(lineage, &name).ok().and_then(|p| container::read_header(&p).ok()).map(|h| h.file_size).filter(|s| *s > 0);
    (rev.len() == 64).then_some((rev, size))
}

fn unhide(vh: &VaultHistory, core: &mut Core<RealBackend>, lineage: &str, path: &str) {
    {
        let mut s = super::lock(&vh.lineage);
        s.dirty |= s.trash.remove(lineage).is_some();
    }
    vh.index.write().unwrap_or_else(|p| p.into_inner()).set_hidden(lineage, false);
    core.b.changed(path, lineage);
}

/// A file appeared at `path` (watcher, startup): hidden lineages trashed from here within 7 days
/// come back when its bytes are the revision of any of their versions (macOS "Put Back").
pub(super) fn reattach_at(vh: &VaultHistory, core: &mut Core<RealBackend>, path: &str, now: u64) {
    let cands: Vec<String> = {
        let g = vh.read_index();
        let s = super::lock(&vh.lineage);
        g.all_lineages_for(path).into_iter().filter(|l| g.hidden.contains(*l) && s.trash.get(*l).is_some_and(|m| now.saturating_sub(m.at) <= TRASH_MS)).map(str::to_string).collect()
    };
    if cands.is_empty() {
        return;
    }
    let Some(sha) = sha_of_file(vh, path) else { return };
    for l in cands {
        if has_revision(vh, &l, &sha) {
            unhide(vh, core, &l, path);
        }
    }
}

/// The watcher saw `path` (a visible lineage's path) change on disk: re-judge those lineages.
pub(super) fn recheck_path(vh: &VaultHistory, core: &mut Core<RealBackend>, path: &str, now: u64) {
    let lins: Vec<String> = vh.read_index().lineages_for(path).into_iter().map(str::to_string).collect();
    for l in lins {
        check_lineage(vh, core, &l, now);
    }
}

/// One lineage against the disk: hidden → re-attach check; visible → orphan or not.
fn check_lineage(vh: &VaultHistory, core: &mut Core<RealBackend>, lineage: &str, now: u64) {
    let mark = super::lock(&vh.lineage).trash.get(lineage).cloned();
    if let Some(mark) = mark {
        if now.saturating_sub(mark.at) <= TRASH_MS && is_file(vh, &mark.path) {
            reattach_at(vh, core, &mark.path, now);
        }
        return;
    }
    let (mut paths, unloaded) = lineage_paths(vh, lineage);
    if !unloaded.is_empty() {
        // Path records from another Mac carry the newest path: read them before judging.
        let mut any = false;
        for id in &unloaded {
            any |= index::ensure_head(&vh.store, &vh.index, id);
        }
        if any {
            paths = lineage_paths(vh, lineage).0;
        }
    }
    if paths.is_empty() {
        return;
    }
    let present = paths.iter().any(|p| is_file(vh, p));
    let mut s = super::lock(&vh.lineage);
    if present {
        s.clear_orphan(lineage);
    } else {
        s.set_orphan(lineage, now);
        core.want_relink = true;
    }
}

// ---------------------------------------------------------------------------------------------
// In-app move and trash (worker side)
// ---------------------------------------------------------------------------------------------

/// A path record per lineage at `from` (or under it, for a folder), then the core's tracks,
/// clones and sidecars follow. Records first: a crash in between leaves a lineage that already
/// lives at the new path (the sidecar is repointed before the clone is renamed, see staging).
pub(super) fn apply_moved(vh: &VaultHistory, core: &mut Core<RealBackend>, from: &str, to: &str) {
    if !core.on() {
        return;
    }
    let fold = vh.flags.fold.load(std::sync::atomic::Ordering::Relaxed);
    let targets: Vec<(String, String)> = {
        let g = vh.read_index();
        g.lineages.iter().filter(|(l, _)| !g.hidden.contains(*l)).filter_map(|(l, lin)| Some((l.clone(), rebase(lin.path.as_deref()?, from, to, fold)?))).filter(|(_, np)| container::is_sane_relative_path(np)).collect()
    };
    for (lineage, new_path) in targets {
        match core.b.writer.write_path_record(&lineage, &new_path) {
            Ok(Outcome::Written(_)) => {
                super::lock(&vh.lineage).clear_orphan(&lineage);
                core.b.changed(&new_path, &lineage);
            }
            Ok(Outcome::DiskLow) => break,
            Ok(Outcome::Skipped(_)) => {}
            Err(e) => core.b.error(&e.code, &e.message),
        }
    }
    core.on_moved(from, to, fold);
}

/// The drawing went to the OS Trash: its unversioned state is versioned first (the clone
/// survives the file), then every lineage of the path is hidden for 7 days.
pub(super) fn apply_trashed(vh: &VaultHistory, core: &mut Core<RealBackend>, path: &str) {
    if !core.on() {
        return;
    }
    // On failure (disk low, a newer worker) the track and its clone stay for the retry timer.
    if !core.is_dirty(path) || core.version_pending(path, names::Reason::Leave) {
        core.drop_track(path);
    }
    hide(vh, core, path);
}

fn hide(vh: &VaultHistory, core: &mut Core<RealBackend>, path: &str) {
    let lins: Vec<String> = vh.read_index().lineages_for(path).into_iter().map(str::to_string).collect();
    if lins.is_empty() {
        return;
    }
    let now = core.clock_ms();
    {
        let mut s = super::lock(&vh.lineage);
        for l in &lins {
            s.trash.insert(l.clone(), Mark { path: path.to_string(), at: now });
            s.clear_orphan(l);
            s.dirty = true;
        }
    }
    let mut g = vh.index.write().unwrap_or_else(|p| p.into_inner());
    for l in &lins {
        g.set_hidden(l, true);
    }
    drop(g);
    core.b.changed(path, "");
}

// ---------------------------------------------------------------------------------------------
// Orphan check (chunked)
// ---------------------------------------------------------------------------------------------

/// Stats every lineage's paths in ≤ 5 ms chunks (open after catch-up, then daily).
pub(super) struct OrphanRun {
    todo: Vec<String>,
}

impl OrphanRun {
    pub(super) fn new(vh: &VaultHistory) -> OrphanRun {
        let todo: Vec<String> = vh.read_index().lineages.keys().cloned().collect();
        // Marks of lineages that no longer exist (deleted by another Mac or by GC) are stale.
        let mut s = super::lock(&vh.lineage);
        let g = vh.read_index();
        let stale: Vec<String> = s.orphan_since.keys().filter(|l| !g.lineages.contains_key(*l)).cloned().collect();
        for l in stale {
            s.clear_orphan(&l);
        }
        OrphanRun { todo }
    }

    /// Returns true when every lineage was checked.
    pub(super) fn step(&mut self, vh: &VaultHistory, core: &mut Core<RealBackend>, now: u64, budget: Duration) -> bool {
        let t0 = Instant::now();
        while let Some(l) = self.todo.pop() {
            check_lineage(vh, core, &l, now);
            if t0.elapsed() >= budget {
                break;
            }
        }
        self.todo.is_empty()
    }
}

// ---------------------------------------------------------------------------------------------
// Relink (M9)
// ---------------------------------------------------------------------------------------------

struct Want {
    lineage: String,
    old_path: Option<String>,
    rev: String,
    size: Option<u64>,
}

/// Matches orphaned lineages to unlinked files by content: a vault walk (chunked, sizes only),
/// hashes of same-size candidates, and a path record when exactly one file fits exactly one
/// lineage. Anything ambiguous is left alone (a Finder copy, identical blank drawings).
pub(super) struct RelinkRun {
    wants: Vec<Want>,
    stack: Vec<(String, usize)>,
    queue: Vec<(String, u64)>,
    hashes: Vec<(String, String)>,
    unknown_hashed: usize,
    walked: bool,
}

impl RelinkRun {
    /// `None` when there is nothing to relink (no orphan, or none whose paths are all missing).
    pub(super) fn new(vh: &VaultHistory, _core: &mut Core<RealBackend>) -> Option<RelinkRun> {
        let orphans: Vec<String> = super::lock(&vh.lineage).orphan_since.keys().cloned().collect();
        let mut wants = Vec::new();
        for lineage in orphans {
            if vh.read_index().hidden.contains(&lineage) {
                continue;
            }
            let (paths, _) = lineage_paths(vh, &lineage);
            if paths.is_empty() || paths.iter().any(|p| is_file(vh, p)) {
                continue;
            }
            let Some((rev, size)) = newest_revision(vh, &lineage) else { continue };
            let old_path = vh.read_index().lineages.get(&lineage).and_then(|l| l.path.clone());
            wants.push(Want { lineage, old_path, rev, size });
        }
        (!wants.is_empty()).then(|| RelinkRun { wants, stack: vec![(String::new(), 0)], queue: Vec::new(), hashes: Vec::new(), unknown_hashed: 0, walked: false })
    }

    /// Returns true when the pass is over.
    pub(super) fn step(&mut self, vh: &VaultHistory, core: &mut Core<RealBackend>, budget: Duration) -> bool {
        let t0 = Instant::now();
        while !self.walked && t0.elapsed() < budget {
            match self.stack.pop() {
                Some((dir, depth)) => self.walk_dir(vh, &dir, depth),
                None => self.walked = true,
            }
        }
        if !self.walked {
            return false;
        }
        // One hash per chunk (a 30 MB drawing takes a few ms).
        if let Some((path, _)) = self.queue.pop() {
            if let Some(sha) = sha_of_file(vh, &path) {
                self.hashes.push((path, sha));
            }
            return false;
        }
        self.resolve(vh, core);
        true
    }

    fn walk_dir(&mut self, vh: &VaultHistory, dir: &str, depth: usize) {
        let Ok(rd) = std::fs::read_dir(vh.root.join(dir)) else { return };
        for e in rd.flatten() {
            let (Ok(name), Ok(ft)) = (e.file_name().into_string(), e.file_type()) else { continue };
            if ft.is_symlink() || name.starts_with(".excalidraw-tmp-") || (dir.is_empty() && name.eq_ignore_ascii_case(crate::META_DIR)) || vaultdraw_core::filekind::is_hidden_name(&name) {
                continue;
            }
            let child = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
            if ft.is_dir() {
                if depth < MAX_WALK_DEPTH {
                    self.stack.push((child, depth + 1));
                }
            } else if ft.is_file() && vaultdraw_core::filekind::is_drawing_name(&name) && !vh.read_index().has_lineage(&child) {
                let Ok(md) = e.metadata() else { continue };
                if self.wants_size(md.len()) {
                    self.queue.push((child, md.len()));
                }
            }
        }
    }

    /// Size filter: a candidate is hashed only when some lineage's newest file has that size
    /// (lineages without a recorded size accept a bounded number of candidates).
    fn wants_size(&mut self, size: u64) -> bool {
        if self.wants.iter().any(|w| w.size == Some(size)) {
            return true;
        }
        if self.wants.iter().any(|w| w.size.is_none()) && self.unknown_hashed < UNKNOWN_SIZE_CANDIDATES {
            self.unknown_hashed += 1;
            return true;
        }
        false
    }

    fn resolve(&mut self, vh: &VaultHistory, core: &mut Core<RealBackend>) {
        let fold = vh.flags.fold.load(std::sync::atomic::Ordering::Relaxed);
        let mut claims: HashMap<&str, usize> = HashMap::new();
        for w in &self.wants {
            *claims.entry(w.rev.as_str()).or_default() += 1;
        }
        let mut links: Vec<(usize, String)> = Vec::new();
        for (i, w) in self.wants.iter().enumerate() {
            let files: Vec<&String> = self.hashes.iter().filter(|(_, sha)| *sha == w.rev).map(|(p, _)| p).collect();
            if let ([file], Some(1)) = (files.as_slice(), claims.get(w.rev.as_str())) {
                if container::is_sane_relative_path(file) {
                    links.push((i, (*file).clone()));
                }
            }
        }
        for (i, new_path) in links {
            let w = &self.wants[i];
            // Re-check right before writing: the vault may have changed during the walk.
            if vh.read_index().has_lineage(&new_path) || !is_file(vh, &new_path) || w.old_path.as_deref().is_some_and(|p| is_file(vh, p)) {
                continue;
            }
            match core.b.writer.write_path_record(&w.lineage, &new_path) {
                Ok(Outcome::Written(_)) => {
                    super::lock(&vh.lineage).clear_orphan(&w.lineage);
                    if let Some(old) = &w.old_path {
                        core.on_moved(old, &new_path, fold);
                    }
                    core.b.changed(&new_path, &w.lineage);
                }
                Ok(Outcome::DiskLow) => return,
                Ok(Outcome::Skipped(_)) => {}
                Err(e) => core.b.error(&e.code, &e.message),
            }
        }
    }
}
