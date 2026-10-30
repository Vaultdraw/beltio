//! GC on real files: thinning, cap, own/foreign blobs, takeover, orphans, explicit deletes and
//! crash safety (agent H). The vault is opened read-only (no worker thread), so a writer driven on
//! the test thread and the GC functions share the instance's index without interference.
use super::support::*;
use crate::history::{
    gc::{self, Ctx, Sweep},
    index,
    names::{self, BlobName, Reason},
    retention::{DAY_MS, HOUR_MS},
    store::Store,
    writer::{Clock, Epoch, Outcome, Writer},
    HistorySettings, VaultHistory,
};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

const OTHER: &str = "b2c3d4e5";
const START: u64 = T0;
/// Elements per "big" drawing (about 0.4 MB of history each).
const BIG: usize = 12_000;

struct G {
    fx: Fx,
    vh: Arc<VaultHistory>,
    me: String,
    settings: HistorySettings,
}

fn off0(_: u64) -> i32 {
    0
}

impl G {
    fn new() -> G {
        let fx = Fx::new();
        fx.start(true);
        let vh = fx.vh();
        vh.ensure_loaded();
        std::fs::create_dir_all(&vh.state_hist).unwrap();
        let me = names::load_or_create_device(&vh.state_hist).unwrap();
        fx.clock.0.store(START, Ordering::SeqCst);
        G { fx, vh, me, settings: HistorySettings::default() }
    }
    fn at(&self, t: u64) {
        self.fx.clock.0.store(t, Ordering::SeqCst);
    }
    fn writer(&self, dev: Option<&str>) -> Writer {
        let dev = dev.map(str::to_string).unwrap_or_else(|| self.me.clone());
        let ulid = names::UlidGen::load(None);
        let epoch = Epoch::load(None, self.fx.clock.now_ms());
        Writer::new(self.vh.store.clone(), self.vh.index.clone(), dev, ulid, epoch, self.fx.clock.clone(), Box::new(|| true), Box::new(|| true))
    }
    fn ctx(&self, now: u64) -> Ctx<'_> {
        Ctx { vh: &self.vh, dev: &self.me, now_ms: now, settings: &self.settings }
    }
    /// Versions `json` at `path` at time `t`; returns (id, lineage).
    fn put(&self, w: &mut Writer, path: &str, json: &str, reason: Reason, t: u64) -> (String, String) {
        self.at(t);
        match version_of(w, &self.fx.root, path, json, reason).unwrap() {
            Outcome::Written(x) => (x.id, x.lineage),
            o => panic!("{path} {reason:?} at +{}ms not written: {o:?}", t - START),
        }
    }
    fn hist(&self) -> PathBuf {
        self.fx.hist_dir()
    }
    fn files(&self, lin: &str) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(self.hist().join(lin)).map(|r| r.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".vdh")).collect()).unwrap_or_default();
        v.sort();
        v
    }
    fn count(&self) -> usize {
        self.vh.read_index().version_count()
    }
    fn sweep(&self, now: u64) {
        self.rescan_blobs();
        let ctx = self.ctx(now);
        let mut s = Sweep::new(&ctx);
        while !s.step_with(&ctx, Duration::from_secs(5), &off0) {}
    }
    fn blob_files(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(self.hist().join("blobs")) {
            for shard in rd.flatten() {
                for f in std::fs::read_dir(shard.path()).unwrap().flatten() {
                    out.push(f.file_name().to_string_lossy().into_owned());
                }
            }
        }
        out.sort();
        out
    }
    fn rescan_blobs(&self) {
        index::scan_all(&self.vh.store, &self.vh.index, self.fx.clock.now_ms());
    }
}

/// `n` edits of a small drawing, one per `step_ms`, all automatic.
fn history(g: &G, w: &mut Writer, path: &str, n: usize, step_ms: u64, from: u64) -> String {
    history_seed(g, w, path, n, step_ms, from, 7)
}

