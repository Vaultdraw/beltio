//! Benches (`#[ignore]`): one `HISTORY_PERF {...}` line per metric.
//!
//! normal:   cargo test --release --offline history::core_tests::bench -- --ignored --nocapture --test-threads=1
//! low-end:  taskpolicy -c background env HISTORY_PERF_PROFILE=low-end <same command>
use super::support::*;
use crate::history::{
    container::{self, Header},
    index::{self, Index},
    names::{self, Reason},
    staging,
    store::Store,
    worker::Core,
    writer::{Outcome, RealBackend},
    Clock,
};
use std::{
    path::Path,
    sync::{atomic::Ordering, Arc, RwLock},
    time::Instant,
};


fn profile() -> String {
    std::env::var("HISTORY_PERF_PROFILE").unwrap_or_else(|_| "normal".into())
}

pub(crate) fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * p).round() as usize]
}

pub(crate) fn emit(metric: &str, unit: &str, mut s: Vec<f64>, extra: &str) {
    let (p50, p95, max, n) = (pct(&mut s, 0.5), pct(&mut s, 0.95), pct(&mut s, 1.0), s.len());
    println!("HISTORY_PERF {{\"metric\":\"history.{metric}\",\"unit\":\"{unit}\",\"p50\":{p50:.3},\"p95\":{p95:.3},\"max\":{max:.3},\"n\":{n},\"profile\":\"{}\"{extra}}}", profile());
}

fn vault() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let (root, state) = (d.path().join("v"), d.path().join("s"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&state).unwrap();
    let root = dunce::canonicalize(root).unwrap();
    (d, root, state)
}

const P: &str = "a.excalidraw";
pub(crate) const IMG_COUNT: usize = 6;
/// 6 x 2.5 MB of image data (20 MB as base64) + 5k elements: a ~24 MB stress file.
pub(crate) const IMG_BYTES: usize = 2_500_000;

fn writer_for(root: &Path, state: &Path) -> crate::history::writer::Writer {
    mk_writer(root, state, Arc::new(crate::history::SystemClock), Box::new(|| true))
}

/// Auto-version latency of a scene: one keyframe, then `rounds` edits each versioned (deltas).
fn auto_write(n: usize, images: usize, img: usize, rounds: usize) -> (Vec<f64>, f64) {
    let (_d, root, state) = vault();
    let mut w = writer_for(&root, &state);
    let mut sc = scene(n as u64, n, images, img);
    version_of(&mut w, &root, P, &sc.json(), Reason::Auto).unwrap();
    let mut out = Vec::new();
    let mut size = 0usize;
    for _ in 0..rounds {
        sc.edit();
        let json = sc.json();
        size = json.len();
        std::fs::write(root.join(P), json).unwrap();
        let t = Instant::now();
        let o = w.write_version(&crate::history::core_tests::support::live_request(P, Reason::Auto)).unwrap();
        out.push(t.elapsed().as_secs_f64() * 1e3);
        assert!(matches!(o, Outcome::Written(_)));
    }
    (out, size as f64 / 1048576.0)
}

