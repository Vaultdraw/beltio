//! Pure parts of the background indexer: walking a vault for drawings, deciding what needs a
//! (re)parse and turning file bytes into index entries. No threads, no UI.

use super::extract::{extract_doc, fingerprint_parts, parse_scene_prefix, Prefix, FINGERPRINT_EDGE_BYTES};
use super::index::DocEntry;
use crate::error::{err, ioerr, Result};
use crate::fsbulk::read_dir_entries;
use crate::paths::{now_ms, validate_relative, MAX_DRAWING_BYTES, META_DIR};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

const MAX_DEPTH: usize = 64;

pub struct Found {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

impl Found {
    pub fn stat(&self) -> (u64, u64) {
        (self.size, self.mtime)
    }
}

pub use crate::filekind::is_drawing_name;

/// Files the index reads: drawings and Markdown notes.
pub fn is_indexed_name(name: &str) -> bool {
    is_drawing_name(name) || super::notes::is_note_name(name)
}

/// Folders never walked: every dot name (`.obsidian`, `.trash`, `.git`, ...), see `filekind`.
pub fn is_skipped_dir(name: &str) -> bool {
    crate::filekind::is_hidden_name(name)
}

/// Lists one folder: its drawings go to `files`, its subfolders (with their depth) to `dirs`.
/// One bulk directory read supplies names, types, sizes and times (`fsbulk`: on macOS no
/// `stat` per file). If that read fails part way (an entry removed between the listing and
/// its `stat` on the fallback path), the folder is listed again one entry at a time, so one
/// vanished file never hides the rest of the folder from the index.
fn scan_dir(root: &Path, dir: &str, depth: usize, dirs: &mut Vec<(String, usize)>, files: &mut Vec<Found>) {
    let mut accept = |name: &str, is_dir: bool| {
        // A name that is not valid UTF-8 reaches us with U+FFFD in it and could not be opened
        // again by that name: skip it, as the per-entry path does.
        !name.contains('\u{FFFD}')
            && !crate::filekind::is_hidden_name(name)
            && !name.starts_with(".excalidraw-tmp-")
            && !(dir.is_empty() && name.eq_ignore_ascii_case(META_DIR))
            && if is_dir { depth < MAX_DEPTH && !is_skipped_dir(name) } else { is_indexed_name(name) }
    };
    let Ok(raw) = read_dir_entries(&root.join(dir), &mut accept) else {
        return scan_dir_each(root, dir, depth, dirs, files);
    };
    for e in raw {
        let child = if dir.is_empty() { e.name } else { format!("{dir}/{}", e.name) };
        if validate_relative(&child).is_err() {
            continue;
        }
        if e.is_dir {
            dirs.push((child, depth + 1));
        } else {
            files.push(Found { path: child, size: e.size, mtime: e.modified_ms });
        }
    }
}

/// [`scan_dir`] one entry at a time, skipping entries that fail: `read_dir` plus a `stat` per drawing.
fn scan_dir_each(root: &Path, dir: &str, depth: usize, dirs: &mut Vec<(String, usize)>, files: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(root.join(dir)) else { return };
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() || name.starts_with(".excalidraw-tmp-") || (dir.is_empty() && name.eq_ignore_ascii_case(META_DIR)) {
            continue;
        }
        // Dot names (`.obsidian`, `.trash`, `.git`) are never walked.
        if crate::filekind::is_hidden_name(&name) {
            continue;
        }
        let child = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
        if ft.is_dir() {
            if depth < MAX_DEPTH && !is_skipped_dir(&name) && validate_relative(&child).is_ok() {
                dirs.push((child, depth + 1));
            }
        } else if ft.is_file() && is_indexed_name(&name) && validate_relative(&child).is_ok() {
            if let Ok(md) = entry.metadata() {
                files.push(Found { path: child, size: md.len(), mtime: md.modified().map(now_ms).unwrap_or(0) });
            }
        }
    }
}

