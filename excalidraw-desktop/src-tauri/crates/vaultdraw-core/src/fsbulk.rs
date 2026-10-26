//! Reading one folder with its file sizes and times in as few system calls as the platform
//! allows. On macOS `getattrlistbulk` returns name, type, size and modified time for many
//! entries per call (the way Finder and ripgrep-style walkers avoid a `stat` per file); other
//! platforms, and file systems that do not support it, use `read_dir` plus one `metadata`
//! call per accepted entry. Symbolic links and anything that is neither a file nor a folder
//! are never returned.

use crate::paths::now_ms;
use std::{fs, io, path::Path};

/// One folder entry that passed the caller's filter.
pub struct RawEntry {
    pub name: String,
    pub is_dir: bool,
    /// Byte length for files, 0 for folders.
    pub size: u64,
    /// Modified time in milliseconds since the Unix epoch (0 if unknown).
    pub modified_ms: u64,
}

/// Lists `dir`. `accept(name, is_dir)` runs before any size or time is read, so entries the
/// caller does not want cost nothing on the fallback path. Order is the file system's.
pub fn read_dir_entries(dir: &Path, accept: &mut dyn FnMut(&str, bool) -> bool) -> io::Result<Vec<RawEntry>> {
    #[cfg(target_os = "macos")]
    if let Some(res) = macos::read_dir_bulk(dir, accept) {
        return res;
    }
    read_dir_fallback(dir, accept)
}

