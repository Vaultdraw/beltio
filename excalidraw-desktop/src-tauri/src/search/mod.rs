//! Vault-wide search of drawing names and the text inside drawings (F1).
//!
//! In-memory index of normalised text per drawing, scanned linearly with
//! `memchr::memmem`; built and kept current by a background worker per open vault.

mod worker;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod bench;

// The pure index, extractor, normaliser and snapshot store live in `vaultdraw-core`.
pub(crate) use vaultdraw_core::search::{index, store, types};
// Public API for other features (tags, quick switcher); unused until they land.
#[allow(unused_imports)]
pub(crate) use vaultdraw_core::search::{extract_items, ElementLink, ItemKind, TextItem};
pub(crate) use vaultdraw_core::search::{DocEntry, Index};
pub(crate) use vaultdraw_core::search::{find_tags, key_under, tag_key};
// Shared with file history (one vault-id derivation, one walker, one QoS helper).
pub(crate) use vaultdraw_core::search::vault_id;
#[allow(unused_imports)] // `walk` is used by file-history relink (H3)
pub(crate) use vaultdraw_core::search::{is_drawing_name, walk};
pub(crate) use worker::lower_priority;
#[allow(unused_imports)]
pub(crate) use vaultdraw_core::search::{normalize, NORMALIZER_VERSION};
#[allow(unused_imports)]
pub(crate) use vaultdraw_core::search::{ElementMatch, IndexState, IndexStatus, NamesListing, Scope, SearchHit, SearchResponse, TagsResponse};

use crate::{err, Result};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::AtomicBool, mpsc, Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard},
    time::Instant,
};
use tauri::{AppHandle, Emitter as _, State};


/// Receives every status change (and throttled progress while building).
pub(crate) type Emitter = Arc<dyn Fn(IndexStatus) + Send + Sync>;

pub(crate) enum Update {
    /// Vault-relative paths reported by the file watcher (files or folders, possibly gone).
    Paths(Vec<String>),
    Rescan,
    Shutdown,
}

pub(crate) struct VaultIndex {
    index: RwLock<Index>,
    state: Mutex<IndexState>,
    tx: mpsc::Sender<Update>,
    stop: AtomicBool,
}

impl VaultIndex {
    pub(crate) fn read(&self) -> RwLockReadGuard<'_, Index> {
        self.index.read().unwrap_or_else(|p| p.into_inner())
    }
    pub(crate) fn write(&self) -> RwLockWriteGuard<'_, Index> {
        self.index.write().unwrap_or_else(|p| p.into_inner())
    }
    pub(crate) fn is_ready(&self) -> bool {
        *self.state.lock().unwrap_or_else(|p| p.into_inner()) == IndexState::Ready
    }
    /// Builds the link index on first call (under a read lock, so queries keep running and
    /// only indexer writes wait), then it is maintained by `Index::upsert/remove`.
    pub(crate) fn ensure_links(&self) {
        loop {
            if self.read().links().is_some() {
                return;
            }
            let (built, generation) = {
                let g = self.read();
                (g.build_links(), g.generation())
            };
            let mut w = self.write();
            if w.links().is_some() {
                return;
            }
            if w.generation() == generation {
                w.install_links(built);
                return;
            }
        }
    }
    fn set_state(&self, state: IndexState) {
        *self.state.lock().unwrap_or_else(|p| p.into_inner()) = state;
    }
    fn status(&self, handle: &str) -> IndexStatus {
        let guard = self.read();
        self.status_of(handle, &guard)
    }
    fn status_of(&self, handle: &str, index: &Index) -> IndexStatus {
        let state = *self.state.lock().unwrap_or_else(|p| p.into_inner());
        let (indexed, total) = index.counts();
        IndexStatus { handle: handle.to_string(), state, indexed: indexed as u32, total: total as u32 }
    }
}

/// What a pending vault needs to start: root, emitter, snapshot path.
type Pending = (PathBuf, Emitter, Option<PathBuf>);

