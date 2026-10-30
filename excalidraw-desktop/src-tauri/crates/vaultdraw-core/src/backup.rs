//! Vault backup and restore: a streamed zip of the vault's files, checked after writing.
//!
//! Safety rules: the vault is only read; the zip is written to a `.part` file next to its final
//! name and renamed only after it was re-read and every file's SHA-256 matched; restore creates
//! a NEW folder (`create_dir` fails when the path exists) and removes it again if anything fails.
//!
//! The zip is plain (deflate, data descriptors, no zip64): a file or the whole archive must stay
//! under 4 GiB and the vault under 65 534 files, else the backup is refused with a clear error.
//! The last entry, `vaultdraw-backup.json`, lists every file with its size, SHA-256 and mtime.

use crate::error::{err, ioerr, NativeError, Result};
use crate::paths::META_DIR;
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

pub const MANIFEST: &str = "vaultdraw-backup.json";
const MAX_U32: u64 = 0xFFFF_FFFF;
const MAX_ENTRIES: usize = 65_534;
const MAX_MANIFEST: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BackupOptions {
    /// Include `.excalidraw-vault/settings.toml`.
    pub settings: bool,
    /// Include the file history (`.excalidraw-vault/history` and `note-history`).
    pub history: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Progress {
    pub phase: &'static str,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupResult {
    pub path: PathBuf,
    pub files: usize,
    pub bytes: u64,
    pub zip_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct ManifestFile {
    path: String,
    size: u64,
    sha256: String,
    mtime: u64,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    vault: String,
    created: u64,
    files: Vec<ManifestFile>,
}

fn cancelled() -> NativeError {
    err("CANCELLED", "Backup cancelled; nothing was kept")
}
fn bad(msg: impl std::fmt::Display) -> NativeError {
    err("INVALID_FILE", format!("Not a valid Vaultdraw backup: {msg}"))
}
fn check_cancel(c: &AtomicBool) -> Result<()> {
    if c.load(Ordering::Relaxed) {
        Err(cancelled())
    } else {
        Ok(())
    }
}

// ---- file collection ---------------------------------------------------------------------

struct Item {
    rel: String,
    abs: PathBuf,
    size: u64,
    mtime: u64,
}

fn mtime_of(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs())
}

fn skip_dot_file(name: &str) -> bool {
    name == ".DS_Store" || name == ".excalidraw-vault.lock" || name.starts_with(".excalidraw-tmp-")
}

fn walk(dir: &Path, rel: &str, top: bool, opts: BackupOptions, out: &mut Vec<Item>) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir).map_err(ioerr)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let child = if rel.is_empty() { name.to_string() } else { format!("{rel}/{name}") };
        if ft.is_dir() {
            if name.starts_with('.') {
                continue;
            }
            walk(&e.path(), &child, false, opts, out)?;
        } else if ft.is_file() {
            if name.starts_with('.') && skip_dot_file(name) {
                continue;
            }
            if top && name.starts_with('.') && name == MANIFEST {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };
            out.push(Item { rel: child, abs: e.path(), size: m.len(), mtime: mtime_of(&m) });
        }
    }
    Ok(())
}

fn collect(root: &Path, opts: BackupOptions) -> Result<Vec<Item>> {
    let mut out = Vec::new();
    walk(root, "", true, opts, &mut out)?;
    let meta = root.join(META_DIR);
    if meta.is_dir() && !fs::symlink_metadata(&meta).map_err(ioerr)?.file_type().is_symlink() {
        if opts.settings {
            let f = meta.join("settings.toml");
            if let Ok(m) = fs::symlink_metadata(&f) {
                if m.is_file() {
                    out.push(Item { rel: format!("{META_DIR}/settings.toml"), abs: f, size: m.len(), mtime: mtime_of(&m) });
                }
            }
        }
        if opts.history {
            for d in ["history", "note-history"] {
                let p = meta.join(d);
                if p.is_dir() && !fs::symlink_metadata(&p).map_err(ioerr)?.file_type().is_symlink() {
                    walk_all(&p, &format!("{META_DIR}/{d}"), &mut out)?;
                }
            }
        }
    }
    Ok(out)
}

/// Like `walk` but includes dot entries (history stores use dot-temp files we skip by name).
fn walk_all(dir: &Path, rel: &str, out: &mut Vec<Item>) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir).map_err(ioerr)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let child = format!("{rel}/{name}");
        if ft.is_dir() {
            walk_all(&e.path(), &child, out)?;
        } else if ft.is_file() && !name.ends_with(".tmp") && !skip_dot_file(name) {
            let Ok(m) = e.metadata() else { continue };
            out.push(Item { rel: child, abs: e.path(), size: m.len(), mtime: mtime_of(&m) });
        }
    }
    Ok(())
}

// ---- dates -------------------------------------------------------------------------------

