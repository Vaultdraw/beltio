//! `.vdh` container (PLAN §2.3): `VDH`, major (1 byte), header frame length (u32 LE), header zstd
//! frame (JSON, checksum on), body zstd frame (checksum on). Bounded decode (header ≤ 64 KiB,
//! body ≤ cap) — synced history is untrusted input (M13).
//!
//! Contract frozen at the H1 skeleton; agent A implements the bodies.

use super::names::{is_device, is_epoch, is_sha_ext, is_ulid};
use crate::{err, Result};
use serde::{Deserialize, Serialize};

pub const MAGIC: &[u8; 3] = b"VDH";
pub const MAJOR: u8 = 1;
pub const PREFIX_LEN: usize = 8;
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
/// Cap on the decoded header JSON. The 64 KiB bound applies to the compressed frame (one short
/// read); incompressible `blobs` lists of image-heavy drawings exceed 64 KiB of JSON.
pub const MAX_HEADER_JSON_BYTES: usize = 1024 * 1024;
pub const MAX_NAME_CHARS: usize = 120;
pub const MAX_NOTE_CHARS: usize = 2000;
pub const ZSTD_LEVEL: i32 = 3;

/// Header JSON v1. Unknown fields are ignored; new optional fields are a minor change.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub format: u32,
    /// "keyframe" | "delta" | "path"
    pub kind: String,
    pub id: String,
    pub lineage: String,
    pub device: String,
    pub epoch: String,
    pub created: u64,
    /// `Reason::as_str`
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Vault-relative drawing path at write time (validated with `validate_relative` on read).
    pub path: String,
    /// sha256 hex of the exact file bytes (the save path's revision).
    #[serde(default)]
    pub file_revision: String,
    /// sha256 hex of the stripped text.
    #[serde(default)]
    pub stripped_hash: String,
    #[serde(default)]
    pub file_size: u64,
    #[serde(default)]
    pub element_count: u32,
    /// Delta only: the keyframe id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframe: Option<String>,
    /// `<sha>.<ext>` tokens referenced by this version.
    #[serde(default)]
    pub blobs: Vec<String>,
    #[serde(default)]
    pub app: String,
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn bad(msg: &str) -> crate::NativeError {
    err("VERSION_CORRUPT", format!("history header: {msg}"))
}

/// A header path must be a plain relative `.excalidraw` path (the store layer additionally runs
/// the app's `validate_relative` / `safe_path` before any use).
pub fn is_sane_relative_path(p: &str) -> bool {
    p.len() <= 4096
        && p.ends_with(vaultdraw_core::DRAWING_EXT)
        && !p.starts_with('/')
        && !p.bytes().any(|b| b == 0 || b == b'\\' || b < 0x20)
        && p.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

impl Header {
    /// Checks every field against the M13 rules (ids, device, epoch, blobs, name/note length,
    /// hashes are 64 hex, path sanity). Called by `read_header`.
    pub fn validate(&self) -> Result<()> {
        if self.format != 1 {
            return Err(bad("unsupported format"));
        }
        if !is_ulid(&self.id) || !is_ulid(&self.lineage) {
            return Err(bad("bad id"));
        }
        if !is_device(&self.device) || !is_epoch(&self.epoch) {
            return Err(bad("bad device or epoch"));
        }
        match (self.kind.as_str(), &self.keyframe) {
            ("keyframe" | "path", None) => {}
            ("delta", Some(k)) if is_ulid(k) => {}
            _ => return Err(bad("kind and keyframe disagree")),
        }
        if self.reason.len() > 32 || !self.reason.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') {
            return Err(bad("bad reason"));
        }
        // Path records carry no scene, so they have no hashes.
        let hashes_ok = |h: &str| is_hex64(h) || (self.kind == "path" && h.is_empty());
        if !hashes_ok(&self.file_revision) || !hashes_ok(&self.stripped_hash) {
            return Err(bad("bad hash"));
        }
        if self.name.as_deref().is_some_and(|n| n.chars().count() > MAX_NAME_CHARS)
            || self.note.as_deref().is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS)
        {
            return Err(bad("name or note too long"));
        }
        if self.app.chars().count() > 128 {
            return Err(bad("app too long"));
        }
        if !is_sane_relative_path(&self.path) {
            return Err(bad("bad path"));
        }
        if !self.blobs.iter().all(|b| is_sha_ext(b)) {
            return Err(bad("bad blob token"));
        }
        Ok(())
    }
}

