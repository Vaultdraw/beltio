//! File-system safety on REAL volumes (exFAT, FAT32, case-sensitive APFS, HFS+, ...).
//!
//! Skipped unless `VAULTDRAW_TEST_VOLUMES` lists mounted folders, colon-separated:
//!
//! ```text
//! hdiutil create -size 64m -fs ExFAT -volname VDX exfat.dmg
//! hdiutil attach -nobrowse -mountpoint /tmp/mnt-exfat exfat.dmg
//! VAULTDRAW_TEST_VOLUMES=/tmp/mnt-exfat:/tmp/mnt-fat32 cargo test -p vaultdraw-core --test volumes -- --nocapture
//! ```
//!
//! Each volume runs the same cases in a scratch folder it deletes afterwards. Every case prints
//! `VOLUME <fs> <case> PASS|FAIL|N/A <detail>`; the test fails if any case fails. A case that
//! cannot apply to a volume (a FAT volume has no read-only mode bits) reports N/A, not PASS.
//! `VAULTDRAW_TEST_STAMP_STRICT=1` makes the "save stamp shortcut is off on FAT/exFAT" case fail
//! instead of warn (set it once the stamp fix has merged).

use std::{
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
};
use vaultdraw_core::{checked_recovery_dir, create_folder_at, current_revision_stamped, list_recovery, metadata_read_only, move_entry_paths, rename_no_replace, write_atomic_new, write_drawing_file, write_drawing_file_with_commit, NativeError, Vault};

const SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[],"appState":{},"files":{}}"#;

fn scene(n: usize) -> String {
    format!(r#"{{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[{{"id":"e{n}"}}],"appState":{{}},"files":{{}}}}"#)
}

/// File-system type name from `statfs` ("apfs", "hfs", "msdos", "exfat", ...).
#[cfg(target_os = "macos")]
fn fs_type(p: &Path) -> String {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let c = CString::new(p.as_os_str().as_bytes()).unwrap();
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::statfs(c.as_ptr(), &mut s) }, 0);
    let raw: Vec<u8> = s.f_fstypename.iter().take_while(|b| **b != 0).map(|b| *b as u8).collect();
    String::from_utf8_lossy(&raw).into_owned()
}
#[cfg(not(target_os = "macos"))]
fn fs_type(_p: &Path) -> String {
    "unknown".into()
}

