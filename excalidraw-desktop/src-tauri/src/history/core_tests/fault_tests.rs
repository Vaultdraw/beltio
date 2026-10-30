//! ENOSPC / fault injection at every durable step, and 50 random SIGKILLs of a writer process.
use super::support::*;
use crate::history::{
    names::Reason,
    store::{self, fault, FaultKind, Step},
    writer::Outcome,
};
use std::{fs, path::Path, process::Command, sync::{atomic::{AtomicBool, Ordering}, Arc}};

const P: &str = "a.excalidraw";

fn vault() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("v");
    let state = d.path().join("s");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&state).unwrap();
    let root = dunce::canonicalize(root).unwrap();
    (d, root, state)
}

fn visible_versions(root: &Path) -> usize {
    let mut n = 0;
    if let Ok(rd) = fs::read_dir(root.join(".excalidraw-vault/history")) {
        for l in rd.flatten().filter(|l| l.path().is_dir() && l.file_name().to_string_lossy().len() == 26) {
            n += fs::read_dir(l.path()).unwrap().flatten().filter(|f| f.file_name().to_string_lossy().ends_with(".vdh")).count();
        }
    }
    n
}

#[test]
fn enospc_at_every_step_leaves_nothing_partial_and_a_retry_succeeds() {
    for step in [Step::BlobTmp, Step::BlobSync, Step::BlobRename, Step::VersionTmp, Step::VersionSync, Step::VersionRename] {
        let (_d, root, state) = vault();
        let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
        let json = scene(3, 50, 1, 4000).json();
        fault::arm(step, 0, FaultKind::Enospc);
        let out = version_of(&mut w, &root, P, &json, Reason::Checkpoint).unwrap();
        fault::clear();
        assert_eq!(out, Outcome::DiskLow, "{step:?}");
        assert_eq!(visible_versions(&root), 0, "{step:?}: nothing partial is visible");
        assert!(tmp_files(&root).is_empty(), "{step:?}: no temp file left");
        assert!(w.index.read().unwrap().is_empty(), "{step:?}: index untouched");
        let again = version_of(&mut w, &root, P, &json, Reason::Checkpoint).unwrap();
        assert!(matches!(again, Outcome::Written(_)), "{step:?}: retry");
        assert_eq!(verify_all_versions(&root), 1);
    }
    // a failing directory fsync happens after the rename: the file is complete, never partial
    let (_d, root, state) = vault();
    let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
    fault::arm(Step::DirSync, 0, FaultKind::Enospc);
    let _ = version_of(&mut w, &root, P, &scene(3, 20, 0, 0).json(), Reason::Checkpoint).unwrap();
    fault::clear();
    assert!(verify_all_versions(&root) <= 1);
}

#[test]
fn other_io_errors_are_history_errors_not_disk_low() {
    let (_d, root, state) = vault();
    let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
    fault::arm(Step::VersionRename, 0, FaultKind::Io);
    let e = version_of(&mut w, &root, P, &scene(3, 20, 0, 0).json(), Reason::Auto).unwrap_err();
    fault::clear();
    assert_eq!(e.code, "IO_ERROR");
    assert_eq!(visible_versions(&root), 0);
}

#[test]
fn clone_enospc_never_fails_the_save_and_raises_disk_low() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let json = scene(8, 40, 0, 0).json();
    fault::arm(Step::Clone, 0, FaultKind::Enospc);
    let rev = fx.save(P, &json); // would panic if the save failed
    fault::clear();
    assert_eq!(crate::current_revision(&fx.root.join(P)).unwrap().unwrap(), rev);
    assert!(fx.staged_files().is_empty());
    let st = fx.vh().status();
    assert_eq!(st.state, "error");
    assert_eq!(st.last_error.unwrap().code, "HISTORY_DISK_LOW");
    // no further clones while disk-low
    fx.save(P, &scene(9, 40, 0, 0).json());
    assert!(fx.staged_files().is_empty());
}

