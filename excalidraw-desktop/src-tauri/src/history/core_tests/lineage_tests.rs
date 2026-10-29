//! H3 lineage tests (owner: agent I): in-app moves, relink after outside renames (M9), trash
//! (N1), orphans, `lineages.json`. Real worker thread, real files. See PLAN-H3.md §4.4.
use super::support::*;
use crate::history::{codec, lineage, names::Reason, staging, worker::rebase, writer::Clock};
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

pub(super) const A: &str = "a.excalidraw";
pub(super) const B: &str = "b.excalidraw";
const DAY: u64 = 24 * 3600 * 1000;

pub(super) fn save_exp(fx: &Fx, rel: &str, json: &str, expected: Option<&str>) -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let _g = fx.vault.mutation.lock().unwrap();
    let op = format!("lin{}", N.fetch_add(1, Ordering::Relaxed));
    let out = crate::write_drawing_file(&fx.vault, rel, json, expected, &op).unwrap();
    let rev = out["revision"].as_str().unwrap().to_string();
    fx.svc.after_commit("h", rel, &rev, json.len() as u64);
    rev
}

pub(super) fn disk_rev(fx: &Fx, rel: &str) -> String {
    crate::current_revision(&fx.root.join(rel)).unwrap().unwrap()
}

/// Bytes of version `id` exactly as saved (stripped text with blobs inlined).
pub(super) fn exact(fx: &Fx, id: &str) -> Vec<u8> {
    let vh = fx.vh();
    let raw = vh.read_version(id).unwrap_or_else(|e| panic!("{}: {}", e.code, e.message));
    let nl = raw.iter().position(|b| *b == b'\n').unwrap();
    codec::inline(&raw[nl + 1..], &|t| vh.read_blob(t)).unwrap()
}

/// Number of path records on disk.
pub(super) fn path_records(fx: &Fx) -> usize {
    fn walk(d: &std::path::Path) -> usize {
        fs::read_dir(d).map(|rd| rd.flatten().map(|e| if e.path().is_dir() { walk(&e.path()) } else { usize::from(e.file_name().to_string_lossy().ends_with(".pm.vdh")) }).sum()).unwrap_or(0)
    }
    walk(&fx.hist_dir())
}

/// Delivers a watcher batch and waits until the worker has processed everything queued so far.
pub(super) fn watch(fx: &Fx, paths: &[&str]) {
    let v: Vec<String> = paths.iter().map(|p| p.to_string()).collect();
    fx.svc.watched("h", &v, &[], false);
    fx.barrier();
}

/// Saves `rel` (seed), opens it, edits and saves again, versions the result: two versions
/// (the open-time state and the edit). Leaves the drawing closed. Returns (lineage, newest bytes).
pub(super) fn make_history(fx: &Fx, rel: &str, seed: u64) -> (String, String) {
    let mut sc = scene(seed, 40, 0, 0);
    fx.save(rel, &sc.json());
    fx.open(Some(rel));
    sc.edit();
    let json = sc.json();
    fx.save(rel, &json);
    assert!(fx.vh().snapshot(rel, "before-restore", true).unwrap().id.is_some());
    fx.open(None);
    let lins = fx.vh().list(rel).unwrap().lineages;
    assert_eq!(lins.len(), 1);
    assert_eq!(fx.versions(rel).len(), 2);
    (lins[0].clone(), json)
}

const Z: &str = "z.excalidraw";
const Z2: &str = "z2.excalidraw";

/// A history that IS relinked (Finder rename of `z`): once `z2` has its versions the relink pass
/// has resolved every other orphan too, so "nothing relinked" assertions are deterministic.
pub(super) fn control_rename(fx: &Fx) {
    make_history(fx, Z, 77);
    fs::rename(fx.root.join(Z), fx.root.join(Z2)).unwrap();
}

pub(super) fn wait_control(fx: &Fx) {
    wait_for("control relink", || fx.versions(Z2).len() == 2);
}