pub(crate) fn read_dir_fallback(dir: &Path, accept: &mut dyn FnMut(&str, bool) -> bool) -> io::Result<Vec<RawEntry>> {
    let mut out = Vec::new();
    for item in fs::read_dir(dir)? {
        let item = item?;
        let ft = item.file_type()?;
        if ft.is_symlink() || !(ft.is_dir() || ft.is_file()) {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if !accept(&name, ft.is_dir()) {
            continue;
        }
        let md = item.metadata()?;
        out.push(RawEntry {
            name,
            is_dir: ft.is_dir(),
            size: if ft.is_file() { md.len() } else { 0 },
            modified_ms: md.modified().map(now_ms).unwrap_or_default(),
        });
    }
    Ok(out)
}


#[cfg(target_os = "macos")]
mod macos {
    use super::RawEntry;
    use libc::{
        attrlist, c_void, close, getattrlistbulk, open, ATTR_BIT_MAP_COUNT, ATTR_CMN_MODTIME, ATTR_CMN_NAME, ATTR_CMN_OBJTYPE,
        ATTR_CMN_RETURNED_ATTRS, ATTR_FILE_DATALENGTH, O_CLOEXEC, O_DIRECTORY, O_RDONLY,
    };
    use std::{ffi::CString, io, os::unix::ffi::OsStrExt, path::Path};

    const VREG: u32 = 1;
    const VDIR: u32 = 2;
    /// Common attribute bit for a per-entry error code (`ATTR_CMN_ERROR`).
    const ATTR_CMN_ERROR: u32 = 0x2000_0000;
    const BUF_BYTES: usize = 128 * 1024;

    fn rd_u32(b: &[u8], at: usize) -> Option<u32> {
        Some(u32::from_ne_bytes(b.get(at..at + 4)?.try_into().ok()?))
    }
    fn rd_i32(b: &[u8], at: usize) -> Option<i32> {
        Some(i32::from_ne_bytes(b.get(at..at + 4)?.try_into().ok()?))
    }
    fn rd_i64(b: &[u8], at: usize) -> Option<i64> {
        Some(i64::from_ne_bytes(b.get(at..at + 8)?.try_into().ok()?))
    }

    /// `None` when the bulk call is not usable here (the caller falls back); `Some(Err)` for a
    /// real error such as a permission failure.
    pub fn read_dir_bulk(dir: &Path, accept: &mut dyn FnMut(&str, bool) -> bool) -> Option<io::Result<Vec<RawEntry>>> {
        let c = CString::new(dir.as_os_str().as_bytes()).ok()?;
        // SAFETY: plain open of a NUL-terminated path; the descriptor is closed below.
        let fd = unsafe { open(c.as_ptr(), O_RDONLY | O_DIRECTORY | O_CLOEXEC) };
        if fd < 0 {
            return Some(Err(io::Error::last_os_error()));
        }
        let mut list: attrlist = unsafe { std::mem::zeroed() };
        list.bitmapcount = ATTR_BIT_MAP_COUNT;
        list.commonattr = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_OBJTYPE | ATTR_CMN_MODTIME | ATTR_CMN_ERROR;
        list.fileattr = ATTR_FILE_DATALENGTH;
        // u64 backing keeps the buffer 8-byte aligned.
        let mut buf = vec![0u64; BUF_BYTES / 8];
        let mut out = Vec::new();
        let mut first = true;
        let result = loop {
            // SAFETY: `list` and `buf` are valid for the call; BUF_BYTES is the buffer size.
            let n = unsafe { getattrlistbulk(fd, &mut list as *mut attrlist as *mut c_void, buf.as_mut_ptr() as *mut c_void, BUF_BYTES, 0) };
            if n < 0 {
                let e = io::Error::last_os_error();
                // Not supported by this file system: let the caller use read_dir.
                if first && matches!(e.raw_os_error(), Some(libc::ENOTSUP) | Some(libc::EINVAL)) {
                    break None;
                }
                break Some(Err(e));
            }
            first = false;
            if n == 0 {
                break Some(Ok(out));
            }
            let bytes: &[u8] = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, BUF_BYTES) };
            let mut at = 0usize;
            let mut bad = false;
            for _ in 0..n {
                match parse_entry(&bytes[at..], accept) {
                    Some((len, entry)) => {
                        out.extend(entry);
                        at += len;
                    }
                    None => {
                        bad = true;
                        break;
                    }
                }
            }
            if bad {
                break Some(Err(io::Error::new(io::ErrorKind::InvalidData, "unreadable directory record")));
            }
        };
        // SAFETY: fd came from open above and is closed once.
        unsafe { close(fd) };
        result
    }

    /// One packed record: `u32 length`, returned-attribute set (5 x u32), then each requested
    /// attribute that was returned, in bit order: name reference, object type, modified time
    /// (timespec), error code, file data length. Returns the record length and the entry if
    /// it is wanted.
    fn parse_entry(b: &[u8], accept: &mut dyn FnMut(&str, bool) -> bool) -> Option<(usize, Option<RawEntry>)> {
        let len = rd_u32(b, 0)? as usize;
        if len < 24 || len > b.len() {
            return None;
        }
        let common = rd_u32(b, 4)?;
        let mut at = 24; // length + returned set (common, vol, dir, file, fork)
        let (mut name_at, mut name_len) = (None, 0usize);
        if common & ATTR_CMN_NAME != 0 {
            let off = rd_i32(b, at)?;
            name_len = rd_u32(b, at + 4)? as usize;
            name_at = Some((at as i64 + off as i64) as usize);
            at += 8;
        }
        let mut kind = 0;
        if common & ATTR_CMN_OBJTYPE != 0 {
            kind = rd_u32(b, at)?;
            at += 4;
        }
        let mut mtime_ms = 0u64;
        if common & ATTR_CMN_MODTIME != 0 {
            let (s, ns) = (rd_i64(b, at)?, rd_i64(b, at + 8)?);
            mtime_ms = (s.max(0) as u64).saturating_mul(1000).saturating_add((ns.max(0) / 1_000_000) as u64);
            at += 16;
        }
        if common & ATTR_CMN_ERROR != 0 {
            if rd_u32(b, at)? != 0 {
                return Some((len, None));
            }
            at += 4;
        }
        let file_attr = rd_u32(b, 16)?;
        let mut size = 0u64;
        if file_attr & ATTR_FILE_DATALENGTH != 0 {
            size = rd_i64(b, at)?.max(0) as u64;
        }
        if kind != VREG && kind != VDIR {
            return Some((len, None));
        }
        let start = name_at?;
        let raw = b.get(start..start.checked_add(name_len)?)?;
        let raw = raw.strip_suffix(&[0]).unwrap_or(raw);
        let name = String::from_utf8_lossy(raw);
        let is_dir = kind == VDIR;
        if !accept(&name, is_dir) {
            return Some((len, None));
        }
        Some((len, Some(RawEntry { name: name.into_owned(), is_dir, size: if is_dir { 0 } else { size }, modified_ms: mtime_ms })))
    }
}
