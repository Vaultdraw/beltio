//! Restore-as-copy and Save-as export of one version: the exact bytes the save path committed.
use super::RestoredCopy;
use crate::history::{codec, index, names, VaultHistory};
use crate::{err, revision, safe_path, save_with_dialog, validate_relative, write_atomic_new, Result, MAX_DRAWING_BYTES};
use sha2::{Digest, Sha256};

/// A version's file: where it lives, when it was created, and its exact bytes.
struct Exact {
    /// Vault-relative path of the drawing's lineage (current path, else the path at write time).
    path: String,
    created_ms: u64,
    bytes: Vec<u8>,
}

/// Rebuilds the committed file of version `id` and verifies it against the header's `fileRevision`.
fn exact_bytes(vh: &VaultHistory, id: &str) -> Result<Exact> {
    let corrupt = || err("VERSION_CORRUPT", "This version failed its integrity check");
    let raw = vh.read_version(id)?;
    let nl = raw.iter().position(|&b| b == b'\n').ok_or_else(corrupt)?;
    let meta: serde_json::Value = serde_json::from_slice(&raw[..nl]).map_err(|_| corrupt())?;
    let want = meta["fileRevision"].as_str().ok_or_else(corrupt)?.to_string();
    let bytes = codec::inline(&raw[nl + 1..], &|blob| vh.read_blob(blob))?;
    drop(raw);
    if hex::encode(Sha256::digest(&bytes)) != want {
        return Err(corrupt());
    }
    let path = lineage_path(vh, id).ok_or_else(|| err("VERSION_GONE", "This version is not available"))?;
    Ok(Exact { path, created_ms: names::ulid_time_ms(id).unwrap_or(0), bytes })
}

/// The lineage's current path, else the path in this version's own header.
fn lineage_path(vh: &VaultHistory, id: &str) -> Option<String> {
    index::ensure_head(&vh.store, &vh.index, id);
    let g = vh.read_index();
    let (lin, e) = g.entry(id)?;
    g.lineages.get(lin).and_then(|l| l.path.clone()).or_else(|| e.head.as_ref().map(|h| h.path.clone()))
}

#[repr(C)]
struct Tm {
    sec: i32,
    min: i32,
    hour: i32,
    mday: i32,
    mon: i32,
    year: i32,
    wday: i32,
    yday: i32,
    isdst: i32,
    gmtoff: i64,
    zone: *const core::ffi::c_char,
}

extern "C" {
    fn localtime_r(t: *const i64, out: *mut Tm) -> *mut Tm;
}

/// `YYYY-MM-DD HH.MM` in the machine's local time (UTC if the conversion fails).
fn local_stamp(ms: u64) -> String {
    let t = (ms / 1000) as i64;
    let mut tm = Tm { sec: 0, min: 0, hour: 0, mday: 0, mon: 0, year: 0, wday: 0, yday: 0, isdst: 0, gmtoff: 0, zone: std::ptr::null() };
    // SAFETY: both pointers are valid for the call; localtime_r only writes into `tm`.
    let ok = !unsafe { localtime_r(&t, &mut tm) }.is_null();
    if !ok {
        return utc_stamp(ms);
    }
    format!("{:04}-{:02}-{:02} {:02}.{:02}", tm.year + 1900, tm.mon + 1, tm.mday, tm.hour, tm.min)
}

fn utc_stamp(ms: u64) -> String {
    let secs = ms / 1000;
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}.{:02}", rem / 3600, rem % 3600 / 60)
}

/// File name without folder and without the `.excalidraw` extension, shortened to leave room for a suffix.
fn stem_of(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = vaultdraw_core::filekind::strip_drawing_ext(file);
    let mut end = stem.len().min(150);
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    stem[..end].trim_end().to_string()
}

fn folder_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// Suggested name for exporting a version.
fn export_name(path: &str, created_ms: u64) -> String {
    format!("{} ({}).excalidraw", stem_of(path), local_stamp(created_ms))
}

