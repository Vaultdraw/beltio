//! A strict reader for the plugin zips `vaultdraw-plugin package` writes (sdk/docs/packaging.md).
//!
//! It extracts nothing by itself: `read` returns the entries (name and bytes) after checking
//! the archive, and `extract` writes them under a folder. The rules match `vaultdraw-plugin
//! check`: no absolute paths, `.`/`..` segments, backslashes, control characters, repeated
//! names (also by case), symbolic links, encryption, zip64, multi-disk archives or archive
//! comment; only stored and deflate; sizes and CRCs must match; at most 1000 entries and
//! 8 MB uncompressed; `plugin.toml` at the root.
use crate::{err, ioerr, Result};
use flate2::{read::DeflateDecoder, Crc};
use std::{collections::HashSet, fs, io::Read, path::Path};

pub(crate) const MAX_ENTRIES: usize = 1000;
pub(crate) const MAX_UNCOMPRESSED: u64 = 8 * 1024 * 1024;

pub(crate) struct Entry {
    pub name: String,
    pub data: Vec<u8>,
}

fn bad(msg: impl Into<String>) -> crate::NativeError {
    err("INVALID_FILE", format!("Not a valid plugin package: {}", msg.into()))
}

fn u16_at(b: &[u8], i: usize) -> Option<usize> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?) as usize)
}

fn u32_at(b: &[u8], i: usize) -> Option<u64> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?) as u64)
}

fn check_name(name: &str) -> Result<()> {
    if name.is_empty() || name.starts_with('/') || name.ends_with('/') {
        return Err(bad(format!("entry name `{name}`")));
    }
    if name.contains('\\') || name.chars().any(|c| c.is_control()) {
        return Err(bad(format!("entry name `{}` has a backslash or control character", name.escape_debug())));
    }
    let mut chars = name.chars();
    if chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.next() == Some(':') {
        return Err(bad(format!("entry name `{name}` has a drive letter")));
    }
    if name.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return Err(bad(format!("entry name `{name}` has an empty, `.` or `..` segment")));
    }
    Ok(())
}

