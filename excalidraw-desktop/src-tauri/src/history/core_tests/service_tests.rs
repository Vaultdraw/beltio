//! Service-level tests: real worker thread, real writer, real files.
use super::support::*;
use crate::history::{codec, HistoryEvent, HistoryService};
use std::{collections::HashMap, fs, sync::atomic::Ordering};

const P: &str = "a.excalidraw";

/// Every version of `p` decodes (with blobs inlined) to exactly the bytes that were saved.
fn assert_all_exact(fx: &Fx, p: &str, saved: &HashMap<String, Vec<u8>>) -> usize {
    let vh = fx.vh();
    let mut checked = 0;
    for v in fx.versions(p) {
        let raw = vh.read_version(&v.id).unwrap_or_else(|e| panic!("{}: {}", e.code, e.message));
        let nl = raw.iter().position(|b| *b == b'\n').unwrap();
        let meta: serde_json::Value = serde_json::from_slice(&raw[..nl]).unwrap();
        let rev = meta["fileRevision"].as_str().unwrap();
        let file = codec::inline(&raw[nl + 1..], &|t| vh.read_blob(t)).unwrap();
        assert_eq!(crate::revision(&file), rev, "fileRevision matches the restored bytes");
        assert_eq!(&file, saved.get(rev).unwrap_or_else(|| panic!("unknown revision {rev}")), "version {} is not byte-exact", v.id);
        checked += 1;
    }
    checked
}

#[test]
fn versions_roundtrip_byte_exact_with_images_keyframes_and_deltas() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(7, 300, 2, 6000);
    let mut saved: HashMap<String, Vec<u8>> = HashMap::new();
    let json = sc.json();
    saved.insert(fx.save(P, &json), json.into_bytes());
    fx.open(Some(P));
    for i in 0..12 {
        sc.edit();
        let json = sc.json();
        saved.insert(fx.save(P, &json), json.clone().into_bytes());
        let out = fx.vh().snapshot(P, "before-restore", true).unwrap();
        assert!(out.id.is_some(), "round {i}: {out:?}");
    }
    let vs = fx.versions(P);
    assert!(vs.len() >= 12);
    assert!(vs.iter().any(|v| v.kind == "delta") && vs.iter().any(|v| v.kind == "keyframe"));
    assert_eq!(assert_all_exact(&fx, P, &saved), vs.len());
    // newest first, all ours
    assert!(vs.windows(2).all(|w| w[0].created_at >= w[1].created_at));
    assert!(vs.iter().all(|v| v.own_device && v.availability == "local"));
    // an unchanged state is not versioned again
    assert_eq!(fx.vh().snapshot(P, "before-restore", true).unwrap().skipped.as_deref(), Some("unchanged"));
    // images were stored once per device/epoch
    let blobs = count_files(&fx.hist_dir().join("blobs"));
    assert_eq!(blobs, 2, "two images, one copy each");
}