fn is_fat_family(fs: &str) -> bool {
    matches!(fs, "msdos" | "exfat")
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

/// Entries that belong to the vault's own work (temp files, AppleDouble `._x`) are not drawings.
fn leftovers(dir: &Path) -> Vec<String> {
    names(dir).into_iter().filter(|n| n.starts_with(".excalidraw-tmp-")).collect()
}

fn is_case_insensitive(dir: &Path) -> bool {
    let a = dir.join("CaseProbe.tmp");
    fs::write(&a, "x").unwrap();
    let r = dir.join("caseprobe.TMP").exists();
    fs::remove_file(a).unwrap();
    r
}

type R = std::result::Result<String, String>;
type Case = (&'static str, fn(&Ctx) -> R);

struct Ctx {
    fs: String,
    root: PathBuf,
    v: Vault,
    ci: bool,
}

fn ok(s: impl Into<String>) -> R {
    Ok(s.into())
}
fn na(s: impl Into<String>) -> R {
    Ok(format!("N/A {}", s.into()))
}
fn must(c: bool, msg: impl Into<String>) -> std::result::Result<(), String> {
    if c { Ok(()) } else { Err(msg.into()) }
}

fn save(c: &Ctx, path: &str, json: &str, expected: Option<&str>) -> std::result::Result<String, NativeError> {
    let r = write_drawing_file(&c.v, path, json, expected, "op")?;
    Ok(r["revision"].as_str().unwrap().to_string())
}

fn case_create_no_hard_links(c: &Ctx) -> R {
    let p = c.root.join("a.excalidraw");
    for i in 0..3 {
        save(c, &format!("n{i}.excalidraw"), SCENE, None).map_err(|e| format!("create: {}", e.message))?;
    }
    save(c, "a.excalidraw", SCENE, None).map_err(|e| format!("create: {}", e.message))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        for n in ["a", "n0", "n1", "n2"] {
            let nl = fs::metadata(c.root.join(format!("{n}.excalidraw"))).unwrap().nlink();
            must(nl == 1, format!("{n}: nlink {nl}"))?;
        }
    }
    must(leftovers(&c.root).is_empty(), format!("temp files left: {:?}", leftovers(&c.root)))?;
    must(fs::read_to_string(&p).unwrap() == SCENE, "content differs")?;
    // Information: does this volume support hard links at all?
    let probe = fs::hard_link(&p, c.root.join("hl-probe"));
    let _ = fs::remove_file(c.root.join("hl-probe"));
    ok(format!("4 created, nlink 1, no temp left; hard_link on this volume: {}", if probe.is_ok() { "works" } else { "refused (fallback path exercised)" }))
}

fn case_repeated_saves(c: &Ctx) -> R {
    let mut rev = save(c, "rep.excalidraw", &scene(0), None).map_err(|e| e.message)?;
    for i in 1..=25 {
        rev = save(c, "rep.excalidraw", &scene(i), Some(&rev)).map_err(|e| format!("save {i}: {}: {}", e.code, e.message))?;
        must(fs::read_to_string(c.root.join("rep.excalidraw")).unwrap() == scene(i), format!("content after save {i}"))?;
    }
    // A stale revision is refused and the file stays as last saved.
    let stale = save(c, "rep.excalidraw", &scene(99), Some("00")).err().ok_or("stale revision accepted")?;
    must(stale.code == "CONFLICT", format!("stale save: {}", stale.code))?;
    must(fs::read_to_string(c.root.join("rep.excalidraw")).unwrap() == scene(25), "stale save changed the file")?;
    must(leftovers(&c.root).is_empty(), "temp files left")?;
    must(list_recovery(&c.v).map_err(|e| e.message)?.is_empty(), "recovery records left after successful saves")?;
    ok("25 chained saves, stale revision refused, no temp or recovery left")
}

fn case_create_collision(c: &Ctx) -> R {
    save(c, "dup.excalidraw", &scene(1), None).map_err(|e| e.message)?;
    let e = save(c, "dup.excalidraw", &scene(2), None).err().ok_or("create over an existing file succeeded")?;
    must(e.code == "CONFLICT" || e.code == "NAME_COLLISION", format!("code {}", e.code))?;
    must(fs::read_to_string(c.root.join("dup.excalidraw")).unwrap() == scene(1), "original changed")?;
    // The raw no-clobber create path.
    let e = write_atomic_new(&c.root.join("dup.excalidraw"), b"X").err().ok_or("write_atomic_new replaced a file")?;
    must(e.code == "NAME_COLLISION", format!("write_atomic_new code {}", e.code))?;
    must(fs::read_to_string(c.root.join("dup.excalidraw")).unwrap() == scene(1), "original changed by write_atomic_new")?;
    must(leftovers(&c.root).is_empty(), "temp files left")?;
    ok("create over existing refused, original intact")
}

fn case_case_only_rename(c: &Ctx) -> R {
    fs::write(c.root.join("notes.excalidraw"), SCENE).unwrap();
    move_entry_paths(&c.root, "notes.excalidraw", "Notes.excalidraw").map_err(|e| format!("{}: {}", e.code, e.message))?;
    let n = names(&c.root);
    must(n.contains(&"Notes.excalidraw".to_string()) && !n.contains(&"notes.excalidraw".to_string()), format!("names {n:?}"))?;
    must(fs::read_to_string(c.root.join("Notes.excalidraw")).unwrap() == SCENE, "content lost")?;
    fs::create_dir(c.root.join("folder")).unwrap();
    move_entry_paths(&c.root, "folder", "Folder").map_err(|e| format!("folder: {}: {}", e.code, e.message))?;
    must(names(&c.root).contains(&"Folder".to_string()), "folder not renamed")?;
    ok("file and folder case-only rename keep content")
}

fn case_accent_clash(c: &Ctx) -> R {
    fs::write(c.root.join("\u{e9}t\u{e9}.excalidraw"), "KEEP").unwrap();
    fs::write(c.root.join("other.excalidraw"), "OTHER").unwrap();
    let mut detail = Vec::new();
    for target in ["\u{c9}t\u{e9}.excalidraw" /* Été */, "e\u{301}te\u{301}.excalidraw" /* NFD */, "\u{c9}T\u{c9}.excalidraw"] {
        let e = move_entry_paths(&c.root, "other.excalidraw", target).err().ok_or(format!("rename onto {target:?} succeeded"))?;
        must(e.code == "NAME_COLLISION", format!("{target:?}: code {}", e.code))?;
    }
    must(fs::read_to_string(c.root.join("\u{e9}t\u{e9}.excalidraw")).unwrap() == "KEEP", "clash target lost")?;
    must(fs::read_to_string(c.root.join("other.excalidraw")).unwrap() == "OTHER", "source lost")?;
    must(names(&c.root).iter().filter(|n| n.to_lowercase().contains("t")).count() >= 2, "an entry disappeared")?;
    detail.push("3 spellings refused by the name scan, nothing lost");
    // New file and new folder with a clashing name are refused too.
    let e = create_folder_at(&c.root, "\u{c9}T\u{c9}.excalidraw").err().ok_or("folder created on a clashing name")?;
    must(e.code == "NAME_COLLISION", format!("create_folder_at: {}", e.code))?;
    let e = save(c, "\u{c9}t\u{e9}.excalidraw", SCENE, None).err().ok_or("drawing created on a clashing name")?;
    // A create onto a clashing name is refused either by the name scan or, where the volume folds the name, by the revision check (it sees the existing file): both leave it untouched.
    must(e.code == "NAME_COLLISION" || e.code == "CONFLICT", format!("create drawing: {}", e.code))?;
    must(fs::read_to_string(c.root.join("\u{e9}t\u{e9}.excalidraw")).unwrap() == "KEEP", "clash target lost by create")?;
    detail.push("create folder and drawing onto a clash refused");
    ok(detail.join("; "))
}

/// Skip the name scan and ask the kernel/fallback directly: nothing may be replaced.
fn case_kernel_no_replace(c: &Ctx) -> R {
    let (src, dst) = (c.root.join("ks.tmp"), c.root.join("kd.tmp"));
    fs::write(&src, "SRC").unwrap();
    fs::write(&dst, "DST").unwrap();
    let e = rename_no_replace(&src, &dst).err().ok_or("rename_no_replace replaced an existing file")?;
    must(e.kind() == std::io::ErrorKind::AlreadyExists, format!("error kind {:?}", e.kind()))?;
    must(fs::read_to_string(&dst).unwrap() == "DST" && fs::read_to_string(&src).unwrap() == "SRC", "contents changed")?;
    // A different spelling of the same name: refused where the volume folds it, a plain move where it does not.
    let alt = c.root.join("KD.TMP");
    let r = rename_no_replace(&src, &alt);
    let detail = if c.ci {
        must(r.as_ref().err().is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists), format!("case variant: {r:?}"))?;
        must(fs::read_to_string(&dst).unwrap() == "DST", "destination replaced via case variant")?;
        "exact and case-variant clash refused by the volume"
    } else {
        r.map_err(|e| format!("distinct name on a case-sensitive volume: {e}"))?;
        "exact clash refused; case variant is a distinct name here"
    };
    let _ = fs::remove_file(&src);
    let _ = fs::remove_file(&alt);
    let _ = fs::remove_file(&dst);
    // Folders: the claim fallback uses mkdir.
    let (fa, fb) = (c.root.join("fa"), c.root.join("fb"));
    fs::create_dir(&fa).unwrap();
    fs::create_dir(&fb).unwrap();
    fs::write(fb.join("inside"), "IN").unwrap();
    let e = rename_no_replace(&fa, &fb).err().ok_or("folder renamed over a non-empty folder")?;
    must(e.kind() == std::io::ErrorKind::AlreadyExists || e.raw_os_error().is_some(), format!("{e:?}"))?;
    must(fs::read_to_string(fb.join("inside")).unwrap() == "IN", "folder content lost")?;
    ok(detail)
}