fn history_seed(g: &G, w: &mut Writer, path: &str, n: usize, step_ms: u64, from: u64, seed: u64) -> String {
    let mut sc = scene(seed, 20, 0, 0);
    let mut lin = String::new();
    for i in 0..n {
        sc.edit();
        lin = g.put(w, path, &sc.json(), Reason::Auto, from + i as u64 * step_ms).1;
    }
    lin
}

#[test]
fn after_write_thins_and_every_remaining_version_still_decodes() {
    let g = G::new();
    let mut w = g.writer(None);
    let end = START + 40 * HOUR_MS;
    let lin = history(&g, &mut w, "a.excalidraw", 130, 20 * 60_000, START);
    let before = g.count();
    assert_eq!(before, 130);
    gc::retain_with(&g.ctx(end), &lin, &off0, usize::MAX);
    let after = g.count();
    assert!(after < 60 && after > 20, "{after}");
    assert_eq!(g.files(&lin).len(), after, "files and index agree");
    assert_eq!(verify_all_versions(&g.fx.root), after, "every remaining version decodes (keyframes kept for kept deltas)");
    // idempotent
    assert_eq!(gc::retain_with(&g.ctx(end), &lin, &off0, usize::MAX), 0);
    // the panel hears about it
    assert!(g.vh.notifier.lock().unwrap().paths.contains("a.excalidraw"));
}

#[test]
fn crash_after_every_kth_unlink_leaves_every_delta_with_its_keyframe() {
    let end = START + 40 * HOUR_MS;
    let mut totals = Vec::new();
    for k in [0usize, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89] {
        let g = G::new();
        let mut w = g.writer(None);
        let lin = history(&g, &mut w, "a.excalidraw", 130, 20 * 60_000, START);
        let done = gc::retain_with(&g.ctx(end), &lin, &off0, k);
        assert!(done <= k);
        // on disk: every delta's keyframe exists
        let n = verify_all_versions(&g.fx.root);
        assert_eq!(n, 130 - done, "k={k}");
        // and in the index
        let idx = g.vh.read_index();
        let l = idx.lineages.get(&lin).unwrap();
        for e in l.versions.values() {
            if let Some(kf) = e.keyframe_id() {
                assert!(l.versions.contains_key(kf), "k={k}: index delta without keyframe");
            }
        }
        drop(idx);
        // resuming finishes the same job
        gc::retain_with(&g.ctx(end), &lin, &off0, usize::MAX);
        totals.push(g.count());
        verify_all_versions(&g.fx.root);

    }
    // (the writer's keyframe/delta choices differ between vaults, so the totals are not compared)
    assert!(totals.iter().all(|t| *t < 60), "{totals:?}");
}

#[cfg(unix)]
#[test]
fn keyframe_is_never_removed_while_a_delta_references_it_even_if_the_delta_stays_on_disk() {
    let g = G::new();
    let mut w = g.writer(None);
    let end = START + 40 * HOUR_MS;
    let lin = history(&g, &mut w, "a.excalidraw", 130, 20 * 60_000, START);
    // make the first delta undeletable (a read-only file in a read-only folder is not portable): hide
    // it behind a symlink swap instead, so remove_version refuses it ("not a regular file").
    let first_delta = {
        let idx = g.vh.read_index();
        idx.lineages[&lin].versions.values().find(|e| e.keyframe_id().is_some()).unwrap().name.clone()
    };
    let p = g.hist().join(&lin).join(first_delta.format());
    let data = std::fs::read(&p).unwrap();
    std::fs::remove_file(&p).unwrap();
    let elsewhere = g.fx.dir.path().join("elsewhere");
    std::fs::write(&elsewhere, &data).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &p).unwrap();
    let kf = first_delta.kind.clone();
    gc::retain_with(&g.ctx(end), &lin, &off0, usize::MAX);
    assert!(elsewhere.exists(), "never follows a symlink");
    let idx = g.vh.read_index();
    let l = &idx.lineages[&lin];
    if let names::NameKind::Delta(_, key) = kf {
        assert!(l.versions.contains_key(first_delta.id.as_str()), "the delta that could not be unlinked stays indexed");
        assert!(l.versions.contains_key(&key), "so its keyframe stays");
    }
}