pub(super) fn restore_copy(vh: &VaultHistory, id: &str) -> Result<RestoredCopy> {
    if vh.read_only() {
        return Err(err("HISTORY_READ_ONLY", "History is read-only in this window"));
    }
    let Exact { path, created_ms, bytes } = exact_bytes(vh, id)?;
    if bytes.len() as u64 > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "File exceeds its size limit"));
    }
    let (dir, stem, stamp) = (folder_of(&path), stem_of(&path), local_stamp(created_ms));
    for n in 1..=999u32 {
        let suffix = if n == 1 { String::new() } else { format!(" {n}") };
        let rel = join(dir, &format!("{stem} (restored {stamp}){suffix}.excalidraw"));
        validate_relative(&rel)?;
        let target = safe_path(&vh.root, &rel, true)?;
        match write_atomic_new(&target, &bytes) {
            Ok(()) => return Ok(RestoredCopy { path: rel, revision: revision(&bytes) }),
            Err(e) if e.code == "NAME_COLLISION" => continue,
            Err(e) => return Err(e),
        }
    }
    Err(err("NAME_COLLISION", "Too many restored copies with this name"))
}

pub(super) fn export_file(vh: &VaultHistory, id: &str) -> Result<bool> {
    let Exact { path, created_ms, bytes } = exact_bytes(vh, id)?;
    save_with_dialog(&export_name(&path, created_ms), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::core_tests::{
        bench::{emit, IMG_BYTES, IMG_COUNT},
        support::{scene, Fx},
    };
    use std::{fs, path::Path, time::Instant};

    const P: &str = "a.excalidraw";

    /// Saves `n` edits of a scene (each versioned), with `\/` escapes and a trailing newline in the file.
    fn versions(fx: &Fx, path: &str, n: usize, elements: usize, images: usize, img: usize) -> Vec<(String, String)> {
        let mut sc = scene(3, elements, images, img);
        let mut out = Vec::new();
        let json = |sc: &crate::history::core_tests::support::Scene| sc.json().replacen("https://excalidraw.com", r"https:\/\/excalidraw.com", 1) + "\n";
        if let Some((dir, _)) = path.rsplit_once('/') {
            fs::create_dir_all(fx.root.join(dir)).unwrap();
        }
        fx.save(path, &json(&sc));
        fx.open(Some(path));
        for _ in 0..n {
            sc.edit();
            let json = json(&sc);
            fx.save(path, &json);
            let id = fx.vh().snapshot(path, "before-restore", true).unwrap().id.unwrap();
            out.push((id, json));
        }
        out
    }

    fn fx() -> Fx {
        let fx = Fx::new();
        fx.start_configured(5);
        fx
    }

    fn files_under(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        for e in fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() { out.extend(files_under(&p)) } else { out.push(p) }
        }
        out
    }

    fn drawings(root: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(root).unwrap().flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".excalidraw")).collect();
        v.sort();
        v
    }

    #[test]
    fn restore_copy_is_byte_exact_for_keyframes_deltas_and_blobs() {
        let fx = fx();
        let vs = versions(&fx, P, 8, 40, 2, 3000);
        let vh = fx.vh();
        for (i, (id, json)) in vs.iter().enumerate() {
            let got = restore_copy(&vh, id).unwrap();
            let on_disk = fs::read(fx.root.join(&got.path)).unwrap();
            assert_eq!(on_disk, json.as_bytes(), "version {i}");
            assert_eq!(got.revision, revision(json.as_bytes()));
            assert!(!got.path.contains('/') && got.path.starts_with("a (restored "), "{}", got.path);
        }
        assert_eq!(drawings(&fx.root).len(), 1 + vs.len());
    }

    #[test]
    fn exact_bytes_matches_original_and_reports_the_drawing_path() {
        let fx = fx();
        let vs = versions(&fx, "sub/dir/b.excalidraw", 3, 10, 1, 500);
        let ex = exact_bytes(&fx.vh(), &vs[2].0).unwrap();
        assert_eq!((ex.path.as_str(), ex.bytes.as_slice()), ("sub/dir/b.excalidraw", vs[2].1.as_bytes()));
        assert_eq!(ex.created_ms, names::ulid_time_ms(&vs[2].0).unwrap());
    }

    #[test]
    fn collisions_get_a_counter_and_the_copy_stays_in_the_drawings_folder() {
        let fx = fx();
        fs::create_dir_all(fx.root.join("sub")).unwrap();
        let vs = versions(&fx, "sub/b.excalidraw", 1, 5, 0, 0);
        let vh = fx.vh();
        let first = restore_copy(&vh, &vs[0].0).unwrap();
        let second = restore_copy(&vh, &vs[0].0).unwrap();
        let third = restore_copy(&vh, &vs[0].0).unwrap();
        assert!(first.path.starts_with("sub/b (restored ") && first.path.ends_with(").excalidraw"), "{}", first.path);
        assert_eq!(second.path, first.path.replace(").excalidraw", ") 2.excalidraw"));
        assert_eq!(third.path, first.path.replace(").excalidraw", ") 3.excalidraw"));
        for p in [&first, &second, &third] {
            assert!(fx.root.join(&p.path).starts_with(&fx.root) && fx.root.join(&p.path).is_file());
        }
    }

    #[test]
    fn copies_do_not_start_history_files() {
        let fx = fx();
        let vs = versions(&fx, P, 2, 5, 0, 0);
        let before = files_under(&fx.hist_dir()).len();
        restore_copy(&fx.vh(), &vs[0].0).unwrap();
        assert_eq!(files_under(&fx.hist_dir()).len(), before);
    }

    #[test]
    fn read_only_unknown_and_invalid_ids_are_refused() {
        let fx = fx();
        let vs = versions(&fx, P, 1, 5, 0, 0);
        let vh = fx.vh();
        assert_eq!(restore_copy(&vh, "01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap_err().code, "VERSION_GONE");
        assert_eq!(restore_copy(&vh, "nope").unwrap_err().code, "INVALID_ARGUMENT");
        assert_eq!(drawings(&fx.root).len(), 1);

        let ro = Fx::new();
        ro.start(true);
        assert_eq!(restore_copy(&ro.vh(), &vs[0].0).unwrap_err().code, "HISTORY_READ_ONLY");
        assert!(drawings(&ro.root).is_empty());
    }

    fn blob_files(fx: &Fx) -> Vec<std::path::PathBuf> {
        files_under(&fx.hist_dir().join("blobs"))
    }

    #[test]
    fn missing_or_corrupt_blob_fails_without_leaving_a_file() {
        let fx = fx();
        let vs = versions(&fx, P, 2, 5, 1, 2000);
        let vh = fx.vh();
        let blobs = blob_files(&fx);
        assert!(!blobs.is_empty());
        for b in &blobs {
            fs::write(b, b"tampered").unwrap();
        }
        let e = restore_copy(&vh, &vs[1].0).unwrap_err();
        assert!(matches!(e.code.as_str(), "VERSION_GONE" | "VERSION_CORRUPT"), "{}", e.code);
        for b in &blobs {
            fs::remove_file(b).unwrap();
        }
        assert_eq!(restore_copy(&vh, &vs[1].0).unwrap_err().code, "VERSION_GONE");
        assert_eq!(drawings(&fx.root), vec![P.to_string()]);
        assert!(files_under(&fx.root).iter().all(|p| !p.file_name().unwrap().to_string_lossy().starts_with(".excalidraw-tmp")));
    }

    #[test]
    fn names_are_pure_and_well_formed() {
        assert_eq!(stem_of("x/y/My Draw.excalidraw"), "My Draw");
        assert_eq!(stem_of("My Draw.EXCALIDRAW"), "My Draw");
        assert_eq!(stem_of(&format!("{}.excalidraw", "é".repeat(200))).chars().count(), 75);
        assert_eq!((folder_of("a/b/c.excalidraw"), folder_of("c.excalidraw")), ("a/b", ""));
        assert_eq!(utc_stamp(1_800_000_000_000), "2027-01-15 08.00");
        let name = export_name("d/Plan.excalidraw", 1_800_000_000_000);
        let b = name.as_bytes();
        assert!(name.starts_with("Plan (20") && name.ends_with(").excalidraw"), "{name}");
        assert_eq!((b[10], b[13], b[16], b[19]), (b'-', b'-', b' ', b'.'), "{name}");
    }

    #[test]
    #[ignore]
    fn bench_history_restore_copy() {
        let fx = fx();
        let vs = versions(&fx, P, 6, 5000, IMG_COUNT, IMG_BYTES);
        let vh = fx.vh();
        let mut s = Vec::new();
        for i in 0..24 {
            let t = Instant::now();
            let got = restore_copy(&vh, &vs[i % vs.len()].0).unwrap();
            s.push(t.elapsed().as_secs_f64() * 1e3);
            fs::remove_file(fx.root.join(got.path)).unwrap();
        }
        let mb = vs[0].1.len() as f64 / 1048576.0;
        emit("restoreCopy.5kimg", "ms", s, &format!(",\"fileMB\":{mb:.2}"));
    }
}