fn case_read_only(c: &Ctx) -> R {
    let name = "ro.excalidraw";
    let rev = save(c, name, &scene(1), None).map_err(|e| e.message)?;
    let p = c.root.join(name);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = fs::metadata(&p).unwrap().permissions();
        perm.set_mode(0o444);
        let _ = fs::set_permissions(&p, perm);
    }
    // macOS "Locked" (UF_IMMUTABLE) is the other way a file is read-only.
    let mut how = "mode 0444";
    if !metadata_read_only(&fs::metadata(&p).unwrap()) {
        #[cfg(target_os = "macos")]
        {
            let cp = std::ffi::CString::new(p.to_str().unwrap()).unwrap();
            if unsafe { libc::chflags(cp.as_ptr(), 0x2) } == 0 { how = "chflags uchg"; }
        }
    }
    if !metadata_read_only(&fs::metadata(&p).unwrap()) {
        return na("this volume ignores chmod 0444 and chflags uchg, so a file cannot be made read-only here");
    }
    let before = fs::read(&p).unwrap();
    let e = save(c, name, &scene(2), Some(&rev)).err().ok_or("save over a read-only file succeeded")?;
    let kept = fs::read(&p).unwrap() == before;
    let tmp = leftovers(&c.root);
    // Unlock for cleanup.
    #[cfg(target_os = "macos")]
    unsafe { let cp = std::ffi::CString::new(p.to_str().unwrap()).unwrap(); libc::chflags(cp.as_ptr(), 0); }
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o644)); }
    must(e.code == "READ_ONLY", format!("code {} ({})", e.code, e.message))?;
    must(kept, "read-only file was changed")?;
    must(tmp.is_empty(), format!("temp left {tmp:?}"))?;
    ok(format!("refused with READ_ONLY ({how}), file untouched"))
}