#[test]
#[ignore]
fn bench_history_hooks() {
    let fx = Fx::new();
    fx.start_configured(5);
    let big: Vec<u8> = { let mut r = Rng(99); (0..22 * 1024 * 1024).map(|_| r.next() as u8).collect() };
    std::fs::write(fx.root.join(P), &big).unwrap();
    fx.open(None);
    let vh = fx.vh();
    let mut s = Vec::new();
    for i in 0..1500u64 {
        let rev = format!("{:016x}{}", i + 1, "0".repeat(48));
        let t = Instant::now();
        vh.after_commit(P, &rev, big.len() as u64);
        s.push(t.elapsed().as_secs_f64() * 1e6);
        if i % 50 == 49 {
            std::thread::sleep(std::time::Duration::from_millis(2)); // let the worker prune superseded clones
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    println!("staged after hook bench: {:?}, unsupported={} disk_low={} err={:?}", fx.staged_files().len(), vh.flags.staging_unsupported.load(Ordering::Relaxed), vh.flags.disk_low.load(Ordering::Relaxed), vh.status().last_error);
    emit("hook.commit", "us", s, "");
}

#[test]
#[ignore]
fn bench_history_write() {
    let (s, mb) = auto_write(200, 0, 0, 40);
    emit("write.auto.200", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    let (s, mb) = auto_write(2000, 0, 0, 40);
    emit("write.auto.2k", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    let (s, mb) = auto_write(5000, 0, 0, 30);
    emit("write.auto.5k", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    let (s, mb) = auto_write(5000, IMG_COUNT, IMG_BYTES, 12);
    emit("write.auto.5kimg", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    // keyframes (new lineage each time, images already stored once)
    let (_d, root, state) = vault();
    let mut w = writer_for(&root, &state);
    let sc = scene(77, 5000, IMG_COUNT, IMG_BYTES);
    let json = sc.json();
    version_of(&mut w, &root, "warm.excalidraw", &json, Reason::Auto).unwrap();
    let mut s = Vec::new();
    let mb = json.len() as f64 / 1048576.0;
    for i in 0..8 {
        let p = format!("k{i}.excalidraw");
        std::fs::write(root.join(&p), &json).unwrap();
        let t = Instant::now();
        let o = w.write_version(&crate::history::core_tests::support::live_request(&p, Reason::Checkpoint)).unwrap();
        s.push(t.elapsed().as_secs_f64() * 1e3);
        assert!(matches!(o, Outcome::Written(_)));
    }
    emit("write.keyframe.5kimg", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    // peak memory above baseline during one auto write
    for (id, n, images, img) in [("write.peakMB.5kimg", 5000, IMG_COUNT, IMG_BYTES), ("write.peakMB.32mbNoImg", 72_000, 0, 0)] {
        let (_d, root, state) = vault();
        let mut w = writer_for(&root, &state);
        let mut sc = scene(5, n, images, img);
        version_of(&mut w, &root, P, &sc.json(), Reason::Auto).unwrap();
        sc.edit();
        let json = sc.json();
        std::fs::write(root.join(P), &json).unwrap();
        let size = json.len();
        drop(json);
        drop(sc);
        let base = crate::test_alloc::reset_peak();
        let o = w.write_version(&crate::history::core_tests::support::live_request(P, Reason::Auto)).unwrap();
        assert!(matches!(o, Outcome::Written(_)));
        let peak = (crate::test_alloc::peak() - base) as f64;
        let mb = peak / 1048576.0;
        emit(id, "MB", vec![mb], &format!(",\"fileMB\":{:.2},\"ratio\":{:.2}", size as f64 / 1048576.0, peak / size as f64));
    }
}

#[test]
#[ignore]
fn bench_history_read() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(9, 5000, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    let mut ids = Vec::new();
    for _ in 0..12 {
        sc.edit();
        fx.save(P, &sc.json());
        ids.push(fx.vh().snapshot(P, "before-restore", true).unwrap().id.unwrap());
    }
    let vh = fx.vh();
    let mut s = Vec::new();
    for i in 0..120 {
        let t = Instant::now();
        let out = vh.read_version(&ids[i % ids.len()]).unwrap();
        s.push(t.elapsed().as_secs_f64() * 1e3);
        assert!(out.len() > 100_000);
    }
    emit("read.version.5k", "ms", s, "");
}

/// 100 lineages x 100 tiny but valid versions (10k files).
fn fake_vault_10k(root: &Path) {
    let store = Store::new(root);
    store.ensure_layout().unwrap();
    let hist = root.join(".excalidraw-vault/history");
    let state = tempfile::tempdir().unwrap();
    let mut gen = names::UlidGen::load(Some(state.path()));
    let dev = names::random_crockford_lower(8);
    let body = br#"{"type":"excalidraw","elements":[]}"#;
    for l in 0..100 {
        let lineage = gen.next(T0 + l);
        std::fs::create_dir_all(hist.join(&lineage)).unwrap();
        let mut key = String::new();
        for v in 0..100u64 {
            let id = gen.next(T0 + 1000 + l * 100 + v);
            let delta = v % 20 != 0;
            if !delta {
                key = id.clone();
            }
            let h = Header {
                format: 1,
                kind: if delta { "delta" } else { "keyframe" }.into(),
                id: id.clone(),
                lineage: lineage.clone(),
                device: dev.clone(),
                epoch: "0abc".into(),
                created: T0,
                reason: "auto".into(),
                path: format!("dir{}/drawing{l}.excalidraw", l % 10),
                file_revision: "a".repeat(64),
                stripped_hash: "b".repeat(64),
                keyframe: delta.then(|| key.clone()),
                ..Default::default()
            };
            let kind = if delta { names::NameKind::Delta(Reason::Auto, key.clone()) } else { names::NameKind::Keyframe(Reason::Auto) };
            let name = names::VersionName { id, dev: dev.clone(), kind }.format();
            std::fs::write(hist.join(&lineage).join(name), container::write_container(&h, body, 3)).unwrap();
        }
    }
}

#[test]
#[ignore]
fn bench_history_index() {
    let (_d, root, _state) = vault();
    fake_vault_10k(&root);
    let store = Store::new(&root);
    let mut cold = Vec::new();
    for _ in 0..7 {
        let idx = RwLock::new(Index::new(false));
        let t = Instant::now();
        index::scan_all(&store, &idx, T0);
        cold.push(t.elapsed().as_secs_f64() * 1e3);
        assert_eq!(idx.read().unwrap().version_count(), 10_000);
        assert_eq!(idx.read().unwrap().path_count(), 100);
    }
    emit("scan.cold.10k", "ms", cold, "");
    let idx = RwLock::new(Index::new(false));
    index::scan_all(&store, &idx, T0);
    let f = root.join("index.bin");
    index::save(&f, &idx.read().unwrap()).unwrap();
    let mut load = Vec::new();
    for _ in 0..25 {
        let t = Instant::now();
        let i = index::load(&f).unwrap();
        load.push(t.elapsed().as_secs_f64() * 1e3);
        assert_eq!(i.version_count(), 10_000);
    }
    emit("index.load.10k", "ms", load, &format!(",\"binKB\":{}", std::fs::metadata(&f).unwrap().len() / 1024));
}

#[test]
#[ignore]
fn bench_history_snapshot() {
    let fx = Fx::new();
    fake_vault_10k(&fx.root);
    fx.start_configured(5);
    let mut sc = scene(3, 200, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    fx.barrier();
    let vh = fx.vh();
    let mut s = Vec::new();
    for _ in 0..40 {
        sc.edit();
        fx.save(P, &sc.json());
        // a sweep (index reconcile in 5 ms chunks) is queued right before the urgent request
        vh.inbox.send_task(crate::history::worker::Task::Reconcile);
        let t = Instant::now();
        let o = vh.snapshot(P, "before-restore", true).unwrap();
        s.push(t.elapsed().as_secs_f64() * 1e3);
        assert!(o.id.is_some());
    }
    emit("snapshot.wait.urgent", "ms", s, "");
}

#[test]
#[ignore]
fn bench_history_heavy_day() {
    let (_d, root, state) = vault();
    let clock = TestClock::new(T0);
    let w = mk_writer(&root, &state, clock.clone(), Box::new(|| true));
    let staged_dir = state.join("staged");
    std::fs::create_dir_all(&staged_dir).unwrap();
    let flags = Arc::new(staging::Flags::default());
    for f in [&flags.active, &flags.configured, &flags.enabled] {
        f.store(true, Ordering::Relaxed);
    }
    let backend = RealBackend { writer: w, flags: flags.clone(), staged_dir: staged_dir.clone(), on_change: Box::new(|_, _| {}), on_error: Box::new(|_| {}), writing: Arc::default() };
    let mut core = Core::new(backend, clock.clone() as Arc<dyn Clock>);
    core.configure(settings(5));
    // a lighter 5k + 1.8 MB images scene: the day has 1200 saves
    let mut sc = scene(1, 5000, IMG_COUNT, 300_000);
    std::fs::write(root.join(P), sc.json()).unwrap();
    let rev0 = crate::current_revision(&root.join(P)).unwrap().unwrap();
    let c = staging::clone_open(&flags, &staged_dir, &root, P, &rev0);
    core.on_opened(Some(P.into()), Some(rev0), c);
    let mut commits = 0;
    // 8 hours: 25 min of editing (a save every 20 s), 5 min away, repeated; a leave every 2 h
    for slot in 0..16 {
        for _ in 0..75 {
            sc.edit();
            let json = sc.json();
            std::fs::write(root.join(P), &json).unwrap();
            let rev = crate::revision(json.as_bytes());
            let staged = staging::stage_after_commit(&flags, &staged_dir, &root, P, &rev);
            core.on_committed(P.into(), rev, json.len() as u64, staged);
            commits += 1;
            clock.advance(20_000);
            core.tick();
        }
        for _ in 0..10 {
            clock.advance(30_000);
            core.tick();
        }
        if slot % 4 == 3 {
            core.on_opened(None, None, None);
            let rev = crate::current_revision(&root.join(P)).unwrap().unwrap();
            let c = staging::clone_open(&flags, &staged_dir, &root, P, &rev);
            core.on_opened(Some(P.into()), Some(rev), c);
        }
    }
    let hist = root.join(".excalidraw-vault/history");
    let bytes: u64 = walk_sizes(&hist);
    let files = count_files(&hist);
    let mb = bytes as f64 / 1048576.0;
    emit("disk.heavyDay.5kimg", "MB", vec![mb], &format!(",\"files\":{files},\"commits\":{commits},\"versions\":{}", verify_all_versions(&root)));
    assert!(mb <= 8.0, "{mb} MB");
    assert!(files <= 100, "{files} files");
}

fn walk_sizes(d: &Path) -> u64 {
    std::fs::read_dir(d).map(|rd| rd.flatten().map(|e| if e.path().is_dir() { walk_sizes(&e.path()) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }).sum()).unwrap_or(0)
}

#[test]
#[ignore]
fn peak_phases_probe() {
    use crate::history::codec;
    for (n, images, img) in [(5000usize, IMG_COUNT, IMG_BYTES), (72_000, 0, 0)] {
        let mut sc = scene(5, n, images, img);
        let a = sc.json().into_bytes();
        sc.edit();
        let b = sc.json().into_bytes();
        drop(sc);
        let mut memo = crate::history::core_tests::support::NoMemoLocal;
        let f = a.len() as f64;
        let phase = |name: &str, base: usize| println!("PHASE {name}: peak +{:.2} F (F={:.1}MB)", (crate::test_alloc::peak() as f64 - base as f64) / f, f / 1048576.0);
        let base = crate::test_alloc::reset_peak();
        let sa = codec::strip(&a, &mut memo, &|_| true, "aaaaaaaa", "0000").unwrap();
        phase("strip", base);
        let sb = codec::strip(&b, &mut memo, &|_| true, "aaaaaaaa", "0000").unwrap();
        let base = crate::test_alloc::reset_peak();
        let d = codec::proven_delta(&sa.text, &sb.text);
        phase("proven_delta", base);
        println!("PHASE text={:.2}F delta={:?}", sa.text.len() as f64 / f, d.map(|d| d.len()));
    }
}

#[test]
#[ignore]
fn clone_probe() {
    let (_d, root, state) = vault();
    let big: Vec<u8> = { let mut r = Rng(99); (0..22 * 1024 * 1024).map(|_| r.next() as u8).collect() };
    std::fs::write(root.join(P), &big).unwrap();
    let mut s = Vec::new();
    for i in 0..200 {
        let t = Instant::now();
        crate::history::store::clone_file(&root.join(P), &state.join(format!("c{i}"))).unwrap();
        s.push(t.elapsed().as_secs_f64() * 1e6);
    }
    println!("clone only: p50 {:.1} us p95 {:.1}", pct(&mut s.clone(), 0.5), pct(&mut s, 0.95));
}