#[test]
fn rebase_handles_files_folders_boundaries_and_case_folding() {
    assert_eq!(rebase("a.excalidraw", "a.excalidraw", "b.excalidraw", false).as_deref(), Some("b.excalidraw"));
    assert_eq!(rebase("d/x.excalidraw", "d", "e", false).as_deref(), Some("e/x.excalidraw"));
    assert_eq!(rebase("d/s/x.excalidraw", "d", "e/f", false).as_deref(), Some("e/f/s/x.excalidraw"));
    assert_eq!(rebase("dd/x.excalidraw", "d", "e", false), None);
    assert_eq!(rebase("d.excalidraw", "d", "e", false), None);
    assert_eq!(rebase("D/X.excalidraw", "d", "e", true).as_deref(), Some("e/X.excalidraw"));
    assert_eq!(rebase("D/X.excalidraw", "d", "e", false), None);
}

#[test]
fn in_app_rename_keeps_the_lineage_and_later_versions_land_in_it() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fx.svc.moved("h", A, B);
    fx.barrier();
    assert_eq!(fx.versions(B).len(), 2, "listing follows the move");
    assert!(fx.versions(A).is_empty());
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin.clone()]);
    assert_eq!(path_records(&fx), 1);
    let rec = fs::read_dir(fx.hist_dir().join(&lin)).unwrap().flatten().find(|e| e.file_name().to_string_lossy().ends_with(".pm.vdh")).unwrap();
    let header = crate::history::container::read_header(&fs::read(rec.path()).unwrap()).unwrap();
    assert_eq!((header.kind.as_str(), header.reason.as_str(), header.path.as_str()), ("path", "moved", B));
    assert!(header.file_revision.is_empty() && header.stripped_hash.is_empty());
    // A version after the move lands in the same lineage.
    fx.open(Some(B));
    let mut sc = scene(5, 40, 0, 0);
    sc.edit();
    save_exp(&fx, B, &sc.json(), Some(&disk_rev(&fx, B)));
    assert!(fx.vh().snapshot(B, "before-restore", true).unwrap().id.is_some());
    assert_eq!(fx.versions(B).len(), 3);
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin]);
    // A plain version adds no path record; retention may drop the one it supersedes (PLAN-H3 4.2).
    assert!(path_records(&fx) <= 1, "no new path record for a plain version");
    // ... also after a restart (the path record is read back from disk)
    fx.svc.stop("h");
    fx.start_configured(5);
    fx.barrier();
    assert_eq!(fx.versions(B).len(), 3);
}

#[test]
fn folder_move_records_every_lineage_under_it_and_nothing_else() {
    let fx = Fx::new();
    fx.start_configured(5);
    for d in ["d", "dd"] {
        fs::create_dir(fx.root.join(d)).unwrap();
    }
    let (lx, _) = make_history(&fx, "d/x.excalidraw", 1);
    let (ly, _) = make_history(&fx, "d/y.excalidraw", 2);
    let (lz, _) = make_history(&fx, "dd/z.excalidraw", 3);
    fs::rename(fx.root.join("d"), fx.root.join("e")).unwrap();
    fx.svc.moved("h", "d", "e");
    fx.barrier();
    assert_eq!(fx.vh().list("e/x.excalidraw").unwrap().lineages, vec![lx]);
    assert_eq!(fx.vh().list("e/y.excalidraw").unwrap().lineages, vec![ly]);
    assert_eq!(fx.versions("e/x.excalidraw").len(), 2);
    assert!(fx.versions("d/x.excalidraw").is_empty());
    assert_eq!(fx.vh().list("dd/z.excalidraw").unwrap().lineages, vec![lz], "a sibling that merely shares the prefix is untouched");
    assert_eq!(path_records(&fx), 2);
}

#[test]
fn crash_survivor_after_a_move_lands_in_the_moved_lineage() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json1) = make_history(&fx, A, 1);
    fx.open(Some(A));
    let mut sc = scene(9, 40, 0, 0);
    sc.edit();
    let json2 = sc.json();
    save_exp(&fx, A, &json2, Some(&disk_rev(&fx, A)));
    assert_ne!(json1, json2);
    fx.barrier();
    assert_eq!(fx.staged_files().len(), 1, "pending clone");
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fx.svc.moved("h", A, B);
    fx.barrier();
    let staged = fx.staged_files();
    let key = staging::key_for(B, fx.vh().flags.fold.load(Ordering::Relaxed));
    assert!(staged.len() == 1 && staged[0].starts_with(&key), "clone follows the move: {staged:?}");
    let sidecar = fs::read_to_string(fx.vh().staged_dir.join(format!("{key}.path"))).unwrap();
    assert_eq!(sidecar, B);
    // "Crash": stop without versioning, restart.
    fx.svc.stop("h");
    fx.start_configured(5);
    wait_for("survivor version", || fx.versions(B).len() == 3);
    assert!(fx.versions(A).is_empty());
    let newest = fx.versions(B).remove(0);
    assert_eq!(newest.reason, Reason::Recovered.as_str());
    assert_eq!(exact(&fx, &newest.id), json2.as_bytes());
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin]);
}