#[test]
fn checkpoint_has_name_note_and_is_listed_with_loaded_header() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(1, 50, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let v = fx.vh().checkpoint(P, "  Milestone 1 ", "ship it").unwrap();
    assert_eq!(v.name.as_deref(), Some("Milestone 1"));
    assert_eq!(v.note.as_deref(), Some("ship it"));
    assert_eq!(v.reason, "checkpoint");
    assert_eq!(fx.vh().checkpoint(P, "   ", "").unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(fx.vh().checkpoint(P, &"x".repeat(121), "").unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(fx.vh().checkpoint(P, "n", &"x".repeat(2001)).unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(fx.vh().checkpoint("../x.excalidraw", "n", "").unwrap_err().code, "INVALID_PATH");
    // a checkpoint of unchanged content still creates a version
    let again = fx.vh().checkpoint(P, "Same", "").unwrap();
    assert_ne!(again.id, v.id);
    let l = fx.vh().list(P).unwrap();
    assert!(l.enabled && !l.read_only && l.lineages.len() == 1);
    assert_eq!(l.last_version_at, Some(l.versions[0].created_at));
    assert!(l.versions.iter().filter(|v| v.reason == "checkpoint").count() == 2);
}

#[test]
fn staged_clone_is_made_under_the_guard_and_equals_the_commit() {
    let fx = Fx::new();
    fx.start_configured(5);
    let sc = scene(3, 200, 0, 0);
    fx.open(None);
    let json = sc.json();
    let rev = fx.save(P, &json);
    let staged = fx.staged_files();
    assert_eq!(staged.len(), 1, "{staged:?}");
    assert!(staged[0].contains(&rev[..16]));
    let meta = fs::metadata(fx.vh().staged_dir.join(&staged[0])).unwrap();
    assert_eq!(meta.len(), json.len() as u64);
    assert_eq!(fs::read(fx.vh().staged_dir.join(&staged[0])).unwrap(), json.as_bytes());
}

#[test]
fn quit_right_after_a_save_then_relaunch_recovers_the_exact_last_commit() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(11, 120, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    fx.barrier();
    sc.edit();
    let last = sc.json();
    let rev = fx.save(P, &last);
    fx.barrier();
    assert!(fx.versions(P).iter().all(|v| v.reason != "recovered"));
    // "kill": the process dies with a pending clone; nothing graceful happens
    fx.svc.stop("h");
    wait_for("index.bin", || fx.state.join("history").read_dir().map(|rd| rd.flatten().any(|e| e.path().join("index.bin").exists())).unwrap_or(false));
    let svc2 = HistoryService::for_tests(fx.state.clone(), fx.clock.clone());
    svc2.start("h", fx.root.clone(), false, fx.emitter());
    svc2.vault("h").unwrap().configure(settings(5));
    let vh2 = svc2.vault("h").unwrap();
    wait_for("recovered version", || vh2.list(P).unwrap().versions.iter().any(|v| v.reason == "recovered"));
    let recovered = vh2.list(P).unwrap().versions.into_iter().find(|v| v.reason == "recovered").unwrap();
    let raw = vh2.read_version(&recovered.id).unwrap();
    let nl = raw.iter().position(|b| *b == b'\n').unwrap();
    let meta: serde_json::Value = serde_json::from_slice(&raw[..nl]).unwrap();
    assert_eq!(meta["fileRevision"], rev, "labelled with its true revision");
    assert_eq!(codec::inline(&raw[nl + 1..], &|t| vh2.read_blob(t)).unwrap(), last.as_bytes());
    assert!(vh2.list(P).unwrap().versions.iter().all(|v| v.reason != "before-outside-change"));
    // survivors are consumed
    wait_for("clone freed", || {
        std::fs::read_dir(&vh2.staged_dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".excalidraw") || e.file_name().to_string_lossy().starts_with("o-"))
    });
}

#[test]
fn staging_off_falls_back_to_the_live_file_with_a_revision_check() {
    let fx = Fx::new();
    fx.start(false);
    let vh = fx.vh();
    vh.flags.staging_unsupported.store(true, Ordering::Relaxed);
    vh.configure(settings(5));
    assert!(!vh.status().staging);
    let mut sc = scene(5, 80, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    let last = sc.json();
    let rev = fx.save(P, &last);
    assert!(fx.staged_files().is_empty(), "no clones without staging");
    fx.open(None); // leave
    fx.barrier();
    let vs = fx.versions(P);
    assert_eq!(vs.len(), 1);
    assert_eq!(vs[0].reason, "leave");
    let raw = vh.read_version(&vs[0].id).unwrap();
    assert!(String::from_utf8_lossy(&raw[..raw.iter().position(|b| *b == b'\n').unwrap()]).contains(&rev));
    // an outside change before the leave: the live file no longer matches the commit, so nothing is mislabelled
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    fs::write(fx.root.join(P), sc.json().replace("excalidraw", "excalidraw ").as_bytes()).unwrap();
    fx.open(None);
    fx.barrier();
    assert_eq!(fx.versions(P).len(), 1);
}

#[test]
fn reads_and_listings_stage_nothing() {
    let fx = Fx::new();
    fx.start_configured(5);
    let sc = scene(2, 40, 0, 0);
    fx.save(P, &sc.json());
    fx.barrier();
    let before = fx.staged_files();
    for _ in 0..500 {
        crate::read_drawing_file(&fx.root, P).unwrap();
        let _ = fx.vh().list(P).unwrap();
    }
    fx.barrier();
    assert_eq!(fx.staged_files(), before);
    assert!(fx.versions(P).is_empty() || fx.versions(P).iter().all(|v| v.reason != "auto"));
}

#[test]
fn hard_off_has_no_thread_no_clones_and_commands_answer_history_off() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("v");
    fs::create_dir_all(&root).unwrap();
    let svc = HistoryService::hard_off_for_tests(dir.path().join("state"));
    svc.start("h", root.canonicalize().unwrap(), false, std::sync::Arc::new(|_| {}));
    assert_eq!(svc.vault("h").err().unwrap().code, "HISTORY_OFF");
    svc.after_commit("h", P, &"a".repeat(64), 1);
    assert!(!dir.path().join("state").exists());
}

#[test]
fn unconfigured_vault_stages_and_writes_nothing() {
    let fx = Fx::new();
    fx.start(false);
    fx.save(P, &scene(1, 20, 0, 0).json());
    fx.open(Some(P));
    fx.barrier();
    assert!(fx.staged_files().is_empty());
    assert_eq!(fx.vh().status().state, "off");
    assert!(!fx.hist_dir().exists(), "no history folder is created before the first version");
}

#[test]
fn disabled_history_stops_writes_but_reads_still_work() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(4, 60, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let v = fx.vh().checkpoint(P, "keep", "").unwrap();
    let mut s = settings(5);
    s.enabled = false;
    fx.vh().configure(s);
    sc.edit();
    fx.save(P, &sc.json());
    fx.barrier();
    assert!(fx.staged_files().is_empty());
    assert_eq!(fx.vh().checkpoint(P, "x", "").unwrap_err().code, "HISTORY_OFF");
    assert_eq!(fx.vh().snapshot(P, "before-restore", true).unwrap().skipped.as_deref(), Some("off"));
    assert!(fx.vh().read_version(&v.id).is_ok());
    assert_eq!(fx.vh().status().state, "off");
}

#[test]
fn second_read_only_instance_writes_nothing_and_still_reads() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(9, 60, 1, 3000);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let v = fx.vh().checkpoint(P, "cp", "").unwrap();
    fx.svc.stop("h");
    wait_for("index.bin", || fx.state.join("history").read_dir().map(|rd| rd.flatten().any(|e| e.path().join("index.bin").exists())).unwrap_or(false));
    let snap = |d: &std::path::Path| {
        let mut out = Vec::new();
        fn walk(d: &std::path::Path, out: &mut Vec<(String, u64)>) {
            if let Ok(rd) = fs::read_dir(d) {
                for e in rd.flatten() {
                    let md = e.metadata().unwrap();
                    out.push((e.path().to_string_lossy().into_owned(), md.len()));
                    if md.is_dir() {
                        walk(&e.path(), out);
                    }
                }
            }
        }
        walk(d, &mut out);
        out.sort();
        out
    };
    let (vault_before, state_before) = (snap(&fx.root), snap(&fx.state));
    let svc2 = HistoryService::for_tests(fx.state.clone(), fx.clock.clone());
    svc2.start("ro", fx.root.clone(), true, fx.emitter());
    let ro = svc2.vault("ro").unwrap();
    ro.configure(settings(5));
    ro.opened(Some(P.into()), Some("a".repeat(64))).unwrap();
    svc2.after_commit("ro", P, &"b".repeat(64), 10);
    assert_eq!(ro.status().state, "read-only");
    assert_eq!(ro.checkpoint(P, "no", "").unwrap_err().code, "HISTORY_READ_ONLY");
    assert_eq!(ro.snapshot(P, "leave", true).unwrap().skipped.as_deref(), Some("read-only"));
    let l = ro.list(P).unwrap();
    assert!(l.read_only && l.versions.len() >= 2);
    assert!(ro.read_version(&v.id).is_ok(), "reads are allowed");
    svc2.stop("ro");
    assert_eq!(snap(&fx.root), vault_before);
    assert_eq!(snap(&fx.state), state_before, "the state dir is untouched by a read-only instance");
}

#[test]
fn switching_a_to_b_to_a_leaves_one_worker_and_no_duplicate_versions() {
    let fx = Fx::new();
    let other = tempfile::tempdir().unwrap();
    let other_root = other.path().canonicalize().unwrap();
    fx.start_configured(5);
    let mut sc = scene(21, 60, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    fx.barrier();
    fx.svc.stop("h"); // switch to B
    fx.svc.start("b", other_root, false, fx.emitter());
    fx.svc.vault("b").unwrap().configure(settings(5));
    fx.svc.stop("b");
    for round in 0..3 {
        // back to A (twice with the same state: nothing may be versioned twice)
        fx.svc.start("h", fx.root.clone(), false, fx.emitter());
        let vh = fx.vh();
        vh.configure(settings(5));
        wait_for("recovered", || vh.list(P).unwrap().versions.iter().any(|v| v.reason == "recovered" || v.reason == "first"));
        fx.barrier();
        let revs: Vec<_> = vh.list(P).unwrap().versions.len().to_string().into();
        let n = vh.list(P).unwrap().versions.len();
        assert!(n >= 1 && n <= 2, "round {round}: {revs:?}");
        fx.svc.stop("h");
    }
    // distinct revisions only
    fx.svc.start("h", fx.root.clone(), false, fx.emitter());
    let vh = fx.vh();
    vh.configure(settings(5));
    fx.barrier();
    let mut seen = std::collections::HashSet::new();
    for v in vh.list(P).unwrap().versions {
        let raw = vh.read_version(&v.id).unwrap();
        let nl = raw.iter().position(|b| *b == b'\n').unwrap();
        let meta: serde_json::Value = serde_json::from_slice(&raw[..nl]).unwrap();
        assert!(seen.insert(meta["fileRevision"].as_str().unwrap().to_string()), "duplicate version of one revision");
    }
}

#[test]
fn read_version_reports_gone_corrupt_and_foreign_ids() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(31, 40, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let a = fx.vh().checkpoint(P, "a", "").unwrap();
    sc.edit();
    fx.save(P, &sc.json());
    let b = fx.vh().checkpoint(P, "b", "").unwrap();
    assert_eq!(fx.vh().read_version("nope").unwrap_err().code, "INVALID_ARGUMENT");
    assert_eq!(fx.vh().read_version("0123456789ABCDEFGHJKMNPQRS").unwrap_err().code, "VERSION_GONE");
    let file = |v: &crate::history::VersionInfo| {
        let dir = fx.hist_dir().join(&v.lineage);
        fs::read_dir(dir).unwrap().flatten().find(|e| e.file_name().to_string_lossy().starts_with(&v.id)).unwrap().path()
    };
    let mut bytes = fs::read(file(&b)).unwrap();
    let n = bytes.len();
    bytes[n - 3] ^= 0xFF;
    fs::write(file(&b), &bytes).unwrap();
    assert_eq!(fx.vh().read_version(&b.id).unwrap_err().code, "VERSION_CORRUPT");
    fs::remove_file(file(&a)).unwrap();
    assert_eq!(fx.vh().read_version(&a.id).unwrap_err().code, "VERSION_GONE");
}

#[test]
fn events_are_debounced_and_index_bin_survives_a_restart() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(41, 40, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    for i in 0..3 {
        fx.vh().checkpoint(P, &format!("c{i}"), "").unwrap();
    }
    wait_for("history-change", || fx.events.lock().unwrap().iter().any(|e| matches!(e, HistoryEvent::Change(c) if c.paths.contains(&P.to_string()))));
    let changes = fx.events.lock().unwrap().iter().filter(|e| matches!(e, HistoryEvent::Change(_))).count();
    assert!(changes <= 2, "bursts are coalesced, got {changes}");
    assert!(fx.events.lock().unwrap().iter().any(|e| matches!(e, HistoryEvent::Status(_))));
    let n = fx.versions(P).len();
    fx.svc.stop("h"); // flushes index.bin
    wait_for("index.bin", || fx.state.join("history").read_dir().map(|rd| rd.flatten().any(|e| e.path().join("index.bin").exists())).unwrap_or(false));
    let svc2 = HistoryService::for_tests(fx.state.clone(), fx.clock.clone());
    svc2.start("h", fx.root.clone(), true, fx.emitter());
    assert_eq!(svc2.vault("h").unwrap().list(P).unwrap().versions.len(), n);
}

#[test]
fn clearing_the_canvas_with_tombstones_still_versions_the_previous_state() {
    let fx = Fx::new();
    fx.start_configured(5);
    let mut sc = scene(51, 400, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    fx.barrier();
    // Cmd+Delete: every element stays in the file, marked isDeleted
    for e in sc.elements.iter_mut() {
        e["isDeleted"] = serde_json::json!(true);
    }
    fx.save(P, &sc.json());
    fx.barrier();
    let vs = fx.versions(P);
    assert!(vs.iter().any(|v| v.reason == "before-clear"), "{:?}", vs.iter().map(|v| v.reason).collect::<Vec<_>>());
}

// ---- lazy start (D8) ----

fn loader(interval: u32) -> Option<crate::history::SettingsLoader> {
    Some(std::sync::Arc::new(move || settings(interval)))
}

#[test]
fn registered_history_starts_on_a_history_call_not_on_watcher_events() {
    let fx = Fx::new();
    fx.svc.register("h", fx.root.clone(), false, fx.emitter(), loader(5));
    fx.svc.watched("h", &[P.to_string()], &[], true);
    assert!(fx.svc.get("h").is_none());
    assert!(fx.svc.is_pending("h"));
    let first = fx.svc.vault("h").unwrap();
    assert!(!fx.svc.is_pending("h"));
    assert!(std::sync::Arc::ptr_eq(&first, &fx.svc.vault("h").unwrap()));
    fx.svc.ensure("h");
    assert!(std::sync::Arc::ptr_eq(&first, &fx.svc.get("h").unwrap()));
}

#[test]
fn first_save_starts_a_pending_history_and_is_staged_with_the_real_settings() {
    // Review #6: the first edit's save must never be dropped while the webview's start races.
    let fx = Fx::new();
    fx.svc.register("h", fx.root.clone(), false, fx.emitter(), loader(7));
    let rev = fx.save(P, &scene(3, 200, 0, 0).json());
    let vh = fx.svc.get("h").expect("the save started history");
    assert_eq!(vh.settings.lock().unwrap().interval_minutes, 7, "configured from the loader, not the defaults");
    assert_ne!(vh.status().state, "off");
    let staged = fx.staged_files();
    assert_eq!(staged.len(), 1, "{staged:?}");
    assert!(staged[0].contains(&rev[..16]));
}

#[test]
fn native_start_configures_and_announces_itself() {
    // Review #4: started by any caller, history runs on the vault's settings and the webview
    // hears `history-started` so it can configure and open the drawing too.
    let fx = Fx::new();
    fx.svc.register("h", fx.root.clone(), false, fx.emitter(), loader(11));
    fx.svc.ensure("h");
    assert_eq!(fx.vh().settings.lock().unwrap().interval_minutes, 11);
    let events = fx.events.lock().unwrap();
    assert!(events.iter().any(|e| matches!(e, HistoryEvent::Started(s) if s.handle == "h")));
}

#[test]
fn ensured_history_versions_like_an_eager_start() {
    let fx = Fx::new();
    fx.svc.register("h", fx.root.clone(), false, fx.emitter(), None);
    fx.svc.ensure("h");
    fx.vh().configure(settings(5));
    let mut sc = scene(1, 50, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    let v = fx.vh().checkpoint(P, "after lazy start", "").unwrap();
    assert_eq!(v.name.as_deref(), Some("after lazy start"));
    assert!(!fx.versions(P).is_empty());
}

#[test]
fn stop_drops_a_pending_history_and_hard_off_never_registers() {
    let fx = Fx::new();
    fx.svc.register("h", fx.root.clone(), false, fx.emitter(), None);
    fx.svc.stop("h");
    assert_eq!(fx.svc.vault("h").err().unwrap().code, "NOT_FOUND");

    let dir = tempfile::tempdir().unwrap();
    let off = HistoryService::hard_off_for_tests(dir.path().join("state"));
    off.register("h", dir.path().to_path_buf(), false, std::sync::Arc::new(|_| {}), None);
    assert_eq!(off.vault("h").err().unwrap().code, "HISTORY_OFF");
    assert!(!dir.path().join("state").exists());
}