/// Recursively lists drawings under `root/rel` (never following symlinks, skipping
/// the metadata folder and temp files). Paths are vault-relative with forward slashes.
pub fn walk(root: &Path, rel: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut stack = vec![(rel.to_string(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        scan_dir(root, &dir, depth, &mut stack, &mut out);
    }
    out
}

/// [`walk`] over the whole vault on up to `threads` threads: folders go through a shared queue,
/// so each worker lists and `stat`s its own folders (the `stat` per file is what costs). The
/// result is the same set as `walk`, in no particular order.
pub fn walk_parallel(root: &Path, threads: usize) -> Vec<Found> {
    use std::sync::{Condvar, Mutex};
    if threads <= 1 {
        return walk(root, "");
    }
    // (folders waiting, workers busy)
    let queue = Mutex::new((vec![(String::new(), 0usize)], 0usize));
    let wake = Condvar::new();
    let out = Mutex::new(Vec::new());
    let work = || {
        let mut local = Vec::new();
        let mut subdirs = Vec::new();
        loop {
            let (dir, depth) = {
                let mut q = queue.lock().unwrap_or_else(|p| p.into_inner());
                loop {
                    if let Some(job) = q.0.pop() {
                        q.1 += 1;
                        break job;
                    }
                    if q.1 == 0 {
                        wake.notify_all();
                        out.lock().unwrap_or_else(|p| p.into_inner()).append(&mut local);
                        return;
                    }
                    q = wake.wait(q).unwrap_or_else(|p| p.into_inner());
                }
            };
            subdirs.clear();
            scan_dir(root, &dir, depth, &mut subdirs, &mut local);
            let mut q = queue.lock().unwrap_or_else(|p| p.into_inner());
            q.0.append(&mut subdirs);
            q.1 -= 1;
            wake.notify_all();
        }
    };
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(work);
        }
    });
    out.into_inner().unwrap_or_else(|p| p.into_inner())
}

/// Parsed entry for one drawing file's bytes (unparseable files stay findable by name).
pub fn entry_from_bytes(path: &str, stat: (u64, u64), bytes: &[u8]) -> DocEntry {
    if super::notes::is_note_name(path) {
        return super::notes::note_entry_from_bytes(path, stat, bytes);
    }
    match extract_doc(bytes) {
        Ok(x) => DocEntry::new(path, stat, x.items).with_links(x.elinks, x.hash8),
        Err(_) => DocEntry::new(path, stat, Vec::new()),
    }
}

/// Bytes read before the first parse attempt: most drawings without images end inside it.
const FIRST_READ: usize = 64 * 1024;
/// Read size grows by this factor while `elements` is not yet complete.
const GROW: usize = 4;
/// A reused buffer bigger than this is freed after the file, so one big drawing does not pin memory.
const KEEP_BUF: usize = 4 * 1024 * 1024;

/// Index entry for the drawing at `path`, reading only as much of it as the index needs: Excalidraw
/// writes `elements` before `appState` and `files`, and the `files` image blobs are most of a big
/// drawing, so the read stops once `elements` is parsed (the length and the two 4 KiB ends for the
/// fingerprint come from one `fstat` and one seek). `buf` is reused across files; `size_hint` is
/// the size the walk saw, which lets a file that fits the first read be read with one `read` call.
pub fn read_entry(path: &Path, rel: &str, stat: (u64, u64), buf: &mut Vec<u8>) -> Result<DocEntry> {
    let mut file = fs::File::open(path).map_err(ioerr)?;
    read_entry_open(&mut file, rel, stat, buf)
}

/// [`read_entry`] on an already open file (the parallel build opens relative to a directory).
pub fn read_entry_open(file: &mut fs::File, rel: &str, stat: (u64, u64), buf: &mut Vec<u8>) -> Result<DocEntry> {
    let r = read_entry_from(file, rel, stat, buf);
    if buf.len() > KEEP_BUF {
        *buf = Vec::new();
    }
    r
}

