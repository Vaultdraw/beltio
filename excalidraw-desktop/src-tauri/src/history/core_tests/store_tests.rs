//! Index and store behaviour on real files: names-first scan, lazy headers, index.bin, case
//! folding, untrusted names, symlinks.
use super::support::*;
use crate::history::{index::{self, Index}, names::{self, Reason}, store::Store};
use std::{fs, sync::{Arc, RwLock}};

const P: &str = "Dir/Draw.excalidraw";

fn filled() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf, usize) {
    let d = tempfile::tempdir().unwrap();
    let (root, state) = (d.path().join("v"), d.path().join("s"));
    fs::create_dir_all(root.join("Dir")).unwrap();
    fs::create_dir_all(&state).unwrap();
    let root = dunce::canonicalize(root).unwrap();
    let mut w = mk_writer(&root, &state, TestClock::new(T0), Box::new(|| true));
    let mut sc = scene(1, 60, 1, 2000);
    for _ in 0..5 {
        sc.edit();
        version_of(&mut w, &root, P, &sc.json(), Reason::Auto).unwrap();
    }
    (d, root, state, 5)
}

#[test]
fn cold_scan_lists_from_names_and_headers_load_lazily() {
    let (_d, root, _s, n) = filled();
    let store = Store::new(&root);
    let idx = RwLock::new(Index::new(false));
    index::scan_all(&store, &idx, T0);
    let g = idx.read().unwrap();
    assert_eq!(g.version_count(), n);
    assert!(g.has_lineage(P), "the newest header of each lineage gives it its path");
    let e = g.entries_for_path(P);
    assert_eq!(e.iter().filter(|(_, e)| e.head.is_some()).count(), 1, "only the newest header was read");
    let ids = g.unloaded_for_path(P, 100);
    assert_eq!(ids.len(), n - 1);
    drop(g);
    for id in &ids {
        assert!(index::ensure_head(&store, &idx, id));
    }
    assert!(idx.read().unwrap().unloaded_for_path(P, 100).is_empty());
    assert!(!index::ensure_head(&store, &idx, &ids[0]), "already cached");
}

#[test]
fn blob_units_and_revision_lookup() {
    let (_d, root, _s, _) = filled();
    let store = Store::new(&root);
    let idx = RwLock::new(Index::new(false));
    index::scan_all(&store, &idx, T0);
    let g = idx.read().unwrap();
    assert_eq!(g.blobs.len(), 1);
    assert!(g.total_bytes() > 0);
    let (_, e) = g.latest_for_path(P).unwrap();
    let rev = e.head.as_ref().unwrap().rev.clone();
    assert_eq!(g.lineages_for_revision(&rev).len(), 1);
}

#[test]
fn index_bin_roundtrips_and_any_damage_reads_as_none() {
    let (d, root, _s, n) = filled();
    let store = Store::new(&root);
    let idx = RwLock::new(Index::new(false));
    index::scan_all(&store, &idx, T0);
    let f = d.path().join("index.bin");
    index::save(&f, &idx.read().unwrap()).unwrap();
    let back = index::load(&f).unwrap();
    assert_eq!(back.version_count(), n);
    assert!(back.has_lineage(P));
    let good = fs::read(&f).unwrap();
    for cut in [0, 5, 11, good.len() / 2, good.len() - 1] {
        fs::write(&f, &good[..cut]).unwrap();
        assert!(index::load(&f).is_none(), "truncated at {cut}");
    }
    for off in [0usize, 4, 8, good.len() - 1] {
        let mut bad = good.clone();
        bad[off] ^= 0xFF;
        fs::write(&f, &bad).unwrap();
        assert!(index::load(&f).is_none(), "flipped byte {off}");
    }
    assert!(index::load(&d.path().join("missing")).is_none());
}

#[test]
fn case_insensitive_volumes_fold_path_keys() {
    let (_d, root, _s, _) = filled();
    let store = Store::new(&root);
    let idx = RwLock::new(Index::new(true));
    index::scan_all(&store, &idx, T0);
    let g = idx.read().unwrap();
    assert!(g.has_lineage("dir/draw.excalidraw"));
    assert_eq!(g.entries_for_path("DIR/DRAW.EXCALIDRAW").len(), 5);
    let strict = RwLock::new(Index::new(false));
    index::scan_all(&store, &strict, T0);
    assert!(!strict.read().unwrap().has_lineage("dir/draw.excalidraw"));
}

