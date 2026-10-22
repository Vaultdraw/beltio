//! Headless index for the offline CLI: the same result the app's background worker converges
//! to, built in one call. Loads the snapshot (`store::load`), stat-walks the vault, re-parses
//! only new or changed drawings (`needs_parse`/`parse`, in parallel), drops deleted ones and
//! saves the snapshot when anything changed. Use `store::snapshot_path(<state>, <root>)` so the
//! app and the CLI share one snapshot.

use super::index::DocEntry;
use super::scan::{needs_parse, parse, walk, Found};
use super::{store, Index};
use crate::error::Result;
use crate::paths::now_ms;
use std::{
    collections::HashSet,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::SystemTime,
};

/// Files modified this close to a reference time may have changed without a stat change.
pub const RACY_MS: u64 = 2000;
/// Drawings a worker thread claims at a time (small enough to balance big image-heavy files).
const CLAIM: usize = 8;

/// Parses `pending` on up to `available_parallelism()` threads (no new dependencies), each with
/// its own read buffer. Files that vanished meanwhile are skipped.
pub fn parse_parallel(root: &Path, pending: &[&Found]) -> Vec<(String, DocEntry)> {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(pending.len().div_ceil(CLAIM)).max(1);
    let next = AtomicUsize::new(0);
    let out = Mutex::new(Vec::with_capacity(pending.len()));
    let work = || {
        let mut buf = Vec::new();
        let mut local = Vec::new();
        loop {
            let start = next.fetch_add(CLAIM, Ordering::Relaxed);
            if start >= pending.len() {
                break;
            }
            for f in &pending[start..(start + CLAIM).min(pending.len())] {
                local.extend(parse(root, f, &mut buf));
            }
        }
        out.lock().unwrap_or_else(|p| p.into_inner()).extend(local);
    };
    if threads == 1 {
        work();
    } else {
        std::thread::scope(|s| {
            for _ in 0..threads {
                s.spawn(work);
            }
        });
    }
    out.into_inner().unwrap_or_else(|p| p.into_inner())
}