/// Reads and checks the whole archive in memory.
pub(crate) fn read(bytes: &[u8]) -> Result<Vec<Entry>> {
    if bytes.len() < 22 {
        return Err(bad("too short"));
    }
    let eocd = bytes.len() - 22;
    if bytes[eocd..eocd + 4] != [0x50, 0x4b, 5, 6] {
        return Err(bad("no end record (a zip comment is not allowed)"));
    }
    let (disk, cd_disk) = (u16_at(bytes, eocd + 4), u16_at(bytes, eocd + 6));
    if disk != Some(0) || cd_disk != Some(0) {
        return Err(bad("multi-disk archives are not allowed"));
    }
    let n = u16_at(bytes, eocd + 10).ok_or_else(|| bad("truncated"))?;
    let total = u16_at(bytes, eocd + 8).ok_or_else(|| bad("truncated"))?;
    if n != total || n == 0xffff {
        return Err(bad("zip64 or inconsistent entry count"));
    }
    if n > MAX_ENTRIES {
        return Err(bad(format!("more than {MAX_ENTRIES} entries")));
    }
    let cd_size = u32_at(bytes, eocd + 12).ok_or_else(|| bad("truncated"))? as usize;
    let cd_off = u32_at(bytes, eocd + 16).ok_or_else(|| bad("truncated"))? as usize;
    if cd_size == 0xffff_ffff || cd_off == 0xffff_ffff || cd_off.checked_add(cd_size) != Some(eocd) {
        return Err(bad("zip64 or a damaged central directory"));
    }
    let mut pos = cd_off;
    let mut out = Vec::with_capacity(n);
    let mut seen = HashSet::new();
    let mut budget = 0u64;
    for _ in 0..n {
        if bytes.get(pos..pos + 4) != Some(&[0x50, 0x4b, 1, 2]) {
            return Err(bad("damaged central directory"));
        }
        let field = |i: usize| u16_at(bytes, pos + i).ok_or_else(|| bad("truncated"));
        let field32 = |i: usize| u32_at(bytes, pos + i).ok_or_else(|| bad("truncated"));
        let flags = field(8)?;
        let method = field(10)?;
        let crc = field32(16)?;
        let csize = field32(20)?;
        let usize_ = field32(24)?;
        let (nlen, elen, clen) = (field(28)?, field(30)?, field(32)?);
        let disk_start = field(34)?;
        let attrs = field32(38)?;
        let local = field32(42)? as usize;
        let name_bytes = bytes.get(pos + 46..pos + 46 + nlen).ok_or_else(|| bad("truncated"))?;
        let name = std::str::from_utf8(name_bytes).map_err(|_| bad("entry name is not UTF-8"))?.to_owned();
        pos += 46 + nlen + elen + clen;
        if pos > cd_off + cd_size {
            return Err(bad("damaged central directory"));
        }
        if flags & 1 != 0 {
            return Err(bad(format!("`{name}` is encrypted")));
        }
        if disk_start != 0 || csize == 0xffff_ffff || usize_ == 0xffff_ffff || local == 0xffff_ffff {
            return Err(bad("zip64 or multi-disk entry"));
        }
        if (attrs >> 16) & 0o170000 == 0o120000 {
            return Err(bad(format!("`{name}` is a symbolic link")));
        }
        check_name(&name)?;
        if !seen.insert(name.to_lowercase()) {
            return Err(bad(format!("`{name}` appears twice (names are compared without case)")));
        }
        budget += usize_;
        if budget > MAX_UNCOMPRESSED {
            return Err(bad("more than 8 MB uncompressed"));
        }
        if bytes.get(local..local + 4) != Some(&[0x50, 0x4b, 3, 4]) {
            return Err(bad(format!("`{name}` has no local header")));
        }
        let lnlen = u16_at(bytes, local + 26).ok_or_else(|| bad("truncated"))?;
        let lelen = u16_at(bytes, local + 28).ok_or_else(|| bad("truncated"))?;
        let start = local + 30 + lnlen + lelen;
        let raw = bytes
            .get(start..start.checked_add(csize as usize).ok_or_else(|| bad("truncated"))?)
            .ok_or_else(|| bad(format!("`{name}` runs past the end")))?;
        let data = match method {
            0 => {
                if csize != usize_ {
                    return Err(bad(format!("`{name}` has the wrong size")));
                }
                raw.to_vec()
            }
            8 => {
                let mut data = Vec::with_capacity(usize_ as usize);
                DeflateDecoder::new(raw)
                    .take(usize_ + 1)
                    .read_to_end(&mut data)
                    .map_err(|_| bad(format!("`{name}` does not inflate")))?;
                data
            }
            _ => return Err(bad(format!("`{name}` uses an unsupported compression method"))),
        };
        if data.len() as u64 != usize_ {
            return Err(bad(format!("`{name}` has the wrong size")));
        }
        let mut c = Crc::new();
        c.update(&data);
        if c.sum() as u64 != crc {
            return Err(bad(format!("`{name}` fails its checksum")));
        }
        out.push(Entry { name, data });
    }
    if pos != cd_off + cd_size {
        return Err(bad("damaged central directory"));
    }
    if !out.iter().any(|e| e.name == "plugin.toml") {
        return Err(bad("plugin.toml must be at the root of the zip, not in a folder"));
    }
    Ok(out)
}

