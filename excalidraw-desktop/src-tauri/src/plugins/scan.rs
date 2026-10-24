//! Plugin discovery: one level of folders under the user and bundled roots, `plugin.toml` only.
//! A persisted cache (keyed by folder, manifest and main stamps) lets a warm scan skip TOML parsing.
use super::manifest::{self, Manifest};
use crate::{write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Instant, UNIX_EPOCH},
};

const MANIFEST_FILE: &str = "plugin.toml";
const CACHE_FILE: &str = "plugins-cache.json";
const CACHE_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Source {
    User,
    Bundled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInfo {
    #[serde(flatten)]
    pub manifest: Manifest,
    pub source: Source,
    pub dir: String,
    pub main_bytes: u64,
    pub compatible: bool,
    pub problem: Option<String>,
    pub host_disabled: Option<String>,
    /// Set by `plugins_list`: declared permissions against the consent record.
    pub review: super::consent::Review,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ScanError {
    pub dir: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginsList {
    pub plugins: Vec<PluginInfo>,
    pub errors: Vec<ScanError>,
    pub scan_ms: f64,
    /// Set by `plugins_list`: this launch's safe mode, if any.
    pub safe_mode: Option<super::launch::SafeMode>,
}

/// Where the scheme handler and uninstall find a plugin.
#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub dir: PathBuf,
    /// Canonical plugin folder; served files must stay inside it.
    pub canonical: PathBuf,
    pub source: Source,
}
pub(crate) type Index = HashMap<String, Entry>;

pub(crate) struct Roots {
    pub user: PathBuf,
    pub bundled: Option<PathBuf>,
}

pub(crate) struct Scanned {
    pub list: PluginsList,
    pub index: Index,
    /// Manifests parsed from TOML (cache misses); read by tests.
    #[allow(dead_code)]
    pub parsed: usize,
}

type Stamp = (u64, u64);

fn stamp(m: &fs::Metadata) -> Stamp {
    let nanos = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos() as u64);
    (nanos, m.len())
}

#[derive(Clone, Serialize, Deserialize)]
struct CacheEntry {
    manifest_stamp: Stamp,
    main_stamp: Stamp,
    manifest: Manifest,
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    app: String,
    entries: HashMap<String, CacheEntry>,
}

fn load_cache(path: Option<&Path>, app_version: &str) -> Cache {
    path.and_then(|p| crate::read_bounded(p, 8 * 1024 * 1024).ok())
        .and_then(|b| serde_json::from_slice::<Cache>(&b).ok())
        .filter(|c| c.version == CACHE_VERSION && c.app == app_version)
        .unwrap_or_default()
}

pub(crate) struct Loaded {
    pub manifest: Manifest,
    pub main_bytes: u64,
    entry: CacheEntry,
    parsed: bool,
}

fn regular_file_meta(path: &Path, what: &str) -> std::result::Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{what}: {e}"))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(format!("{what} must be a regular file (not a symbolic link)"));
    }
    Ok(meta)
}

/// Reads and validates one plugin folder; reuses `cached` when both stamps are unchanged.
fn load_dir(dir: &Path, cached: Option<&CacheEntry>) -> std::result::Result<Loaded, String> {
    let manifest_meta = regular_file_meta(&dir.join(MANIFEST_FILE), MANIFEST_FILE)?;
    let manifest_stamp = stamp(&manifest_meta);
    let cached = cached.filter(|c| c.manifest_stamp == manifest_stamp);
    let (manifest, parsed) = match cached {
        Some(c) => (c.manifest.clone(), false),
        None => {
            let text = crate::config::read_toml_text(&dir.join(MANIFEST_FILE), MANIFEST_FILE, manifest::MAX_MANIFEST_BYTES)
                .map_err(|e| e.message)?;
            (manifest::parse(&text)?, true)
        }
    };
    let main_path = dir.join(&manifest.main);
    let main_meta = regular_file_meta(&main_path, &format!("main '{}'", manifest.main))?;
    let inside = match (main_path.canonicalize(), dir.canonicalize()) {
        (Ok(m), Ok(d)) => m.starts_with(d),
        _ => false,
    };
    if !inside {
        return Err(format!("main '{}' is outside the plugin folder", manifest.main));
    }
    let main_stamp = stamp(&main_meta);
    Ok(Loaded {
        main_bytes: main_meta.len(),
        entry: CacheEntry { manifest_stamp, main_stamp, manifest: manifest.clone() },
        manifest,
        parsed,
    })
}