/// (year, month, day, hour, minute, second) of a unix time, UTC.
fn civil(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

fn dos_time(secs: u64) -> (u16, u16) {
    let (y, mo, d, h, mi, s) = civil(secs);
    if y < 1980 {
        return (0, (1 << 5) | 1);
    }
    let y = (y.min(2107) - 1980) as u16;
    ((h as u16) << 11 | (mi as u16) << 5 | (s / 2) as u16, y << 9 | (mo as u16) << 5 | d as u16)
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Today's date as `YYYY-MM-DD` in local time (UTC where the platform gives no offset).
pub fn today() -> String {
    #[allow(unused_mut)]
    let mut t = now_secs() as i64;
    #[cfg(unix)]
    {
        let tt = t as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        if !unsafe { libc::localtime_r(&tt, &mut tm) }.is_null() {
            return format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
        }
    }
    let (y, m, d, ..) = civil(t.max(0) as u64);
    format!("{y:04}-{m:02}-{d:02}")
}

// ---- zip writer --------------------------------------------------------------------------

struct Counting<W: Write> {
    inner: W,
    n: u64,
}
impl<W: Write> Write for Counting<W> {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(b)?;
        self.n += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

struct CdEntry {
    name: String,
    crc: u32,
    csize: u32,
    usize_: u32,
    offset: u32,
    time: (u16, u16),
}

struct ZipOut<W: Write> {
    w: Counting<W>,
    cd: Vec<CdEntry>,
}

impl<W: Write> ZipOut<W> {
    fn new(w: W) -> Self {
        Self { w: Counting { inner: w, n: 0 }, cd: Vec::new() }
    }

    /// Streams one entry; `feed` pushes the plain bytes through the writer it is given and
    /// returns the SHA-256 of what it wrote, or an error (including cancellation).
    fn entry(&mut self, name: &str, mtime: u64, feed: impl FnOnce(&mut dyn Write) -> Result<()>) -> Result<()> {
        if self.cd.len() >= MAX_ENTRIES {
            return Err(err("TOO_LARGE", "The vault has too many files for one zip backup (limit 65 534)"));
        }
        if self.w.n >= MAX_U32 {
            return Err(err("TOO_LARGE", "The backup would pass 4 GiB, the limit of the plain zip format"));
        }
        let offset = self.w.n as u32;
        let time = dos_time(mtime);
        let nb = name.as_bytes();
        let mut h = Vec::with_capacity(30 + nb.len());
        h.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        h.extend_from_slice(&20u16.to_le_bytes());
        h.extend_from_slice(&0x0808u16.to_le_bytes()); // data descriptor + UTF-8 names
        h.extend_from_slice(&8u16.to_le_bytes());
        h.extend_from_slice(&time.0.to_le_bytes());
        h.extend_from_slice(&time.1.to_le_bytes());
        h.extend_from_slice(&[0u8; 12]); // crc, sizes: in the descriptor
        h.extend_from_slice(&(nb.len() as u16).to_le_bytes());
        h.extend_from_slice(&0u16.to_le_bytes());
        h.extend_from_slice(nb);
        self.w.write_all(&h).map_err(ioerr)?;
        let start = self.w.n;
        let mut enc = DeflateEncoder::new(CrcCount { inner: &mut self.w, crc: crc32fast::Hasher::new(), n: 0 }, Compression::fast());
        let mut sink = CrcSink { enc: &mut enc, crc: crc32fast::Hasher::new(), n: 0 };
        feed(&mut sink)?;
        let (crc, usize_) = (sink.crc.finalize(), sink.n);
        enc.finish().map_err(ioerr)?;
        let csize = self.w.n - start;
        if usize_ > MAX_U32 || csize > MAX_U32 {
            return Err(err("TOO_LARGE", format!("`{name}` is over 4 GiB, the limit of the plain zip format")));
        }
        let mut d = Vec::with_capacity(16);
        d.extend_from_slice(&0x0807_4b50u32.to_le_bytes());
        d.extend_from_slice(&crc.to_le_bytes());
        d.extend_from_slice(&(csize as u32).to_le_bytes());
        d.extend_from_slice(&(usize_ as u32).to_le_bytes());
        self.w.write_all(&d).map_err(ioerr)?;
        self.cd.push(CdEntry { name: name.to_string(), crc, csize: csize as u32, usize_: usize_ as u32, offset, time });
        Ok(())
    }

    fn finish(mut self) -> Result<W> {
        let cd_start = self.w.n;
        let mut b = Vec::new();
        for e in &self.cd {
            b.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            b.extend_from_slice(&20u16.to_le_bytes()); // made by
            b.extend_from_slice(&20u16.to_le_bytes());
            b.extend_from_slice(&0x0808u16.to_le_bytes());
            b.extend_from_slice(&8u16.to_le_bytes());
            b.extend_from_slice(&e.time.0.to_le_bytes());
            b.extend_from_slice(&e.time.1.to_le_bytes());
            b.extend_from_slice(&e.crc.to_le_bytes());
            b.extend_from_slice(&e.csize.to_le_bytes());
            b.extend_from_slice(&e.usize_.to_le_bytes());
            b.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            b.extend_from_slice(&[0u8; 12]); // extra, comment, disk, internal and external attrs
            b.extend_from_slice(&e.offset.to_le_bytes());
            b.extend_from_slice(e.name.as_bytes());
        }
        let cd_len = b.len() as u64;
        if cd_start + cd_len >= MAX_U32 {
            return Err(err("TOO_LARGE", "The backup would pass 4 GiB, the limit of the plain zip format"));
        }
        b.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        b.extend_from_slice(&[0u8; 4]);
        b.extend_from_slice(&(self.cd.len() as u16).to_le_bytes());
        b.extend_from_slice(&(self.cd.len() as u16).to_le_bytes());
        b.extend_from_slice(&(cd_len as u32).to_le_bytes());
        b.extend_from_slice(&(cd_start as u32).to_le_bytes());
        b.extend_from_slice(&0u16.to_le_bytes());
        self.w.write_all(&b).map_err(ioerr)?;
        self.w.flush().map_err(ioerr)?;
        Ok(self.w.inner)
    }
}

struct CrcCount<'a, W: Write> {
    inner: &'a mut Counting<W>,
    #[allow(dead_code)]
    crc: crc32fast::Hasher,
    #[allow(dead_code)]
    n: u64,
}
impl<W: Write> Write for CrcCount<'_, W> {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.inner.write(b)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
struct CrcSink<'a, E: Write> {
    enc: &'a mut E,
    crc: crc32fast::Hasher,
    n: u64,
}
impl<E: Write> Write for CrcSink<'_, E> {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.enc.write_all(b)?;
        self.crc.update(b);
        self.n += b.len() as u64;
        Ok(b.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ---- create ------------------------------------------------------------------------------

/// `<vault name> backup <date>.zip`, with ` (2)`, ` (3)` … when the name is taken.
fn free_name(dir: &Path, vault_name: &str) -> PathBuf {
    let base = format!("{vault_name} backup {}", today());
    let mut n = 1;
    loop {
        let name = if n == 1 { format!("{base}.zip") } else { format!("{base} ({n}).zip") };
        let p = dir.join(&name);
        if !p.exists() && !dir.join(format!("{name}.part")).exists() {
            return p;
        }
        n += 1;
    }
}

fn vault_name(root: &Path) -> String {
    let n = root.file_name().and_then(|n| n.to_str()).unwrap_or("vault");
    n.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect()
}

/// Backs the vault up into `dest_dir`. The vault is only read. `progress` is called at most
/// about every 100 ms. On cancel or error no `.zip` and no `.part` is left behind.
pub fn create(root: &Path, dest_dir: &Path, opts: BackupOptions, cancel: &AtomicBool, progress: &mut dyn FnMut(&Progress)) -> Result<BackupResult> {
    let root = dunce::canonicalize(root).map_err(ioerr)?;
    if !dest_dir.is_dir() {
        return Err(err("NOT_FOUND", format!("The backup folder {} does not exist", dest_dir.display())));
    }
    let dest_dir = dunce::canonicalize(dest_dir).map_err(ioerr)?;
    if dest_dir.starts_with(&root) {
        return Err(err("INVALID_PATH", "Choose a backup folder outside the vault"));
    }
    let items = collect(&root, opts)?;
    let total: u64 = items.iter().map(|i| i.size).sum();
    let name = vault_name(&root);
    let zip_path = free_name(&dest_dir, &name);
    let part = PathBuf::from(format!("{}.part", zip_path.display()));
    let result = (|| {
        let f = fs::OpenOptions::new().write(true).create_new(true).open(&part).map_err(ioerr)?;
        let mut zip = ZipOut::new(BufWriter::with_capacity(256 * 1024, f));
        let mut p = Progress { phase: "writing", files_total: items.len(), bytes_total: total, ..Default::default() };
        let mut last = Instant::now();
        let mut files = Vec::with_capacity(items.len());
        for it in &items {
            check_cancel(cancel)?;
            let mut hasher = Sha256::new();
            let mut size = 0u64;
            let mut src = match File::open(&it.abs) {
                Ok(f) => f,
                // A file removed since the scan is not part of the backup.
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(err("IO_ERROR", format!("Cannot read {}: {e}", it.rel))),
            };
            zip.entry(&it.rel, it.mtime, |w| {
                let mut buf = vec![0u8; 128 * 1024];
                loop {
                    check_cancel(cancel)?;
                    let n = src.read(&mut buf).map_err(ioerr)?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                    w.write_all(&buf[..n]).map_err(ioerr)?;
                    size += n as u64;
                    p.bytes_done += n as u64;
                    if last.elapsed().as_millis() >= 100 {
                        progress(&p);
                        last = Instant::now();
                    }
                }
                Ok(())
            })?;
            files.push(ManifestFile { path: it.rel.clone(), size, sha256: hex::encode(hasher.finalize()), mtime: it.mtime });
            p.files_done += 1;
        }
        let manifest = Manifest { format: 1, vault: name.clone(), created: now_secs(), files };
        let json = serde_json::to_vec_pretty(&manifest).map_err(|e| err("IO_ERROR", e.to_string()))?;
        zip.entry(MANIFEST, now_secs(), |w| w.write_all(&json).map_err(ioerr))?;
        let f = zip.finish()?.into_inner().map_err(|e| ioerr(e.into_error()))?;
        f.sync_all().map_err(ioerr)?;
        drop(f);
        p.phase = "verifying";
        progress(&p);
        verify_file(&part, cancel, &mut |done| {
            p.bytes_done = done;
            progress(&p)
        })?;
        check_cancel(cancel)?;
        if zip_path.exists() {
            return Err(err("NAME_COLLISION", "A file with the backup's name appeared; try again"));
        }
        fs::rename(&part, &zip_path).map_err(ioerr)?;
        let zip_bytes = fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
        Ok(BackupResult { path: zip_path.clone(), files: manifest.files.len(), bytes: total, zip_bytes })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

// ---- zip reader --------------------------------------------------------------------------

struct Cde {
    name: String,
    method: u16,
    crc: u32,
    csize: u64,
    usize_: u64,
    offset: u64,
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}
fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

fn read_cd(f: &mut File) -> Result<Vec<Cde>> {
    let len = f.seek(SeekFrom::End(0)).map_err(ioerr)?;
    if len < 22 {
        return Err(bad("too short"));
    }
    let mut e = [0u8; 22];
    f.seek(SeekFrom::Start(len - 22)).map_err(ioerr)?;
    f.read_exact(&mut e).map_err(ioerr)?;
    if u32_at(&e, 0) != 0x0605_4b50 || u16_at(&e, 20) != 0 {
        return Err(bad("no end record (zip comments are not allowed)"));
    }
    let (n, cd_len, cd_off) = (u16_at(&e, 10) as usize, u32_at(&e, 12) as u64, u32_at(&e, 16) as u64);
    if u16_at(&e, 4) != 0 || u16_at(&e, 6) != 0 || n == 0xFFFF || cd_off.saturating_add(cd_len) > len - 22 {
        return Err(bad("multi-disk, zip64 or damaged end record"));
    }
    let mut cd = vec![0u8; cd_len as usize];
    f.seek(SeekFrom::Start(cd_off)).map_err(ioerr)?;
    f.read_exact(&mut cd).map_err(ioerr)?;
    let (mut out, mut i) = (Vec::with_capacity(n), 0usize);
    for _ in 0..n {
        if cd.len() < i + 46 || u32_at(&cd, i) != 0x0201_4b50 {
            return Err(bad("damaged central directory"));
        }
        let (flags, method) = (u16_at(&cd, i + 8), u16_at(&cd, i + 10));
        let (nl, xl, cl) = (u16_at(&cd, i + 28) as usize, u16_at(&cd, i + 30) as usize, u16_at(&cd, i + 32) as usize);
        let (csize, usize_, offset) = (u32_at(&cd, i + 20) as u64, u32_at(&cd, i + 24) as u64, u32_at(&cd, i + 42) as u64);
        if flags & 1 != 0 || (method != 0 && method != 8) || csize == MAX_U32 || usize_ == MAX_U32 || offset == MAX_U32 {
            return Err(bad("encrypted, zip64 or unsupported compression"));
        }
        let Some(nb) = cd.get(i + 46..i + 46 + nl) else { return Err(bad("damaged central directory")) };
        let name = std::str::from_utf8(nb).map_err(|_| bad("entry name is not UTF-8"))?.to_string();
        out.push(Cde { name, method, crc: u32_at(&cd, i + 16), csize, usize_, offset });
        i += 46 + nl + xl + cl;
    }
    Ok(out)
}

/// Opens an entry's plain bytes; the caller must read at most `usize_ + 1` and compare.
fn open_entry<'a>(f: &'a mut File, e: &Cde, file_len: u64) -> Result<Box<dyn Read + 'a>> {
    let mut h = [0u8; 30];
    f.seek(SeekFrom::Start(e.offset)).map_err(ioerr)?;
    f.read_exact(&mut h).map_err(|_| bad("damaged entry"))?;
    if u32_at(&h, 0) != 0x0403_4b50 {
        return Err(bad("damaged entry header"));
    }
    let data = e.offset + 30 + u16_at(&h, 26) as u64 + u16_at(&h, 28) as u64;
    if data.saturating_add(e.csize) > file_len {
        return Err(bad("entry runs past the end of the file"));
    }
    f.seek(SeekFrom::Start(data)).map_err(ioerr)?;
    let r = BufReader::with_capacity(128 * 1024, f.take(e.csize));
    Ok(if e.method == 8 { Box::new(DeflateDecoder::new(r)) } else { Box::new(r) })
}

/// Streams an entry through `sink`, checking size and CRC. Returns the SHA-256 of the bytes.
fn stream_entry(f: &mut File, e: &Cde, file_len: u64, cancel: &AtomicBool, sink: &mut dyn FnMut(&[u8]) -> Result<()>) -> Result<String> {
    let mut r = open_entry(f, e, file_len)?.take(e.usize_ + 1);
    let (mut sha, mut crc, mut n) = (Sha256::new(), crc32fast::Hasher::new(), 0u64);
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        check_cancel(cancel)?;
        let k = r.read(&mut buf).map_err(|e| bad(format!("cannot inflate: {e}")))?;
        if k == 0 {
            break;
        }
        sha.update(&buf[..k]);
        crc.update(&buf[..k]);
        n += k as u64;
        sink(&buf[..k])?;
    }
    if n != e.usize_ || crc.finalize() != e.crc {
        return Err(bad(format!("`{}` does not match its size or checksum", e.name)));
    }
    Ok(hex::encode(sha.finalize()))
}

fn read_manifest(f: &mut File, cd: &[Cde], len: u64) -> Result<Manifest> {
    let e = cd.iter().find(|e| e.name == MANIFEST).ok_or_else(|| bad("no vaultdraw-backup.json inside"))?;
    if e.usize_ > MAX_MANIFEST {
        return Err(bad("manifest too large"));
    }
    let mut v = Vec::new();
    stream_entry(f, e, len, &AtomicBool::new(false), &mut |b| {
        v.extend_from_slice(b);
        Ok(())
    })?;
    let m: Manifest = serde_json::from_slice(&v).map_err(|e| bad(format!("manifest: {e}")))?;
    if m.format != 1 {
        return Err(bad("unknown backup format"));
    }
    Ok(m)
}

/// Re-reads the whole zip and compares every file's SHA-256 with its manifest line.
/// Returns the number of files.
pub fn verify_file(zip: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64)) -> Result<usize> {
    let mut f = File::open(zip).map_err(ioerr)?;
    let len = f.metadata().map_err(ioerr)?.len();
    let cd = read_cd(&mut f)?;
    let m = read_manifest(&mut f, &cd, len)?;
    let by_name: std::collections::HashMap<&str, &Cde> = cd.iter().map(|e| (e.name.as_str(), e)).collect();
    if cd.len() != m.files.len() + 1 || by_name.len() != cd.len() {
        return Err(bad("the file list does not match the manifest"));
    }
    let mut done = 0u64;
    for mf in &m.files {
        let e = by_name.get(mf.path.as_str()).ok_or_else(|| bad(format!("`{}` is missing", mf.path)))?;
        let sha = stream_entry(&mut f, e, len, cancel, &mut |b| {
            done += b.len() as u64;
            Ok(())
        })?;
        if sha != mf.sha256 || e.usize_ != mf.size {
            return Err(err("VERIFY_FAILED", format!("`{}` differs from what was read from the vault", mf.path)));
        }
        progress(done);
    }
    Ok(m.files.len())
}

// ---- restore -----------------------------------------------------------------------------

fn check_name(name: &str) -> Result<()> {
    let b = name.as_bytes();
    if name.is_empty()
        || name.starts_with('/')
        || name.ends_with('/')
        || name.contains('\\')
        || name.chars().any(|c| c.is_control())
        || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
        || name.split('/').any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err(bad(format!("unsafe entry name `{}`", name.escape_debug())));
    }
    Ok(())
}

