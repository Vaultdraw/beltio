//! Community plugins registry: the cached `index.json` and hash-checked package installs.
//!
//! The list and its cache reuse `theme_catalogue` (purpose `plugins`). Every download goes
//! through `network::ensure_network_allowed(dirs, "plugins")`. Nothing is executed here: an
//! install checks the bytes against the index, reads the zip strictly (`zip.rs`), checks the
//! manifest inside against the index entry, then copies the folder like "Install from folder".
use super::{install, scan, zip};
use crate::{config, err, ioerr, network, random_id, theme_catalogue as cat, theme_install, Result};
use serde::Deserialize;
use std::{collections::HashSet, fs, path::Path};

/// Used when `plugins.registry_url` is not set (the same address as `DEFAULT_PLUGINS_REGISTRY_URL` in preferences.ts).
const DEFAULT_URL: &str = "https://raw.githubusercontent.com/Vaultdraw/plugin-registry/main/index.json";
const KIND: cat::Kind = cat::Kind { purpose: "plugins", dir: "plugin-registry" };
const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;
/// A zip of a package that unpacks to at most 8 MB is not much larger than that.
const MAX_PACKAGE_BYTES: u64 = 9 * 1024 * 1024;
const ACCEPT_ZIP: &str = "application/zip, application/octet-stream, */*";

/// The fields an install trusts, taken from the cached index (never from the page).
#[derive(Debug, Deserialize)]
struct Entry {
    id: String,
    version: String,
    sha256: String,
    url: String,
    #[serde(default)]
    permissions: Vec<String>,
}

#[derive(Deserialize)]
struct IndexFile {
    #[serde(default)]
    plugins: Vec<serde_json::Value>,
}

fn find_entry(index: &cat::CatalogueIndex, id: &str) -> Result<Entry> {
    let file: IndexFile = serde_json::from_str(&index.json).map_err(|_| err("INVALID_INDEX", "The plugins list is not valid"))?;
    file.plugins
        .into_iter()
        .filter(|v| v.get("id").and_then(|i| i.as_str()) == Some(id))
        .find_map(|v| serde_json::from_value::<Entry>(v).ok())
        .ok_or_else(|| err("NOT_FOUND", format!("`{id}` is not in the plugins list")))
}

/// Removes its folder when dropped.
struct Scratch(std::path::PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Verifies `bytes` against `entry` and installs them into `user_root`. Pure of the network.
fn install_bytes(user_root: &Path, scratch_root: &Path, bytes: &[u8], entry: &Entry, app_version: &str, official: &HashSet<String>) -> Result<scan::PluginInfo> {
    if !theme_install::sha256_hex(bytes).eq_ignore_ascii_case(&entry.sha256) {
        return Err(err(
            "HASH_MISMATCH",
            format!("`{}` changed after the list was made. Refresh the list and try again.", entry.id),
        ));
    }
    let entries = zip::read(bytes)?;
    fs::create_dir_all(scratch_root).map_err(ioerr)?;
    let scratch = Scratch(scratch_root.join(format!("pkg-{}", random_id())));
    zip::extract(&entries, &scratch.0)?;
    let manifest = scan::load_uncached(&scratch.0).map_err(|m| err("INVALID_FILE", m))?;
    if manifest.id != entry.id || manifest.version != entry.version {
        return Err(err(
            "INVALID_FILE",
            format!("The package is `{}` {}, but the list says `{}` {}", manifest.id, manifest.version, entry.id, entry.version),
        ));
    }
    // `dev = true` (the developer's own copy, allowed to shadow an official plugin) is for local
    // folder installs only: a package from the list may not claim it.
    if manifest.dev {
        return Err(err("INVALID_FILE", "A package from the list may not set dev = true (only a local folder install may)"));
    }
    let mut declared = manifest.permissions.clone();
    let mut listed = entry.permissions.clone();
    declared.sort();
    listed.sort();
    if declared != listed {
        return Err(err("INVALID_FILE", "The permissions in the package differ from the ones the list shows"));
    }
    install::install_folder(user_root, &scratch.0, app_version, official)
}

fn download_and_install(dirs: &config::Dirs, user_root: &Path, id: &str, app_version: &str, official: &HashSet<String>) -> Result<scan::PluginInfo> {
    if official.contains(id) {
        return Err(err("NAME_COLLISION", format!("`{id}` is an official plugin id; it cannot be installed from the list")));
    }
    network::ensure_network_allowed(dirs, KIND.purpose)?;
    let index = cat::cached_for(dirs, KIND).ok_or_else(|| err("NOT_FOUND", "The plugins list is not loaded. Open Browse first."))?;
    let entry = find_entry(&index, id)?;
    let base = network::parse_url(&index.url)?;
    let url = base.join(&entry.url).map_err(|_| err("INVALID_URL", "The package address in the list is not valid"))?;
    let url = network::parse_url(url.as_str())?;
    let bytes = network::get_bytes(&url, MAX_PACKAGE_BYTES, ACCEPT_ZIP)?;
    install_bytes(user_root, &dirs.state.join("plugin-registry-tmp"), &bytes, &entry, app_version, official)
}

#[tauri::command]
pub(crate) async fn plugin_registry_cached() -> Result<Option<cat::CatalogueIndex>> {
    theme_install::blocking(|d| Ok(cat::cached_for(&d, KIND))).await
}

/// The list address from `config.toml` (`plugins.registry_url`), or the default. Rust reads it itself
/// and only from `config.toml`: neither the page's argument nor `overrides.toml` (which the page can
/// write) can choose which address this command fetches.
fn configured_url(dirs: &config::Dirs) -> Result<String> {
    let loaded = config::load_settings_in(dirs)?;
    Ok(network::list_address(&loaded.layers, "plugins", "registry_url").unwrap_or_else(|| DEFAULT_URL.to_owned()))
}

/// Fetches and caches the plugins list. The page's address (`_url`) is ignored: see `configured_url`.
#[tauri::command]
pub(crate) async fn plugin_registry_index(_url: Option<String>, max_bytes: u64) -> Result<cat::CatalogueIndex> {
    theme_install::blocking(move |d| {
        let url = configured_url(&d)?;
        cat::index_for(&d, KIND, &url, max_bytes.clamp(1, MAX_INDEX_BYTES))
    })
    .await
}

/// Installs (or updates) the plugin `id` from the cached list. Returns the plugin like
/// `plugins_install_folder`, with its permission review.
#[tauri::command]
pub(crate) async fn plugin_registry_install(app: tauri::AppHandle, id: String) -> Result<scan::PluginInfo> {
    super::blocking(move || {
        let dirs = config::resolve_dirs()?;
        let roots = super::roots(&app)?;
        let mut info = download_and_install(&dirs, &roots.user, &id, super::APP_VERSION, &super::scan::official_ids(&roots))?;
        super::rescan(&app)?;
        info.host_disabled = super::state::load(&dirs.state).get(&info.manifest.id).cloned();
        info.review = super::review_of(&info, &super::consent::load(&dirs.state));
        Ok(info)
    })
    .await
}

#[cfg(test)]
mod tests;