fn case_recovery_after_failed_save(c: &Ctx) -> R {
    let name = "rec.excalidraw";
    let rev = save(c, name, &scene(1), None).map_err(|e| e.message)?;
    let before = list_recovery(&c.v).map_err(|e| e.message)?.len();
    let e = write_drawing_file_with_commit(&c.v, name, &scene(2), Some(&rev), "op-fail", |_, _, _| Err(NativeError { code: "IO".into(), message: "injected".into() }));
    must(e.is_err(), "failed commit reported success")?;
    must(fs::read_to_string(c.root.join(name)).unwrap() == scene(1), "source changed by the failed save")?;
    let recs = list_recovery(&c.v).map_err(|e| e.message)?;
    must(recs.len() == before + 1, format!("{} records, want {}", recs.len(), before + 1))?;
    must(recs.iter().any(|r| r.path == name && r.json == scene(2)), "record lacks the unsaved scene")?;
    // The record lives on the volume under the vault's metadata folder.
    let dir = checked_recovery_dir(&c.v, false).map_err(|e| e.message)?.ok_or("no recovery dir")?;
    must(dir.starts_with(&c.root), "recovery dir is not on the volume")?;
    // Recovery text can be written to disk again after a real save (the next success removes only its own record).
    let rev2 = save(c, name, &scene(3), Some(&rev)).map_err(|e| e.message)?;
    must(!rev2.is_empty(), "retry failed")?;
    // The same session's record for this drawing is replaced and then removed by a successful save (one record per drawing and session).
    must(!list_recovery(&c.v).map_err(|e| e.message)?.iter().any(|r| r.path == name), "record of the drawing left after a successful save")?;
    ok("failed commit keeps source and a recovery record on the volume; the next success clears it")
}

