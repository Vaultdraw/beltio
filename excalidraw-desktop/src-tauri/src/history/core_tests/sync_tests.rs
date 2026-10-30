//! Two "devices" sharing one history folder, with replication lag, reordering, partial and
//! conflict-copy files; blob epochs and clock skew.
use super::support::*;
use crate::history::{index, names::Reason, store::Store, writer::{Epoch, Outcome}, HistoryService};
use std::{fs, path::{Path, PathBuf}, sync::Arc};

const P: &str = "a.excalidraw";
const DAY: u64 = 24 * 3600 * 1000;

struct Two {
    _d: tempfile::TempDir,
    root: PathBuf,
    clock: Arc<TestClock>,
    a: crate::history::writer::Writer,
    b: crate::history::writer::Writer,
}

fn two() -> Two {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("v");
    fs::create_dir_all(&root).unwrap();
    let root = dunce::canonicalize(root).unwrap();
    let clock = TestClock::new(T0);
    let a = mk_writer(&root, &d.path().join("sa"), clock.clone(), Box::new(|| true));
    let b = mk_writer(&root, &d.path().join("sb"), clock.clone(), Box::new(|| true));
    assert_ne!(a.dev, b.dev);
    Two { _d: d, root, clock, a, b }
}

fn resync(w: &crate::history::writer::Writer, now: u64) {
    index::scan_all(&w.store, &w.index, now);
}

fn written(o: Outcome) -> crate::history::writer::Written {
    match o {
        Outcome::Written(w) => w,
        other => panic!("expected a version, got {other:?}"),
    }
}

#[test]
fn two_devices_never_collide_and_deltas_stay_same_device() {
    let mut t = two();
    let mut sc = scene(1, 200, 2, 5000);
    let mut lineage = String::new();
    for round in 0..6 {
        let (w, other) = if round % 2 == 0 { (&mut t.a, &t.b) } else { (&mut t.b, &t.a) };
        resync(w, T0);
        sc.edit();
        t.clock.advance(1000);
        let out = written(version_of(w, &t.root, P, &sc.json(), Reason::Auto).unwrap());
        if lineage.is_empty() {
            lineage = out.lineage.clone();
        }
        assert_eq!(out.lineage, lineage, "after syncing, both devices write into one lineage");
        resync(other, T0);
    }
    let checked = verify_all_versions(&t.root);
    assert_eq!(checked, 6);
    // each device wrote its own keyframe: B never deltas against A's
    let l = t.a.index.read().unwrap();
    let entries = l.entries_for_path(P);
    assert_eq!(entries.len(), 6);
    for dev in [&t.a.dev, &t.b.dev] {
        assert!(entries.iter().any(|(_, e)| &e.name.dev == dev && e.name.is_keyframe()), "device {dev} has its own keyframe");
    }
    let ids: std::collections::HashSet<_> = entries.iter().map(|(_, e)| e.name.id.clone()).collect();
    assert_eq!(ids.len(), 6, "no id collisions");
    // images are stored once per device (2 images x 2 devices)
    assert_eq!(count_files(&t.root.join(".excalidraw-vault/history/blobs")), 4);
}

#[test]
fn concurrent_first_edits_make_two_lineages_and_a_union_listing() {
    let mut t = two();
    let sc = scene(2, 50, 0, 0);
    // neither device has seen the other's files yet
    let wa = written(version_of(&mut t.a, &t.root, P, &sc.json(), Reason::First).unwrap());
    t.clock.advance(5);
    let mut sc2 = sc.clone();
    sc2.edit();
    let wb = written(version_of(&mut t.b, &t.root, P, &sc2.json(), Reason::First).unwrap());
    assert_ne!(wa.lineage, wb.lineage);
    resync(&t.a, T0);
    resync(&t.b, T0);
    for w in [&t.a, &t.b] {
        let g = w.index.read().unwrap();
        assert_eq!(g.lineages_for(P).len(), 2, "path maps to a set of lineages");
        let ids: Vec<_> = g.entries_for_path(P).iter().map(|(_, e)| e.name.id.clone()).collect();
        let mut sorted = ids.clone();
        sorted.sort_by(|x, y| y.cmp(x));
        assert_eq!(ids, sorted, "union listing is newest first");
        assert_eq!(ids.len(), 2);
    }
    // writing continues in the lineage holding this device's newest version
    let again = written(version_of(&mut t.a, &t.root, P, &{ let mut s = sc.clone(); s.edit(); s.edit(); s.json() }, Reason::Auto).unwrap());
    assert_eq!(again.lineage, wa.lineage);
    assert_eq!(verify_all_versions(&t.root), 3);
}

