//! Community themes catalogue: the `index.json` and its preview images, cached on disk.
//!
//! Reading the cache needs no network and no consent. Every download goes through
//! `network::ensure_network_allowed(dirs, "themes")` first.

use super::{config, err, ioerr, network, theme_install, write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const PURPOSE: &str = "themes";
const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 512 * 1024;
const MAX_PREVIEWS: usize = 300;
const CACHE_DIR: &str = "theme-catalogue";
const PREVIEWS_DIR: &str = "previews";
const INDEX_FILE: &str = "index.json";
const META_FILE: &str = "index.meta.json";
const ACCEPT_JSON: &str = "application/json, text/plain, */*";
const ACCEPT_IMAGE: &str = "image/png, image/jpeg, image/webp";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct CatalogueIndex {
    pub json: String,
    pub sha256: String,
    pub fetched_at: u64,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Meta {
    sha256: String,
    url: String,
    fetched_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cache_dir(dirs: &config::Dirs) -> PathBuf {
    dirs.state.join(CACHE_DIR)
}

/// Creates `path` as a real directory (never through a symlink); errors when something else is there.
fn ensure_real_dir(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(err("INVALID_PATH", "The theme catalogue cache path is not a folder")),
        Err(_) => fs::create_dir(path).map_err(ioerr),
    }
}

fn ensure_cache(dirs: &config::Dirs, sub: Option<&str>) -> Result<PathBuf> {
    fs::create_dir_all(&dirs.state).map_err(ioerr)?;
    let root = cache_dir(dirs);
    ensure_real_dir(&root)?;
    match sub {
        Some(s) => {
            let p = root.join(s);
            ensure_real_dir(&p)?;
            Ok(p)
        }
        None => Ok(root),
    }
}

fn read_regular(path: &Path) -> Option<Vec<u8>> {
    let m = fs::symlink_metadata(path).ok()?;
    if !m.is_file() {
        return None;
    }
    fs::read(path).ok()
}

fn read_meta(root: &Path) -> Option<Meta> {
    serde_json::from_slice(&read_regular(&root.join(META_FILE))?).ok()
}

fn write_meta(root: &Path, meta: &Meta) -> Result<()> {
    let bytes = serde_json::to_vec(meta).map_err(|e| err("INTERNAL", e.to_string()))?;
    write_atomic(&root.join(META_FILE), &bytes)
}

fn is_json_object(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|v| v.is_object())
}

pub(crate) fn cached_in(dirs: &config::Dirs) -> Option<CatalogueIndex> {
    let root = cache_dir(dirs);
    let raw = read_regular(&root.join(INDEX_FILE))?;
    let meta = read_meta(&root)?;
    if theme_install::sha256_hex(&raw) != meta.sha256 {
        return None;
    }
    let text = String::from_utf8(raw).ok()?;
    let json = text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_owned();
    if !is_json_object(&json) {
        return None;
    }
    Some(CatalogueIndex { json, sha256: meta.sha256, fetched_at: meta.fetched_at, url: meta.url })
}

pub(crate) fn index_in(dirs: &config::Dirs, url: &str, max_bytes: u64) -> Result<CatalogueIndex> {
    network::ensure_network_allowed(dirs, PURPOSE)?;
    let parsed = network::parse_url(url)?;
    let bytes = network::get_bytes(&parsed, max_bytes.clamp(1, MAX_INDEX_BYTES), ACCEPT_JSON)?;
    let text = String::from_utf8(bytes.clone()).map_err(|_| err("INVALID_FILE", "The catalogue is not valid UTF-8"))?;
    let json = text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_owned();
    if !is_json_object(&json) {
        return Err(err("INVALID_FILE", "The catalogue is not a JSON object"));
    }
    let sha = theme_install::sha256_hex(&bytes);
    let root = ensure_cache(dirs, None)?;
    let fetched_at = now_secs();
    let same = read_meta(&root).is_some_and(|m| m.sha256 == sha && m.url == url)
        && read_regular(&root.join(INDEX_FILE)).is_some_and(|b| b == bytes);
    if !same {
        write_atomic(&root.join(INDEX_FILE), &bytes)?;
    }
    write_meta(&root, &Meta { sha256: sha.clone(), url: url.to_owned(), fetched_at })?;
    Ok(CatalogueIndex { json, sha256: sha, fetched_at, url: url.to_owned() })
}

fn image_kind(b: &[u8]) -> bool {
    b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
        || b.starts_with(&[0xFF, 0xD8, 0xFF])
        || (b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP")
}

/// Keeps the `keep` newest regular files (by modified time) of `dir`; temp files are left alone.
fn prune_dir(dir: &Path, keep: usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = rd
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| {
            let m = fs::symlink_metadata(e.path()).ok()?;
            m.is_file().then(|| (m.modified().unwrap_or(UNIX_EPOCH), e.path()))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (_, p) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(p);
    }
}

pub(crate) fn preview_in(dirs: &config::Dirs, url: &str, max_bytes: u64, keep: usize) -> Result<Vec<u8>> {
    let name = theme_install::sha256_hex(url.as_bytes());
    let dir = cache_dir(dirs).join(PREVIEWS_DIR);
    if let Some(b) = read_regular(&dir.join(&name)).filter(|b| image_kind(b)) {
        return Ok(b);
    }
    network::ensure_network_allowed(dirs, PURPOSE)?;
    let parsed = network::parse_url(url)?;
    let bytes = network::get_bytes(&parsed, max_bytes.clamp(1, MAX_PREVIEW_BYTES), ACCEPT_IMAGE)?;
    if !image_kind(&bytes) {
        return Err(err("INVALID_FILE", "The preview is not a PNG, JPEG or WebP image"));
    }
    let dir = ensure_cache(dirs, Some(PREVIEWS_DIR))?;
    write_atomic(&dir.join(&name), &bytes)?;
    prune_dir(&dir, keep);
    Ok(bytes)
}

#[tauri::command]
pub(crate) async fn theme_catalogue_cached() -> Result<Option<CatalogueIndex>> {
    theme_install::blocking(|d| Ok(cached_in(&d))).await
}

#[tauri::command]
pub(crate) async fn theme_catalogue_index(url: String, max_bytes: u64) -> Result<CatalogueIndex> {
    theme_install::blocking(move |d| index_in(&d, &url, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn theme_catalogue_preview(url: String, max_bytes: u64) -> Result<tauri::ipc::Response> {
    let bytes = theme_install::blocking(move |d| preview_in(&d, &url, max_bytes, MAX_PREVIEWS)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests;