#[test]
fn unknown_reason_and_junk_files_are_never_deleted() {
    let g = G::new();
    let mut w = g.writer(None);
    let lin = history(&g, &mut w, "a.excalidraw", 3, 60_000, START);
    // an unknown-code copy of a real keyframe, plus junk
    let real = g.files(&lin).into_iter().find(|f| f.contains(".k")).unwrap();
    let id = names::UlidGen::load(None).next(START - 400 * DAY_MS);
    let unknown = format!("{id}-{}.kz.vdh", g.me);
    std::fs::copy(g.hist().join(&lin).join(&real), g.hist().join(&lin).join(&unknown)).unwrap();
    std::fs::write(g.hist().join(&lin).join("README.txt"), b"x").unwrap();
    std::fs::write(g.hist().join(&lin).join(format!("{id}-{}.kq.vdh.bak", g.me)), b"x").unwrap();
    g.rescan_blobs();
    assert!(g.vh.read_index().lineages[&lin].versions.contains_key(&id));
    let end = START + 500 * DAY_MS;
    gc::retain_with(&g.ctx(end), &lin, &off0, usize::MAX);
    gc::delete_automatic(&g.ctx(end), &lin);
    g.sweep(end);
    assert!(g.hist().join(&lin).join(&unknown).exists(), "unknown reason code is kept by every rule");
    assert!(g.hist().join(&lin).join("README.txt").exists());
}

#[test]
fn own_blobs_go_only_after_an_hour_unreferenced() {
    let g = G::new();
    let mut w = g.writer(None);
    let json = scene(3, 5, 1, 2000).json();
    let (_, lin) = g.put(&mut w, "img.excalidraw", &json, Reason::Auto, START);
    assert_eq!(g.blob_files().len(), 1);
    // referenced: never goes, however many sweeps
    for h in [0u64, 2, 5] {
        g.sweep(START + h * HOUR_MS);
    }
    assert_eq!(g.blob_files().len(), 1);
    // delete the history: the blob is unreferenced from now on
    let now = START + 10 * HOUR_MS;
    gc::delete_lineages(&g.ctx(now), &[lin]).unwrap();
    g.sweep(now);
    assert_eq!(g.blob_files().len(), 1, "first sweep that sees it unreferenced only notes the time");
    g.sweep(now + 59 * 60_000);
    assert_eq!(g.blob_files().len(), 1, "59 minutes");
    g.sweep(now + 61 * 60_000);
    assert!(g.blob_files().is_empty(), "an hour later it goes");
    assert!(g.vh.read_index().blobs.is_empty());
    let shards = std::fs::read_dir(g.hist().join("blobs")).map(|r| r.count()).unwrap_or(0);
    assert_eq!(shards, 0, "the empty shard folder is removed");
}

#[test]
fn a_blob_that_becomes_referenced_again_resets_the_hour() {
    let g = G::new();
    let mut w = g.writer(None);
    let json = scene(3, 5, 1, 2000).json();
    let (_, lin) = g.put(&mut w, "img.excalidraw", &json, Reason::Auto, START);
    gc::delete_lineages(&g.ctx(START), &[lin]).unwrap();
    g.sweep(START + HOUR_MS); // noted unreferenced
    // the same image comes back in a new drawing (new version references the same sha)
    let (_, _lin2) = g.put(&mut w, "other.excalidraw", &json, Reason::Auto, START + HOUR_MS + 1000);
    g.sweep(START + 3 * HOUR_MS);
    assert_eq!(g.blob_files().len(), 1, "referenced again: kept");
}