#[test]
fn finder_rename_of_a_closed_drawing_relinks_once() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fx.svc.watched("h", &[A.to_string(), B.to_string()], &[], false);
    wait_for("relink", || fx.versions(B).len() == 2);
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin]);
    assert!(fx.versions(A).is_empty());
    assert_eq!(path_records(&fx), 1);
    // Further events change nothing.
    watch(&fx, &[A, B]);
    watch(&fx, &[B]);
    assert_eq!(path_records(&fx), 1, "relinked once");
}

#[test]
fn finder_rename_while_open_versions_the_pending_state_and_relinks() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    fx.open(Some(A));
    let mut sc = scene(11, 40, 0, 0);
    sc.edit();
    let json2 = sc.json();
    save_exp(&fx, A, &json2, Some(&disk_rev(&fx, A)));
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fx.svc.watched("h", &[A.to_string(), B.to_string()], &[], false);
    wait_for("relink after pending", || fx.versions(B).len() == 3);
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin]);
    assert_eq!(exact(&fx, &fx.versions(B)[0].id), json2.as_bytes(), "the unversioned edit was kept");
    assert_eq!(path_records(&fx), 1);
    assert!(fx.staged_files().is_empty());
}

#[test]
fn finder_rename_while_the_app_was_closed_relinks_at_startup() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    fx.svc.stop("h");
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fx.start_configured(5);
    wait_for("startup relink", || fx.versions(B).len() == 2);
    assert_eq!(fx.vh().list(B).unwrap().lineages, vec![lin]);
    assert_eq!(path_records(&fx), 1);
}

#[test]
fn finder_copy_keeps_an_empty_history() {
    let fx = Fx::new();
    fx.start_configured(5);
    make_history(&fx, A, 1);
    fs::copy(fx.root.join(A), fx.root.join("c.excalidraw")).unwrap();
    watch(&fx, &["c.excalidraw"]);
    assert!(fx.versions("c.excalidraw").is_empty());
    assert_eq!(fx.versions(A).len(), 2);
    assert_eq!(path_records(&fx), 0);
    assert!(!lineage::has_orphans(&fx.vh()));
}

#[test]
fn identical_blank_drawings_do_not_relink() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json) = make_history(&fx, A, 5);
    fs::remove_file(fx.root.join(A)).unwrap();
    fs::write(fx.root.join(B), &json).unwrap();
    fs::write(fx.root.join("c.excalidraw"), &json).unwrap();
    control_rename(&fx);
    watch(&fx, &[A, B, "c.excalidraw", Z, Z2]);
    wait_control(&fx);
    assert!(fx.versions(B).is_empty() && fx.versions("c.excalidraw").is_empty(), "two candidates: ambiguous");
    assert_eq!(fx.versions(A).len(), 2, "history stays with its path");
    assert_eq!(fx.vh().list(A).unwrap().lineages, vec![lin]);
    assert_eq!(path_records(&fx), 1, "only the control relinked");
}

#[test]
fn renaming_one_of_two_identical_files_does_not_relink() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (_, json) = make_history(&fx, A, 5);
    fs::write(fx.root.join(B), &json).unwrap();
    fs::rename(fx.root.join(A), fx.root.join("c.excalidraw")).unwrap();
    control_rename(&fx);
    watch(&fx, &[A, "c.excalidraw", B, Z, Z2]);
    wait_control(&fx);
    assert!(fx.versions("c.excalidraw").is_empty() && fx.versions(B).is_empty());
    assert_eq!(path_records(&fx), 1);
}

#[test]
fn rename_plus_edit_starts_a_new_lineage() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = make_history(&fx, A, 1);
    fs::rename(fx.root.join(A), fx.root.join(B)).unwrap();
    fs::write(fx.root.join(B), scene(42, 15, 0, 0).json()).unwrap();
    control_rename(&fx);
    watch(&fx, &[A, B, Z, Z2]);
    wait_control(&fx);
    assert!(fx.versions(B).is_empty(), "different content: no relink");
    fx.open(Some(B));
    let mut sc = scene(43, 15, 0, 0);
    sc.edit();
    save_exp(&fx, B, &sc.json(), Some(&disk_rev(&fx, B)));
    assert!(fx.vh().snapshot(B, "before-restore", true).unwrap().id.is_some());
    let lins = fx.vh().list(B).unwrap().lineages;
    assert_eq!(lins.len(), 1);
    assert_ne!(lins[0], lin, "a new lineage; the old one stays orphaned under its old path");
    assert_eq!(fx.versions(A).len(), 2);
}