/// Extracts `zip` into `dest`, which must NOT exist yet (its parent must). Nothing is ever
/// overwritten; on any failure or cancel the new folder is removed again.
pub fn restore(zip: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(&Progress)) -> Result<BackupResult> {
    if dest.symlink_metadata().is_ok() {
        return Err(err("NAME_COLLISION", format!("{} already exists; restore only into a new folder", dest.display())));
    }
    let mut f = File::open(zip).map_err(ioerr)?;
    let len = f.metadata().map_err(ioerr)?.len();
    let cd = read_cd(&mut f)?;
    let m = read_manifest(&mut f, &cd, len)?;
    let mut seen = HashSet::new();
    let by_name: std::collections::HashMap<&str, &Cde> = cd.iter().map(|e| (e.name.as_str(), e)).collect();
    for e in &cd {
        if e.name != MANIFEST {
            check_name(&e.name)?;
        }
        if !seen.insert(e.name.to_lowercase()) {
            return Err(bad(format!("`{}` appears twice", e.name)));
        }
    }
    if cd.len() != m.files.len() + 1 || by_name.len() != cd.len() {
        return Err(bad("the file list does not match the manifest"));
    }
    for mf in &m.files {
        check_name(&mf.path)?;
    }
    // create_dir fails when the path exists (even if a race created it): nothing is overwritten.
    fs::create_dir(dest).map_err(ioerr)?;
    let result = (|| {
        let mut p = Progress { phase: "restoring", files_total: m.files.len(), bytes_total: m.files.iter().map(|f| f.size).sum(), ..Default::default() };
        let mut last = Instant::now();
        for mf in &m.files {
            check_cancel(cancel)?;
            let e = by_name.get(mf.path.as_str()).ok_or_else(|| bad(format!("`{}` is missing", mf.path)))?;
            let target = mf.path.split('/').fold(dest.to_path_buf(), |a, s| a.join(s));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(ioerr)?;
            }
            let mut out = BufWriter::new(fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(ioerr)?);
            let sha = stream_entry(&mut f, e, len, cancel, &mut |b| {
                out.write_all(b).map_err(ioerr)?;
                p.bytes_done += b.len() as u64;
                if last.elapsed().as_millis() >= 100 {
                    progress(&p);
                    last = Instant::now();
                }
                Ok(())
            })?;
            let out = out.into_inner().map_err(|e| ioerr(e.into_error()))?;
            if sha != mf.sha256 || e.usize_ != mf.size {
                return Err(err("VERIFY_FAILED", format!("`{}` does not match the backup's manifest", mf.path)));
            }
            if mf.mtime > 0 {
                let _ = out.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(mf.mtime));
            }
            p.files_done += 1;
        }
        progress(&p);
        Ok(BackupResult { path: dest.to_path_buf(), files: m.files.len(), bytes: p.bytes_total, zip_bytes: len })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(dest); // only the folder this call created
    }
    result
}