#[test]
fn unreadable_own_header_blocks_blob_deletes() {
    let g = G::new();
    let mut w = g.writer(None);
    let json = scene(3, 5, 1, 2000).json();
    let (_, lin_img) = g.put(&mut w, "img.excalidraw", &json, Reason::Auto, START);
    let (id2, lin2) = g.put(&mut w, "plain.excalidraw", &scene(4, 5, 0, 0).json(), Reason::Auto, START + 1000);
    gc::delete_lineages(&g.ctx(START), &[lin_img]).unwrap();
    // plain's header becomes unreadable: the image blob could be referenced by it, for all we know
    {
        let mut idx = g.vh.index.write().unwrap();
        idx.lineages.get_mut(&lin2).unwrap().versions.get_mut(&id2).unwrap().head = None;
    }
    let name = g.vh.read_index().lineages[&lin2].versions[&id2].name.format();
    std::fs::write(g.hist().join(&lin2).join(name), b"garbage").unwrap();
    g.sweep(START + 10 * HOUR_MS);
    g.sweep(START + 20 * HOUR_MS);
    assert!(g.vh.gc.lock().unwrap().gc_blocked);
    assert_eq!(g.blob_files().len(), 1, "no own blob is deleted while an own header is unknown");
}

#[test]
fn foreign_blob_takeover_follows_epoch_and_reference_rules() {
    let g = G::new();
    let store: &Store = &g.vh.store;
    store.ensure_layout().unwrap();
    let sha = "ab".repeat(32);
    let other = |epoch: &str| BlobName { sha: sha.clone(), dev: OTHER.into(), epoch: epoch.into(), ext: "png".into() };
    // the device's epochs: an old one and its newest
    store.write_blob(&other("0aaa"), b"x", false).unwrap();
    store.write_blob(&other("0bbb"), b"x", false).unwrap();
    g.rescan_blobs();
    let now = START + 400 * DAY_MS;
    let set_seen = |days: u64| {
        let mut idx = g.vh.index.write().unwrap();
        idx.devices.insert(OTHER.into(), now - days * DAY_MS);
    };
    set_seen(10);
    g.sweep(now);
    assert_eq!(g.blob_files().len(), 2, "seen recently: untouched");
    set_seen(40);
    g.sweep(now);
    let left = g.blob_files();
    assert_eq!(left.len(), 1, "{left:?}");
    assert!(left[0].contains("-0bbb."), "the device's newest epoch stays");
    set_seen(200);
    g.sweep(now);
    assert!(g.blob_files().is_empty(), "dead device: even its newest epoch goes");
}

#[test]
fn foreign_blob_referenced_by_a_known_header_is_kept_even_when_we_hold_a_copy() {
    let g = G::new();
    let mut fw = g.writer(Some(OTHER));
    let json = scene(3, 5, 1, 2000).json();
    let (_, _lin) = g.put(&mut fw, "img.excalidraw", &json, Reason::Auto, START);
    assert_eq!(g.blob_files().len(), 1);
    let now = START + 400 * DAY_MS;
    {
        let mut idx = g.vh.index.write().unwrap();
        idx.devices.insert(OTHER.into(), now - 300 * DAY_MS);
    }
    g.sweep(now);
    assert_eq!(g.blob_files().len(), 1, "the foreign header is the newest version and references the blob");
    // We get our own copy of the same image. The foreign copy still stays (D-H3-8): our copy
    // follows our own headers only and may go once they stop referencing the image.
    let mut mw = g.writer(None);
    g.put(&mut mw, "mine.excalidraw", &json, Reason::Auto, now - 1000);
    // (our blob has the same sha: own + foreign copies)
    assert_eq!(g.blob_files().len(), 2);
    g.sweep(now);
    let left = g.blob_files();
    assert_eq!(left.len(), 2, "{left:?}");
    assert!(left.iter().any(|f| f.contains(&format!("-{OTHER}-"))), "the referenced foreign copy stays");
}