fn case_mode_and_xattr_kept(c: &Ctx) -> R {
    let name = "attr.excalidraw";
    let rev = save(c, name, &scene(1), None).map_err(|e| e.message)?;
    let p = c.root.join(name);
    let mut notes = Vec::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o640));
    }
    let mode_before = { use std::os::unix::fs::MetadataExt; fs::metadata(&p).unwrap().mode() & 0o777 };
    #[cfg(target_os = "macos")]
    let xattr_set = {
        use std::ffi::CString;
        let cp = CString::new(p.to_str().unwrap()).unwrap();
        let k = CString::new("com.vaultdraw.test").unwrap();
        let rc = unsafe { libc::setxattr(cp.as_ptr(), k.as_ptr(), b"tag".as_ptr() as *const _, 3, 0, 0) };
        rc == 0
    };
    #[cfg(not(target_os = "macos"))]
    let xattr_set = false;
    save(c, name, &scene(2), Some(&rev)).map_err(|e| e.message)?;
    let mode_after = { use std::os::unix::fs::MetadataExt; fs::metadata(&p).unwrap().mode() & 0o777 };
    must(mode_before == mode_after, format!("mode {mode_before:o} -> {mode_after:o}"))?;
    notes.push(format!("mode {mode_after:o} kept (volume {} honour chmod)", if mode_before == 0o640 { "does" } else { "does not" }));
    #[cfg(target_os = "macos")]
    if xattr_set {
        use std::ffi::CString;
        let cp = CString::new(p.to_str().unwrap()).unwrap();
        let k = CString::new("com.vaultdraw.test").unwrap();
        let mut buf = [0u8; 8];
        let n = unsafe { libc::getxattr(cp.as_ptr(), k.as_ptr(), buf.as_mut_ptr() as *mut _, 8, 0, 0) };
        must(n == 3 && &buf[..3] == b"tag", format!("xattr lost after save (getxattr -> {n})"))?;
        notes.push("xattr kept".into());
    } else {
        notes.push("xattr not supported here".into());
    }
    let _ = xattr_set;
    // AppleDouble sidecars (`._name`) are how FAT/exFAT store xattrs: they must not be mistaken for drawings or left as temp files.
    let sidecars: Vec<_> = names(&c.root).into_iter().filter(|n| n.starts_with("._")).collect();
    if !sidecars.is_empty() { notes.push(format!("AppleDouble sidecars present: {sidecars:?}")); }
    let listed: Vec<String> = vaultdraw_core::list_directory_in(&c.v, "").map_err(|e| e.message)?.into_iter().map(|e| e.name).collect();
    must(listed == vec![name.to_string()], format!("directory listing shows {listed:?}"))?;
    notes.push("listing shows only the drawing".into());
    must(leftovers(&c.root).is_empty(), "temp files left")?;
    ok(notes.join("; "))
}

fn case_stamp_shortcut(c: &Ctx) -> R {
    let name = "stamp.excalidraw";
    save(c, name, &scene(1), None).map_err(|e| e.message)?;
    std::thread::sleep(std::time::Duration::from_millis(2300));
    let (_, stamp) = current_revision_stamped(&c.root.join(name)).map_err(|e| e.message)?.ok_or("file vanished")?;
    let fat = is_fat_family(&c.fs);
    let strict = std::env::var("VAULTDRAW_TEST_STAMP_STRICT").is_ok_and(|v| v == "1");
    match (fat, stamp.is_some()) {
        (true, true) if strict => Err("the stamp shortcut is ON for a 2 second-clock volume".into()),
        (true, true) => ok("WARN stamp shortcut is still ON here (set VAULTDRAW_TEST_STAMP_STRICT=1 once the data-safety-2 stamp fix is merged)"),
        (true, false) => ok("shortcut OFF (re-hash on every save)"),
        (false, _) => ok(format!("shortcut {} on a native-clock volume (expected)", if stamp.is_some() { "ON" } else { "OFF" })),
    }
}

fn case_mtime_granularity(c: &Ctx) -> R {
    // Information only: the modification-time step of this volume.
    let mut seen = std::collections::BTreeSet::new();
    for i in 0..4 {
        let p = c.root.join(format!("mt{i}.tmp"));
        fs::write(&p, "x").unwrap();
        let m = fs::metadata(&p).unwrap().modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap();
        seen.insert(m.subsec_nanos() % 1_000_000_000);
        let _ = fs::remove_file(p);
        std::thread::sleep(std::time::Duration::from_millis(137));
    }
    let coarse = seen.iter().all(|n| *n == 0);
    ok(format!("mtime sub-second part: {} ({} distinct values over 4 files)", if coarse { "always 0 (whole seconds: coarse clock)" } else { "present" }, seen.len()))
}