// ---- prune -------------------------------------------------------------------------------

fn is_backup_name(name: &str, vault: &str) -> bool {
    let Some(rest) = name.strip_prefix(&format!("{vault} backup ")) else { return false };
    let b = rest.as_bytes();
    name.ends_with(".zip") && b.len() >= 10 && b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'-' && b[7] == b'-'
}

/// This vault's backups in `folder` (files named `<vault> backup <date>….zip` that hold the
/// backup manifest), newest first.
pub fn list_backups(folder: &Path, vault: &Path) -> Result<Vec<(SystemTime, PathBuf)>> {
    let name = vault_name(&dunce::canonicalize(vault).map_err(ioerr)?);
    let mut found: Vec<(SystemTime, String, PathBuf)> = Vec::new();
    for e in fs::read_dir(folder).map_err(ioerr)?.flatten() {
        let fname = e.file_name().to_string_lossy().to_string();
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() || !is_backup_name(&fname, &name) {
            continue;
        }
        let Ok(mut f) = File::open(e.path()) else { continue };
        if read_cd(&mut f).map_or(true, |cd| !cd.iter().any(|c| c.name == MANIFEST)) {
            continue;
        }
        found.push((m.modified().unwrap_or(UNIX_EPOCH), fname, e.path()));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    Ok(found.into_iter().map(|(t, _, p)| (t, p)).collect())
}

/// Deletes the oldest backups of this vault in `folder` beyond `keep` (at least 1); see
/// [`list_backups`] for which files count. Nothing else is touched.
pub fn prune(folder: &Path, vault: &Path, keep: usize) -> Result<Vec<PathBuf>> {
    let mut removed = Vec::new();
    for (_, p) in list_backups(folder, vault)?.into_iter().skip(keep.max(1)) {
        if fs::remove_file(&p).is_ok() {
            removed.push(p);
        }
    }
    Ok(removed)
}

// ---- settings ----------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Every {
    Off,
    Daily,
    Weekly,
}

