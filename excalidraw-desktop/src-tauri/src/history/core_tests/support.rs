//! Test fixtures: a throwaway vault + state dir wired to a real `HistoryService`, a settable
//! clock, and a small scene generator (independent of agent A's helpers, which are private to
//! `history::tests`).
use crate::history::{
    writer::Clock, HistoryEvent, HistoryService, HistorySettings, VaultHistory,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex},
    time::{Duration, Instant},
};

pub struct TestClock(pub AtomicU64);
impl TestClock {
    pub fn new(ms: u64) -> Arc<TestClock> {
        Arc::new(TestClock(AtomicU64::new(ms)))
    }
    pub fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}
impl Clock for TestClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct Rng(pub u64);
impl Rng {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

pub const T0: u64 = 1_800_000_000_000;

fn element(r: &mut Rng, i: usize) -> Value {
    json!({"id": format!("el{i:06}"), "type": "rectangle", "x": r.below(2000), "y": r.below(2000), "width": 10 + r.below(300), "height": 10 + r.below(300),
        "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "roughness": 1, "opacity": 100,
        "groupIds": [], "isDeleted": false, "version": 1, "versionNonce": r.below(1 << 30), "seed": r.below(1 << 30), "updated": 1739539200000u64,
        "boundElements": null, "link": null, "locked": false, "index": format!("a{i:05}")})
}

/// A drawing with `n` elements and `images` embedded images of `img_len` random bytes each.
pub fn scene(seed: u64, n: usize, images: usize, img_len: usize) -> Scene {
    let mut r = Rng(seed | 1);
    let mut s = Scene { elements: (0..n).map(|i| element(&mut r, i)).collect(), files: serde_json::Map::new(), rng: r };
    for k in 0..images {
        let bytes: Vec<u8> = (0..img_len).map(|_| s.rng.next() as u8).collect();
        let id = format!("file{k:04}{:08x}", s.rng.next() as u32);
        s.files.insert(id.clone(), json!({"mimeType": "image/png", "id": id, "dataURL": format!("data:image/png;base64,{}", b64(&bytes)), "created": 1739539200000u64}));
        let mut e = element(&mut s.rng, n + k);
        e["type"] = json!("image");
        e["fileId"] = json!(id);
        s.elements.push(e);
    }
    s
}

pub fn b64(data: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (u32::from(c[0]) << 16) | (u32::from(*c.get(1).unwrap_or(&0)) << 8) | u32::from(*c.get(2).unwrap_or(&0));
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

#[derive(Clone)]
pub struct Scene {
    pub elements: Vec<Value>,
    pub files: serde_json::Map<String, Value>,
    pub rng: Rng,
}
impl Clone for Rng {
    fn clone(&self) -> Self {
        Rng(self.0)
    }
}

impl Scene {
    pub fn json(&self) -> String {
        json!({"type": "excalidraw", "version": 2, "source": "https://excalidraw.com", "elements": self.elements, "appState": {"viewBackgroundColor": "#ffffff", "gridSize": null}, "files": self.files}).to_string()
    }
    /// A realistic small edit: move a few elements, add one, tombstone one.
    pub fn edit(&mut self) {
        let n = self.elements.len().max(1);
        for _ in 0..3 {
            let i = self.rng.below(n);
            let x = self.rng.below(2000);
            let e = &mut self.elements[i];
            e["x"] = json!(x);
            e["version"] = json!(e["version"].as_u64().unwrap_or(1) + 1);
        }
        let k = self.elements.len();
        let e = element(&mut self.rng, k);
        self.elements.push(e);
        let d = self.rng.below(self.elements.len());
        self.elements[d]["isDeleted"] = json!(true);
    }
    pub fn clear(&mut self) {
        self.elements.truncate(2);
    }
}

pub fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(15) {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("timed out waiting for {what}");
}

pub fn settings(interval: u32) -> HistorySettings {
    HistorySettings { interval_minutes: interval, ..Default::default() }
}

/// A vault + state dir with a started `HistoryService` and a save helper that mirrors
/// `write_drawing` (mutation guard held, hook after a successful commit).
pub struct Fx {
    pub dir: tempfile::TempDir,
    pub root: PathBuf,
    pub state: PathBuf,
    pub svc: HistoryService,
    pub clock: Arc<TestClock>,
    pub events: Arc<Mutex<Vec<HistoryEvent>>>,
    pub vault: crate::Vault,
    revs: Mutex<HashMap<String, String>>,
    ops: AtomicU64,
}

impl Fx {
    pub fn new() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let state = dir.path().join("state");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&state).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let clock = TestClock::new(crate::now_ms(std::time::SystemTime::now()));
        let svc = HistoryService::for_tests(state.clone(), clock.clone());
        let vault = crate::Vault::for_tests(root.clone(), "h", false);
        Fx { dir, root, state, svc, clock, events: Arc::default(), vault, revs: Mutex::default(), ops: AtomicU64::new(0) }
    }
    pub fn emitter(&self) -> crate::history::Emitter {
        let ev = self.events.clone();
        Arc::new(move |e| ev.lock().unwrap().push(e))
    }
    pub fn start(&self, read_only: bool) {
        self.svc.start("h", self.root.clone(), read_only, self.emitter());
    }
    pub fn start_configured(&self, interval: u32) {
        self.start(false);
        self.svc.vault("h").unwrap().configure(settings(interval));
    }
    pub fn vh(&self) -> Arc<VaultHistory> {
        self.svc.vault("h").unwrap()
    }
    /// Save like `write_drawing`; returns the revision.
    pub fn save(&self, rel: &str, json: &str) -> String {
        let _g = self.vault.mutation.lock().unwrap();
        let expected = self.revs.lock().unwrap().get(rel).cloned();
        let op = format!("op{}", self.ops.fetch_add(1, Ordering::Relaxed));
        let out = crate::write_drawing_file(&self.vault, rel, json, expected.as_deref(), &op).unwrap();
        let rev = out["revision"].as_str().unwrap().to_string();
        self.svc.after_commit("h", rel, &rev, json.len() as u64);
        self.revs.lock().unwrap().insert(rel.to_string(), rev.clone());
        rev
    }
    pub fn open(&self, rel: Option<&str>) {
        let rev = rel.map(|r| self.revs.lock().unwrap().get(r).cloned().unwrap_or_else(|| crate::current_revision(&self.root.join(r)).unwrap().unwrap()));
        self.vh().opened(rel.map(str::to_string), rev).unwrap();
    }
    pub fn versions(&self, rel: &str) -> Vec<crate::history::VersionInfo> {
        self.vh().list(rel).unwrap().versions
    }
    pub fn staged_files(&self) -> Vec<String> {
        let dir = self.vh().staged_dir.clone();
        let mut v: Vec<String> = std::fs::read_dir(dir).map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".excalidraw")).collect()).unwrap_or_default();
        v.sort();
        v
    }
    /// A synchronization point: a waited snapshot drains everything queued before it.
    pub fn barrier(&self) {
        // A barrier that timed out would let the next assertion race the worker and fail far
        // from the cause (toimprove 119: one flaky lineage failure at load 16): say so here.
        if let Err(e) = self.vh().snapshot("barrier.excalidraw", "leave", true) {
            assert!(!e.message.contains("did not answer"), "history barrier timed out: {}", e.message);
        }
        // Background jobs run in 5 ms wall-clock slices behind urgent messages: under load they
        // were still running when the next step began (toimprove 119). Wait until they are done,
        // then pass once more through the queue so the worker's last loop pass has run.
        let vh = self.vh();
        wait_for("history background jobs", || !vh.bg_busy.load(std::sync::atomic::Ordering::Relaxed));
        let _ = vh.snapshot("barrier.excalidraw", "leave", true);
    }
    pub fn hist_dir(&self) -> PathBuf {
        self.root.join(".excalidraw-vault/history")
    }
}

