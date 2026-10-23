//! Install themes from a URL or a GitHub repo into `<config dir>/themes/<Name>/`.
//!
//! The frontend validates the palette; this module resolves and downloads (consent-gated, size
//! capped, see `network`), and writes `<Name>.json` plus `source.json` (where it came from, so it
//! can be updated or uninstalled). Hand-made themes are never overwritten or deleted: only
//! folders that contain `source.json` are ours.
// The commands are compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{config, err, ioerr, network, write_atomic, NativeError, Result};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

const PURPOSE: &str = "themes";
const MAX_THEME_BYTES: u64 = 256 * 1024;
const MAX_TREE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THEMES: usize = 500;
const MAX_NAME_CHARS: usize = 80;
const SOURCE_FILE: &str = "source.json";
const RAW_HOST: &str = "https://raw.githubusercontent.com";
const API_HOST: &str = "https://api.github.com";
const ACCEPT_FILE: &str = "application/json, text/plain, */*";
/// Files that are never palettes when listing a repo.
const IGNORED_FILES: [&str; 7] =
    ["package.json", "package-lock.json", "tsconfig.json", "index.json", "meta.json", "source.json", "manifest.json"];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub(crate) struct ThemeRef {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Resolved {
    File { name: String, json: String, sha256: String, url: String },
    Repo { owner: String, repo: String, commit: String, themes: Vec<ThemeRef> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum FetchRef {
    Url { url: String },
    Repo { owner: String, repo: String, commit: String, path: String },
}

#[derive(Debug, Serialize)]
pub(crate) struct Fetched {
    json: String,
    sha256: String,
    url: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SourceIn {
    url: Option<String>,
    repo: Option<String>,
    path: Option<String>,
    commit: Option<String>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WriteRequest {
    name: String,
    json: String,
    source: SourceIn,
    #[serde(default)]
    replace: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct Written {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct Installed {
    name: String,
    source: Value,
}

#[derive(Debug, Serialize)]
pub(crate) struct UpdateCheck {
    changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    json: Option<String>,
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
}

/// Where GitHub's API and raw files live; tests point both at a loopback server.
pub(crate) struct Endpoints {
    api: String,
    raw: String,
}
impl Endpoints {
    fn github() -> Self {
        Endpoints { api: API_HOST.into(), raw: RAW_HOST.into() }
    }
}

// ---------------------------------------------------------------------------
// Input classification (pure)
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RepoSpec {
    owner: String,
    repo: String,
    reference: Option<String>,
    subpath: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Source {
    File(Url),
    Repo(RepoSpec),
}

fn invalid(msg: &str) -> NativeError {
    err("INVALID_URL", msg.to_string())
}

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s != "."
        && s != ".."
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A branch, tag or commit: one path segment of safe characters.
fn is_ref(s: &str) -> bool {
    is_slug(s) && !s.starts_with(['-', '.']) && !s.contains("..")
}

fn is_path_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.chars().any(|c| c.is_control() || matches!(c, '\\' | '?' | '#'))
}

/// A repo-relative file path: no leading slash, no `..`, no backslash.
fn validate_repo_path(path: &str) -> Result<()> {
    if path.len() > 512 || !path.split('/').all(is_path_segment) {
        return Err(err("INVALID_PATH", "Invalid path in the repository"));
    }
    Ok(())
}

fn decode(seg: &str) -> String {
    percent_decode_str(seg).decode_utf8_lossy().into_owned()
}

fn repo_spec(owner: &str, repo: &str) -> Result<RepoSpec> {
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if !is_slug(owner) || !is_slug(repo) {
        return Err(invalid("Not a valid GitHub owner/repo"));
    }
    Ok(RepoSpec { owner: owner.into(), repo: repo.into(), reference: None, subpath: None })
}

fn raw_url(base: &str, owner: &str, repo: &str, rev: &str, path: &str) -> Result<Url> {
    if !is_slug(owner) || !is_slug(repo) || !is_ref(rev) {
        return Err(err("INVALID_PATH", "Invalid repository, owner or revision"));
    }
    validate_repo_path(path)?;
    let mut url = Url::parse(base).map_err(|_| invalid("Bad base URL"))?;
    url.path_segments_mut()
        .map_err(|_| invalid("Bad base URL"))?
        .pop_if_empty()
        .extend([owner, repo, rev])
        .extend(path.split('/'));
    network::parse_url(url.as_str())
}

/// `segs` are the decoded path segments after `github.com/`.
fn github_source(segs: &[String]) -> Result<Source> {
    let segs: Vec<&str> = segs.iter().map(String::as_str).filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 {
        return Err(invalid("Expected github.com/<owner>/<repo>"));
    }
    let mut spec = repo_spec(segs[0], segs[1])?;
    match (segs.get(2).copied(), segs.len()) {
        (None, _) => Ok(Source::Repo(spec)),
        (Some("tree"), n) if n >= 4 => {
            if !is_ref(segs[3]) {
                return Err(invalid("Unsupported branch or tag name"));
            }
            spec.reference = Some(segs[3].into());
            if n > 4 {
                let sub = segs[4..].join("/");
                validate_repo_path(&sub)?;
                spec.subpath = Some(sub);
            }
            Ok(Source::Repo(spec))
        }
        (Some("blob" | "raw"), n) if n >= 5 && segs[n - 1].to_ascii_lowercase().ends_with(".json") => {
            Ok(Source::File(raw_url(RAW_HOST, &spec.owner, &spec.repo, segs[3], &segs[4..].join("/"))?))
        }
        _ => Err(err("NOT_A_THEME_URL", "Use a repository, a /tree/ folder or a /blob/ link to a .json file")),
    }
}

/// Decides what the user typed: a `.json` file URL or a GitHub repo (URL or `owner/repo`).
pub(crate) fn classify(input: &str) -> Result<Source> {
    let text = input.trim();
    if text.is_empty() {
        return Err(invalid("Enter a URL or owner/repo"));
    }
    if !text.contains("://") {
        let prefixed = text.starts_with("github.com/");
        let parts: Vec<String> = text.strip_prefix("github.com/").unwrap_or(text).split('/').map(str::to_string).collect();
        if (prefixed && parts.len() >= 2) || (!prefixed && parts.len() == 2 && !text.contains(':')) {
            return github_source(&parts);
        }
        return Err(invalid("Not a URL or owner/repo"));
    }
    let url = network::parse_url(text)?;
    if matches!(url.host_str(), Some("github.com" | "www.github.com")) {
        let segs: Vec<String> = url.path_segments().map(|s| s.map(decode).collect()).unwrap_or_default();
        return github_source(&segs);
    }
    if url.path().to_ascii_lowercase().ends_with(".json") {
        return Ok(Source::File(url));
    }
    Err(err("NOT_A_THEME_URL", "The URL must point to a .json file or a GitHub repository"))
}

// ---------------------------------------------------------------------------
// Repo tree filtering (pure)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    size: Option<u64>,
}

fn json_stem(file: &str) -> Option<&str> {
    let split = file.len().checked_sub(5)?;
    if !file.is_char_boundary(split) || split == 0 || !file[split..].eq_ignore_ascii_case(".json") {
        return None;
    }
    Some(&file[..split])
}

/// The theme name of `rel` (a path under a scan root): `X.json` or `X/X.json`.
fn theme_in(rel: &str) -> Option<&str> {
    let segs: Vec<&str> = rel.split('/').collect();
    let stem = json_stem(segs.last()?)?;
    match segs.len() {
        1 => Some(stem),
        2 if segs[0].eq_ignore_ascii_case(stem) => Some(stem),
        _ => None,
    }
}

/// Palette files of a repo tree: in the root and `themes/` (or only under `subpath`).
pub(crate) fn filter_tree(entries: &[TreeEntry], subpath: Option<&str>, max_bytes: u64) -> Vec<ThemeRef> {
    let sub = subpath.map(|s| s.trim_matches('/')).filter(|s| !s.is_empty());
    let mut out: Vec<ThemeRef> = Vec::new();
    for e in entries {
        let file = e.path.rsplit('/').next().unwrap_or("");
        let ignored = IGNORED_FILES.iter().any(|i| file.eq_ignore_ascii_case(i));
        if e.kind != "blob" || ignored || e.size.is_some_and(|s| s > max_bytes) || e.path.split('/').any(|s| s.starts_with('.')) {
            continue;
        }
        let name = match sub {
            Some(s) if e.path == s => json_stem(file),
            Some(s) => e.path.strip_prefix(s).and_then(|r| r.strip_prefix('/')).and_then(theme_in),
            None => theme_in(&e.path).or_else(|| e.path.strip_prefix("themes/").and_then(theme_in)),
        };
        if let Some(name) = name {
            out.push(ThemeRef { name: name.into(), path: e.path.clone() });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.path.cmp(&b.path)));
    out.dedup();
    out.truncate(MAX_THEMES);
    out
}

// ---------------------------------------------------------------------------
// Names, hashes, timestamps (pure)
// ---------------------------------------------------------------------------

/// A name safe to use as a folder and file name.
pub(crate) fn sanitize_name(name: &str) -> Result<&str> {
    let bad = |m: &str| err("INVALID_NAME", m.to_string());
    if name.is_empty() || name.trim() != name {
        return Err(bad("The theme name is empty or has spaces around it"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(bad("The theme name is too long (80 characters at most)"));
    }
    if name.starts_with('.') || name.eq_ignore_ascii_case("source") {
        return Err(bad("This theme name is not allowed"));
    }
    if name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err(bad("The theme name has characters that are not allowed in file names"));
    }
    Ok(name)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// `1970-01-01T00:00:00Z` style UTC timestamp for `secs` since the Unix epoch.
fn iso_utc(secs: u64) -> String {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Days to civil date (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn now_iso() -> String {
    iso_utc(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

fn source_json(src: &SourceIn, installed: &str) -> Value {
    json!({
        "url": src.url, "repo": src.repo, "path": src.path,
        "commit": src.commit, "sha256": src.sha256, "installed": installed,
    })
}

fn validate_source(src: &SourceIn) -> Result<()> {
    let long = [&src.url, &src.repo, &src.path, &src.commit].iter().any(|v| v.as_ref().is_some_and(|s| s.len() > 2048));
    if long || src.sha256.len() != 64 || !src.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err("INVALID_SOURCE", "The theme source is malformed"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Download (network; callers check consent first)
// ---------------------------------------------------------------------------

fn clamp_max(max_bytes: u64) -> u64 {
    max_bytes.clamp(1, MAX_THEME_BYTES)
}

/// Downloads one theme file: UTF-8 text (BOM dropped) plus the hash of the raw bytes.
fn fetch_theme_text(url: &Url, max_bytes: u64) -> Result<(String, String)> {
    let bytes = network::get_bytes(url, max_bytes, ACCEPT_FILE)?;
    let sha = sha256_hex(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", "The file is not valid UTF-8"))?;
    Ok((text.strip_prefix('\u{FEFF}').map(str::to_owned).unwrap_or(text), sha))
}

/// `<api>/repos/<owner>/<repo>/<tail...>` as a vetted URL.
fn api_url(ep: &Endpoints, owner: &str, repo: &str, tail: &[&str], query: Option<&str>) -> Result<Url> {
    let mut url = Url::parse(&ep.api).map_err(|_| invalid("Bad API URL"))?;
    url.path_segments_mut()
        .map_err(|_| invalid("Bad API URL"))?
        .pop_if_empty()
        .extend(["repos", owner, repo])
        .extend(tail);
    url.set_query(query);
    network::parse_url(url.as_str())
}

/// The commit sha of `reference` (`HEAD` = default branch tip), via GitHub's sha media type.
fn resolve_commit(ep: &Endpoints, owner: &str, repo: &str, reference: &str) -> Result<String> {
    let url = api_url(ep, owner, repo, &["commits", reference], None)?;
    let bytes = network::get_bytes(&url, 256, "application/vnd.github.sha")?;
    let sha = String::from_utf8_lossy(&bytes).trim().to_string();
    if sha.len() != 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err("BAD_RESPONSE", "GitHub returned an unexpected commit"));
    }
    Ok(sha)
}

fn fetch_tree(ep: &Endpoints, owner: &str, repo: &str, commit: &str) -> Result<Vec<TreeEntry>> {
    #[derive(Deserialize)]
    struct Tree {
        tree: Vec<TreeEntry>,
        #[serde(default)]
        truncated: bool,
    }
    let url = api_url(ep, owner, repo, &["git", "trees", commit], Some("recursive=1"))?;
    let bytes = network::get_bytes(&url, MAX_TREE_BYTES, "application/vnd.github+json")?;
    let tree = serde_json::from_slice::<Tree>(&bytes).map_err(|_| err("BAD_RESPONSE", "GitHub returned an unexpected file list"))?;
    if tree.truncated {
        return Err(err("BAD_RESPONSE", "The repo is too large for GitHub to list in one go; give a folder inside it (owner/repo/tree/<branch>/<folder>)"));
    }
    Ok(tree.tree)
}

/// A file theme's name: the JSON `name` field when present, else the URL's file stem.
fn file_theme_name(json: &str, url: &Url) -> String {
    let field = serde_json::from_str::<Value>(json)
        .ok()
        .and_then(|v| v.get("name").and_then(Value::as_str).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty());
    field.unwrap_or_else(|| {
        let last = url.path_segments().and_then(|mut s| s.next_back()).map(decode).unwrap_or_default();
        json_stem(&last).unwrap_or(&last).to_string()
    })
}

pub(crate) fn resolve_in(dirs: &config::Dirs, ep: &Endpoints, input: &str, max_bytes: u64) -> Result<Resolved> {
    network::ensure_network_allowed(dirs, PURPOSE)?;
    let max = clamp_max(max_bytes);
    match classify(input)? {
        Source::File(url) => {
            let (json, sha256) = fetch_theme_text(&url, max)?;
            Ok(Resolved::File { name: file_theme_name(&json, &url), json, sha256, url: url.to_string() })
        }
        Source::Repo(spec) => {
            let reference = spec.reference.as_deref().unwrap_or("HEAD");
            let commit = resolve_commit(ep, &spec.owner, &spec.repo, reference)?;
            let tree = fetch_tree(ep, &spec.owner, &spec.repo, &commit)?;
            let themes = filter_tree(&tree, spec.subpath.as_deref(), max);
            if themes.is_empty() {
                return Err(err("NO_THEMES_FOUND", "No theme files (.json) found in this repository"));
            }
            Ok(Resolved::Repo { owner: spec.owner, repo: spec.repo, commit, themes })
        }
    }
}

fn fetch_repo_file(ep: &Endpoints, owner: &str, repo: &str, commit: &str, path: &str, max: u64) -> Result<Fetched> {
    let url = raw_url(&ep.raw, owner, repo, commit, path)?;
    let (json, sha256) = fetch_theme_text(&url, max)?;
    Ok(Fetched { json, sha256, url: url.to_string() })
}

pub(crate) fn fetch_in(dirs: &config::Dirs, ep: &Endpoints, fetch: &FetchRef, max_bytes: u64) -> Result<Fetched> {
    network::ensure_network_allowed(dirs, PURPOSE)?;
    let max = clamp_max(max_bytes);
    match fetch {
        FetchRef::Url { url } => {
            let url = network::parse_url(url)?;
            let (json, sha256) = fetch_theme_text(&url, max)?;
            Ok(Fetched { json, sha256, url: url.to_string() })
        }
        FetchRef::Repo { owner, repo, commit, path } => fetch_repo_file(ep, owner, repo, commit, path, max),
    }
}

// ---------------------------------------------------------------------------
// Installed themes on disk
// ---------------------------------------------------------------------------

fn themes_dir(dirs: &config::Dirs) -> PathBuf {
    dirs.config.join(config::THEMES_DIR)
}

fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

fn is_real_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_file())
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// The parsed `source.json` of `folder`, or None when it is missing or unreadable.
fn read_source(folder: &Path) -> Option<Value> {
    let path = folder.join(SOURCE_FILE);
    if !is_real_file(&path) {
        return None;
    }
    let bytes = super::read_bounded(&path, 64 * 1024).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn write_in(dirs: &config::Dirs, req: &WriteRequest) -> Result<Written> {
    let name = sanitize_name(&req.name)?;
    if req.json.len() as u64 > MAX_THEME_BYTES {
        return Err(err("TOO_LARGE", "The theme is larger than 256 KiB"));
    }
    serde_json::from_str::<serde::de::IgnoredAny>(&req.json).map_err(|_| err("INVALID_JSON", "The theme is not valid JSON"))?;
    validate_source(&req.source)?;

    let themes = themes_dir(dirs);
    fs::create_dir_all(&themes).map_err(ioerr)?;
    let folder = themes.join(name);
    let exists_msg = || err("THEME_EXISTS", format!("A theme named {name} already exists"));
    if exists(&themes.join(format!("{name}.json"))) {
        return Err(exists_msg());
    }
    let created = if exists(&folder) {
        if !(req.replace && is_real_dir(&folder) && read_source(&folder).is_some()) {
            return Err(exists_msg());
        }
        false
    } else {
        fs::create_dir(&folder).map_err(ioerr)?;
        true
    };
    let file = folder.join(format!("{name}.json"));
    let source = serde_json::to_vec_pretty(&source_json(&req.source, &now_iso())).map_err(|e| err("INTERNAL", e.to_string()))?;
    // New install: source.json first, so a folder without it never looks hand-made.
    // Replace: the theme file first, so a failure leaves the old hash and the next update retries.
    let write_source = || write_atomic(&folder.join(SOURCE_FILE), &source);
    let write_file = || write_atomic(&file, req.json.as_bytes());
    let result = if created { write_source().and_then(|_| write_file()) } else { write_file().and_then(|_| write_source()) };
    if result.is_err() && created {
        let _ = fs::remove_dir_all(&folder);
    }
    result?;
    Ok(Written { name: name.into(), path: file.to_string_lossy().into_owned() })
}

pub(crate) fn installed_in(dirs: &config::Dirs) -> Result<Vec<Installed>> {
    let listing = match fs::read_dir(themes_dir(dirs)) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(ioerr(e)),
    };
    let mut out: Vec<Installed> = listing
        .filter_map(|item| item.ok())
        .filter(|item| is_real_dir(&item.path()))
        .filter_map(|item| {
            let name = item.file_name().to_string_lossy().into_owned();
            read_source(&item.path()).map(|source| Installed { name, source })
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name)));
    out.truncate(MAX_THEMES);
    Ok(out)
}

/// The folder of an installed theme; THEME_NOT_INSTALLED unless it holds `source.json`.
fn installed_folder(dirs: &config::Dirs, name: &str) -> Result<(PathBuf, Value)> {
    let folder = themes_dir(dirs).join(sanitize_name(name)?);
    match (is_real_dir(&folder), read_source(&folder)) {
        (true, Some(source)) => Ok((folder, source)),
        _ => Err(err("THEME_NOT_INSTALLED", format!("{name} was not installed by Vaultdraw; delete it by hand"))),
    }
}

pub(crate) fn uninstall_in(dirs: &config::Dirs, name: &str) -> Result<()> {
    let (folder, _) = installed_folder(dirs, name)?;
    fs::remove_dir_all(folder).map_err(ioerr)
}

pub(crate) fn update_fetch_in(dirs: &config::Dirs, ep: &Endpoints, name: &str, max_bytes: u64) -> Result<UpdateCheck> {
    network::ensure_network_allowed(dirs, PURPOSE)?;
    let (_, source) = installed_folder(dirs, name)?;
    let max = clamp_max(max_bytes);
    let text = |key: &str| source.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let (fetched, commit) = match (text("repo"), text("url")) {
        (Some(repo), _) => {
            let (owner, repo) = repo.split_once('/').ok_or_else(|| err("INVALID_SOURCE", "The stored repo is malformed"))?;
            let path = text("path").ok_or_else(|| err("INVALID_SOURCE", "The stored source has no path"))?;
            let commit = resolve_commit(ep, owner, repo, "HEAD")?;
            (fetch_repo_file(ep, owner, repo, &commit, &path, max)?, Some(commit))
        }
        (None, Some(url)) => {
            let url = network::parse_url(&url)?;
            let (json, sha256) = fetch_theme_text(&url, max)?;
            (Fetched { json, sha256, url: url.to_string() }, None)
        }
        _ => return Err(err("INVALID_SOURCE", "The stored source has neither a url nor a repo")),
    };
    let changed = text("sha256").as_deref() != Some(fetched.sha256.as_str());
    Ok(UpdateCheck { changed, json: changed.then_some(fetched.json), sha256: fetched.sha256, commit })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Runs blocking work (network, disk) off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce(config::Dirs) -> Result<T> + Send + 'static) -> Result<T> {
    let dirs = config::resolve_dirs()?;
    tauri::async_runtime::spawn_blocking(move || f(dirs))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub(crate) async fn theme_resolve(input: String, max_bytes: u64) -> Result<Resolved> {
    blocking(move |d| resolve_in(&d, &Endpoints::github(), &input, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn theme_fetch(fetch_ref: FetchRef, max_bytes: u64) -> Result<Fetched> {
    blocking(move |d| fetch_in(&d, &Endpoints::github(), &fetch_ref, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn theme_write(req: WriteRequest) -> Result<Written> {
    blocking(move |d| write_in(&d, &req)).await
}

#[tauri::command]
pub(crate) async fn theme_installed() -> Result<Vec<Installed>> {
    blocking(|d| installed_in(&d)).await
}

#[tauri::command]
pub(crate) async fn theme_update_fetch(name: String, max_bytes: u64) -> Result<UpdateCheck> {
    blocking(move |d| update_fetch_in(&d, &Endpoints::github(), &name, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn theme_uninstall(name: String) -> Result<()> {
    blocking(move |d| uninstall_in(&d, &name)).await
}

#[cfg(test)]
mod tests;