#[test]
fn foreign_keyframe_takeover_on_real_files_and_protection_when_seen() {
    let g = G::new();
    let mut fw = g.writer(Some(OTHER));
    let lin = history(&g, &mut fw, "a.excalidraw", 3, 60_000, START);
    // the foreign device wrote again much later (so it "moved past" the keyframe), in the same lineage
    let mut sc = scene(9, 20, 0, 0);
    sc.edit();
    g.put(&mut fw, "a.excalidraw", &sc.json(), Reason::Auto, START + 20 * DAY_MS);
    let mine = g.put(&mut g.writer(None), "a.excalidraw", &scene(11, 20, 0, 0).json(), Reason::Auto, START + 90 * DAY_MS).0;
    let now = START + 120 * DAY_MS;
    let foreign_kfs = |g: &G| g.files(&lin).iter().filter(|f| f.contains(&format!("-{OTHER}.k"))).count();
    let before = foreign_kfs(&g);
    assert!(before >= 1);
    {
        let mut idx = g.vh.index.write().unwrap();
        idx.devices.insert(OTHER.into(), now - 5 * DAY_MS);
    }
    gc::retain_with(&g.ctx(now), &lin, &off0, usize::MAX);
    assert_eq!(foreign_kfs(&g), before, "recently seen: foreign keyframes stay");
    {
        let mut idx = g.vh.index.write().unwrap();
        idx.devices.insert(OTHER.into(), now - 45 * DAY_MS);
    }
    gc::retain_with(&g.ctx(now), &lin, &off0, usize::MAX);
    assert!(foreign_kfs(&g) < before, "unseen 45 d, files older than 30 d, device moved on: taken over");
    assert!(g.files(&lin).iter().any(|f| f.starts_with(&mine)), "our newest version stays");
    verify_all_versions(&g.fx.root);
}

#[test]
fn cap_order_and_over_cap_values() {
    // Two big drawings, two keyframes each (8 days apart forces a new keyframe).
    let big = |seed: u64| scene(seed, BIG, 0, 0).json();
    let mut g = G::new();
    let mut w = g.writer(None);
    for (i, p) in ["a.excalidraw", "b.excalidraw"].iter().enumerate() {
        g.put(&mut w, p, &big(10 + i as u64), Reason::Auto, START);
    }
    for (i, p) in ["a.excalidraw", "b.excalidraw"].iter().enumerate() {
        g.put(&mut w, p, &big(20 + i as u64), Reason::Auto, START + 8 * DAY_MS);
    }
    let total = g.vh.read_index().total_bytes();
    assert_eq!(g.count(), 4);
    let now = START + 9 * DAY_MS;
    // cap far above: nothing happens, over_cap none
    g.settings.size_cap_mb = 500;
    g.sweep(now);
    assert_eq!((g.count(), g.vh.gc.lock().unwrap().over_cap), (4, "none"));
    // cap at 1 MB < total (each keyframe ~ >300 KB): the OLD keyframes go first, oldest first
    assert!(total > 1024 * 1024, "{total}");
    g.settings.size_cap_mb = 1;
    g.sweep(now);
    let idx = g.vh.read_index();
    let remaining: Vec<_> = idx.lineages.values().flat_map(|l| l.versions.values()).map(|e| e.name.time_ms()).collect();
    drop(idx);
    assert!(remaining.iter().all(|t| *t >= START + 8 * DAY_MS) || g.count() == 4, "only the older keyframes were candidates");
    assert!(g.count() >= 2, "each lineage keeps its newest version");
    let total_after = g.vh.read_index().total_bytes();
    let over = g.vh.gc.lock().unwrap().over_cap;
    if total_after <= 1024 * 1024 {
        assert_eq!(over, "none");
    } else {
        assert_eq!(over, "other-devices");
    }
    verify_all_versions(&g.fx.root);
}