pub fn count_files(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten().map(|e| if e.path().is_dir() { count_files(&e.path()) } else { 1 }).sum()
}

use crate::history::{
    index::{self, Index},
    names,
    store::Store,
    writer::{Epoch, Outcome, Source, VersionRequest, Writer},
};
use std::sync::RwLock;

/// A `Writer` driven directly on the calling thread (fault injection is thread-local).
pub fn mk_writer(root: &Path, state: &Path, clock: Arc<dyn Clock>, free_ok: Box<dyn Fn() -> bool + Send>) -> Writer {
    let store = Store::new(root);
    let idx = Arc::new(RwLock::new(Index::new(false)));
    index::scan_all(&store, &idx, clock.now_ms());
    let hist = state.join("history");
    std::fs::create_dir_all(&hist).unwrap();
    let dev = names::load_or_create_device(&hist).unwrap();
    let ulid = names::UlidGen::load(Some(&hist));
    let epoch = Epoch::load(Some(state.join("writer")), clock.now_ms());
    Writer::new(store, idx, dev, ulid, epoch, clock, free_ok, Box::new(|| true))
}

pub fn live_request(path: &str, reason: names::Reason) -> VersionRequest {
    VersionRequest { path: path.into(), reason, name: None, note: None, source: Source::Live, revision: None, size: None, verify: false, allow_unchanged: false, rev_prefix: None }
}