#[test]
fn low_free_space_skips_writes_keeps_pending_and_recovers() {
    let fx = Fx::new();
    let ok = Arc::new(AtomicBool::new(true));
    let probe = ok.clone();
    fx.svc.set_free_probe(Arc::new(move || probe.load(Ordering::SeqCst)));
    fx.start_configured(5);
    let mut sc = scene(12, 60, 0, 0);
    fx.save(P, &sc.json());
    fx.open(Some(P));
    sc.edit();
    fx.save(P, &sc.json());
    fx.barrier();
    let n = fx.versions(P).len();
    ok.store(false, Ordering::SeqCst);
    assert_eq!(fx.vh().checkpoint(P, "no room", "").unwrap_err().code, "HISTORY_DISK_LOW");
    assert_eq!(fx.versions(P).len(), n, "nothing written below the floor");
    assert_eq!(fx.vh().status().last_error.unwrap().code, "HISTORY_DISK_LOW");
    assert!(fx.vh().flags.disk_low.load(Ordering::SeqCst), "the save path skips cloning now");
    sc.edit();
    let json = sc.json();
    fx.save(P, &json); // the save itself is unaffected
    fx.barrier();
    assert!(fx.staged_files().is_empty(), "{:?}", fx.staged_files());
    ok.store(true, Ordering::SeqCst);
    // the pending state is still versioned from the live file once space returns
    let v = fx.vh().checkpoint(P, "room again", "").unwrap();
    assert_eq!(v.reason, "checkpoint");
    assert!(fx.vh().status().last_error.is_none());
    assert!(!fx.vh().flags.disk_low.load(Ordering::SeqCst));
}

#[test]
fn crash_at_every_step_leaves_only_complete_versions_and_cleans_its_tmp() {
    for step in [Step::BlobTmp, Step::BlobSync, Step::BlobRename, Step::VersionTmp, Step::VersionSync, Step::VersionRename, Step::DirSync] {
        let (_d, root, state) = vault();
        let clock = TestClock::new(T0);
        let mut sc = scene(5, 80, 1, 3000);
        {
            let mut w = mk_writer(&root, &state, clock.clone(), Box::new(|| true));
            assert!(matches!(version_of(&mut w, &root, P, &sc.json(), Reason::Checkpoint).unwrap(), Outcome::Written(_)));
            sc.edit();
            fault::arm(step, 0, FaultKind::Crash);
            let _ = version_of(&mut w, &root, P, &sc.json(), Reason::Checkpoint);
            fault::clear();
        }
        // "relaunch"
        let before = tmp_files(&root).len();
        let w2 = mk_writer(&root, &state, clock.clone(), Box::new(|| true));
        let removed = store::cleanup_own_tmp(&w2.store, &w2.dev, std::time::Duration::ZERO);
        assert_eq!(removed, before, "{step:?}");
        assert!(tmp_files(&root).is_empty());
        assert!(verify_all_versions(&root) >= 1, "{step:?}");
        let mut w2 = w2;
        assert!(matches!(version_of(&mut w2, &root, P, &sc.json(), Reason::Auto).unwrap(), Outcome::Written(_) | Outcome::Skipped("unchanged")));
        verify_all_versions(&root);
    }
}

/// Child side of the SIGKILL test: loops writing versions until it is killed (no-op normally).
#[test]
fn kill_child() {
    let (Ok(dir), Ok(seed)) = (std::env::var("HIST_KILL_DIR"), std::env::var("HIST_KILL_SEED")) else { return };
    let base = Path::new(&dir);
    let (root, state) = (base.join("v"), base.join("s"));
    let mut w = mk_writer(&root, &state, Arc::new(crate::history::SystemClock), Box::new(|| true));
    let mut sc = scene(seed.parse::<u64>().unwrap() * 7919 + 1, 150, 1, 3000);
    let t0 = std::time::Instant::now();
    while t0.elapsed() < std::time::Duration::from_secs(60) {
        sc.edit();
        let _ = version_of(&mut w, &root, P, &sc.json(), if sc.rng.below(4) == 0 { Reason::Leave } else { Reason::Auto });
    }
}

#[cfg(unix)]
#[test]
fn fifty_random_sigkills_of_a_writer_leave_every_visible_version_exact() {
    let d = tempfile::tempdir().unwrap();
    let (root, state) = (d.path().join("v"), d.path().join("s"));
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&state).unwrap();
    let exe = std::env::current_exe().unwrap();
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for i in 0..50 {
        let mut child = Command::new(&exe)
            .args(["--exact", "history::core_tests::fault_tests::kill_child", "--nocapture", "--test-threads=1"])
            .env("HIST_KILL_DIR", d.path())
            .env("HIST_KILL_SEED", i.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(60 + rng.below(240) as u64));
        child.kill().unwrap(); // SIGKILL
        let _ = child.wait();
        if i % 10 == 9 {
            verify_all_versions(&dunce::canonicalize(&root).unwrap());
        }
    }
    let root = dunce::canonicalize(&root).unwrap();
    let n = verify_all_versions(&root);
    assert!(n > 20, "the writers made progress ({n} versions)");
    // relaunch: own temp files are cleaned
    let w = mk_writer(&root, &state, Arc::new(crate::history::SystemClock), Box::new(|| true));
    store::cleanup_own_tmp(&w.store, &w.dev, std::time::Duration::ZERO);
    assert!(tmp_files(&root).is_empty());
    assert_eq!(verify_all_versions(&root), n);
}