/// Validates a folder without the cache (install uses this).
pub(crate) fn load_uncached(dir: &Path) -> std::result::Result<Manifest, String> {
    load_dir(dir, None).map(|l| l.manifest)
}

pub(crate) fn info(l: Loaded, dir: &Path, source: Source, app_version: &str) -> PluginInfo {
    let (compatible, problem) = manifest::compatibility(&l.manifest, app_version);
    PluginInfo {
        manifest: l.manifest,
        source,
        dir: dir.to_string_lossy().into_owned(),
        main_bytes: l.main_bytes,
        compatible,
        problem,
        host_disabled: None,
        review: super::consent::Review::ok(),
    }
}

/// Info for a freshly installed folder.
pub(crate) fn info_for_dir(dir: &Path, source: Source, app_version: &str) -> Result<PluginInfo> {
    let loaded = load_dir(dir, None).map_err(|m| crate::err("INVALID_FILE", m))?;
    Ok(info(loaded, dir, source, app_version))
}

/// Candidate plugin folders under `root`: real directories only, no dotfolders, sorted by name.
fn child_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(root) else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs
}

pub(crate) fn scan(roots: &Roots, cache_path: Option<&Path>, app_version: &str) -> Scanned {
    let started = Instant::now();
    let old = load_cache(cache_path, app_version);
    let mut fresh = Cache { version: CACHE_VERSION, app: app_version.to_string(), entries: HashMap::new() };
    let _ = fs::create_dir_all(&roots.user);
    let mut plugins: Vec<PluginInfo> = Vec::new();
    let mut errors = Vec::new();
    let mut index = Index::new();
    let mut parsed = 0;
    let sources = [(Some(&roots.user), Source::User), (roots.bundled.as_ref(), Source::Bundled)];
    for (root, source) in sources.into_iter().filter_map(|(r, s)| r.map(|r| (r, s))) {
        for dir in child_dirs(root) {
            let key = dir.to_string_lossy().into_owned();
            let fail = |errors: &mut Vec<ScanError>, message: String| errors.push(ScanError { dir: key.clone(), message });
            let loaded = match load_dir(&dir, old.entries.get(&key)) {
                Ok(l) => l,
                Err(m) => {
                    fail(&mut errors, m);
                    continue;
                }
            };
            let id = loaded.manifest.id.clone();
            if let Some(prev) = index.get(&id) {
                // A user plugin shadows a bundled one silently; any other repeat is an error.
                if !(prev.source == Source::User && source == Source::Bundled) {
                    fail(&mut errors, format!("Duplicate plugin id '{id}' (already in {})", prev.dir.display()));
                }
                continue;
            }
            let Ok(canonical) = dir.canonicalize() else { continue };
            parsed += usize::from(loaded.parsed);
            fresh.entries.insert(key, loaded.entry.clone());
            index.insert(id, Entry { dir: dir.clone(), canonical, source });
            plugins.push(info(loaded, &dir, source, app_version));
        }
    }
    if let Some(path) = cache_path {
        write_cache(path, &fresh, &old);
    }
    let scan_ms = started.elapsed().as_secs_f64() * 1000.0;
    Scanned { list: PluginsList { plugins, errors, scan_ms, safe_mode: None }, index, parsed }
}

fn write_cache(path: &Path, fresh: &Cache, old: &Cache) {
    let same = fresh.entries.len() == old.entries.len()
        && fresh.entries.iter().all(|(k, v)| {
            old.entries.get(k).is_some_and(|o| o.manifest_stamp == v.manifest_stamp && o.main_stamp == v.main_stamp)
        });
    if same && old.version == CACHE_VERSION && old.app == fresh.app {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(fresh) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = write_atomic(path, &bytes) {
        eprintln!("plugins scan cache not written: {}", e.message);
    }
}

pub(crate) fn cache_path(state_dir: &Path) -> PathBuf {
    state_dir.join(CACHE_FILE)
}