#[test]
fn over_cap_checkpoints_and_other_devices() {
    let big = |seed: u64| scene(seed, BIG, 0, 0).json();
    // checkpoints alone exceed the cap
    let mut g = G::new();
    let mut w = g.writer(None);
    for (i, d) in (0..4u64).enumerate() {
        g.put(&mut w, &format!("c{i}.excalidraw"), &big(30 + d), Reason::Checkpoint, START + d * 1000);
    }
    g.settings.size_cap_mb = 1;
    g.sweep(START + HOUR_MS);
    assert_eq!(g.count(), 4, "checkpoints are never deleted by the cap");
    assert_eq!(g.vh.gc.lock().unwrap().over_cap, "checkpoints");
    // foreign data keeps us over
    let mut g = G::new();
    let mut fw = g.writer(Some(OTHER));
    for i in 0..4u64 {
        g.put(&mut fw, &format!("f{i}.excalidraw"), &big(40 + i), Reason::Auto, START + i * 1000);
    }
    g.settings.size_cap_mb = 1;
    g.sweep(START + HOUR_MS);
    assert_eq!(g.count(), 4);
    assert_eq!(g.vh.gc.lock().unwrap().over_cap, "other-devices");
}

#[test]
fn delete_checkpoint_only_deletes_checkpoints() {
    let g = G::new();
    let mut w = g.writer(None);
    let sc = scene(1, 20, 0, 0);
    let (auto_id, lin) = g.put(&mut w, "a.excalidraw", &sc.json(), Reason::Auto, START);
    let mut sc2 = sc.clone();
    sc2.edit();
    let (cp, _) = g.put(&mut w, "a.excalidraw", &sc2.json(), Reason::Checkpoint, START + 1000);
    let mut sc3 = sc2.clone();
    sc3.edit();
    g.put(&mut w, "a.excalidraw", &sc3.json(), Reason::Auto, START + 2000);
    let ctx = g.ctx(START + 3000);
    assert_eq!(gc::delete_checkpoint(&ctx, &auto_id).unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(gc::delete_checkpoint(&ctx, "not-a-ulid").unwrap_err().code, "INVALID_ARGUMENT");
    assert!(g.files(&lin).iter().any(|f| f.starts_with(&auto_id)));
    gc::delete_checkpoint(&ctx, &cp).unwrap();
    assert!(!g.files(&lin).iter().any(|f| f.starts_with(&cp)));
    assert!(g.vh.read_index().entry(&cp).is_none());
    assert_eq!(verify_all_versions(&g.fx.root), 2);
    assert_eq!(gc::delete_checkpoint(&ctx, &cp).unwrap_err().code, "VERSION_GONE");
}

#[test]
fn delete_checkpoint_refuses_when_a_delta_references_it() {
    let g = G::new();
    let mut w = g.writer(None);
    let (cp, lin) = g.put(&mut w, "a.excalidraw", &scene(1, 20, 0, 0).json(), Reason::Checkpoint, START);
    // a (forged) index entry of a delta against the checkpoint keyframe
    {
        let mut idx = g.vh.index.write().unwrap();
        let name = names::VersionName { id: names::UlidGen::load(None).next(START + 5000), dev: g.me.clone(), kind: names::NameKind::Delta(Reason::Auto, cp.clone()) };
        idx.insert(&lin, index::Entry { name, size: 10, dataless: false, head: None }, START);
    }
    assert_eq!(gc::delete_checkpoint(&g.ctx(START), &cp).unwrap_err().code, "INVALID_ARGUMENT");
    assert!(g.files(&lin).iter().any(|f| f.starts_with(&cp)));
}

#[test]
fn delete_all_removes_every_lineage_of_the_path_including_hidden_and_checkpoints() {
    let g = G::new();
    let mut w = g.writer(None);
    let lin1 = history(&g, &mut w, "a.excalidraw", 4, 60_000, START);
    let (_, _) = g.put(&mut w, "a.excalidraw", &scene(5, 20, 0, 0).json(), Reason::Checkpoint, START + 10 * 60_000);
    // hide lineage 1 (trashed): the next write starts a second lineage for the same path
    g.vh.index.write().unwrap().set_hidden(&lin1, true);
    let (_, lin2) = g.put(&mut w, "a.excalidraw", &scene(6, 20, 0, 0).json(), Reason::Checkpoint, START + 20 * 60_000);
    assert_ne!(lin1, lin2);
    // a foreign device's file and an unknown file in lineage 2
    let mut fw = g.writer(Some(OTHER));
    g.put(&mut fw, "a.excalidraw", &scene(99, 20, 0, 0).json(), Reason::Auto, START + 30 * 60_000);
    std::fs::write(g.hist().join(&lin2).join("notes.txt"), b"keep me").unwrap();
    // another drawing is untouched
    let (_, other_lin) = g.put(&mut w, "b.excalidraw", &scene(8, 20, 0, 0).json(), Reason::Checkpoint, START + 40 * 60_000);
    let gone = gc::delete_all(&g.ctx(START + HOUR_MS), "a.excalidraw").unwrap();
    assert_eq!(gone.len(), 2);
    assert!(g.vh.read_index().lineages.get(&lin1).is_none() && g.vh.read_index().lineages.get(&lin2).is_none());
    assert!(!g.hist().join(&lin1).exists(), "empty folder removed");
    assert!(g.hist().join(&lin2).join("notes.txt").exists(), "unknown files are never deleted");
    assert!(g.files(&lin2).is_empty());
    assert_eq!(g.files(&other_lin).len(), 1);
    assert_eq!(verify_all_versions(&g.fx.root), 1);
    assert!(g.vh.notifier.lock().unwrap().paths.contains("a.excalidraw"));
    assert_eq!(gc::delete_all(&g.ctx(START), "../evil").unwrap_err().code, "INVALID_PATH");
    assert!(gc::delete_all(&g.ctx(START), "nothing.excalidraw").unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn delete_lineages_validates_ids_and_refuses_symlinked_folders() {
    let g = G::new();
    let mut w = g.writer(None);
    let (_, lin) = g.put(&mut w, "a.excalidraw", &scene(1, 20, 0, 0).json(), Reason::Checkpoint, START);
    assert_eq!(gc::delete_lineages(&g.ctx(START), &["../x".into()]).unwrap_err().code, "INVALID_ARGUMENT");
    gc::delete_lineages(&g.ctx(START), &[lin.clone()]).unwrap();
    assert!(!g.hist().join(&lin).exists());
    gc::delete_lineages(&g.ctx(START), &[lin]).unwrap(); // already gone: fine
    // a lineage folder that is a symlink: refused, the target is untouched
    let outside = g.fx.dir.path().join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    let ulid = names::UlidGen::load(None).next(START);
    let victim = format!("{ulid}-{}.ka.vdh", g.me);
    std::fs::write(outside.join(&victim), b"precious").unwrap();
    std::os::unix::fs::symlink(&outside, g.hist().join(&ulid)).unwrap();
    assert!(gc::delete_lineages(&g.ctx(START), &[ulid]).is_err());
    assert!(outside.join(victim).exists());
}

#[test]
fn orphan_sweep_deletes_automatic_versions_but_keeps_checkpoints_and_what_they_need() {
    let g = G::new();
    let mut w = g.writer(None);
    let mut sc = scene(1, 20, 0, 0);
    let mut put = |reason, t| {
        sc.edit();
        g.put(&mut w, "gone.excalidraw", &sc.json(), reason, t)
    };
    let (a1, lin) = put(Reason::Auto, START);
    let (a2, _) = put(Reason::Auto, START + 1000);
    let (cp, _) = put(Reason::Checkpoint, START + 2000);
    let (a3, _) = put(Reason::Auto, START + 3000);
    let n = gc::delete_automatic(&g.ctx(START + 40 * DAY_MS), &lin);
    let left = g.files(&lin);
    assert!(left.iter().any(|f| f.starts_with(&cp)), "checkpoint stays");
    for id in [&a2, &a3] {
        assert!(!left.iter().any(|f| f.starts_with(id.as_str())), "automatic delta {id} goes");
    }
    assert_eq!(n + left.len(), 4);
    // whatever the checkpoint needs to decode is still there
    assert_eq!(verify_all_versions(&g.fx.root), left.len());
    let _ = a1;
}

#[test]
fn sweep_runs_in_small_steps_and_matches_the_one_shot_result() {
    let g = G::new();
    let mut w = g.writer(None);
    let end = START + 40 * HOUR_MS;
    for p in ["a.excalidraw", "b.excalidraw", "c.excalidraw"] {
        history(&g, &mut w, p, 60, 30 * 60_000, START);
    }
    let ctx = g.ctx(end);
    let mut s = Sweep::new(&ctx);
    let mut steps = 0;
    while !s.step_with(&ctx, Duration::ZERO, &off0) {
        steps += 1;
        assert!(steps < 100_000);
    }
    assert!(steps > 3, "zero budget means one unit per step");
    let after = g.count();
    assert!(after < 3 * 60);
    assert_eq!(verify_all_versions(&g.fx.root), after);
    // a second sweep has nothing left to do
    g.sweep(end);
    assert_eq!(g.count(), after);
    // the status the panel reads
    assert_eq!(g.vh.gc.lock().unwrap().over_cap, "none");
    assert!(!g.vh.gc.lock().unwrap().gc_blocked);
}

#[test]
fn heads_of_own_entries_are_loaded_by_the_sweep() {
    let g = G::new();
    let mut w = g.writer(None);
    let lin = history(&g, &mut w, "a.excalidraw", 5, 60_000, START);
    {
        let mut idx = g.vh.index.write().unwrap();
        for e in idx.lineages.get_mut(&lin).unwrap().versions.values_mut() {
            e.head = None;
        }
    }
    g.sweep(START + 100 * 60_000);
    let idx = g.vh.read_index();
    assert!(idx.lineages[&lin].versions.values().all(|e| e.head.is_some()));
    assert!(!g.vh.gc.lock().unwrap().gc_blocked);
}

#[test]
fn clock_skew_on_one_device_never_loses_its_files() {
    // +40 d device: future ULIDs. -40 d device: old ULIDs, seen just now.
    let g = G::new();
    let now = START + 100 * DAY_MS;
    let mut ahead = g.writer(Some(OTHER));
    let lin = history_seed(&g, &mut ahead, "a.excalidraw", 3, 60_000, now + 40 * DAY_MS, 21);
    let mut behind = g.writer(Some("c3d4e5f6"));
    history_seed(&g, &mut behind, "a.excalidraw", 3, 60_000, now - 40 * DAY_MS, 22);
    {
        let mut idx = g.vh.index.write().unwrap();
        idx.devices.insert(OTHER.into(), now - 200 * DAY_MS); // unseen for ages, by local observation
        idx.devices.insert("c3d4e5f6".into(), now - 60_000); // seen a minute ago
    }
    let before = g.files(&lin);
    gc::retain_with(&g.ctx(now), &lin, &off0, usize::MAX);
    let after = g.files(&lin);
    for dev in [OTHER, "c3d4e5f6"] {
        let kfs = |v: &[String]| v.iter().filter(|f| f.contains(&format!("-{dev}.k"))).count();
        assert_eq!(kfs(&before), kfs(&after), "keyframes of {dev} stay");
    }
    verify_all_versions(&g.fx.root);
}