/// Writes the entries under `dir` (created; each name was vetted by `read`).
pub(crate) fn extract(entries: &[Entry], dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(ioerr)?;
    for e in entries {
        let target = dir.join(&e.name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(ioerr)?;
        }
        fs::write(&target, &e.data).map_err(ioerr)?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod testzip {
    use flate2::{write::DeflateEncoder, Compression, Crc};
    use std::io::Write;

    /// (name, data, deflate). Builds a zip the way the packager does.
    pub(crate) fn build(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut cd = Vec::new();
        for (name, data, deflate) in entries {
            let mut c = Crc::new();
            c.update(data);
            let stored: Vec<u8> = if *deflate {
                let mut e = DeflateEncoder::new(Vec::new(), Compression::best());
                e.write_all(data).unwrap();
                e.finish().unwrap()
            } else {
                data.to_vec()
            };
            let method: u16 = if *deflate { 8 } else { 0 };
            let off = out.len() as u32;
            out.extend([0x50, 0x4b, 3, 4, 20, 0, 0, 0]);
            out.extend(method.to_le_bytes());
            out.extend([0, 0, 0x21, 0]);
            out.extend(c.sum().to_le_bytes());
            out.extend((stored.len() as u32).to_le_bytes());
            out.extend((data.len() as u32).to_le_bytes());
            out.extend((name.len() as u16).to_le_bytes());
            out.extend([0, 0]);
            out.extend(name.as_bytes());
            out.extend(&stored);
            cd.extend([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 0]);
            cd.extend(method.to_le_bytes());
            cd.extend([0, 0, 0x21, 0]);
            cd.extend(c.sum().to_le_bytes());
            cd.extend((stored.len() as u32).to_le_bytes());
            cd.extend((data.len() as u32).to_le_bytes());
            cd.extend((name.len() as u16).to_le_bytes());
            cd.extend([0, 0, 0, 0, 0, 0, 0, 0]);
            cd.extend(0o100644u32.wrapping_shl(16).to_le_bytes());
            cd.extend(off.to_le_bytes());
            cd.extend(name.as_bytes());
        }
        let cd_off = out.len() as u32;
        out.extend(&cd);
        out.extend([0x50, 0x4b, 5, 6, 0, 0, 0, 0]);
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((cd.len() as u32).to_le_bytes());
        out.extend(cd_off.to_le_bytes());
        out.extend([0, 0]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::testzip::build;
    use super::*;

    fn code(r: Result<Vec<Entry>>) -> String {
        r.err().map(|e| e.message).unwrap_or_default()
    }

    #[test]
    fn reads_stored_and_deflated() {
        let big = "x".repeat(500);
        let z = build(&[("main.js", big.as_bytes(), true), ("plugin.toml", b"id = \"a\"", false)]);
        let e = read(&z).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].data, big.as_bytes());
        assert_eq!(e[1].name, "plugin.toml");
    }

    #[test]
    fn refuses_bad_names_and_layout() {
        for name in ["../x", "/abs", "a\\b", "C:x", "a//b", "./a", "a/./b"] {
            let z = build(&[("plugin.toml", b"x", false), (name, b"x", false)]);
            assert!(code(read(&z)).contains("not a valid") || code(read(&z)).contains("Not a valid"), "{name}");
        }
        let z = build(&[("top/plugin.toml", b"x", false)]);
        assert!(code(read(&z)).contains("plugin.toml must be at the root"));
        let z = build(&[("plugin.toml", b"x", false), ("PLUGIN.toml", b"y", false)]);
        assert!(code(read(&z)).contains("appears twice"));
    }

    #[test]
    fn refuses_damage() {
        let mut z = build(&[("plugin.toml", b"hello world", false)]);
        let i = z.iter().position(|&b| b == b'h').unwrap();
        z[i] = b'j';
        assert!(code(read(&z)).contains("checksum"));
        assert!(read(&[1, 2, 3]).is_err());
        let mut z = build(&[("plugin.toml", b"x", false)]);
        z.extend([0]); // a trailing byte hides the end record
        assert!(read(&z).is_err());
    }

    #[test]
    fn refuses_symlink_and_oversize() {
        let mut z = build(&[("plugin.toml", b"x", false)]);
        let cd = z.windows(4).position(|w| w == [0x50, 0x4b, 1, 2]).unwrap();
        z[cd + 38..cd + 42].copy_from_slice(&(0o120777u32 << 16).to_le_bytes());
        assert!(code(read(&z)).contains("symbolic link"));
        let big = vec![0u8; 9 * 1024 * 1024];
        let z = build(&[("plugin.toml", b"x", false), ("big.bin", &big, true)]);
        assert!(code(read(&z)).contains("8 MB"));
    }
}