/// Reads into `dst[have..]` until it is full, the file ends, or `hint` (the size the walk saw) is
/// reached: for a regular file that fits, that is one `read` call instead of read plus a probe.
/// Also says whether end of file was actually seen: a file that grew since the walk is not over at `hint`.
fn fill(file: &mut fs::File, buf: &mut [u8], mut have: usize, hint: u64) -> Result<(usize, bool)> {
    loop {
        match file.read(&mut buf[have..]) {
            Ok(0) => return Ok((have, true)),
            Ok(n) => have += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(ioerr(e)),
        }
        if have == buf.len() || have as u64 >= hint {
            return Ok((have, false));
        }
    }
}

fn read_entry_from(file: &mut fs::File, rel: &str, stat: (u64, u64), buf: &mut Vec<u8>) -> Result<DocEntry> {
    let mut hint = stat.0;
    let mut want = FIRST_READ;
    let mut have = 0;
    if buf.len() < want {
        buf.resize(want, 0);
    }
    let (len, items, filled) = loop {
        let (filled, eof) = fill(file, &mut buf[..want], have, hint)?;
        let at_end = filled < want;
        let len = if at_end { filled as u64 } else { file.metadata().map_err(ioerr)?.len().max(filled as u64) };
        if len > MAX_DRAWING_BYTES {
            return Err(err("INVALID_FILE", "File exceeds its size limit"));
        }
        match parse_scene_prefix(&buf[..filled], at_end) {
            Prefix::Done(v) => break (len, v, filled),
            // The walk's size was stale (the file grew): read on to the real end before giving up.
            Prefix::Invalid(_) if at_end && !eof && hint != u64::MAX => {
                hint = u64::MAX;
                have = filled;
            }
            Prefix::Invalid(e) => return Err(e),
            Prefix::NeedMore => {
                have = filled;
                want = (want * GROW).min(MAX_DRAWING_BYTES as usize + 1);
                if buf.len() < want {
                    buf.resize(want, 0);
                }
            }
        }
    };
    let edge = FINGERPRINT_EDGE_BYTES;
    let head = &buf[..filled.min(edge)];
    let hash8 = if len as usize <= filled {
        fingerprint_parts(len, head, &buf[filled - (len as usize).min(edge)..filled])
    } else {
        let mut tail = vec![0u8; edge];
        file.seek(SeekFrom::Start(len - edge as u64)).map_err(ioerr)?;
        file.read_exact(&mut tail).map_err(ioerr)?;
        fingerprint_parts(len, head, &tail)
    };
    Ok(DocEntry::new(rel, stat, items.0).with_links(items.1, hash8))
}

pub fn parse(root: &Path, f: &Found, buf: &mut Vec<u8>) -> Option<(String, DocEntry)> {
    if super::notes::is_note_name(&f.path) {
        return finish(f, read_note_entry(&mut fs::File::open(root.join(&f.path)).map_err(ioerr).ok()?, f, buf));
    }
    finish(f, read_entry(&root.join(&f.path), &f.path, f.stat(), buf))
}

/// Largest note the index reads (the parser's own cap); a bigger one stays findable by name.
const MAX_NOTE_INDEX_BYTES: u64 = crate::markdown::MAX_MARKDOWN_BYTES;

/// Reads a whole note and builds its entry. The stat is the one the walk saw.
fn read_note_entry(file: &mut fs::File, f: &Found, buf: &mut Vec<u8>) -> Result<DocEntry> {
    let md = file.metadata().map_err(ioerr)?;
    if !md.is_file() || md.len() > MAX_NOTE_INDEX_BYTES {
        return Err(err("INVALID_FILE", "Not a readable note"));
    }
    buf.clear();
    file.take(MAX_NOTE_INDEX_BYTES + 1).read_to_end(buf).map_err(ioerr)?;
    let r = Ok(super::notes::note_entry_from_bytes(&f.path, f.stat(), buf));
    if buf.capacity() > KEEP_BUF {
        *buf = Vec::new();
    }
    r
}

fn finish(f: &Found, r: Result<DocEntry>) -> Option<(String, DocEntry)> {
    let entry = match r {
        Ok(e) => e,
        Err(e) if e.code == "NOT_FOUND" => return None,
        // Unreadable, oversize or not a drawing: still findable by name.
        Err(_) => DocEntry::new(&f.path, f.stat(), Vec::new()),
    };
    Some((f.path.clone(), entry))
}