/// make_history + an unversioned pending edit, returning (lineage, bytes of an old version).
fn history_with_pending(fx: &Fx) -> (String, String) {
    let (lin, json1) = make_history(fx, A, 1);
    fx.open(Some(A));
    let mut sc = scene(21, 40, 0, 0);
    sc.edit();
    save_exp(fx, A, &sc.json(), Some(&disk_rev(fx, A)));
    (lin, json1)
}

fn all_versions(fx: &Fx, lin: &str) -> usize {
    fx.vh().read_index().lineages.get(lin).map_or(0, |l| l.versions.values().filter(|e| !e.is_path_record()).count())
}

#[test]
fn trash_hides_the_history_and_put_back_within_seven_days_reattaches_it() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json1) = history_with_pending(&fx);
    fs::remove_file(fx.root.join(A)).unwrap();
    fx.svc.trashed("h", A);
    fx.barrier();
    assert!(fx.versions(A).is_empty(), "hidden");
    assert_eq!(fx.vh().read_index().all_lineages_for(A), vec![lin.as_str()]);
    assert_eq!(all_versions(&fx, &lin), 3, "the pending state was versioned before hiding");
    assert!(fx.staged_files().is_empty());
    assert!(fs::read_to_string(fx.vh().vault_state.join("lineages.json")).unwrap().contains(&lin));
    // Put Back, three days later: the bytes are the revision of an old version.
    fx.clock.advance(3 * DAY);
    fs::write(fx.root.join(A), &json1).unwrap();
    watch(&fx, &[A]);
    // Three days on, the daily sweep may thin the automatic versions (retention), and it runs in
    // background slices whose pace follows the wall clock: count what survived, not a fixed 3
    // (toimprove 119: the fixed count held only while the sweep had not run yet).
    assert_eq!(fx.vh().list(A).unwrap().lineages, vec![lin.clone()], "re-attached");
    let kept = all_versions(&fx, &lin);
    assert!(kept >= 1, "the history survived the put-back");
    assert_eq!(fx.versions(A).len(), kept, "every kept version is listed again");
    fx.barrier();
    assert!(!fs::read_to_string(fx.vh().vault_state.join("lineages.json")).unwrap().contains(&lin));
    assert!(lineage::sweep_inputs(&fx.vh(), fx.clock.now_ms() + 30 * DAY).trash_expired.is_empty());
}

#[test]
fn put_back_after_seven_days_does_not_reattach_and_expiry_is_reported() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json1) = history_with_pending(&fx);
    fs::remove_file(fx.root.join(A)).unwrap();
    fx.svc.trashed("h", A);
    fx.barrier();
    let now = fx.clock.now_ms();
    assert!(lineage::sweep_inputs(&fx.vh(), now + 6 * DAY).trash_expired.is_empty());
    assert_eq!(lineage::sweep_inputs(&fx.vh(), now + 7 * DAY).trash_expired, vec![lin.clone()]);
    assert!(lineage::sweep_inputs(&fx.vh(), now + 60 * DAY).orphaned.is_empty(), "a trashed lineage is not an orphan");
    fx.clock.advance(8 * DAY);
    fs::write(fx.root.join(A), &json1).unwrap();
    watch(&fx, &[A]);
    assert!(fx.versions(A).is_empty(), "the window is over");
    // GC reports it and forgets it afterwards.
    lineage::forget(&fx.vh(), &[lin]);
    assert!(lineage::sweep_inputs(&fx.vh(), fx.clock.now_ms()).trash_expired.is_empty());
}