fn compress_frame(data: &[u8], level: i32) -> Vec<u8> {
    // Always writes the content size (bulk pledges it) and a checksum.
    let try_compress = || -> std::io::Result<Vec<u8>> {
        let mut c = zstd::bulk::Compressor::new(level)?;
        c.include_checksum(true)?;
        c.include_contentsize(true)?;
        c.compress(data)
    };
    // Compression into a sized buffer only fails on allocation problems; fall back to a raw-block
    // frame at level 1 rather than panicking.
    try_compress()
        .or_else(|_| zstd::bulk::compress(data, 1))
        .unwrap_or_default()
}

pub fn write_container(header: &Header, body: &[u8], level: i32) -> Vec<u8> {
    let json = serde_json::to_vec(header).unwrap_or_default();
    let hframe = compress_frame(&json, level);
    let bframe = compress_frame(body, level);
    let mut out = Vec::with_capacity(PREFIX_LEN + hframe.len() + bframe.len());
    out.extend_from_slice(MAGIC);
    out.push(MAJOR);
    out.extend_from_slice(&(hframe.len() as u32).to_le_bytes());
    out.extend_from_slice(&hframe);
    out.extend_from_slice(&bframe);
    out
}

/// Validates the 8-byte prefix and returns the declared header frame length.
fn check_prefix(prefix: &[u8]) -> Result<usize> {
    let p = prefix.get(..PREFIX_LEN).ok_or_else(|| err("VERSION_CORRUPT", "history file too short"))?;
    if &p[..3] != MAGIC {
        return Err(err("VERSION_CORRUPT", "not a history file"));
    }
    match p[3] {
        MAJOR => {}
        m if m > MAJOR => return Err(err("HISTORY_FORMAT_NEWER", "history written by a newer app")),
        _ => return Err(err("VERSION_CORRUPT", "bad history major")),
    }
    let len = u32::from_le_bytes([p[4], p[5], p[6], p[7]]) as usize;
    if len == 0 || len > MAX_HEADER_BYTES {
        return Err(err("VERSION_CORRUPT", "bad header length"));
    }
    Ok(len)
}

/// Header frame length declared in the prefix (so callers know how much to read).
pub fn header_len(prefix: &[u8]) -> Result<usize> {
    check_prefix(prefix)
}

/// Decodes one zstd frame that must fill `data` exactly, with a declared content size ≤ `cap`
/// (checked before allocating) and a checksum.
fn decode_frame(data: &[u8], cap: usize) -> Result<Vec<u8>> {
    let corrupt = |m: &str| err("VERSION_CORRUPT", format!("history frame: {m}"));
    // zstd magic, then the frame header descriptor: bit 2 = content checksum present.
    if data.len() < 6 || data[..4] != [0x28, 0xB5, 0x2F, 0xFD] || data[4] & 0x04 == 0 {
        return Err(corrupt("bad frame header or no checksum"));
    }
    let size = match zstd::zstd_safe::get_frame_content_size(data) {
        Ok(Some(n)) => n,
        _ => return Err(corrupt("no content size")),
    };
    if size > cap as u64 {
        return Err(corrupt("declared size over cap"));
    }
    match zstd::zstd_safe::find_frame_compressed_size(data) {
        Ok(n) if n == data.len() => {}
        _ => return Err(corrupt("frame length mismatch")),
    }
    let out = zstd::bulk::decompress(data, size as usize).map_err(|_| corrupt("decode failed"))?;
    if out.len() as u64 != size {
        return Err(corrupt("size mismatch"));
    }
    Ok(out)
}

/// Parses and validates the header from a prefix of the file (one 4 KiB pread usually suffices;
/// returns `VERSION_CORRUPT` if the prefix is too short for the declared header length).
pub fn read_header(prefix: &[u8]) -> Result<Header> {
    let len = check_prefix(prefix)?;
    let frame = prefix
        .get(PREFIX_LEN..PREFIX_LEN + len)
        .ok_or_else(|| err("VERSION_CORRUPT", "header prefix too short"))?;
    let json = decode_frame(frame, MAX_HEADER_JSON_BYTES)?;
    let header: Header = serde_json::from_slice(&json).map_err(|_| bad("not valid JSON"))?;
    header.validate()?;
    Ok(header)
}

/// Decodes the body frame, refusing more than `cap` bytes (declared content size checked first).
pub fn read_body(file: &[u8], cap: usize) -> Result<Vec<u8>> {
    let len = check_prefix(file)?;
    let frame = file
        .get(PREFIX_LEN + len..)
        .ok_or_else(|| err("VERSION_CORRUPT", "history file truncated"))?;
    decode_frame(frame, cap)
}