/// The last directory a worker opened, so its next file is opened relative to it (`openat`):
/// the kernel then resolves one name instead of the whole path from `/`. Paths in a vault are
/// long (`/Users/<name>/…/<vault>/<folder>/<sub>/<file>`) and the lookup was the biggest cost of
/// a cold build. Not unix: plain paths.
#[derive(Default)]
pub struct DirHandle {
    #[cfg(unix)]
    open: Option<(String, fs::File)>,
}

/// [`parse`] using `dir` to open the file relative to its folder where the platform allows.
pub fn parse_in(root: &Path, f: &Found, buf: &mut Vec<u8>, dir: &mut DirHandle) -> Option<(String, DocEntry)> {
    #[cfg(unix)]
    {
        let (parent, name) = f.path.rsplit_once('/').unwrap_or(("", &f.path));
        let reuse = dir.open.as_ref().is_some_and(|(p, _)| p == parent);
        if !reuse {
            dir.open = fs::File::open(root.join(parent)).ok().map(|d| (parent.to_string(), d));
        }
        if let Some((_, d)) = &dir.open {
            return match open_at(d, name) {
                Ok(mut file) if super::notes::is_note_name(name) => finish(f, read_note_entry(&mut file, f, buf)),
                Ok(mut file) => finish(f, read_entry_open(&mut file, &f.path, f.stat(), buf)),
                Err(e) => finish(f, Err(ioerr(e))),
            };
        }
    }
    let _ = dir;
    parse(root, f, buf)
}

#[cfg(unix)]
fn open_at(dir: &fs::File, name: &str) -> std::io::Result<fs::File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let c = std::ffi::CString::new(name).map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    // SAFETY: `dir` is a live descriptor, `c` a NUL-terminated name; a non-negative result is a fresh descriptor we own.
    let fd = unsafe { libc::openat(dir.as_raw_fd(), c.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `fd` was just returned by openat and is owned by nothing else.
    let file = unsafe { fs::File::from_raw_fd(fd) };
    // A FIFO or device swapped in under a drawing name must not be read (O_NONBLOCK keeps the open from hanging).
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
    }
    Ok(file)
}

