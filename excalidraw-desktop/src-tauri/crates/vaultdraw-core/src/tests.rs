//! Tests of the vault core: path rules, atomic and revision-guarded writes, recovery, reads.

use crate::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::Arc,
    thread,
    time::Duration,
};
use tempfile::tempdir;

const SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[],"appState":{},"files":{}}"#;
fn split_frame(frame: &[u8]) -> (String, &[u8]) {
    assert_eq!(frame[REVISION_HEX_LEN], b'\n');
    (String::from_utf8(frame[..REVISION_HEX_LEN].to_vec()).unwrap(), &frame[FRAME_PREFIX_LEN..])
}
fn vault(root: &Path) -> Vault {
    Vault::new(root.canonicalize().unwrap(), "test".into(), false, None)
}
/// Save/open cost breakdown on a real fixture: `PERF_FIXTURE=/path/to/x.excalidraw cargo test --release
/// bench_write_breakdown -- --ignored --nocapture`.
#[test]
#[ignore]
fn bench_write_breakdown() {
    use std::time::Instant;
    let Ok(src) = std::env::var("PERF_FIXTURE") else { return };
    let json = fs::read_to_string(src).unwrap();
    let t = tempdir().unwrap();
    let v = vault(t.path());
    let ms = |s: Instant| s.elapsed().as_secs_f64() * 1000.0;
    let first = write_drawing_file(&v, "a.excalidraw", &json, None, "bench-0").unwrap();
    let mut rev = first["revision"].as_str().unwrap().to_string();
    let p = safe_path(&v.root, "a.excalidraw", true).unwrap();
    for i in 0..5 {
        let s = Instant::now(); ensure_json(&json).unwrap(); let t_json = ms(s);
        let s = Instant::now(); let _ = current_revision(&p).unwrap(); let t_rev = ms(s);
        let s = Instant::now(); let snap = create_recovery(&v, "a.excalidraw", Some(&rev), "bench-r", &json).unwrap(); let t_rec = ms(s);
        remove_recovery(&snap);
        let s = Instant::now(); write_atomic(&p, json.as_bytes()).unwrap(); let t_wr = ms(s);
        let s = Instant::now(); let _ = revision(json.as_bytes()); let t_hash = ms(s);
        let s = Instant::now(); let out = write_drawing_file(&v, "a.excalidraw", &json, Some(&rev), &format!("bench-{i}")).unwrap(); let t_all = ms(s);
        rev = out["revision"].as_str().unwrap().to_string();
        let s = Instant::now(); let framed = read_drawing_file(&v.root, "a.excalidraw").unwrap(); let t_read = ms(s);
        println!("run{i} bytes={} ensure_json={t_json:.1} current_revision={t_rev:.1} create_recovery={t_rec:.1} write_atomic={t_wr:.1} hash={t_hash:.1} TOTAL_write={t_all:.1} read_drawing_file={t_read:.1} ({})", json.len(), framed.len());
    }
}
#[test]
fn rejects_traversal_reserved_metadata_and_windows_names() {
    for p in ["../outside", "/tmp/x", "a/../b", "a\\b", ".excalidraw-vault/x", "a//b", "CON", "nul.txt", "a:b", "bad?.excalidraw"] { assert!(validate_relative(p).is_err(), "{p}"); }
    assert_eq!(validate_relative("").unwrap().len(), 0);
}
#[cfg(unix)]
#[test]
fn rejects_symlink_components_and_recovery_ancestors() {
    use std::os::unix::fs::symlink;
    let t = tempdir().unwrap(); let root = t.path().join("root"); let outside = t.path().join("out");
    fs::create_dir(&root).unwrap(); fs::create_dir(&outside).unwrap();
    symlink(&outside, root.join("escape")).unwrap();
    assert!(safe_path(&root, "escape/file.excalidraw", true).is_err());
    symlink(&outside, root.join(META_DIR)).unwrap();
    assert_eq!(checked_recovery_dir(&vault(&root), true).unwrap_err().code, "INVALID_PATH");
}
#[test]
fn recovery_reveal_target_is_created_and_refused_when_read_only() {
    let t = tempdir().unwrap(); let root = t.path().join("root"); fs::create_dir(&root).unwrap();
    let v = vault(&root);
    let dir = recovery_reveal_target(&v).unwrap();
    assert!(dir.is_dir() && dir.ends_with(format!("{META_DIR}/{RECOVERY_DIR}")));
    let ro = t.path().join("ro"); fs::create_dir(&ro).unwrap();
    let mut v = vault(&ro); v.read_only = true;
    assert_eq!(recovery_reveal_target(&v).unwrap_err().code, "NOT_FOUND");
    assert!(!ro.join(META_DIR).exists());
}
#[cfg(unix)]
#[test]
fn refuses_symlink_lock_file() {
    use std::os::unix::fs::symlink;
    let t = tempdir().unwrap(); let root = t.path().join("root"); let target = t.path().join("target");
    fs::create_dir(&root).unwrap(); fs::write(&target, "outside").unwrap();
    symlink(&target, root.join(format!("{META_DIR}.lock"))).unwrap();
    let lock_path = root.join(format!("{META_DIR}.lock"));
    assert!(crate::lock::open_lock_file(&lock_path).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "outside");
}
#[test]
fn atomic_write_and_hash_revision_roundtrip() {
    let t = tempdir().unwrap(); let p = t.path().join("scene.excalidraw");
    write_atomic(&p, SCENE.as_bytes()).unwrap();
    let bytes = read_bounded(&p, MAX_DRAWING_BYTES).unwrap();
    assert_eq!(revision(&bytes), hex::encode(Sha256::digest(&bytes)));
    assert_eq!(String::from_utf8(bytes).unwrap(), SCENE);
    assert_eq!(fs::read_dir(t.path()).unwrap().count(), 1);
}
#[test]
fn move_and_create_refuse_all_existing_destinations() {
    let t = tempdir().unwrap(); let root = t.path();
    fs::write(root.join("source.excalidraw"), SCENE).unwrap();
    fs::write(root.join("dest.excalidraw"), "keep").unwrap();
    let e = move_entry_paths(root, "source.excalidraw", "dest.excalidraw").unwrap_err();
    assert_eq!(e.code, "NAME_COLLISION");
    assert_eq!(fs::read_to_string(root.join("dest.excalidraw")).unwrap(), "keep");
    assert_eq!(move_entry_paths(root, "source.excalidraw", "source.excalidraw").unwrap_err().code, "INVALID_PATH");
    assert_eq!(create_folder_at(root, "dest.excalidraw").unwrap_err().code, "NAME_COLLISION");
    assert!(create_folder_at(root, "").is_err());
}
#[test]
fn writes_are_revision_guarded_and_never_recreate_deleted_scene() {
    let t = tempdir().unwrap(); let v = vault(t.path()); let p = t.path().join("a.excalidraw");
    fs::write(&p, SCENE).unwrap(); let rev = revision(SCENE.as_bytes());
    fs::write(&p, "external").unwrap();
    assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, Some(&rev), "op1").unwrap_err().code, "CONFLICT");
    fs::remove_file(&p).unwrap();
    assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, Some(&rev), "op2").unwrap_err().code, "CONFLICT");
    assert!(!p.exists());
}
#[test]
fn create_only_write_roundtrips_and_preserves_exact_embedded_json() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    let embedded = r#"{"type":"excalidraw","version":2,"elements":[{"type":"image","fileId":"f"}],"appState":{"x":1},"files":{"f":{"dataURL":"data:image/png;base64,aGVsbG8=","mimeType":"image/png"}}}"#;
    ensure_json(embedded).unwrap();
    let result = write_drawing_file(&v, "a.excalidraw", embedded, None, "op").unwrap();
    assert_eq!(result["revision"], revision(embedded.as_bytes()));
    assert_eq!(fs::read_to_string(t.path().join("a.excalidraw")).unwrap(), embedded);
    let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
    let (rev, body) = split_frame(&frame);
    assert_eq!(body, embedded.as_bytes());
    assert_eq!(rev, revision(embedded.as_bytes()));
    assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, None, "op2").unwrap_err().code, "CONFLICT");
}
#[test]
fn injected_commit_failure_retains_recovery_snapshot_and_source() {
    let t = tempdir().unwrap(); let v = vault(t.path()); let source = t.path().join("a.excalidraw");
    fs::write(&source, SCENE).unwrap(); let expected = revision(SCENE.as_bytes());
    let result = write_drawing_file_with_commit(&v, "a.excalidraw", SCENE, Some(&expected), "fault", |_, _, _| Err(err("IO_ERROR", "injected failure")));
    assert_eq!(result.unwrap_err().code, "IO_ERROR");
    assert_eq!(fs::read_to_string(source).unwrap(), SCENE);
    let recovery = checked_recovery_dir(&v, false).unwrap().unwrap();
    assert_eq!(fs::read_dir(recovery).unwrap().count(), 1);
}
#[test]
fn recovery_wrapping_has_headroom_and_roundtrips() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    let json = format!(r#"{{"type":"excalidraw","data":"{}"}}"#, "\\\"".repeat(512));
    create_recovery(&v, "a.excalidraw", None, "op", &json).unwrap();
    let dir = checked_recovery_dir(&v, false).unwrap().unwrap();
    let record: RecoveryRecord = serde_json::from_slice(&read_bounded(&fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path(), MAX_RECOVERY_RECORD_BYTES).unwrap()).unwrap();
    assert_eq!(record.json, json);
}
#[test]
fn bounded_reads_reject_growth_beyond_cap() {
    let t = tempdir().unwrap(); let p = t.path().join("large"); fs::write(&p, vec![b'x'; 32]).unwrap();
    assert_eq!(read_bounded(&p, 31).unwrap_err().code, "INVALID_FILE");
}
#[test]
fn concurrent_mutations_are_serialized_and_ids_unique() {
    let t = tempdir().unwrap(); let v = Arc::new(vault(t.path())); let mut joins = Vec::new();
    for _ in 0..12 { let v = v.clone(); joins.push(thread::spawn(move || { let _g = mutation_guard(&v).unwrap(); thread::sleep(Duration::from_millis(1)); })); }
    for j in joins { j.join().unwrap(); }
    let ids: std::collections::HashSet<_> = (0..100).map(|_| random_id()).collect(); assert_eq!(ids.len(), 100);
}
#[test]
fn json_validation_requires_excalidraw_scene_and_is_bounded() {
    assert!(ensure_json("[]").is_err()); assert!(ensure_json("{bad").is_err()); assert!(ensure_json("{\"ok\":true}").is_err());
    assert!(ensure_json(SCENE).is_ok());
    // Shapes a derived struct would otherwise accept or mis-handle.
    assert!(ensure_json(r#"["excalidraw"]"#).is_err());
    assert!(ensure_json(r#"{"type":5}"#).is_err());
    assert!(ensure_json(r#"{"type":"excalidraw"} trailing"#).is_err());
    assert!(ensure_json(r#"{"elements":[{"type":"x"}],"type":"excalidraw"}"#).is_ok());
    assert!(ensure_json(r#"  {"type":"exc\u0061lidraw"}"#).is_ok());
    assert!(ensure_json(&format!("{{\"type\":\"excalidraw\",\"x\":\"{}\"}}", "x".repeat(MAX_DRAWING_BYTES as usize))).is_err());
}
#[test]
fn read_frame_has_revision_prefix_and_identical_body() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    fs::write(t.path().join("a.excalidraw"), SCENE).unwrap();
    let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
    let (rev, body) = split_frame(&frame);
    assert_eq!(body, SCENE.as_bytes());
    assert_eq!(rev, revision(SCENE.as_bytes()));
    assert_eq!(frame.len(), FRAME_PREFIX_LEN + SCENE.len());
    assert_eq!(read_drawing_file(&v.root, "missing.excalidraw").unwrap_err().code, "NOT_FOUND");
    fs::write(t.path().join("bad.excalidraw"), [0xff, 0xfe]).unwrap();
    assert_eq!(read_drawing_file(&v.root, "bad.excalidraw").unwrap_err().code, "INVALID_FILE");
    fs::write(t.path().join("notscene.excalidraw"), "{\"a\":1}").unwrap();
    assert_eq!(read_drawing_file(&v.root, "notscene.excalidraw").unwrap_err().code, "INVALID_FILE");
}
#[cfg(unix)]
#[test]
fn read_frame_marks_a_read_only_drawing_and_the_flag_lifts() {
    use std::os::unix::fs::PermissionsExt;
    let t = tempdir().unwrap(); let v = vault(t.path());
    let p = t.path().join("a.excalidraw");
    fs::write(&p, SCENE).unwrap();
    let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
    assert_eq!(frame[REVISION_HEX_LEN], b'\n');
    assert!(!drawing_read_only_at(&v.root, "a.excalidraw").unwrap());
    fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
    let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
    assert_eq!(frame[REVISION_HEX_LEN], FRAME_READ_ONLY);
    // The body and revision are unchanged by the mark.
    assert_eq!(&frame[FRAME_PREFIX_LEN..], SCENE.as_bytes());
    assert_eq!(&frame[..REVISION_HEX_LEN], revision(SCENE.as_bytes()).as_bytes());
    assert!(drawing_read_only_at(&v.root, "a.excalidraw").unwrap());
    // Writable again: the next read and the probe both say so.
    fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(!drawing_read_only_at(&v.root, "a.excalidraw").unwrap());
    assert_eq!(read_drawing_file(&v.root, "a.excalidraw").unwrap()[REVISION_HEX_LEN], b'\n');
    assert!(!drawing_read_only_at(&v.root, "missing.excalidraw").unwrap());
}
#[test]
fn streaming_revision_matches_buffered_revision() {
    let t = tempdir().unwrap(); let p = t.path().join("big.excalidraw");
    let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    fs::write(&p, &data).unwrap();
    assert_eq!(current_revision(&p).unwrap(), Some(revision(&data)));
    assert_eq!(current_revision(&t.path().join("none")).unwrap(), None);
    assert_eq!(drawing_revision_at(t.path(), "big.excalidraw").unwrap(), Some(revision(&data)));
    assert_eq!(drawing_revision_at(t.path(), "none.excalidraw").unwrap(), None);
    assert_eq!(drawing_revision_at(t.path(), "big.txt").unwrap_err().code, "INVALID_PATH");
    let (rev, n) = revision_of_reader(&data[..]).unwrap();
    assert_eq!((rev, n), (revision(&data), data.len() as u64));
}
#[test]
fn recovery_streaming_record_keeps_the_json_shape() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    let snapshot = create_recovery(&v, "a.excalidraw", Some("abc"), "op", SCENE).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&snapshot).unwrap()).unwrap();
    assert_eq!(value["path"], "a.excalidraw");
    assert_eq!(value["expectedRevision"], "abc");
    assert_eq!(value["operationId"], "op");
    assert_eq!(value["json"], SCENE);
    assert!(value["createdAt"].is_u64());
    // Serialized length reported by the counting pass equals the bytes on disk.
    let record = RecoveryRecord { path: "a.excalidraw".into(), expected_revision: None, operation_id: "op".into(), json: SCENE.into(), created_at: 1 };
    let mut counter = CountingWriter(0);
    serde_json::to_writer(&mut counter, &record).unwrap();
    assert_eq!(counter.0 as usize, serde_json::to_vec(&record).unwrap().len());
    assert!(fs::read_dir(snapshot.parent().unwrap()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".excalidraw-tmp")));
}
#[test]
fn webview_text_is_ascii_while_disk_and_revision_stay_raw_utf8() {
    let t = tempdir().unwrap(); let v = vault(t.path()); let p = t.path().join("a.excalidraw");
    let raw = "{\"type\":\"excalidraw\",\"elements\":[{\"text\":\"a \u{2014} \u{1F600}\"}]}";
    fs::write(&p, raw).unwrap();
    let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
    let (rev, body) = split_frame(&frame);
    assert_eq!(rev, revision(raw.as_bytes()));
    assert!(body.is_ascii() && body != raw.as_bytes());
    // Saving what the webview received writes the original bytes back.
    let out = write_drawing_file(&v, "a.excalidraw", std::str::from_utf8(body).unwrap(), Some(&rev), "op").unwrap();
    assert_eq!(fs::read(&p).unwrap(), raw.as_bytes());
    assert_eq!(out["revision"], revision(raw.as_bytes()));
    assert_eq!(out["bytes"], raw.len());
    // read_drawing_parts (CLI, templates) stays raw.
    assert_eq!(read_drawing_parts(&v.root, "a.excalidraw").unwrap().json, raw);
}

/// Directory listing cost on a generated folder: `cargo test --release -p vaultdraw-core
/// bench_list_directory -- --ignored --nocapture` (warm cache; `LIST_N` sets the file count).
#[test]
#[ignore]
fn bench_list_directory() {
    use std::time::Instant;
    let n: usize = std::env::var("LIST_N").ok().and_then(|s| s.parse().ok()).unwrap_or(5000);
    let t = tempdir().unwrap();
    let v = vault(t.path());
    for i in 0..n {
        fs::write(t.path().join(format!("Drawing {i:05} {}.excalidraw", ["alpha", "Beta", "gamma"][i % 3])), SCENE).unwrap();
    }
    for i in 0..20 {
        fs::create_dir(t.path().join(format!("Folder {i}"))).unwrap();
    }
    let mut ms: Vec<f64> = (0..60)
        .map(|_| {
            let s = Instant::now();
            let l = list_directory_in(&v, "").unwrap();
            assert_eq!(l.len(), n + 20);
            s.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("list_directory_in {n} files: p50 {:.2} ms, p95 {:.2} ms, min {:.2} ms", ms[ms.len() / 2], ms[ms.len() * 95 / 100], ms[0]);
}

fn mixed_folder(root: &Path) {
    fs::write(root.join("b.excalidraw"), SCENE).unwrap();
    fs::write(root.join("A.EXCALIDRAW"), "x".repeat(5000)).unwrap();
    fs::write(root.join("Zoë ✏️ notes.excalidraw"), SCENE).unwrap();
    fs::write(root.join("readme.md"), "hi").unwrap();
    fs::write(root.join(".excalidraw-tmp-1"), "t").unwrap();
    fs::create_dir(root.join("Sub")).unwrap();
    fs::create_dir(root.join("alpha")).unwrap();
    fs::create_dir(root.join(META_DIR)).unwrap();
    fs::write(root.join("Sub").join("inner.excalidraw"), SCENE).unwrap();
    fs::write(root.join("CON.excalidraw"), SCENE).unwrap();
    fs::write(root.join("trailing .excalidraw "), SCENE).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("b.excalidraw"), root.join("link.excalidraw")).unwrap();
        std::os::unix::fs::symlink(root.join("Sub"), root.join("linkdir")).unwrap();
    }
}

#[test]
fn list_directory_flags_conflict_copies_and_placeholders_and_skips_temp_files() {
    let t = tempdir().unwrap();
    let r = t.path();
    fs::create_dir(r.join("Sub")).unwrap();
    for f in [
        "Plan.excalidraw",
        "Plan (conflicted copy 2026-01-01).excalidraw",
        "Plan.sync-conflict-20260101-120000-ABCDEFG.excalidraw",
        "Plan 2.excalidraw",
        "Report 2.excalidraw", // no "Report.excalidraw" beside it: a normal name
        "Cloud.excalidraw",
        ".Cloud.excalidraw.icloud", // finished downloading: the real file wins
        ".Away.excalidraw.icloud",  // not downloaded
        ".photo.png.icloud",
        "~$Plan.md",
        "x.excalidraw.tmp",
        ".syncthing.Plan.excalidraw.tmp",
        ".dropbox.cache",
        "Sub/Plan.md",
        "Sub/Plan (Mac's conflicted copy 2026-01-01).md",
    ] {
        fs::write(r.join(f), "{}").unwrap();
    }
    let v = vault(r);
    let l = list_directory_in(&v, "").unwrap();
    let row = |n: &str| l.iter().find(|e| e.name == n).unwrap_or_else(|| panic!("{n} missing in {:?}", l.iter().map(|e| &e.name).collect::<Vec<_>>()));
    assert_eq!(row("Plan.excalidraw").sync, None);
    let dropbox = row("Plan (conflicted copy 2026-01-01).excalidraw");
    assert_eq!((dropbox.sync, dropbox.conflict_of.as_deref()), (Some("conflict"), Some("Plan.excalidraw")));
    assert_eq!(row("Plan.sync-conflict-20260101-120000-ABCDEFG.excalidraw").conflict_of.as_deref(), Some("Plan.excalidraw"));
    assert_eq!(row("Plan 2.excalidraw").conflict_of.as_deref(), Some("Plan.excalidraw"));
    assert_eq!(row("Report 2.excalidraw").sync, None);
    assert_eq!(row("Cloud.excalidraw").sync, None);
    let away = row("Away.excalidraw");
    assert_eq!((away.sync, away.kind.as_str(), away.path.as_str()), (Some("placeholder"), "drawing", "Away.excalidraw"));
    let names: Vec<&str> = l.iter().map(|e| e.name.as_str()).collect();
    for junk in ["~$Plan.md", "x.excalidraw.tmp", ".syncthing.Plan.excalidraw.tmp", ".dropbox.cache", ".photo.png.icloud", ".Cloud.excalidraw.icloud", "photo.png"] {
        assert!(!names.contains(&junk), "{junk} must not be listed");
    }
    let sub = list_directory_in(&v, "Sub").unwrap();
    let c = sub.iter().find(|e| e.sync == Some("conflict")).unwrap();
    assert_eq!(c.conflict_of.as_deref(), Some("Sub/Plan.md"));
    assert_eq!(c.path, "Sub/Plan (Mac's conflicted copy 2026-01-01).md");
}

#[test]
fn a_save_onto_a_file_changed_by_sync_is_refused_and_leaves_it_intact() {
    let t = tempdir().unwrap();
    let v = vault(t.path());
    let first = write_drawing_file(&v, "a.excalidraw", SCENE, None, "op-1").unwrap();
    let rev = first["revision"].as_str().unwrap().to_owned();
    // The sync client replaces the file behind the app's back.
    let theirs = SCENE.replace("\"version\":2", "\"version\":3");
    fs::write(t.path().join("a.excalidraw"), &theirs).unwrap();
    let e = write_drawing_file(&v, "a.excalidraw", SCENE, Some(&rev), "op-2").unwrap_err();
    assert_eq!(e.code, "CONFLICT");
    assert_eq!(fs::read_to_string(t.path().join("a.excalidraw")).unwrap(), theirs);
    // Same for a note.
    let n = note_file::write_note_file(&v, "n.md", "mine", None).unwrap();
    fs::write(t.path().join("n.md"), "theirs").unwrap();
    let e = note_file::write_note_file(&v, "n.md", "mine 2", Some(&n.revision)).unwrap_err();
    assert_eq!(e.code, "CONFLICT");
    assert_eq!(fs::read_to_string(t.path().join("n.md")).unwrap(), "theirs");
}

#[test]
fn list_directory_filters_sorts_and_reports_sizes() {
    let t = tempdir().unwrap();
    mixed_folder(t.path());
    let v = vault(t.path());
    let l = list_directory_in(&v, "").unwrap();
    let names: Vec<(&str, &str)> = l.iter().map(|e| (e.kind.as_str(), e.name.as_str())).collect();
    assert_eq!(
        names,
        vec![
            ("folder", "alpha"),
            ("folder", "Sub"),
            ("drawing", "A.EXCALIDRAW"),
            ("drawing", "b.excalidraw"),
            ("note", "readme.md"),
            ("drawing", "Zoë ✏️ notes.excalidraw"),
        ]
    );
    let big = l.iter().find(|e| e.name == "A.EXCALIDRAW").unwrap();
    assert_eq!(big.size, 5000);
    assert!(big.modified_at > 1_600_000_000_000);
    assert_eq!(l.iter().find(|e| e.name == "Sub").unwrap().size, 0);
    let sub = list_directory_in(&v, "Sub").unwrap();
    assert_eq!(sub.len(), 1);
    assert_eq!(sub[0].path, "Sub/inner.excalidraw");
    assert!(list_directory_in(&v, "missing").is_err());
}

#[test]
fn bulk_directory_read_matches_the_read_dir_fallback() {
    let t = tempdir().unwrap();
    mixed_folder(t.path());
    for i in 0..700 {
        fs::write(t.path().join(format!("many {i:04}.excalidraw")), "y".repeat(i)).unwrap();
    }
    let mut accept = |_: &str, _: bool| true;
    let key = |e: &crate::fsbulk::RawEntry| (e.name.clone(), e.is_dir, e.size, e.modified_ms);
    let mut a: Vec<_> = crate::fsbulk::read_dir_entries(t.path(), &mut accept).unwrap().iter().map(key).collect();
    let mut b: Vec<_> = crate::fsbulk::read_dir_fallback(t.path(), &mut accept).unwrap().iter().map(key).collect();
    a.sort();
    b.sort();
    assert_eq!(a.len(), b.len());
    assert_eq!(a, b);
    assert!(a.iter().all(|e| !e.0.starts_with("link")), "symlinks are skipped");
}
#[test]
fn failed_commits_keep_one_recovery_record_per_path_and_success_prunes_it() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    let p = t.path().join("a.excalidraw");
    fs::write(&p, SCENE).unwrap();
    let rev = revision(SCENE.as_bytes());
    let next = SCENE.replace("\"version\":2", "\"version\":3");
    let fail = |_: &Path, _: &[u8], _: bool| -> Result<()> { Err(err("IO", "disk full")) };
    for i in 0..6 {
        assert!(write_drawing_file_with_commit(&v, "a.excalidraw", &next, Some(&rev), &format!("op{i}"), fail).is_err());
    }
    let dir = checked_recovery_dir(&v, false).unwrap().unwrap();
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "six failures, one record");
    assert_eq!(list_recovery(&v).unwrap().len(), 1);
    // Another drawing gets its own record.
    fs::write(t.path().join("b.excalidraw"), SCENE).unwrap();
    assert!(write_drawing_file_with_commit(&v, "b.excalidraw", &next, Some(&rev), "opb", fail).is_err());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    // A later successful save removes the stale record of that path.
    write_drawing_file(&v, "a.excalidraw", &next, Some(&rev), "ok").unwrap();
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
}
#[test]
fn recovery_listing_skips_an_over_limit_record() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    create_recovery(&v, "a.excalidraw", None, "op", SCENE).unwrap();
    let dir = checked_recovery_dir(&v, false).unwrap().unwrap();
    let big = fs::File::create(dir.join("huge.json")).unwrap();
    big.set_len(MAX_RECOVERY_RECORD_BYTES + 1).unwrap();
    assert_eq!(list_recovery(&v).unwrap().len(), 1);
}
#[test]
fn an_earlier_session_recovery_record_survives_a_later_successful_save() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    fs::write(t.path().join("a.excalidraw"), SCENE).unwrap();
    let rev = revision(SCENE.as_bytes());
    let unsaved = SCENE.replace("\"version\":2", "\"version\":3");
    let fail = |_: &Path, _: &[u8], _: bool| -> Result<()> { Err(err("IO", "crash")) };
    assert!(write_drawing_file_with_commit(&v, "a.excalidraw", &unsaved, Some(&rev), "op1", fail).is_err());
    let dir = checked_recovery_dir(&v, false).unwrap().unwrap();
    // "Relaunch": the record now belongs to an earlier session.
    let old = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
    let earlier = old.with_file_name(format!("{}-earlier.json", old.file_stem().unwrap().to_string_lossy().rsplit_once('-').unwrap().0));
    fs::rename(&old, &earlier).unwrap();
    let other = SCENE.replace("\"version\":2", "\"version\":4");
    write_drawing_file(&v, "a.excalidraw", &other, Some(&rev), "ok").unwrap();
    assert!(earlier.exists(), "a save must not delete an earlier session's record");
    let listed = list_recovery(&v).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].json, unsaved);
}
#[test]
fn over_the_cap_prunes_old_session_records_but_never_the_newest_per_drawing() {
    let t = tempdir().unwrap(); let v = vault(t.path());
    let dir = recovery_dir(&v).unwrap();
    let h = &revision(b"a.excalidraw")[..32];
    let h2 = &revision(b"b.excalidraw")[..32];
    let mk = |name: String, age: u64| {
        let f = fs::File::create(dir.join(&name)).unwrap();
        f.set_len(22 * 1024 * 1024).unwrap();
        f.set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + age)).unwrap();
    };
    mk(format!("p-{h}-s1.json"), 1);
    mk(format!("p-{h}-s2.json"), 2);
    mk(format!("p-{h2}-s1.json"), 0);
    create_recovery(&v, "c.excalidraw", None, "op", SCENE).unwrap();
    assert!(!dir.join(format!("p-{h}-s1.json")).exists(), "oldest duplicate pruned");
    assert!(dir.join(format!("p-{h}-s2.json")).exists());
    assert!(dir.join(format!("p-{h2}-s1.json")).exists(), "newest of its drawing kept even though oldest overall");
}
#[test]
fn a_read_only_refusal_keeps_the_unsaved_edits_as_a_recovery_record() {
    use std::os::unix::fs::PermissionsExt;
    let t = tempdir().unwrap(); let v = vault(t.path());
    let p = t.path().join("a.excalidraw");
    fs::write(&p, SCENE).unwrap();
    let rev = revision(SCENE.as_bytes());
    fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
    let edited = SCENE.replace("\"version\":2", "\"version\":9");
    let e = write_drawing_file(&v, "a.excalidraw", &edited, Some(&rev), "op").unwrap_err();
    assert_eq!(e.code, "READ_ONLY");
    let listed = list_recovery(&v).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].json, edited);
    assert_eq!(fs::read_to_string(&p).unwrap(), SCENE);
}
#[test]
fn a_read_only_note_is_not_replaced() {
    use std::os::unix::fs::PermissionsExt;
    let t = tempdir().unwrap(); let v = vault(t.path());
    let p = t.path().join("n.md");
    fs::write(&p, "one").unwrap();
    let rev = revision(b"one");
    fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();
    let e = crate::note_file::write_note_file(&v, "n.md", "two", Some(&rev)).unwrap_err();
    assert_eq!(e.code, "READ_ONLY");
    assert_eq!(fs::read_to_string(&p).unwrap(), "one");
}

/// The names the native core accepts, one table shared with the browser stand-in
/// (`contract/name_rules.json`, read by `src/tests/vaultNameRules.test.ts`).
#[test]
fn name_rules_match_the_shared_table() {
    let table: serde_json::Value = serde_json::from_str(include_str!("contract/name_rules.json")).unwrap();
    let mut wrong = Vec::new();
    for c in table["cases"].as_array().unwrap() {
        let path = c["path"].as_str().unwrap();
        let invalid = c["invalid"].as_bool().unwrap();
        let got_invalid = crate::paths::validate_relative(path).is_err();
        if got_invalid != invalid {
            wrong.push(format!("{}: {:?} native invalid={got_invalid}, table says {invalid}", c["name"], path));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