/// `[backup]` in the merged config. Wrong types count as unset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupSettings {
    pub every: Every,
    pub folder: Option<PathBuf>,
    pub keep: usize,
    pub options: BackupOptions,
}

impl BackupSettings {
    pub fn from_json(cfg: &serde_json::Value) -> Self {
        let t = cfg.get("backup");
        let get = |k: &str| t.and_then(|t| t.get(k));
        let every = match get("every").and_then(|v| v.as_str()) {
            Some("daily") => Every::Daily,
            Some("weekly") => Every::Weekly,
            _ => Every::Off,
        };
        let folder = get("folder").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).map(|s| {
            match (s.strip_prefix("~/"), std::env::var_os("HOME")) {
                (Some(rest), Some(h)) => PathBuf::from(h).join(rest),
                _ => PathBuf::from(s),
            }
        });
        let keep = get("keep").and_then(|v| v.as_u64()).map_or(5, |n| (n as usize).clamp(1, 1000));
        let flag = |k: &str, d: bool| get(k).and_then(|v| v.as_bool()).unwrap_or(d);
        Self { every, folder, keep, options: BackupOptions { settings: flag("include_settings", true), history: flag("include_history", false) } }
    }

    /// Seconds after the newest backup when the next scheduled one is due.
    pub fn period_secs(&self) -> Option<u64> {
        match self.every {
            Every::Off => None,
            Every::Daily => Some(23 * 3600),
            Every::Weekly => Some(7 * 24 * 3600 - 3600),
        }
    }
}