pub fn needs_parse(existing: Option<&DocEntry>, f: &Found, racy_before: u64) -> bool {
    match existing {
        Some(d) => !d.parsed || d.stat != f.stat() || f.mtime >= racy_before,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::extract::fingerprint8;

    /// `walk` built on the per-entry listing, the reference the bulk listing must match.
    fn walk_each(root: &Path) -> Vec<Found> {
        let mut out = Vec::new();
        let mut stack = vec![(String::new(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            scan_dir_each(root, &dir, depth, &mut stack, &mut out);
        }
        out
    }

    fn sorted(v: Vec<Found>) -> Vec<(String, u64, u64)> {
        let mut k: Vec<_> = v.into_iter().map(|f| (f.path, f.size, f.mtime)).collect();
        k.sort();
        k
    }

    #[test]
    fn bulk_scan_lists_what_the_per_entry_scan_lists() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        for d in ["a/b/c", ".excalidraw-vault", "x/.excalidraw-vault", "trail. "] {
            fs::create_dir_all(r.join(d)).unwrap();
        }
        for (i, f) in [
            "top.excalidraw",
            "UP.EXCALIDRAW",
            "a/one.excalidraw",
            "a/b/c/deep.excalidraw",
            "a/notes.txt",
            ".excalidraw-tmp-1.excalidraw",
            "a/.excalidraw-tmp-2.excalidraw",
            ".excalidraw-vault/meta.excalidraw",
            "x/.excalidraw-vault/kept.excalidraw",
            "trail. /in.excalidraw",
            ".excalidraw",
        ]
        .iter()
        .enumerate()
        {
            fs::write(r.join(f), "z".repeat(i * 10)).unwrap();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(r.join("a"), r.join("link")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(r.join("top.excalidraw"), r.join("link.excalidraw")).unwrap();
        let want = sorted(walk_each(r));
        let got = sorted(walk(r, ""));
        assert_eq!(got, want);
        let paths: Vec<&str> = got.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(
            paths,
            ["UP.EXCALIDRAW", "a/b/c/deep.excalidraw", "a/one.excalidraw", "top.excalidraw"],
            "no temp files, no metadata folder at any depth, no symlinks, no invalid folder names"
        );
    }

    #[test]
    fn a_missing_folder_scans_to_nothing() {
        let t = tempfile::tempdir().unwrap();
        assert!(walk(&t.path().join("missing"), "").is_empty());
    }

    /// Reported, not asserted (wall clock under load): bulk vs per-entry listing of 3000 drawings.
    #[test]
    fn scan_cost_report() {
        let t = tempfile::tempdir().unwrap();
        for i in 0..3000 {
            let d = t.path().join(format!("f{}", i % 30));
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join(format!("d{i}.excalidraw")), "{}").unwrap();
        }
        let time = |f: &dyn Fn() -> usize| {
            let mut v: Vec<_> = (0..15)
                .map(|_| {
                    let s = std::time::Instant::now();
                    assert_eq!(f(), 3000);
                    s.elapsed()
                })
                .collect();
            v.sort();
            (v[7], v[14])
        };
        let bulk = time(&|| walk(t.path(), "").len());
        let each = time(&|| walk_each(t.path()).len());
        eprintln!("scan 3000 drawings: bulk p50 {:?} max {:?}; per entry p50 {:?} max {:?}", bulk.0, bulk.1, each.0, each.1);
    }

    fn drawing(n_text: usize, blob_bytes: usize) -> String {
        let els: Vec<String> = (0..n_text).map(|i| format!(r#"{{"id":"t{i}","type":"text","text":"word{i} padding","originalText":"word{i} padding","isDeleted":false}}"#)).collect();
        let blob = "A".repeat(blob_bytes);
        format!(r##"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{"viewBackgroundColor":"#fff"}},"files":{{"f":{{"id":"f","dataURL":"data:image/png;base64,{blob}"}}}}}}"##, els.join(","))
    }

    fn same(a: &DocEntry, b: &DocEntry) -> bool {
        a.hash8 == b.hash8 && a.stat == b.stat && a.parsed == b.parsed && a.elinks == b.elinks && serde_json::to_string(&a.items).unwrap() == serde_json::to_string(&b.items).unwrap()
    }

    /// The streaming reader must give exactly what parsing the whole file gives, whatever the
    /// layout: small, big blob after the elements (tail seek), elements past the first read, exact fits.
    #[test]
    fn read_entry_equals_a_whole_file_parse_for_every_layout() {
        let dir = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        let cases = [(3, 0), (3, 200_000), (3, 5_000_000), (2_000, 0), (2_000, 3_000_000), (1, 100)];
        for (i, (n, blob)) in cases.into_iter().enumerate() {
            let body = drawing(n, blob);
            let p = dir.path().join(format!("d{i}.excalidraw"));
            fs::write(&p, &body).unwrap();
            let stat = (body.len() as u64, 7);
            let got = read_entry(&p, "d.excalidraw", stat, &mut buf).unwrap();
            let want = entry_from_bytes("d.excalidraw", stat, body.as_bytes());
            assert!(same(&got, &want), "case {i}: {n} texts, {blob} blob bytes");
            assert_eq!(got.hash8, fingerprint8(body.as_bytes()));
            assert!(!got.items.is_empty());
        }
        assert!(buf.capacity() <= KEEP_BUF + 1, "a big buffer is not kept");
    }

    #[test]
    fn a_file_that_grew_since_the_walk_is_still_read_whole() {
        let dir = tempfile::tempdir().unwrap();
        let body = drawing(2_000, 0);
        let p = dir.path().join("grew.excalidraw");
        fs::write(&p, &body).unwrap();
        // The walk saw an older, smaller size that ends inside `elements`.
        let got = read_entry(&p, "grew.excalidraw", (300, 1), &mut Vec::new()).unwrap();
        assert_eq!(got.items.len(), 2_000);
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_under_a_drawing_name_is_refused_not_waited_on() {
        let dir = tempfile::tempdir().unwrap();
        let c = std::ffi::CString::new(dir.path().join("p.excalidraw").to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let handle = fs::File::open(dir.path()).unwrap();
        assert!(open_at(&handle, "p.excalidraw").is_err());
    }

    #[test]
    fn read_entry_sizes_around_the_first_read_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        // Pad the file to land just under, on and over FIRST_READ.
        let base = drawing(1, 0);
        let key = "\"pad\":\"\",";
        for total in [FIRST_READ - 1, FIRST_READ, FIRST_READ + 1] {
            let pad = "x".repeat(total - base.len() - key.len());
            let body = base.replacen("\"files\"", &format!("\"pad\":\"{pad}\",\"files\""), 1);
            assert_eq!(body.len(), total);
            let p = dir.path().join("b.excalidraw");
            fs::write(&p, &body).unwrap();
            let got = read_entry(&p, "b", (total as u64, 1), &mut buf).unwrap();
            assert!(same(&got, &entry_from_bytes("b", (total as u64, 1), body.as_bytes())), "size {total}");
        }
    }

    #[test]
    fn broken_and_oversize_files_are_errors_and_stay_findable_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        for (name, body) in [("bad.excalidraw", "not json".to_string()), ("other.excalidraw", r#"{"type":"x","elements":[]}"#.to_string()), ("empty.excalidraw", String::new())] {
            let p = dir.path().join(name);
            fs::write(&p, &body).unwrap();
            assert!(read_entry(&p, name, (body.len() as u64, 1), &mut buf).is_err(), "{name}");
            let f = Found { path: name.into(), size: body.len() as u64, mtime: 1 };
            let (_, e) = parse(dir.path(), &f, &mut buf).unwrap();
            assert!(e.items.is_empty());
        }
        let big = dir.path().join("big.excalidraw");
        fs::File::create(&big).unwrap().set_len(MAX_DRAWING_BYTES + 10).unwrap();
        assert_eq!(read_entry(&big, "big", (MAX_DRAWING_BYTES + 10, 1), &mut buf).unwrap_err().code, "INVALID_FILE");
        let gone = dir.path().join("gone.excalidraw");
        let f = Found { path: "gone.excalidraw".into(), size: 5, mtime: 1 };
        assert!(parse(dir.path(), &f, &mut buf).is_none(), "a vanished file is skipped");
        assert!(read_entry(&gone, "gone", (5, 1), &mut buf).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn parse_in_opens_relative_to_the_folder_and_matches_parse() {
        let dir = tempfile::tempdir().unwrap();
        let mut buf = Vec::new();
        let mut handle = DirHandle::default();
        for rel in ["a.excalidraw", "x/b.excalidraw", "x/c.excalidraw", "x/y/d.excalidraw", "a2.excalidraw"] {
            let p = dir.path().join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, drawing(2, 10)).unwrap();
            let f = Found { path: rel.into(), size: fs::metadata(&p).unwrap().len(), mtime: 1 };
            let a = parse_in(dir.path(), &f, &mut buf, &mut handle).unwrap();
            let b = parse(dir.path(), &f, &mut buf).unwrap();
            assert_eq!(a.0, b.0);
            assert!(same(&a.1, &b.1), "{rel}");
        }
        // A symlink swapped in after the walk is refused by name (the entry stays name-only).
        let target = dir.path().join("a.excalidraw");
        std::os::unix::fs::symlink(&target, dir.path().join("link.excalidraw")).unwrap();
        let f = Found { path: "link.excalidraw".into(), size: 10, mtime: 1 };
        assert!(parse_in(dir.path(), &f, &mut buf, &mut handle).unwrap().1.items.is_empty());
        // A folder that vanished: the file is skipped like any vanished file.
        let f = Found { path: "nodir/z.excalidraw".into(), size: 10, mtime: 1 };
        assert!(parse_in(dir.path(), &f, &mut buf, &mut handle).is_none());
    }
}