#[cfg(unix)]
#[test]
fn untrusted_names_symlinks_and_junk_are_ignored_never_deleted() {
    let (_d, root, _s, n) = filled();
    let hist = root.join(".excalidraw-vault/history");
    let lin = fs::read_dir(&hist).unwrap().flatten().find(|e| names::is_ulid(&e.file_name().to_string_lossy())).unwrap().path();
    let junk = [lin.join("../../x.vdh"), lin.join("README.txt"), lin.join("01ARZ3NDEKTSV4RRFFQ69G5FAV-short.ka.vdh"), lin.join("..vdh")];
    for j in &junk {
        let _ = fs::write(j, b"junk");
    }
    // a symlinked lineage folder and a symlinked version file must not be followed
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("01ARZ3NDEKTSV4RRFFQ69G5FAV-aaaaaaaa.ka.vdh"), b"x").unwrap();
    std::os::unix::fs::symlink(outside.path(), hist.join("01ARZ3NDEKTSV4RRFFQ69G5FAW")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("01ARZ3NDEKTSV4RRFFQ69G5FAV-aaaaaaaa.ka.vdh"), lin.join("01ARZ3NDEKTSV4RRFFQ69G5FAX-aaaaaaaa.ka.vdh")).unwrap();
    let store = Store::new(&root);
    let idx = RwLock::new(Index::new(false));
    index::scan_all(&store, &idx, T0);
    assert_eq!(idx.read().unwrap().version_count(), n, "junk, symlinks and invalid names are not versions");
    for j in &junk[1..] {
        assert!(j.exists(), "never deleted");
    }
    // blob tokens are validated before any join
    for bad in ["../../etc/passwd", "zz.png", &format!("{}.png/../x", "a".repeat(64)), ""] {
        assert!(store.read_blob_any(bad).is_err(), "{bad}");
    }
    assert_eq!(store.read_blob_any(&format!("{}.png", "a".repeat(64))).unwrap_err().code, "VERSION_GONE");
}

#[test]
fn a_blob_copy_with_the_wrong_content_is_skipped_for_another_copy() {
    let (_d, root, _s, _) = filled();
    let store = Store::new(&root);
    let blobs = root.join(".excalidraw-vault/history/blobs");
    let shard = fs::read_dir(&blobs).unwrap().flatten().next().unwrap().path();
    let good = fs::read_dir(&shard).unwrap().flatten().next().unwrap().path();
    let name = good.file_name().unwrap().to_string_lossy().into_owned();
    let b = names::BlobName::parse(&name).unwrap();
    let tok = b.sha_ext();
    let bytes = fs::read(&good).unwrap();
    // a foreign device's corrupt copy sorts first; the good copy still serves
    let other = names::BlobName { dev: "00000000".into(), ..b.clone() };
    fs::write(shard.join(other.format()), b"corrupt").unwrap();
    assert_eq!(store.read_blob_any(&tok).unwrap(), bytes);
    fs::write(&good, b"also corrupt").unwrap();
    assert_eq!(store.read_blob_any(&tok).unwrap_err().code, "VERSION_GONE");
    let _ = Arc::new(0);
}

#[test]
fn newer_format_marker_is_detected_and_makes_history_read_only() {
    let (_d, root, _s, _) = filled();
    let store = Store::new(&root);
    assert!(!store.format_newer());
    fs::write(root.join(".excalidraw-vault/history/format-2"), b"").unwrap();
    assert!(store.format_newer());
    let fx = Fx::new();
    fs::create_dir_all(fx.root.join(".excalidraw-vault/history")).unwrap();
    fs::write(fx.root.join(".excalidraw-vault/history/format-2"), b"").unwrap();
    fx.start(false);
    fx.vh().configure(settings(5));
    let st = fx.vh().status();
    assert!(st.format_newer);
    assert_eq!(st.state, "read-only");
}
