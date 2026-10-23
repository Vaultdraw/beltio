//! Snapshot persistence: `<state>/index/<vault-id>/index.bin`.
//!
//! Layout: magic `VDSI`, u32 format version, u32 normaliser version, u32 crc32 of the
//! payload, then the postcard payload `(saved_at_ms, docs)`. Anything unexpected
//! (missing, corrupt, wrong version, oversize) reads as "no snapshot".

use super::index::{DocEntry, Index};
use super::normalize::NORMALIZER_VERSION;
use crate::{err, ioerr, Result};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

const MAGIC: &[u8; 4] = b"VDSI";
const FORMAT_VERSION: u32 = 3;
const HEADER_LEN: usize = 16;
const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;

/// First 16 hex chars of sha256(root): the per-vault folder name under the state dir (shared with file history).
pub fn vault_id(root: &Path) -> String {
    hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()))[..16].to_string()
}

/// `<state_dir>/index/<vault-id>/index.bin`.
pub fn snapshot_path(state_dir: &Path, root: &Path) -> PathBuf {
    state_dir.join("index").join(vault_id(root)).join("index.bin")
}

pub fn save(path: &Path, saved_at_ms: u64, index: &Index) -> Result<()> {
    // Header first (crc patched afterwards) so the payload is encoded in place, with no second copy.
    // Reserved up front from the in-memory size (untouched pages cost nothing), so it never regrows.
    let mut header = Vec::with_capacity((index.approx_heap_bytes() + HEADER_LEN).min(MAX_SNAPSHOT_BYTES as usize));
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    header.extend_from_slice(&NORMALIZER_VERSION.to_le_bytes());
    header.extend_from_slice(&[0; 4]);
    let mut out = postcard::to_extend(&(saved_at_ms, index.docs()), header).map_err(|e| err("INTERNAL", format!("Index snapshot encode failed: {e}")))?;
    let crc = crc32fast::hash(&out[HEADER_LEN..]);
    out[12..HEADER_LEN].copy_from_slice(&crc.to_le_bytes());
    fs::create_dir_all(path.parent().ok_or_else(|| err("INVALID_PATH", "Snapshot has no parent"))?).map_err(ioerr)?;
    write_cache(path, &out)
}

/// Writes the snapshot through a temp file and a rename, without `fsync`: it is a cache whose CRC
/// rejects a torn file (the next start just rebuilds), and `fsync` is `F_FULLFSYNC` on macOS,
/// tens of milliseconds on the cold path of every first CLI call.
fn write_cache(path: &Path, bytes: &[u8]) -> Result<()> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("tmp-{}-{seq}", std::process::id()));
    let r = fs::write(&tmp, bytes).and_then(|()| fs::rename(&tmp, path));
    if r.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    r.map_err(ioerr)
}

/// The saved index and the time (ms) it was written.
pub fn load(path: &Path) -> Option<(u64, Index)> {
    if fs::metadata(path).ok()?.len() > MAX_SNAPSHOT_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let header = bytes.get(..HEADER_LEN)?;
    let word = |i: usize| u32::from_le_bytes([header[i], header[i + 1], header[i + 2], header[i + 3]]);
    if &header[..4] != MAGIC || word(4) != FORMAT_VERSION || word(8) != NORMALIZER_VERSION {
        return None;
    }
    let payload = &bytes[HEADER_LEN..];
    if crc32fast::hash(payload) != word(12) {
        return None;
    }
    let (saved_at, docs): (u64, HashMap<String, DocEntry>) = postcard::from_bytes(payload).ok()?;
    Some((saved_at, Index::from_docs(docs)?))
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use crate::search::extract::{ItemKind, TextItem};

    fn sample() -> Index {
        let mut idx = Index::default();
        let items = vec![TextItem { element_id: "a".into(), container_id: Some("c".into()), kind: ItemKind::Frame, text: "Café ☕".into() }];
        idx.upsert("x/a.excalidraw".into(), DocEntry::new("x/a.excalidraw", (10, 20), items));
        idx.upsert("b.excalidraw".into(), DocEntry::name_only("b.excalidraw"));
        idx
    }

    #[test]
    fn roundtrip_preserves_entries_and_rebuilds_derived_fields() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("i/index.bin");
        save(&file, 123, &sample()).unwrap();
        let (at, idx) = load(&file).unwrap();
        assert_eq!(at, 123);
        assert_eq!(idx.counts(), (1, 2));
        assert_eq!(idx.get("x/a.excalidraw").unwrap().stat, (10, 20));
        let (hits, _) = idx.query("cafe", crate::search::types::Scope::All, 5);
        assert_eq!(hits[0].matches[0].container_id.as_deref(), Some("c"));
    }

    #[test]
    fn save_replaces_the_snapshot_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("i/index.bin");
        save(&file, 1, &sample()).unwrap();
        save(&file, 2, &sample()).unwrap();
        assert_eq!(load(&file).unwrap().0, 2);
        let names: Vec<_> = fs::read_dir(file.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        assert_eq!(names, vec!["index.bin"]);
    }

    #[test]
    fn element_links_and_hash_survive_the_snapshot_and_old_formats_rebuild() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("index.bin");
        let mut idx = Index::default();
        let d = DocEntry::new("a.excalidraw", (1, 2), vec![]).with_links(vec![crate::search::ElementLink { element_id: "e".into(), link: "[[B]]".into() }], [9; 8]);
        idx.upsert("a.excalidraw".into(), d);
        save(&file, 1, &idx).unwrap();
        let (_, back) = load(&file).unwrap();
        let d = back.get("a.excalidraw").unwrap();
        assert_eq!((&*d.elinks[0].link, d.hash8), ("[[B]]", [9; 8]));
        // a snapshot written by an older format (v1: no element links, v2: no formulas) is ignored, so every vault rebuilds once
        let mut old = fs::read(&file).unwrap();
        old[4..8].copy_from_slice(&1u32.to_le_bytes());
        fs::write(&file, old).unwrap();
        assert!(load(&file).is_none());
        assert_eq!(FORMAT_VERSION, 3);
    }

    #[test]
    fn missing_corrupt_truncated_and_mismatched_files_load_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("index.bin");
        assert!(load(&file).is_none());
        save(&file, 1, &sample()).unwrap();
        let good = fs::read(&file).unwrap();
        // flipped payload byte
        let mut bad = good.clone();
        *bad.last_mut().unwrap() ^= 0xFF;
        fs::write(&file, &bad).unwrap();
        assert!(load(&file).is_none());
        // truncated
        fs::write(&file, &good[..good.len() - 3]).unwrap();
        assert!(load(&file).is_none());
        fs::write(&file, &good[..8]).unwrap();
        assert!(load(&file).is_none());
        // wrong magic / format / normaliser version
        for (off, byte) in [(0, b'X'), (4, 9), (8, 9)] {
            let mut bad = good.clone();
            bad[off] = byte;
            fs::write(&file, &bad).unwrap();
            assert!(load(&file).is_none(), "offset {off}");
        }
        fs::write(&file, &good).unwrap();
        assert!(load(&file).is_some());
    }

    #[test]
    fn snapshot_path_is_stable_and_per_vault() {
        let a = snapshot_path(Path::new("/s"), Path::new("/v/one"));
        assert_eq!(a, snapshot_path(Path::new("/s"), Path::new("/v/one")));
        assert_ne!(a, snapshot_path(Path::new("/s"), Path::new("/v/two")));
        assert!(a.starts_with("/s/index") && a.ends_with("index.bin"));
        assert_eq!(a.parent().unwrap().file_name().unwrap().len(), 16);
    }
}