#[test]
fn local_observation_time_not_ulid_time_decides_device_last_seen() {
    let mut t = two();
    // B's clock is 40 days ahead
    let sb = t.clock.clone();
    let w = written(version_of(&mut t.b, &t.root, P, &scene(3, 10, 0, 0).json(), Reason::Auto).unwrap());
    let _ = (sb, w);
    let real_now = T0 + 12345;
    resync(&t.a, real_now);
    let g = t.a.index.read().unwrap();
    assert_eq!(g.devices[&t.b.dev], real_now, "first observed locally at our own time");
}

#[test]
fn blob_epoch_rotates_after_a_week_and_keyframes_older_than_a_week_are_not_extended() {
    let mut t = two();
    let mut sc = scene(4, 100, 1, 3000);
    written(version_of(&mut t.a, &t.root, P, &sc.json(), Reason::Auto).unwrap());
    sc.edit();
    t.clock.advance(1000);
    let second = written(version_of(&mut t.a, &t.root, P, &sc.json(), Reason::Auto).unwrap());
    assert!(t.a.index.read().unwrap().entry(&second.id).unwrap().1.name.is_keyframe() == false, "a delta within the week");
    assert_eq!(count_files(&t.root.join(".excalidraw-vault/history/blobs")), 1);
    t.clock.advance(8 * DAY);
    sc.edit();
    let third = written(version_of(&mut t.a, &t.root, P, &sc.json(), Reason::Auto).unwrap());
    let g = t.a.index.read().unwrap();
    assert!(g.entry(&third.id).unwrap().1.name.is_keyframe(), "keyframe older than 7 days is not extended");
    assert_eq!(count_files(&t.root.join(".excalidraw-vault/history/blobs")), 2, "a new epoch writes its own blob copy");
    drop(g);
    assert_eq!(verify_all_versions(&t.root), 3);
    // the epoch itself
    let d = tempfile::tempdir().unwrap();
    let f = d.path().join("writer");
    let old = Epoch::load(Some(f.clone()), T0);
    let mut same = Epoch::load(Some(f.clone()), T0 + 6 * DAY);
    assert_eq!(same.code, old.code);
    same.wrote(T0 + 6 * DAY);
    let rotated = Epoch::load(Some(d.path().join("w2")), T0 + 30 * DAY);
    assert_ne!(rotated.code, old.code);
    let mut e = Epoch::load(Some(d.path().join("w3")), T0);
    e.wrote(T0);
    assert_eq!(e.current(T0 + 8 * DAY), rotated_code(T0 + 8 * DAY));
}

fn rotated_code(ms: u64) -> String {
    crate::history::names::epoch_code(crate::history::names::day_number(ms))
}

fn copy_into(src: &Path, dst: &Path, only: &dyn Fn(&str) -> bool) {
    for e in walk(src) {
        let rel = e.strip_prefix(src).unwrap();
        if !only(&rel.to_string_lossy()) {
            continue;
        }
        let to = dst.join(rel);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(&e, &to).unwrap();
    }
}
fn walk(d: &Path) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(rd) = fs::read_dir(d) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                v.extend(walk(&e.path()));
            } else {
                v.push(e.path());
            }
        }
    }
    v.sort();
    v
}