#[test]
fn a_different_new_file_at_a_trashed_path_gets_a_fresh_lineage() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, _) = history_with_pending(&fx);
    fs::remove_file(fx.root.join(A)).unwrap();
    fx.svc.trashed("h", A);
    fx.barrier();
    fx.open(None);
    save_exp(&fx, A, &scene(99, 12, 0, 0).json(), None);
    assert!(fx.vh().snapshot(A, "leave", true).unwrap().id.is_some());
    watch(&fx, &[A]);
    let lins = fx.vh().list(A).unwrap().lineages;
    assert_eq!(lins.len(), 1);
    assert_ne!(lins[0], lin);
    assert_eq!(fx.versions(A).len(), 1);
    assert_eq!(all_versions(&fx, &lin), 3, "the trashed history is untouched");
    let now = fx.clock.now_ms();
    assert_eq!(lineage::sweep_inputs(&fx.vh(), now + 8 * DAY).trash_expired, vec![lin]);
}

#[test]
fn trash_marks_survive_a_restart_and_a_put_back_while_closed_reattaches() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json1) = history_with_pending(&fx);
    fs::remove_file(fx.root.join(A)).unwrap();
    fx.svc.trashed("h", A);
    fx.barrier();
    fx.svc.stop("h");
    fx.start_configured(5);
    fx.barrier();
    assert!(fx.versions(A).is_empty(), "still hidden after a restart");
    fx.svc.stop("h");
    fx.clock.advance(2 * DAY);
    fs::write(fx.root.join(A), &json1).unwrap();
    fx.start_configured(5);
    wait_for("startup re-attach", || fx.versions(A).len() == 3);
    assert_eq!(fx.vh().list(A).unwrap().lineages, vec![lin]);
}

#[test]
fn orphan_since_is_kept_at_the_earliest_and_cleared_when_the_file_returns() {
    let fx = Fx::new();
    fx.start_configured(5);
    let (lin, json) = make_history(&fx, A, 1);
    fx.svc.stop("h");
    fs::remove_file(fx.root.join(A)).unwrap();
    let t0 = fx.clock.now_ms();
    fx.start_configured(5);
    wait_for("orphan marked", || lineage::has_orphans(&fx.vh()));
    assert!(lineage::sweep_inputs(&fx.vh(), t0 + 29 * DAY).orphaned.is_empty());
    assert_eq!(lineage::sweep_inputs(&fx.vh(), t0 + 31 * DAY).orphaned, vec![lin.clone()]);
    // Another launch five days later keeps the first observation.
    fx.svc.stop("h");
    fx.clock.advance(5 * DAY);
    fx.start_configured(5);
    fx.barrier();
    wait_for("second orphan pass", || lineage::has_orphans(&fx.vh()));
    assert_eq!(lineage::sweep_inputs(&fx.vh(), t0 + 31 * DAY).orphaned, vec![lin]);
    // The file comes back: no longer an orphan.
    fx.svc.stop("h");
    fs::write(fx.root.join(A), json).unwrap();
    fx.start_configured(5);
    wait_for("orphan cleared", || !lineage::has_orphans(&fx.vh()));
}

#[test]
fn watcher_removal_marks_the_orphan_without_waiting_for_the_daily_pass() {
    let fx = Fx::new();
    fx.start_configured(5);
    make_history(&fx, A, 1);
    fx.barrier();
    fs::remove_file(fx.root.join(A)).unwrap();
    watch(&fx, &[A]);
    assert!(lineage::has_orphans(&fx.vh()));
    // forget() drops the state of removed lineages
    let lins = fx.vh().list(A).unwrap().lineages;
    lineage::forget(&fx.vh(), &lins);
    assert!(!lineage::has_orphans(&fx.vh()));
}

#[test]
fn a_damaged_or_hostile_lineages_file_is_ignored() {
    let fx = Fx::new();
    fx.start_configured(5);
    make_history(&fx, A, 1);
    let state = fx.vh().vault_state.join("lineages.json");
    fx.svc.stop("h");
    fs::write(&state, b"{ not json").unwrap();
    fx.start_configured(5);
    fx.barrier();
    assert_eq!(fx.versions(A).len(), 2);
    fx.svc.stop("h");
    fs::write(&state, br#"{"trash":{"../../x":{"path":"/etc/passwd","at":1},"not-a-ulid":{"path":"a.excalidraw","at":1}},"orphanSince":{"zz":5}}"#).unwrap();
    fx.start_configured(5);
    fx.barrier();
    let si = lineage::sweep_inputs(&fx.vh(), u64::MAX / 2);
    assert!(si.orphaned.is_empty() && si.trash_expired.is_empty());
    assert_eq!(fx.versions(A).len(), 2);
}
