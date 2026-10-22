//! C4c: the CLI's pre-write staged clone (`vaultdraw_core::staging`) is versioned by the app's
//! next start as "Recovered", skipped when history already holds it, dropped when history is off.
use super::support::*;
use crate::history::{names::Reason, staging};
use std::fs;
use vaultdraw_core::staging as core_staging;

const P: &str = "p.excalidraw";

fn lineage_exact(fx: &Fx, rel: &str) -> Vec<Vec<u8>> {
    fx.versions(rel).iter().map(|v| super::lineage_tests::exact(fx, &v.id)).collect()
}

fn staged_all(fx: &Fx) -> Vec<String> {
    let dir = core_staging::staged_dir(&fx.state, &fx.root);
    let mut v: Vec<String> = fs::read_dir(dir).map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".excalidraw")).collect()).unwrap_or_default();
    v.sort();
    v
}

#[test]
fn key_and_names_match_the_app() {
    for rel in ["a.excalidraw", "Dir/Sub/Ünï.excalidraw", "UPPER.EXCALIDRAW", "x/y/z/日本語 draw.excalidraw", ""] {
        for fold in [false, true] {
            assert_eq!(core_staging::key_for(rel, fold), staging::key_for(rel, fold), "{rel} fold={fold}");
        }
    }
    assert_eq!(core_staging::clone_name("0123456789abcdef", "fedcba9876543210"), staging::clone_name("0123456789abcdef", "fedcba9876543210"));
    assert_eq!(core_staging::rev16(&"a".repeat(64)), staging::rev16(&"a".repeat(64)));
}

#[test]
fn offline_overwrite_then_start_recovers_previous_version() {
    let fx = Fx::new();
    let old = scene(1, 20, 0, 0).json();
    let new = scene(2, 25, 0, 0).json();
    fs::write(fx.root.join(P), &old).unwrap();
    assert!(core_staging::stage_before_overwrite(&fx.state, &fx.root, P).is_some());
    fs::write(fx.root.join(P), &new).unwrap();
    fx.start_configured(5);
    wait_for("recovered version", || fx.versions(P).len() == 1);
    let vs = fx.versions(P);
    assert_eq!(vs[0].reason, Reason::Recovered.as_str());
    assert_eq!(lineage_exact(&fx, P)[0], old.as_bytes());
    assert_eq!(fs::read_to_string(fx.root.join(P)).unwrap(), new);
    wait_for("clone removed", || staged_all(&fx).is_empty());
}

#[test]
fn offline_overwrite_of_an_already_versioned_state_is_skipped() {
    let fx = Fx::new();
    fx.start_configured(5);
    fx.open(None);
    let old = scene(3, 20, 0, 0).json();
    fx.save(P, &old);
    fx.vh().checkpoint(P, "base", "").unwrap();
    fx.barrier();
    let before = fx.versions(P).len();
    fx.svc.stop("h");
    assert!(core_staging::stage_before_overwrite(&fx.state, &fx.root, P).is_some());
    fs::write(fx.root.join(P), scene(4, 25, 0, 0).json()).unwrap();
    fx.start_configured(5);
    wait_for("clone removed", || staged_all(&fx).is_empty());
    fx.barrier();
    assert_eq!(fx.versions(P).len(), before, "no duplicate version");
    assert!(fx.versions(P).iter().all(|v| v.reason != Reason::Recovered.as_str()));
}

#[test]
fn history_disabled_at_configure_drops_the_clone_without_a_version() {
    let fx = Fx::new();
    fs::write(fx.root.join(P), scene(5, 20, 0, 0).json()).unwrap();
    assert!(core_staging::stage_before_overwrite(&fx.state, &fx.root, P).is_some());
    fs::write(fx.root.join(P), scene(6, 20, 0, 0).json()).unwrap();
    fx.start(false);
    let mut s = settings(5);
    s.enabled = false;
    fx.svc.vault("h").unwrap().configure(s);
    wait_for("clone removed", || staged_all(&fx).is_empty());
    fx.barrier();
    assert!(fx.versions(P).is_empty());
}

#[test]
fn two_offline_overwrites_keep_only_the_first_pre_state() {
    let fx = Fx::new();
    let first = scene(7, 20, 0, 0).json();
    fs::write(fx.root.join(P), &first).unwrap();
    assert!(core_staging::stage_before_overwrite(&fx.state, &fx.root, P).is_some());
    fs::write(fx.root.join(P), scene(8, 22, 0, 0).json()).unwrap();
    assert!(core_staging::stage_before_overwrite(&fx.state, &fx.root, P).is_none(), "second pre-state is skipped");
    fs::write(fx.root.join(P), scene(9, 24, 0, 0).json()).unwrap();
    assert_eq!(staged_all(&fx).len(), 1);
    fx.start_configured(5);
    wait_for("recovered", || fx.versions(P).len() == 1);
    fx.barrier();
    assert_eq!(fx.versions(P).len(), 1);
    assert_eq!(lineage_exact(&fx, P)[0], first.as_bytes());
}