#[derive(Default)]
pub(crate) struct SearchService {
    vaults: Mutex<HashMap<String, Arc<VaultIndex>>>,
    /// Opened vaults whose indexer has not started yet (`search.start` = idle or use).
    /// Watcher batches for them are dropped: a start walks the vault against the snapshot
    /// (size + mtime), so it sees every change made while pending.
    pending: Mutex<HashMap<String, Pending>>,
}

/// Emits `search-index-status` to the webview.
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn tauri_emitter(app: &AppHandle) -> Emitter {
    let app = app.clone();
    Arc::new(move |status| {
        let _ = app.emit("search-index-status", status);
    })
}

impl SearchService {
    /// The vault's index, starting a pending indexer first (lazy start on first use).
    pub(crate) fn vault(&self, handle: &str) -> Result<Arc<VaultIndex>> {
        self.ensure(handle);
        self.started(handle).ok_or_else(|| err("NOT_FOUND", "Unknown vault"))
    }

    /// The vault's index only if its indexer is running (never starts one).
    fn started(&self, handle: &str) -> Option<Arc<VaultIndex>> {
        self.vaults.lock().ok()?.get(handle).cloned()
    }

    /// Records an opened vault without starting its indexer (`open_vault`).
    #[cfg_attr(test, allow(dead_code))]
    pub(crate) fn register(&self, handle: &str, root: PathBuf, emit: Emitter) {
        let snapshot = crate::config::resolve_dirs().ok().map(|d| store::snapshot_path(&d.state, &root));
        self.register_with(handle, root, emit, snapshot);
    }