/// Information: can a same-size in-place edit keep the stamp (inode, size, mtime) unchanged on this
/// volume? Where it can, a stamp-based "unchanged" check would miss the edit.
fn case_stamp_blind_to_inplace_edit(c: &Ctx) -> R {
    use std::io::{Seek, Write};
    let p = c.root.join("blind.tmp");
    let mut blind = 0;
    for _ in 0..6 {
        fs::write(&p, "aaaaaaaaaa").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let Some((_, Some(stamp))) = current_revision_stamped(&p).map_err(|e| e.message)? else { return ok("no stamp offered after 150 ms: the shortcut is off, nothing to miss") };
        let mut f = fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.seek(std::io::SeekFrom::Start(0)).unwrap();
        f.write_all(b"bbbbbbbbbb").unwrap();
        drop(f);
        if vaultdraw_core::stamp_unchanged(&p, &stamp) { blind += 1; }
    }
    ok(format!("{blind}/6 same-size in-place edits left the stamp unchanged (a stamp-only check would have missed them)"))
}

fn case_move_into_folder(c: &Ctx) -> R {
    fs::create_dir(c.root.join("dest")).unwrap();
    fs::write(c.root.join("mv.excalidraw"), "M").unwrap();
    move_entry_paths(&c.root, "mv.excalidraw", "dest/mv.excalidraw").map_err(|e| e.message)?;
    must(fs::read_to_string(c.root.join("dest/mv.excalidraw")).unwrap() == "M" && !c.root.join("mv.excalidraw").exists(), "move result wrong")?;
    fs::write(c.root.join("mv.excalidraw"), "N").unwrap();
    let e = move_entry_paths(&c.root, "mv.excalidraw", "dest/mv.excalidraw").err().ok_or("move onto an existing file succeeded")?;
    must(e.code == "NAME_COLLISION", format!("code {}", e.code))?;
    must(fs::read_to_string(c.root.join("dest/mv.excalidraw")).unwrap() == "M", "target lost")?;
    must(fs::read_to_string(c.root.join("mv.excalidraw")).unwrap() == "N", "source lost")?;
    ok("move into a folder works; onto an existing name refused")
}

const CASES: &[Case] = &[
    ("create_no_hard_links", case_create_no_hard_links),
    ("repeated_saves", case_repeated_saves),
    ("create_collision", case_create_collision),
    ("case_only_rename", case_case_only_rename),
    ("accent_case_clash", case_accent_clash),
    ("kernel_no_replace", case_kernel_no_replace),
    ("read_only_refused", case_read_only),
    ("recovery_after_failed_save", case_recovery_after_failed_save),
    ("mode_and_xattr_kept", case_mode_and_xattr_kept),
    ("move_into_folder", case_move_into_folder),
    ("stamp_shortcut", case_stamp_shortcut),
    ("mtime_granularity", case_mtime_granularity),
    ("stamp_blind_to_inplace_edit", case_stamp_blind_to_inplace_edit),
];

fn run_volume(mount: &Path) -> usize {
    let fs = fs_type(mount);
    let mut failures = 0;
    let ci = is_case_insensitive(mount);
    println!("VOLUME {} ({fs}, {}) at {}", mount.file_name().unwrap().to_string_lossy(), if ci { "case-insensitive" } else { "case-sensitive" }, mount.display());
    for (name, case) in CASES {
        // A fresh vault folder per case: no case sees another's files.
        let root = mount.join(format!("vdtest-{}-{name}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let ctx = Ctx { fs: fs.clone(), v: Vault::new(root.clone(), "t".into(), false, None), root: root.clone(), ci };
        let r = catch_unwind(AssertUnwindSafe(|| case(&ctx)));
        let (tag, detail) = match r {
            Ok(Ok(s)) if s.starts_with("N/A ") => ("N/A ", s[4..].to_string()),
            Ok(Ok(s)) => ("PASS", s),
            Ok(Err(e)) => ("FAIL", e),
            Err(p) => ("FAIL", format!("panic: {}", p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default())),
        };
        if tag == "FAIL" { failures += 1; }
        println!("VOLUME {fs} {name} {tag} {detail}");
        let _ = fs::remove_dir_all(&root);
    }
    failures
}

#[test]
fn real_volumes_keep_files_safe() {
    let Ok(list) = std::env::var("VAULTDRAW_TEST_VOLUMES") else {
        eprintln!("VAULTDRAW_TEST_VOLUMES not set: skipping the real-volume tests");
        return;
    };
    let mut failures = 0;
    for mount in list.split(':').filter(|s| !s.is_empty()) {
        failures += run_volume(Path::new(mount));
    }
    assert_eq!(failures, 0, "{failures} case(s) failed; see the VOLUME lines above");
}