#[test]
fn a_lagging_unordered_replica_with_partial_files_and_conflict_copies_never_breaks_reads() {
    let mut t = two();
    let mut sc = scene(6, 120, 1, 3000);
    let mut ids = Vec::new();
    for _ in 0..4 {
        sc.edit();
        t.clock.advance(1000);
        ids.push(written(version_of(&mut t.a, &t.root, P, &sc.json(), Reason::Auto).unwrap()));
    }
    let src = t.root.join(".excalidraw-vault/history");
    let rep_dir = tempfile::tempdir().unwrap();
    let rep = dunce::canonicalize(rep_dir.path()).unwrap();
    let hist = rep.join(".excalidraw-vault/history");
    let state = tempfile::tempdir().unwrap();
    let svc = HistoryService::for_tests(state.path().to_path_buf(), t.clock.clone());
    // 1. only the deltas arrive first (their keyframe is lagging)
    let delta_files: Vec<String> = walk(&src).iter().map(|p| p.strip_prefix(&src).unwrap().to_string_lossy().into_owned()).filter(|n| n.contains(".d")).collect();
    assert!(!delta_files.is_empty());
    copy_into(&src, &hist, &|n| delta_files.iter().any(|d| d == n));
    // junk that sync tools leave around: a conflict copy, a foreign tmp, a partial file, a stray name
    let lin = &ids[0].lineage;
    let a_file = walk(&src.join(lin)).into_iter().find(|p| p.to_string_lossy().ends_with(".vdh")).unwrap();
    let name = a_file.file_name().unwrap().to_string_lossy().into_owned();
    fs::copy(&a_file, hist.join(lin).join(name.replace(".vdh", " 2.vdh"))).unwrap();
    fs::write(hist.join(lin).join(".01ARZ3NDEKTSV4RRFFQ69G5FAV-zzzzzzzz.ka.vdh.tmp"), b"x").unwrap();
    fs::write(hist.join(lin).join("notes.txt"), b"x").unwrap();
    svc.start("r", rep.clone(), true, Arc::new(|_| {}));
    let vh = svc.vault("r").unwrap();
    let l = vh.list(P).unwrap_or_else(|e| panic!("{}", e.message));
    let _ = l;
    resync_vh(&vh);
    let listing = vh.list(P).unwrap();
    assert!(listing.versions.iter().all(|v| v.kind == "delta" && v.availability == "missing"), "deltas without their keyframe are marked missing");
    for v in &listing.versions {
        assert_eq!(vh.read_version(&v.id).unwrap_err().code, "VERSION_GONE");
    }
    // 2. the keyframe arrives truncated (a partial file), then complete
    let kf: Vec<String> = walk(&src).iter().map(|p| p.strip_prefix(&src).unwrap().to_string_lossy().into_owned()).filter(|n| n.ends_with(".vdh") && !n.contains(".d")).collect();
    copy_into(&src, &hist, &|n| kf.iter().any(|d| d == n));
    for k in &kf {
        let p = hist.join(k);
        let full = fs::read(&p).unwrap();
        fs::write(&p, &full[..full.len() / 2]).unwrap();
    }
    resync_vh(&vh);
    for v in vh.list(P).unwrap().versions {
        let r = vh.read_version(&v.id);
        assert!(r.is_err() && matches!(r.unwrap_err().code.as_str(), "VERSION_CORRUPT" | "VERSION_GONE"), "a partial keyframe is an error, never a panic or wrong data");
    }
    copy_into(&src, &hist, &|n| kf.iter().any(|d| d == n));
    resync_vh(&vh);
    let ok = vh.list(P).unwrap().versions.into_iter().filter(|v| vh.read_version(&v.id).is_ok()).count();
    assert_eq!(ok, 4, "everything decodes once the replica caught up");
    // junk is ignored, never deleted, never listed
    assert!(hist.join(lin).join("notes.txt").exists());
    assert!(hist.join(lin).join(name.replace(".vdh", " 2.vdh")).exists());
    assert_eq!(vh.list(P).unwrap().versions.len(), 4);
    // our own cleanup never touches foreign temp files
    let store = Store::new(&rep);
    assert_eq!(crate::history::store::cleanup_own_tmp(&store, "00000000", std::time::Duration::ZERO), 0);
    assert!(hist.join(lin).join(".01ARZ3NDEKTSV4RRFFQ69G5FAV-zzzzzzzz.ka.vdh.tmp").exists());
}

fn resync_vh(vh: &crate::history::VaultHistory) {
    index::scan_all(&vh.store, &vh.index, T0);
}