    pub(crate) fn register_with(&self, handle: &str, root: PathBuf, emit: Emitter, snapshot: Option<PathBuf>) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(handle.to_string(), (root, emit, snapshot));
        }
    }

    /// Starts a registered vault's indexer if it is still pending; a no-op otherwise.
    pub(crate) fn ensure(&self, handle: &str) {
        // Held across the start so a concurrent caller waits for it instead of missing the vault.
        let Ok(mut pending) = self.pending.lock() else { return };
        if let Some((root, emit, snapshot)) = pending.remove(handle) {
            self.start_with(handle, root, emit, snapshot);
        }
    }

    /// Registered but not started.
    pub(crate) fn is_pending(&self, handle: &str) -> bool {
        self.pending.lock().map(|p| p.contains_key(handle)).unwrap_or(false)
    }

    /// Starts indexing `root` (canonical vault path) with the snapshot in the machine state dir.
    #[cfg_attr(test, allow(dead_code))]
    pub(crate) fn start(&self, handle: &str, root: PathBuf, emit: Emitter) {
        let snapshot = crate::config::resolve_dirs().ok().map(|d| store::snapshot_path(&d.state, &root));
        self.start_with(handle, root, emit, snapshot);
    }

    pub(crate) fn start_with(&self, handle: &str, root: PathBuf, emit: Emitter, snapshot: Option<PathBuf>) {
        self.start_deferring(handle, root, emit, snapshot, worker::Defer::DEFAULT);
    }

    fn start_deferring(&self, handle: &str, root: PathBuf, emit: Emitter, snapshot: Option<PathBuf>, defer: worker::Defer) {
        let (tx, rx) = mpsc::channel();
        let shared = Arc::new(VaultIndex { index: RwLock::new(Index::default()), state: Mutex::new(IndexState::Loading), tx, stop: AtomicBool::new(false) });
        let worker = worker::Worker { handle: handle.to_string(), root, shared: shared.clone(), rx, emit, snapshot, last_emit: Instant::now(), dirty_since: None, defer, deferred: Default::default() };
        if let Err(e) = std::thread::Builder::new().name("vaultdraw-search".into()).spawn(move || worker.run()) {
            eprintln!("vaultdraw: search indexer not started: {e}");
            return;
        }
        if let Ok(mut vaults) = self.vaults.lock() {
            if let Some(old) = vaults.insert(handle.to_string(), shared) {
                Self::shut_down(&old);
            }
        }
    }

    fn shut_down(v: &VaultIndex) {
        v.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = v.tx.send(Update::Shutdown);
    }

    /// Forwards watcher results; `paths` are vault-relative, `rescan` forces a full resync.
    pub(crate) fn notify(&self, handle: &str, paths: &[String], rescan: bool) {
        let Some(v) = self.started(handle) else { return };
        if rescan {
            let _ = v.tx.send(Update::Rescan);
        }
        if !paths.is_empty() {
            let _ = v.tx.send(Update::Paths(paths.to_vec()));
        }
    }

    /// Parses `bytes` (just written to `path`) and puts the result in the live indexes.
    pub(crate) fn upsert_bytes(&self, handle: &str, path: &str, stat: (u64, u64), bytes: &[u8]) {
        if let Some(v) = self.started(handle) {
            let entry = vaultdraw_core::search::scan::entry_from_bytes(path, stat, bytes);
            v.write().upsert(path.to_string(), entry);
        }
    }

    /// Test helper: lets a second service object see the same vault index.
    #[cfg(test)]
    pub(crate) fn adopt(&self, other: &SearchService, handle: &str) {
        if let Ok(v) = other.vault(handle) {
            self.vaults.lock().unwrap().insert(handle.to_string(), v);
        }
    }

    pub(crate) fn stop(&self, handle: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(handle);
        }
        if let Some(v) = self.vaults.lock().ok().and_then(|mut m| m.remove(handle)) {
            Self::shut_down(&v);
        }
    }

    #[allow(dead_code)] // API for the tags feature
    /// Runs `f` over the live index (e.g. tag extraction via `Index::for_each_item`).
    pub(crate) fn with_index<T>(&self, handle: &str, f: impl FnOnce(&Index) -> T) -> Option<T> {
        let v = self.vault(handle).ok()?;
        let index = v.read();
        Some(f(&index))
    }

    /// Never starts the indexer: a pending vault reports `loading` with nothing indexed.
    pub(crate) fn status(&self, handle: &str) -> Result<IndexStatus> {
        if self.is_pending(handle) {
            return Ok(IndexStatus { handle: handle.to_string(), state: IndexState::Loading, indexed: 0, total: 0 });
        }
        Ok(self.vault(handle)?.status(handle))
    }

    pub(crate) fn tags(&self, handle: &str) -> Result<TagsResponse> {
        let v = self.vault(handle)?;
        let started = Instant::now();
        let summary = v.read().tag_summary();
        let took_ms = (started.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0;
        Ok(TagsResponse { summary, status: v.status(handle), took_ms })
    }

    /// All known drawing paths, sorted, under a single read lock.
    pub(crate) fn list_names(&self, handle: &str) -> Result<NamesListing> {
        let v = self.vault(handle)?;
        let index = v.read();
        let mut paths = Vec::with_capacity(index.docs().len());
        paths.extend(index.docs().keys().cloned());
        let status = v.status_of(handle, &index);
        drop(index);
        paths.sort_unstable();
        Ok(NamesListing { paths, status })
    }

    pub(crate) fn search(&self, handle: &str, query: &str, limit: Option<u32>, scope: Option<&str>) -> Result<SearchResponse> {
        let limit = vaultdraw_core::search::checked_limit(query, limit)?;
        let scope = Scope::parse(scope).ok_or_else(|| err("INVALID_SCOPE", "Scope must be all, names or content"))?;
        let v = self.vault(handle)?;
        let started = Instant::now();
        let (results, total) = v.read().query(query, scope, limit);
        let took_ms = (started.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0;
        Ok(SearchResponse { query: query.to_string(), results, total_matches: total as u32, status: v.status(handle), took_ms })
    }
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn search_vault(handle: String, query: String, limit: Option<u32>, scope: Option<String>, state: State<'_, SearchService>) -> Result<SearchResponse> {
    state.search(&handle, &query, limit, scope.as_deref())
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn search_list_names(handle: String, state: State<'_, SearchService>) -> Result<NamesListing> {
    state.list_names(&handle)
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn search_index_status(handle: String, state: State<'_, SearchService>) -> Result<IndexStatus> {
    state.status(&handle)
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn vault_tags(handle: String, state: State<'_, SearchService>) -> Result<TagsResponse> {
    // The navigator reads tags at mount: that must not start a lazy index. It refetches on
    // the status events that follow a start.
    if state.is_pending(&handle) {
        return Ok(TagsResponse { summary: vaultdraw_core::search::types::TagSummary { tags: Vec::new(), by_path: HashMap::new() }, status: state.status(&handle)?, took_ms: 0.0 });
    }
    state.tags(&handle)
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use std::{fs, path::Path, time::Duration};

    fn noop() -> Emitter {
        Arc::new(|_| {})
    }

    fn drawing(texts: &[&str]) -> String {
        let els: Vec<String> = texts
            .iter()
            .enumerate()
            .map(|(i, t)| format!(r#"{{"id":"e{i}","type":"text","text":{t:?},"originalText":{t:?},"isDeleted":false}}"#))
            .collect();
        format!(r#"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{}},"files":{{}}}}"#, els.join(","))
    }

    fn write(root: &Path, rel: &str, texts: &[&str]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, drawing(texts)).unwrap();
    }

    fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
        for _ in 0..400 {
            if cond() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {what}");
    }

    fn paths(svc: &SearchService, q: &str) -> Vec<String> {
        svc.search("h", q, None, None).unwrap().results.into_iter().map(|h| h.path).collect()
    }

    fn started(root: &Path) -> SearchService {
        let svc = SearchService::default();
        svc.start_with("h", root.to_path_buf(), noop(), None);
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        svc
    }

    // ---- lazy start (D8) ----

    fn registered(root: &Path) -> SearchService {
        let svc = SearchService::default();
        svc.register_with("h", root.to_path_buf(), noop(), None);
        svc
    }

    #[test]
    fn registered_vault_does_not_start_until_used() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["alpha"]);
        let svc = registered(dir.path());
        // Status and watcher batches never start the indexer.
        let s = svc.status("h").unwrap();
        assert_eq!((s.state, s.indexed, s.total), (IndexState::Loading, 0, 0));
        svc.notify("h", &["a.excalidraw".into()], true);
        assert!(svc.is_pending("h"));
        assert!(svc.started("h").is_none());
        // The first query starts it and the answer fills in.
        let _ = svc.search("h", "alpha", None, None).unwrap();
        assert!(!svc.is_pending("h"));
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        assert_eq!(paths(&svc, "alpha"), vec!["a.excalidraw"]);
    }

    #[test]
    fn changes_made_while_pending_are_found_after_start() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "old.excalidraw", &["before"]);
        let svc = registered(dir.path());
        // Created, edited and deleted while pending: the watcher batches are dropped.
        write(dir.path(), "new.excalidraw", &["created while pending"]);
        write(dir.path(), "old.excalidraw", &["edited while pending"]);
        svc.notify("h", &["new.excalidraw".into(), "old.excalidraw".into()], false);
        svc.ensure("h");
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        assert_eq!(paths(&svc, "created while pending"), vec!["new.excalidraw"]);
        assert_eq!(paths(&svc, "edited while pending"), vec!["old.excalidraw"]);
        assert!(paths(&svc, "before").is_empty());
    }

    #[test]
    fn ensure_is_idempotent_and_stop_drops_a_pending_vault() {
        let dir = tempfile::tempdir().unwrap();
        let svc = registered(dir.path());
        svc.ensure("h");
        let first = svc.started("h").unwrap();
        svc.ensure("h");
        assert!(Arc::ptr_eq(&first, &svc.started("h").unwrap()));

        let other = registered(dir.path());
        other.stop("h");
        assert!(!other.is_pending("h"));
        assert_eq!(other.search("h", "x", None, None).unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn big_drawings_are_reindexed_only_after_they_go_quiet() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let svc = SearchService::default();
        let defer = worker::Defer { min_bytes: 2_000, delay: Duration::from_millis(700) };
        svc.start_deferring("h", root.to_path_buf(), noop(), None, defer);
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        let pad = "padding ".repeat(400);
        let big = |tag: &str| write(root, "big.excalidraw", &[tag, &pad]);

        big("version1");
        svc.notify("h", &["big.excalidraw".into()], false);
        write(root, "small.excalidraw", &["smallword"]);
        svc.notify("h", &["small.excalidraw".into()], false);
        // Small files are indexed at once; the big one is findable by name only.
        wait_until("small", || paths(&svc, "smallword") == ["small.excalidraw"]);
        assert_eq!(paths(&svc, "big"), vec!["big.excalidraw"]);
        assert!(paths(&svc, "version1").is_empty());

        // Events keep arriving faster than the delay: the content stays unindexed.
        for v in ["version2", "version3"] {
            std::thread::sleep(Duration::from_millis(400));
            big(v);
            svc.notify("h", &["big.excalidraw".into()], false);
            assert!(paths(&svc, "version1").is_empty() && paths(&svc, v).is_empty());
        }
        // Once quiet, the final content (and only it) is indexed.
        wait_until("final content", || paths(&svc, "version3") == ["big.excalidraw"]);
        assert!(paths(&svc, "version2").is_empty() && paths(&svc, "version1").is_empty());

        // A deferred file that is deleted never gets indexed.
        big("ghost");
        svc.notify("h", &["big.excalidraw".into()], false);
        fs::remove_file(root.join("big.excalidraw")).unwrap();
        svc.notify("h", &["big.excalidraw".into()], false);
        std::thread::sleep(Duration::from_millis(1000));
        assert!(paths(&svc, "ghost").is_empty() && paths(&svc, "big").is_empty());
    }

    #[test]
    fn cold_build_indexes_names_and_content_skipping_junk() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.excalidraw", &["Alpha"]);
        write(root, "sub/b.excalidraw", &["Beta"]);
        write(root, ".excalidraw-vault/hidden.excalidraw", &["Secret"]);
        fs::write(root.join("note.txt"), "alpha").unwrap();
        fs::write(root.join("broken.excalidraw"), "not json").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a.excalidraw"), root.join("link.excalidraw")).unwrap();
        let svc = started(root);
        assert_eq!(paths(&svc, "alpha"), vec!["a.excalidraw"]);
        assert_eq!(paths(&svc, "secret"), Vec::<String>::new());
        assert_eq!(paths(&svc, "broken"), vec!["broken.excalidraw"]);
        assert_eq!(paths(&svc, "link"), Vec::<String>::new());
        let st = svc.status("h").unwrap();
        assert_eq!((st.indexed, st.total), (3, 3));
    }

    #[test]
    fn watcher_updates_add_change_delete_and_folder_rename() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.excalidraw", &["alpha"]);
        let svc = started(root);

        write(root, "b.excalidraw", &["bravo"]);
        svc.notify("h", &["b.excalidraw".into()], false);
        wait_until("bravo", || paths(&svc, "bravo") == ["b.excalidraw"]);

        write(root, "a.excalidraw", &["charlie is longer now"]);
        svc.notify("h", &["a.excalidraw".into()], false);
        wait_until("charlie", || paths(&svc, "charlie") == ["a.excalidraw"]);
        assert!(paths(&svc, "alpha").is_empty());

        fs::remove_file(root.join("a.excalidraw")).unwrap();
        svc.notify("h", &["a.excalidraw".into()], false);
        wait_until("a removed", || paths(&svc, "charlie").is_empty());

        write(root, "f/c.excalidraw", &["delta"]);
        svc.notify("h", &["f".into(), "f/c.excalidraw".into()], false);
        wait_until("delta", || paths(&svc, "delta") == ["f/c.excalidraw"]);
        fs::rename(root.join("f"), root.join("g")).unwrap();
        svc.notify("h", &["f".into(), "g".into()], false);
        wait_until("renamed folder", || paths(&svc, "delta") == ["g/c.excalidraw"]);

        fs::remove_dir_all(root.join("g")).unwrap();
        svc.notify("h", &["g".into()], false);
        wait_until("folder removed", || paths(&svc, "delta").is_empty());

        write(root, "late.excalidraw", &["echo"]);
        svc.notify("h", &[], true);
        wait_until("rescan", || paths(&svc, "echo") == ["late.excalidraw"]);
    }

    #[test]
    fn snapshot_is_written_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let snap = dir.path().join("state/index.bin");
        write(&root, "a.excalidraw", &["alpha"]);
        let svc = SearchService::default();
        svc.start_with("h", root.clone(), noop(), Some(snap.clone()));
        wait_until("snapshot", || snap.exists());
        svc.stop("h");
        assert!(svc.status("h").is_err());

        let again = SearchService::default();
        again.start_with("h", root.clone(), noop(), Some(snap));
        wait_until("ready", || again.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        assert_eq!(again.search("h", "alpha", None, None).unwrap().total_matches, 1);
    }

    #[test]
    fn emits_status_ending_in_ready() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["alpha"]);
        let seen: Arc<Mutex<Vec<IndexStatus>>> = Arc::default();
        let sink = seen.clone();
        let svc = SearchService::default();
        svc.start_with("h", dir.path().to_path_buf(), Arc::new(move |s| sink.lock().unwrap().push(s)), None);
        wait_until("ready event", || seen.lock().unwrap().last().is_some_and(|s| s.state == IndexState::Ready));
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].state, IndexState::Loading);
        assert_eq!(seen.last().unwrap().indexed, 1);
    }

    #[test]
    fn search_validates_arguments() {
        let dir = tempfile::tempdir().unwrap();
        let svc = started(dir.path());
        assert_eq!(svc.search("h", &"x".repeat(257), None, None).unwrap_err().code, "INVALID_QUERY");
        assert_eq!(svc.search("h", "x", None, Some("bogus")).unwrap_err().code, "INVALID_SCOPE");
        assert_eq!(svc.search("nope", "x", None, None).unwrap_err().code, "NOT_FOUND");
        assert!(svc.search("h", "x", Some(0), Some("names")).is_ok());
    }

    #[test]
    fn response_serialises_to_the_frozen_contract() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["Alpha"]);
        let svc = started(dir.path());
        let v = serde_json::to_value(svc.search("h", "alp", None, None).unwrap()).unwrap();
        assert_eq!(v["totalMatches"], 1);
        assert_eq!(v["status"]["state"], "ready");
        let hit = &v["results"][0];
        assert_eq!(hit["nameHighlights"], serde_json::json!([]));
        let m = &hit["matches"][0];
        assert_eq!(m["kind"], "text");
        assert!(m["containerId"].is_null());
        assert_eq!(m["highlights"], serde_json::json!([[0, 3]]));
        assert!(v["tookMs"].is_number());
    }

    #[test]
    fn tags_follow_watcher_updates_and_tag_search_works() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.excalidraw", &["#todo fix"]);
        let svc = started(root);
        assert_eq!(svc.tags("h").unwrap().summary.tags[0].tag, "todo");
        assert_eq!(paths(&svc, "tag:#todo"), vec!["a.excalidraw"]);

        write(root, "b.excalidraw", &["#todo #Done"]);
        svc.notify("h", &["b.excalidraw".into()], false);
        wait_until("b tagged", || svc.tags("h").unwrap().summary.tags.len() == 2);
        write(root, "a.excalidraw", &["no tags now"]);
        svc.notify("h", &["a.excalidraw".into()], false);
        wait_until("a untagged", || paths(&svc, "tag:#todo") == ["b.excalidraw"]);
        fs::remove_file(root.join("b.excalidraw")).unwrap();
        svc.notify("h", &["b.excalidraw".into()], false);
        wait_until("all gone", || svc.tags("h").unwrap().summary.tags.is_empty());
        assert_eq!(svc.tags("nope").unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn tags_response_serialises_camel_case() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["#Dsa/Graphs"]);
        let svc = started(dir.path());
        let v = serde_json::to_value(svc.tags("h").unwrap()).unwrap();
        assert_eq!(v["tags"][1], serde_json::json!({"tag": "dsa/graphs", "display": "Dsa/Graphs", "count": 1}));
        assert_eq!(v["byPath"]["a.excalidraw"], serde_json::json!(["Dsa/Graphs"]));
        assert_eq!(v["status"]["state"], "ready");
        assert!(v["tookMs"].is_number());
    }

    #[test]
    fn list_names_empty_vault() {
        let dir = tempfile::tempdir().unwrap();
        let svc = started(dir.path());
        let l = svc.list_names("h").unwrap();
        assert!(l.paths.is_empty());
        assert_eq!(l.status.total, 0);
        let v = serde_json::to_value(&l).unwrap();
        assert_eq!(v["paths"], serde_json::json!([]));
        assert_eq!(v["status"]["state"], "ready");
    }

    #[test]
    fn list_names_nested_sorted_forward_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "zeta.excalidraw", &["z"]);
        write(root, "a/deep/c.excalidraw", &["c"]);
        write(root, "a/b.excalidraw", &["b"]);
        write(root, "Alpha.excalidraw", &["a"]);
        let svc = started(root);
        let l = svc.list_names("h").unwrap();
        assert_eq!(l.paths, vec!["Alpha.excalidraw", "a/b.excalidraw", "a/deep/c.excalidraw", "zeta.excalidraw"]);
        assert_eq!((l.status.indexed, l.status.total), (4, 4));
    }

    #[test]
    fn list_names_unknown_handle_matches_search_vault() {
        let svc = SearchService::default();
        let a = svc.list_names("nope").unwrap_err();
        let b = svc.search("nope", "x", None, None).unwrap_err();
        assert_eq!(a.code, b.code);
        assert_eq!(a.code, "NOT_FOUND");
    }

    #[test]
    fn list_names_5k_is_cheap() {
        let dir = tempfile::tempdir().unwrap();
        let svc = SearchService::default();
        svc.start_with("h", dir.path().to_path_buf(), noop(), None);
        wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
        let v = svc.vault("h").unwrap();
        {
            let mut idx = v.write();
            for i in 0..5000 {
                let p = format!("folder{}/drawing-{i}-name.excalidraw", i % 40);
                idx.upsert(p.clone(), index::DocEntry::name_only(&p));
            }
        }
        let mut best = std::time::Duration::MAX;
        for _ in 0..20 {
            let t = Instant::now();
            let l = svc.list_names("h").unwrap();
            best = best.min(t.elapsed());
            assert_eq!(l.paths.len(), 5000);
            assert!(l.paths.windows(2).all(|w| w[0] <= w[1]));
        }
        println!("list_names 5000 docs: best of 20 = {best:?}");
        assert!(best < Duration::from_millis(10));
    }

    #[test]
    fn with_index_exposes_items_for_tags() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.excalidraw", &["#todo one", "two"]);
        let svc = started(dir.path());
        let n = svc.with_index("h", |idx| {
            let mut n = 0;
            idx.for_each_item(|_, _| n += 1);
            n
        });
        assert_eq!(n, Some(2));
    }

    /// Synthetic 5k-drawing vault: `cargo test --release search::unit_tests::perf -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn perf_5k_drawings() {
        let mut seed = 0x9E3779B97F4A7C15u64;
        let mut rnd = move |n: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n as u64) as usize
        };
        const SYL: [&str; 24] = ["ka", "to", "ri", "me", "su", "al", "be", "con", "der", "ing", "ex", "pa", "lo", "ver", "tin", "dat", "ser", "vice", "base", "auth", "flow", "node", "api", "the"];
        let vocab: Vec<String> = (0..3000).map(|_| (0..1 + rnd(3)).map(|_| SYL[rnd(SYL.len())]).collect::<String>()).collect();
        let word = |rnd: &mut dyn FnMut(usize) -> usize| {
            // Zipf-ish: low indices are far more common.
            let a = rnd(vocab.len());
            let b = rnd(vocab.len());
            vocab[a.min(b)].clone()
        };
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let mut json_total = 0usize;
        for d in 0..5000 {
            let mut els = Vec::new();
            for i in 0..20 {
                let n = 2 + rnd(3);
                let t: Vec<String> = (0..n).map(|_| word(&mut rnd)).collect();
                els.push(format!(r#"{{"id":"t{i}","type":"text","text":"{0}","originalText":"{0}","x":1.5,"y":2.5,"width":10,"height":20}},{{"id":"r{i}","type":"rectangle","x":0,"y":0,"points":[[0,0],[1,1]]}}"#, t.join(" ")));
            }
            for l in 0..2 {
                let t: Vec<String> = (0..150).map(|_| word(&mut rnd)).collect();
                els.push(format!(r#"{{"id":"long{l}","type":"text","text":"{0}","originalText":"{0}"}}"#, t.join(" ")));
            }
            if d % 10 == 0 {
                els.push(r#"{"id":"cjk","type":"text","text":"数据库设计与服务认证流程","originalText":"数据库设计与服务认证流程"}"#.into());
            }
            let files = if d % 50 == 0 { format!(r#""files":{{"f":{{"dataURL":"data:image/png;base64,{}"}}}}"#, "A".repeat(200_000)) } else { r#""files":{}"#.into() };
            let json = format!(r#"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{}},{files}}}"#, els.join(","));
            json_total += json.len();
            let p = root.join(format!("folder{}/drawing-{d}-{}.excalidraw", d % 40, word(&mut rnd)));
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, json).unwrap();
        }
        println!("vault: 5000 drawings, {:.1} MB of JSON", json_total as f64 / 1e6);

        let snap = dir.path().join("state/index.bin");
        let svc = SearchService::default();
        let t = Instant::now();
        svc.start_with("h", root.clone(), noop(), Some(snap.clone()));
        let mut names_ready = None;
        while svc.status("h").unwrap().state != IndexState::Ready {
            if names_ready.is_none() && svc.status("h").unwrap().total == 5000 {
                names_ready = Some(t.elapsed());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        println!("cold build: {:?} (all names searchable after {:?})", t.elapsed(), names_ready);
        std::thread::sleep(Duration::from_millis(100));
        let heap = svc.with_index("h", |i| i.approx_heap_bytes()).unwrap();
        println!("index heap estimate: {:.1} MB, snapshot {:.1} MB", heap as f64 / 1e6, fs::metadata(&snap).unwrap().len() as f64 / 1e6);

        for q in ["the", "auth", "serv", "kato", "database design", "数据库", "zzzz", "a", "drawing-12", "dat flow api"] {
            let mut times: Vec<f64> = (0..200).map(|_| svc.search("h", q, None, None).unwrap().took_ms).collect();
            times.sort_by(f64::total_cmp);
            let r = svc.search("h", q, None, None).unwrap();
            println!("query {q:?}: {} matches, p50 {:.2} ms p95 {:.2} ms", r.total_matches, times[100], times[190]);
        }
        svc.stop("h");

        let t = Instant::now();
        let (_, idx) = store::load(&snap).unwrap();
        println!("snapshot load: {:?} ({} docs)", t.elapsed(), idx.counts().1);
        let t = Instant::now();
        let again = SearchService::default();
        again.start_with("h", root, noop(), Some(snap));
        while again.status("h").unwrap().state != IndexState::Ready {
            std::thread::sleep(Duration::from_millis(2));
        }
        println!("warm start to ready (load + stat walk): {:?}", t.elapsed());
    }
}