/// True when the schedule wants a backup now: none yet, or the newest is older than the period.
pub fn is_due(s: &BackupSettings, vault: &Path) -> bool {
    let (Some(period), Some(folder)) = (s.period_secs(), s.folder.as_deref()) else { return false };
    match list_backups(folder, vault) {
        Ok(v) => v.first().map_or(true, |(t, _)| t.elapsed().map_or(false, |d| d.as_secs() >= period)),
        Err(_) => folder.is_dir(), // unreadable folder: do not guess; a missing one is not created
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn no() -> AtomicBool {
        AtomicBool::new(false)
    }
    fn vault() -> tempfile::TempDir {
        let t = tempfile::Builder::new().prefix("My Vault").tempdir().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("sub/deep")).unwrap();
        fs::create_dir_all(r.join(".trash")).unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::create_dir_all(r.join(META_DIR).join("history")).unwrap();
        fs::create_dir_all(r.join(META_DIR).join("recovery")).unwrap();
        fs::write(r.join("a.excalidraw"), b"{\"elements\":[]}").unwrap();
        fs::write(r.join("sub/note.md"), "# héllo\n".repeat(5000)).unwrap();
        fs::write(r.join("sub/deep/img.png"), (0..200_000u32).map(|i| (i * 31 % 251) as u8).collect::<Vec<_>>()).unwrap();
        fs::write(r.join("empty.md"), b"").unwrap();
        fs::write(r.join(".trash/gone.md"), b"x").unwrap();
        fs::write(r.join(".git/HEAD"), b"x").unwrap();
        fs::write(r.join(META_DIR).join("settings.toml"), b"a=1").unwrap();
        fs::write(r.join(META_DIR).join("history/h1"), b"hist").unwrap();
        fs::write(r.join(META_DIR).join("recovery/r1"), b"rec").unwrap();
        fs::write(r.join(".excalidraw-vault.lock"), b"").unwrap();
        t
    }
    fn names(zip: &Path) -> Vec<String> {
        let mut f = File::open(zip).unwrap();
        let mut v: Vec<_> = read_cd(&mut f).unwrap().into_iter().map(|e| e.name).collect();
        v.sort();
        v
    }
    fn tree(root: &Path) -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();
        fn go(d: &Path, rel: &str, out: &mut Vec<(String, Vec<u8>)>) {
            for e in fs::read_dir(d).unwrap().flatten() {
                let n = format!("{rel}{}", e.file_name().to_string_lossy());
                if e.path().is_dir() {
                    go(&e.path(), &format!("{n}/"), out)
                } else {
                    out.push((n, fs::read(e.path()).unwrap()))
                }
            }
        }
        go(root, "", &mut out);
        out.sort();
        out
    }

    #[test]
    fn round_trip_is_byte_identical_and_skips_dot_folders() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let r = create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        assert!(r.path.file_name().unwrap().to_string_lossy().starts_with("My Vault"));
        assert!(r.path.to_string_lossy().contains(" backup "));
        let n = names(&r.path);
        assert_eq!(n, ["a.excalidraw", "empty.md", "sub/deep/img.png", "sub/note.md", MANIFEST]);
        let out = tempfile::tempdir().unwrap();
        let restored = out.path().join("restored");
        restore(&r.path, &restored, &no(), &mut |_| {}).unwrap();
        let mut want = tree(v.path());
        want.retain(|(n, _)| !n.starts_with('.'));
        assert_eq!(tree(&restored), want);
        assert!(dest.path().read_dir().unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".part")));
    }

    #[test]
    fn options_add_settings_and_history_but_never_recovery_or_other_dot_folders() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let r = create(v.path(), dest.path(), BackupOptions { settings: true, history: true }, &no(), &mut |_| {}).unwrap();
        let n = names(&r.path);
        assert!(n.contains(&format!("{META_DIR}/settings.toml")));
        assert!(n.contains(&format!("{META_DIR}/history/h1")));
        assert!(!n.iter().any(|x| x.contains("recovery") || x.contains(".trash") || x.contains(".git") || x.contains(".lock")));
        // the vault is unchanged
        assert_eq!(fs::read(v.path().join("a.excalidraw")).unwrap(), b"{\"elements\":[]}");
    }

    #[test]
    fn cancel_leaves_no_partial_zip() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let c = AtomicBool::new(true);
        let e = create(v.path(), dest.path(), BackupOptions::default(), &c, &mut |_| {}).unwrap_err();
        assert_eq!(e.code, "CANCELLED");
        assert_eq!(dest.path().read_dir().unwrap().count(), 0);
        // cancelled while streaming (the first progress report flips the flag)
        let c = AtomicBool::new(false);
        let mut calls = 0;
        let e = create(v.path(), dest.path(), BackupOptions::default(), &c, &mut |_| {
            calls += 1;
            c.store(true, Ordering::Relaxed);
        });
        assert!(e.is_err() || calls == 0);
        assert!(dest.path().read_dir().unwrap().all(|e| e.unwrap().file_name().to_string_lossy().ends_with(".zip")));
    }

    #[test]
    fn refuses_a_destination_inside_the_vault() {
        let v = vault();
        let e = create(v.path(), &v.path().join("sub"), BackupOptions::default(), &no(), &mut |_| {}).unwrap_err();
        assert_eq!(e.code, "INVALID_PATH");
    }

    #[test]
    fn second_backup_same_day_gets_a_new_name() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let a = create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        let b = create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        assert_ne!(a.path, b.path);
        assert!(a.path.exists() && b.path.exists());
    }

    #[test]
    fn restore_refuses_an_existing_folder_and_changes_nothing() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let r = create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        let out = tempfile::tempdir().unwrap();
        fs::write(out.path().join("keep.txt"), b"mine").unwrap();
        let e = restore(&r.path, out.path(), &no(), &mut |_| {}).unwrap_err();
        assert_eq!(e.code, "NAME_COLLISION");
        assert_eq!(tree(out.path()), vec![("keep.txt".to_string(), b"mine".to_vec())]);
    }

    /// Writes a zip by hand with a chosen set of entry names (no checks), plus a manifest.
    fn evil_zip(path: &Path, names: &[&str]) {
        let mut zip = ZipOut::new(BufWriter::new(File::create(path).unwrap()));
        let mut files = Vec::new();
        for n in names {
            zip.entry(n, 0, |w| w.write_all(b"pwn").map_err(ioerr)).unwrap();
            files.push(ManifestFile { path: n.to_string(), size: 3, sha256: hex::encode(Sha256::digest(b"pwn")), mtime: 0 });
        }
        let json = serde_json::to_vec(&Manifest { format: 1, vault: "v".into(), created: 0, files }).unwrap();
        zip.entry(MANIFEST, 0, |w| w.write_all(&json).map_err(ioerr)).unwrap();
        zip.finish().unwrap().into_inner().unwrap();
    }

    #[test]
    fn zip_slip_paths_are_refused_and_nothing_is_written() {
        for bad_name in ["../evil.txt", "a/../../evil.txt", "/abs.txt", "C:/x.txt", "a\\b.txt", "a//b.txt", "./a.txt"] {
            let t = tempfile::tempdir().unwrap();
            let z = t.path().join("e.zip");
            evil_zip(&z, &[bad_name]);
            let dest = t.path().join("out");
            let e = restore(&z, &dest, &no(), &mut |_| {}).unwrap_err();
            assert_eq!(e.code, "INVALID_FILE", "{bad_name}");
            assert!(!dest.exists() && !t.path().join("evil.txt").exists(), "{bad_name}");
        }
        let t = tempfile::tempdir().unwrap();
        let z = t.path().join("e.zip");
        evil_zip(&z, &["A.md", "a.md"]);
        assert!(restore(&z, &t.path().join("out"), &no(), &mut |_| {}).is_err());
    }

    #[test]
    fn a_damaged_zip_fails_verification() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let r = create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        let mut bytes = fs::read(&r.path).unwrap();
        bytes[46] ^= 0xFF; // inside the first entry's data
        let bad_zip = dest.path().join("bad.zip");
        fs::write(&bad_zip, bytes).unwrap();
        assert!(verify_file(&bad_zip, &no(), &mut |_| {}).is_err());
        let out = tempfile::tempdir().unwrap();
        assert!(restore(&bad_zip, &out.path().join("r"), &no(), &mut |_| {}).is_err());
        assert!(!out.path().join("r").exists(), "a failed restore removes its new folder");
    }

    #[test]
    fn prune_keeps_the_newest_and_touches_only_backups() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let mut made = Vec::new();
        for _ in 0..4 {
            made.push(create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap().path);
        }
        // a look-alike that is not ours, and an unrelated file
        let fake = dest.path().join(format!("{} backup 2020-01-01.zip", vault_name(&dunce::canonicalize(v.path()).unwrap())));
        fs::write(&fake, b"not a zip").unwrap();
        fs::write(dest.path().join("notes.txt"), b"x").unwrap();
        let removed = prune(dest.path(), v.path(), 2).unwrap();
        assert_eq!(removed.len(), 2);
        assert!(fake.exists() && dest.path().join("notes.txt").exists());
        assert_eq!(made.iter().filter(|p| p.exists()).count(), 2);
    }

    #[test]
    fn settings_read_with_defaults_and_bad_types_unset() {
        let d = BackupSettings::from_json(&serde_json::json!({}));
        assert_eq!((d.every, d.keep, d.options.settings, d.options.history), (Every::Off, 5, true, false));
        let s = BackupSettings::from_json(&serde_json::json!({"backup": {"every": "weekly", "folder": "/b", "keep": 3, "include_history": true}}));
        assert_eq!((s.every, s.keep, s.folder.as_deref(), s.options.history), (Every::Weekly, 3, Some(Path::new("/b")), true));
        let bad = BackupSettings::from_json(&serde_json::json!({"backup": {"every": 7, "keep": "x", "folder": 1}}));
        assert_eq!((bad.every, bad.keep, bad.folder), (Every::Off, 5, None));
    }

    #[test]
    fn due_when_no_backup_or_an_old_one() {
        let v = vault();
        let dest = tempfile::tempdir().unwrap();
        let s = BackupSettings { every: Every::Daily, folder: Some(dest.path().to_path_buf()), keep: 5, options: BackupOptions::default() };
        assert!(is_due(&s, v.path()));
        create(v.path(), dest.path(), BackupOptions::default(), &no(), &mut |_| {}).unwrap();
        assert!(!is_due(&s, v.path()));
        assert!(!is_due(&BackupSettings { every: Every::Off, ..s.clone() }, v.path()));
    }

    #[test]
    fn dates_are_right() {
        assert_eq!(civil(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil(1_782_000_000).0, 2026);
        assert_eq!(dos_time(0).1, (1 << 5) | 1);
    }
}
