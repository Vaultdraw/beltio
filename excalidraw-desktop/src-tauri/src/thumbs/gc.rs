//! Size cap for a vault's thumbnail cache: orphans first, then oldest mtime, down to 90% of the cap.
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub(super) const CAP_BYTES: u64 = 128 * 1024 * 1024;
/// Bounds of the `interface.thumbnail_cache_mb` setting (the app validates the same range).
pub(super) const MIN_CAP_MB: u64 = 8;
pub(super) const MAX_CAP_MB: u64 = 8192;

struct Item {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
    rev: String,
    is_png: bool,
}

/// Scan `<cache>/<xx>/*`: thumbnails, fail markers and stray temp files.
fn scan(cache: &Path) -> Vec<Item> {
    let mut out = Vec::new();
    let Ok(shards) = fs::read_dir(cache) else { return out };
    for shard in shards.flatten() {
        if !shard.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(files) = fs::read_dir(shard.path()) else { continue };
        for f in files.flatten() {
            let Ok(meta) = f.metadata() else { continue };
            let name = f.file_name().to_string_lossy().into_owned();
            out.push(Item {
                path: f.path(),
                size: meta.len(),
                modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                rev: name.split('.').next().unwrap_or("").to_string(),
                is_png: name.ends_with(".png"),
            });
        }
    }
    out
}

/// Total bytes of cached files (cheap enough to run once per session; GC refreshes it).
pub(super) fn dir_size(cache: &Path) -> u64 {
    scan(cache).iter().map(|i| i.size).sum()
}

/// Evict until the cache is at most `target` bytes; returns the remaining size.
/// Files younger than `min_age` are kept (a put may not be in the manifest yet).
pub(super) fn run(cache: &Path, referenced: &HashSet<String>, cap: u64, min_age: Duration) -> u64 {
    let now = SystemTime::now();
    let mut items = scan(cache);
    let mut total: u64 = items.iter().map(|i| i.size).sum();
    let young = |i: &Item| now.duration_since(i.modified).map(|d| d < min_age).unwrap_or(true);
    let remove = |i: &Item| fs::remove_file(&i.path).is_ok();
    // Fail markers (tiny) and temp files go with the orphans, unconditionally.
    items.retain(|i| {
        let junk = !i.is_png && !referenced.contains(&i.rev);
        if junk && !young(i) && remove(i) {
            total -= i.size;
            return false;
        }
        true
    });
    let target = cap / 10 * 9;
    if total <= cap {
        return total;
    }
    // Orphans first, then oldest.
    items.retain(|i| i.is_png);
    items.sort_by_key(|i| (referenced.contains(&i.rev), i.modified));
    for i in items {
        if total <= target {
            break;
        }
        if !young(&i) && remove(&i) {
            total -= i.size;
        }
    }
    total
}