/// Writes `json` as the live file and versions it; returns the outcome.
pub fn version_of(w: &mut Writer, root: &Path, path: &str, json: &str, reason: names::Reason) -> crate::Result<Outcome> {
    std::fs::write(root.join(path), json).unwrap();
    w.write_version(&live_request(path, reason))
}

/// Decodes every visible version file under `<root>/.excalidraw-vault/history` and checks that the
/// inlined bytes hash to the header's `fileRevision`. Returns how many versions were checked.
pub fn verify_all_versions(root: &Path) -> usize {
    use crate::history::{codec, container};
    let store = Store::new(root);
    let hist = &store.hist;
    let mut checked = 0;
    let Ok(rd) = std::fs::read_dir(hist) else { return 0 };
    for lin in rd.flatten() {
        let ln = lin.file_name().to_string_lossy().into_owned();
        if !names::is_ulid(&ln) {
            continue;
        }
        for f in std::fs::read_dir(lin.path()).unwrap().flatten() {
            let fname = f.file_name().to_string_lossy().into_owned();
            let Some(name) = names::VersionName::parse(&fname) else { continue };
            let bytes = std::fs::read(f.path()).unwrap();
            let header = container::read_header(&bytes).unwrap_or_else(|e| panic!("{fname}: header {}", e.message));
            let body = container::read_body(&bytes, 64 << 20).unwrap_or_else(|e| panic!("{fname}: body {}", e.message));
            let text = if header.kind == "delta" {
                let kid = header.keyframe.clone().unwrap();
                let kf = std::fs::read_dir(lin.path()).unwrap().flatten().find(|e| e.file_name().to_string_lossy().starts_with(&kid)).unwrap_or_else(|| panic!("{fname}: keyframe {kid} missing"));
                assert!(kf.file_name().to_string_lossy().contains(&format!("-{}.k", name.dev)), "delta's keyframe is same-device");
                let kb = std::fs::read(kf.path()).unwrap();
                codec::reconstruct(&container::read_body(&kb, 64 << 20).unwrap(), Some(&body)).unwrap()
            } else {
                body
            };
            let file = codec::inline(&text, &|t| store.read_blob_any(t)).unwrap_or_else(|e| panic!("{fname}: inline {}", e.message));
            assert_eq!(crate::revision(&file), header.file_revision, "{fname} is not byte-exact");
            checked += 1;
        }
    }
    checked
}

pub fn tmp_files(root: &Path) -> Vec<PathBuf> {
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(rd) = std::fs::read_dir(d) {
            for e in rd.flatten() {
                if e.path().is_dir() {
                    walk(&e.path(), out);
                } else if e.file_name().to_string_lossy().ends_with(".tmp") {
                    out.push(e.path());
                }
            }
        }
    }
    let mut v = Vec::new();
    walk(&root.join(".excalidraw-vault/history"), &mut v);
    v
}

pub struct NoMemoLocal;
impl crate::history::codec::BlobMemo for NoMemoLocal {
    fn lookup(&self, _: &str, _: usize, _: u32) -> Option<String> {
        None
    }
    fn remember(&mut self, _: &str, _: usize, _: u32, _: &str) {}
}