/// The index of the vault at `root` (a canonical vault path), using `snapshot_path` as the cache.
/// A missing, corrupt or outdated snapshot just means a full build. The snapshot is written
/// atomically, and only when the index changed.
pub fn load_or_build(root: &Path, snapshot_path: &Path) -> Result<Index> {
    let mut racy_before = now_ms(SystemTime::now()).saturating_sub(RACY_MS);
    let mut index = match store::load(snapshot_path) {
        Some((saved_at, index)) => {
            racy_before = saved_at.saturating_sub(RACY_MS);
            index
        }
        None => Index::default(),
    };
    let found = walk(root, "");
    let present: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
    let mut changed = index.retain(|p| present.contains(p)) > 0;
    // Same two steps as the worker: every file is findable by name, then new/changed ones are parsed.
    for f in &found {
        if !index.contains(&f.path) {
            index.upsert(f.path.clone(), DocEntry::name_only(&f.path));
            changed = true;
        }
    }
    let pending: Vec<&Found> = found.iter().filter(|f| needs_parse(index.get(&f.path), f, racy_before)).collect();
    if !pending.is_empty() {
        for (path, doc) in parse_parallel(root, &pending) {
            index.upsert(path, doc);
        }
        changed = true;
    }
    if changed {
        store::save(snapshot_path, now_ms(SystemTime::now()), &index)?;
    }
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::{testgen, Scope};
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf};

    fn scene(texts: &[&str]) -> String {
        let els: Vec<Value> = texts.iter().enumerate().map(|(i, t)| json!({"id": format!("e{i}"), "type": "text", "text": t, "originalText": t, "isDeleted": false})).collect();
        json!({"type": "excalidraw", "version": 2, "elements": els, "appState": {}, "files": {}}).to_string()
    }
    fn write(root: &Path, rel: &str, texts: &[&str]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, scene(texts)).unwrap();
        // Keep it out of the racy window so a second load can skip it.
        fs::OpenOptions::new().write(true).open(&p).unwrap().set_modified(SystemTime::now() - std::time::Duration::from_secs(3600)).unwrap();
    }
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("vault");
        fs::create_dir_all(&root).unwrap();
        let snap = t.path().join("state/index/id/index.bin");
        (t, root, snap)
    }
    fn hits(ix: &Index, q: &str) -> Vec<String> {
        ix.query(q, Scope::All, 50).0.into_iter().map(|h| h.path).collect()
    }

    /// Sequential reference: what the worker's startup converges to.
    fn reference(root: &Path) -> Index {
        let mut ix = Index::default();
        let mut buf = Vec::new();
        for f in walk(root, "") {
            ix.upsert(f.path.clone(), DocEntry::name_only(&f.path));
            if let Some((p, d)) = parse(root, &f, &mut buf) {
                ix.upsert(p, d);
            }
        }
        ix
    }

    #[test]
    fn cold_build_equals_the_sequential_reference() {
        let (_t, root, snap) = setup();
        testgen::generate(&root, 30);
        let built = load_or_build(&root, &snap).unwrap();
        let want = reference(&root);
        assert_eq!(built.counts(), want.counts());
        for q in ["service", "dijkstra", "database", "queue", "café", "数据库", "#dsa", "nosuchword"] {
            assert_eq!(serde_json::to_value(built.query(q, Scope::All, 100).0).unwrap(), serde_json::to_value(want.query(q, Scope::All, 100).0).unwrap(), "query {q}");
        }
        assert_eq!(serde_json::to_value(built.tag_summary()).unwrap(), serde_json::to_value(want.tag_summary()).unwrap());
        assert!(snap.is_file(), "a cold build saves the snapshot");
    }

    #[test]
    fn warm_load_reparses_only_what_changed() {
        let (_t, root, snap) = setup();
        write(&root, "a.excalidraw", &["alpha"]);
        write(&root, "sub/b.excalidraw", &["bravo"]);
        write(&root, "gone.excalidraw", &["charlie"]);
        load_or_build(&root, &snap).unwrap();
        let first_saved = fs::metadata(&snap).unwrap().modified().unwrap();

        // Nothing changed: the snapshot is not rewritten.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let ix = load_or_build(&root, &snap).unwrap();
        assert_eq!(fs::metadata(&snap).unwrap().modified().unwrap(), first_saved);
        assert_eq!(hits(&ix, "bravo"), vec!["sub/b.excalidraw"]);

        // Edit one, delete one, add one.
        write(&root, "a.excalidraw", &["alpha delta"]);
        fs::remove_file(root.join("gone.excalidraw")).unwrap();
        write(&root, "new.excalidraw", &["echo"]);
        let ix = load_or_build(&root, &snap).unwrap();
        assert_eq!(hits(&ix, "delta"), vec!["a.excalidraw"]);
        assert_eq!(hits(&ix, "echo"), vec!["new.excalidraw"]);
        assert!(hits(&ix, "charlie").is_empty(), "deleted drawing is dropped");
        assert_eq!(ix.counts().1, 3);
        assert!(fs::metadata(&snap).unwrap().modified().unwrap() > first_saved, "changes are saved");
        // And the saved snapshot agrees.
        let (_, loaded) = store::load(&snap).unwrap();
        assert_eq!(hits(&loaded, "echo"), vec!["new.excalidraw"]);
        assert!(hits(&loaded, "charlie").is_empty());
    }

    #[test]
    fn corrupt_snapshot_means_a_full_build() {
        let (_t, root, snap) = setup();
        write(&root, "a.excalidraw", &["alpha"]);
        fs::create_dir_all(snap.parent().unwrap()).unwrap();
        fs::write(&snap, b"VDSI garbage").unwrap();
        let ix = load_or_build(&root, &snap).unwrap();
        assert_eq!(hits(&ix, "alpha"), vec!["a.excalidraw"]);
        assert!(store::load(&snap).is_some(), "the bad snapshot is replaced");
    }

    #[test]
    fn empty_vault_builds_an_empty_index() {
        let (_t, root, snap) = setup();
        assert_eq!(load_or_build(&root, &snap).unwrap().counts(), (0, 0));
    }

    #[test]
    fn unparseable_file_stays_findable_by_name() {
        let (_t, root, snap) = setup();
        fs::write(root.join("broken thing.excalidraw"), "not json").unwrap();
        let ix = load_or_build(&root, &snap).unwrap();
        assert_eq!(hits(&ix, "broken"), vec!["broken thing.excalidraw"]);
    }

    #[test]
    fn parse_parallel_returns_every_file_once() {
        let (_t, root, _snap) = setup();
        for i in 0..40 {
            write(&root, &format!("d{i}.excalidraw"), &[&format!("word{i}")]);
        }
        let found = walk(&root, "");
        let pending: Vec<&Found> = found.iter().collect();
        let mut got: Vec<String> = parse_parallel(&root, &pending).into_iter().map(|(p, _)| p).collect();
        got.sort();
        got.dedup();
        assert_eq!(got.len(), 40);
    }

    /// 1,000 realistic drawings: cold (no snapshot), warm (snapshot, nothing changed) and `ls` of the root.
    /// `cargo test --release -p vaultdraw-core -- --ignored --nocapture bench_load_or_build_1k`
    #[test]
    #[ignore]
    fn bench_load_or_build_1k() {
        use std::time::Instant;
        let (_t, root, snap) = setup();
        let (bytes, blobs) = testgen::generate(&root, 1000);
        eprintln!("fixture: 1000 drawings, {:.1} MB, {blobs} with an image blob", bytes as f64 / 1e6);
        let ls_ms: Vec<f64> = (0..10)
            .map(|_| {
                let s = Instant::now();
                let n = fs::read_dir(&root).unwrap().count();
                assert!(n > 0);
                s.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        let pct = |v: &mut Vec<f64>, p: f64| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v[((v.len() as f64 * p).ceil() as usize).saturating_sub(1).min(v.len() - 1)]
        };
        let (mut cold, mut warm) = (Vec::new(), Vec::new());
        for _ in 0..10 {
            let _ = fs::remove_file(&snap);
            let s = Instant::now();
            let ix = load_or_build(&root, &snap).unwrap();
            cold.push(s.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(ix.counts().1, 1000);
        }
        for _ in 0..10 {
            let s = Instant::now();
            let ix = load_or_build(&root, &snap).unwrap();
            warm.push(s.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(ix.counts().1, 1000);
        }
        let snap_kb = fs::metadata(&snap).unwrap().len() / 1024;
        let mut ls = ls_ms;
        eprintln!("snapshot: {snap_kb} KB, threads: {}", std::thread::available_parallelism().map_or(1, |n| n.get()));
        eprintln!("cold  p50 {:.1} ms  p95 {:.1} ms", pct(&mut cold, 0.5), pct(&mut cold, 0.95));
        eprintln!("warm  p50 {:.1} ms  p95 {:.1} ms", pct(&mut warm, 0.5), pct(&mut warm, 0.95));
        eprintln!("ls    p50 {:.3} ms  p95 {:.3} ms (read_dir of the root, for scale)", pct(&mut ls, 0.5), pct(&mut ls, 0.95));
    }
}
