use fs2::FileExt;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    borrow::Cow,
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "macos")]
mod app_menu;
mod clipboard;
mod config;
mod control;
mod drawing_copy;
mod links;
mod search;
mod library;
mod memory;
mod pdf_import;
mod pressure;
mod refresh_rate;
mod templates;
mod themes;
mod vault_lock;
mod vault_settings;
mod history;
mod thumbs;
#[cfg(test)]
mod test_alloc;
#[cfg(feature = "smoke-test")]
mod smoke;

// Test builds use the counting allocator in test_alloc.rs (a crate has one global allocator).
#[cfg(not(test))]
#[global_allocator]
static ALLOC: memory::ProcessAlloc = memory::PROCESS_ALLOC;

const MAX_DRAWING_BYTES: u64 = 32 * 1024 * 1024;
/// Exported files (PNG, SVG, multi-page PDF) may be much larger than a drawing.
const MAX_EXPORT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_RECOVERY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RECOVERY_RECORD_BYTES: u64 = MAX_DRAWING_BYTES * 2 + 8192;
const META_DIR: &str = ".excalidraw-vault";
const RECOVERY_DIR: &str = "recovery";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    handle: String,
    path: String,
    name: String,
    read_only: bool,
    /// Why the vault opened read-only (None when writable).
    read_only_reason: Option<vault_lock::ReadOnlyReason>,
    /// The other Vaultdraw process holding the lock, when that is the reason.
    lock_holder_pid: Option<u32>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultEntry {
    path: String,
    name: String,
    kind: String,
    modified_at: u64,
    size: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEntry {
    id: String,
    path: String,
    modified_at: u64,
    json: String,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultChange {
    handle: String,
    paths: Vec<String>,
    rescan: bool,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, allow(dead_code))]
struct VaultSettingsChange {
    handle: String,
}
#[derive(Debug, Serialize)]
struct NativeError {
    code: String,
    message: String,
}
type Result<T> = std::result::Result<T, NativeError>;

fn err(code: &str, message: impl Into<String>) -> NativeError {
    NativeError {
        code: code.into(),
        message: message.into(),
    }
}
fn ioerr(e: std::io::Error) -> NativeError {
    let code = match e.kind() {
        std::io::ErrorKind::NotFound => "NOT_FOUND",
        std::io::ErrorKind::PermissionDenied => "READ_ONLY",
        std::io::ErrorKind::AlreadyExists => "NAME_COLLISION",
        _ => "IO_ERROR",
    };
    err(code, e.to_string())
}

struct Vault {
    root: PathBuf,
    handle: String,
    read_only: bool,
    _lock: Option<Arc<vault_lock::VaultLock>>,
    _watcher: Option<RecommendedWatcher>,
    mutation: Mutex<()>,
}
#[derive(Default)]
struct Service {
    vaults: Mutex<HashMap<String, Arc<Vault>>>,
    locks: vault_lock::LockRegistry,
}

/// Borrowed when serializing (the snapshot is never copied), owned when `list_recovery` parses it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRecord<'a> {
    path: Cow<'a, str>,
    expected_revision: Option<Cow<'a, str>>,
    operation_id: Cow<'a, str>,
    json: Cow<'a, str>,
    created_at: u64,
}

/// The first open vault (lowest handle): the one the control API acts on.
pub(crate) fn control_active_vault(app: &AppHandle) -> Option<Arc<Vault>> {
    let service = app.try_state::<Service>()?;
    let vaults = service.vaults.lock().ok()?;
    vaults.values().min_by(|a, b| a.handle.cmp(&b.handle)).cloned()
}

/// First open vault as `{name, path, readOnly}` for the control API's `app.status`.
pub(crate) fn control_vault_summary(app: &AppHandle) -> Option<serde_json::Value> {
    control_active_vault(app).map(|v| control::vault_ops::info(&v))
}

fn now_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
fn revision(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
/// Hex SHA-256 of a stream through a fixed buffer, plus the number of bytes read.
fn revision_of_reader(mut reader: impl Read) -> std::io::Result<(String, u64)> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
fn random_id() -> String {
    // Monotonic within a process, including multiple IDs generated in one millisecond.
    format!("{:x}-{:x}-{:x}", now_ms(SystemTime::now()), std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn is_windows_reserved_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9")
}
fn validate_relative(path: &str) -> Result<Vec<String>> {
    if path.is_empty() {
        return Ok(Vec::new());
    }
    if path.len() > 4096
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains('\0')
    {
        return Err(err(
            "INVALID_PATH",
            "Path must be a bounded vault-relative path using forward slashes",
        ));
    }
    let mut out = Vec::new();
    for part in path.split('/') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.len() > 255
            || part.ends_with('.')
            || part.ends_with(' ')
            || part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c))
            || is_windows_reserved_name(part)
        {
            return Err(err("INVALID_PATH", "Path contains an invalid component"));
        }
        if part.eq_ignore_ascii_case(META_DIR) {
            return Err(err(
                "INVALID_PATH",
                "Reserved vault metadata is not user-accessible",
            ));
        }
        out.push(part.to_string());
    }
    Ok(out)
}
fn safe_path(root: &Path, path: &str, allow_missing_leaf: bool) -> Result<PathBuf> {
    let parts = validate_relative(path)?;
    let mut cur = root.to_path_buf();
    for (i, part) in parts.iter().enumerate() {
        cur.push(part);
        match fs::symlink_metadata(&cur) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(err(
                    "INVALID_PATH",
                    "Symbolic links are not allowed in a vault",
                ))
            }
            Ok(_) => {}
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    && (allow_missing_leaf || i + 1 < parts.len()) => {}
            Err(e) => return Err(ioerr(e)),
        }
    }
    // Canonicalize the nearest existing ancestor, preventing traversal through replaced parents.
    let mut ancestor = cur.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| err("INVALID_PATH", "Invalid path"))?;
    }
    let canonical = ancestor.canonicalize().map_err(ioerr)?;
    let base = root.canonicalize().map_err(ioerr)?;
    if !canonical.starts_with(&base) {
        return Err(err("INVALID_PATH", "Path escapes the selected vault"));
    }
    Ok(cur)
}
fn vault_for<'a>(s: &'a Service, handle: &str) -> Result<Arc<Vault>> {
    s.vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .get(handle)
        .cloned()
        .ok_or_else(|| err("NOT_FOUND", "Vault handle is no longer active"))
}
fn mutation_guard(v: &Vault) -> Result<std::sync::MutexGuard<'_, ()>> {
    v.mutation.lock().map_err(|_| err("INTERNAL", "Vault mutation state unavailable"))
}
fn writable(v: &Vault) -> Result<()> {
    if v.read_only {
        Err(err("READ_ONLY", "This vault is open read-only because it is not writable or another app instance owns its lock"))
    } else {
        Ok(())
    }
}
fn ensure_no_sibling_collision(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "Entry has no parent"))?;
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Err(err("INVALID_PATH", "Invalid entry name"));
    };
    if !parent.is_dir() {
        return Err(err("NOT_FOUND", "Parent directory not found"));
    }
    for item in fs::read_dir(parent).map_err(ioerr)? {
        let item = item.map_err(ioerr)?;
        if item
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(name)
        {
            return Err(err(
                "NAME_COLLISION",
                "A case-insensitive name collision already exists",
            ));
        }
    }
    Ok(())
}
/// Only the field the validator needs; serde skips (but still syntax-checks) the rest,
/// so a large scene is validated without building a `serde_json::Value` tree.
#[derive(Deserialize)]
struct SceneProbe<'a> {
    #[serde(rename = "type")]
    kind: Option<Cow<'a, str>>,
}
fn ensure_json(json: &str) -> Result<()> {
    if json.len() as u64 > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "Drawing exceeds the 32 MiB limit"));
    }
    let probe: SceneProbe = serde_json::from_str(json)
        .map_err(|e| err("INVALID_FILE", format!("Invalid JSON: {e}")))?;
    // A derived struct also accepts a JSON array, so require an object explicitly.
    if !json.trim_start().starts_with('{') || probe.kind.as_deref() != Some("excalidraw") {
        return Err(err("INVALID_FILE", "Drawing JSON must be an Excalidraw scene object"));
    }
    Ok(())
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        // Same-directory rename is atomic on the primary macOS target. Windows replacement
        // may refuse existing destinations; fail closed rather than remove the source first.
        fs::rename(&temp, path)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(ioerr)
}
fn write_atomic_new(path: &Path, bytes: &[u8]) -> Result<()> {
    write_atomic_new_with(path, |f| f.write_all(bytes))
}
/// No-clobber atomic create where `fill` streams the content into the temp file.
fn write_atomic_new_with(path: &Path, fill: impl FnOnce(&mut File) -> std::io::Result<()>) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("INVALID_PATH", "File has no parent"))?;
    let temp = parent.join(format!(
        ".excalidraw-tmp-{}-{}",
        std::process::id(),
        random_id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        fill(&mut f)?;
        f.sync_all()?;
        // Hard-link creation is an atomic no-clobber commit on the same filesystem.
        fs::hard_link(&temp, path)?;
        fs::remove_file(&temp)?;
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            err("NAME_COLLISION", "Destination already exists")
        } else {
            ioerr(e)
        }
    })
}
fn checked_recovery_dir(v: &Vault, create: bool) -> Result<Option<PathBuf>> {
    let meta = v.root.join(META_DIR);
    let metadata = match fs::symlink_metadata(&meta) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => { fs::create_dir(&meta).map_err(ioerr)?; fs::symlink_metadata(&meta).map_err(ioerr)? },
        Err(e) => return Err(ioerr(e)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(err("INVALID_PATH", "Reserved vault metadata is not a real directory"));
    }
    let dir = meta.join(RECOVERY_DIR);
    let metadata = match fs::symlink_metadata(&dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => { fs::create_dir(&dir).map_err(ioerr)?; fs::symlink_metadata(&dir).map_err(ioerr)? },
        Err(e) => return Err(ioerr(e)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(err("INVALID_PATH", "Recovery directory is not a real directory"));
    }
    Ok(Some(dir))
}
fn recovery_dir(v: &Vault) -> Result<PathBuf> {
    checked_recovery_dir(v, true)?.ok_or_else(|| err("INTERNAL", "Recovery directory unavailable"))
}
fn current_revision(path: &Path) -> Result<Option<String>> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ioerr(e)),
    };
    let (rev, total) = revision_of_reader(file.take(MAX_DRAWING_BYTES + 1)).map_err(ioerr)?;
    if total > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(Some(rev))
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    File::open(path).map_err(ioerr)?.take(limit.saturating_add(1)).read_to_end(&mut data).map_err(ioerr)?;
    if data.len() as u64 > limit { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    Ok(data)
}
fn create_recovery(
    v: &Vault,
    path: &str,
    expected: Option<&str>,
    operation_id: &str,
    json: &str,
) -> Result<PathBuf> {
    let dir = recovery_dir(v)?;
    // Bound retained recovery before adding a snapshot; snapshots are never pruned automatically.
    let mut total = 0u64;
    for entry in fs::read_dir(&dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let ty = entry.file_type().map_err(ioerr)?;
        if ty.is_symlink() { return Err(err("INVALID_PATH", "Recovery metadata contains a symbolic link")); }
        if ty.is_file() { total = total.saturating_add(entry.metadata().map_err(ioerr)?.len()); }
    }
    let record = RecoveryRecord {
        path: path.into(),
        expected_revision: expected.map(Cow::Borrowed),
        operation_id: operation_id.into(),
        json: json.into(),
        created_at: now_ms(SystemTime::now()),
    };
    // Exact serialized size from a counting pass (no allocation), so the caps below hold
    // without materialising the escaped record in memory.
    let mut counter = CountingWriter(0);
    serde_json::to_writer(&mut counter, &record).map_err(|e| err("INTERNAL", e.to_string()))?;
    if counter.0 > MAX_RECOVERY_RECORD_BYTES || total.saturating_add(counter.0) > MAX_RECOVERY_BYTES {
        return Err(err(
            "RECOVERY_FULL",
            "Recovery storage is full; discard snapshots before saving",
        ));
    }
    let file = dir.join(format!("{}.json", random_id()));
    write_atomic_new_with(&file, |f| {
        let mut out = BufWriter::new(f);
        serde_json::to_writer(&mut out, &record)?;
        out.flush()
    })?;
    Ok(file)
}
/// `Write` sink that only counts bytes.
struct CountingWriter(u64);
impl Write for CountingWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
fn remove_recovery(path: &Path) {
    let _ = fs::remove_file(path);
}

#[derive(Debug, PartialEq, Eq)]
enum WatchedPath {
    /// Vault metadata, the lock file or our own temp files.
    Ignore,
    /// `<root>/library.excalidrawlib` (root level only, exact name).
    Library,
    /// `.excalidraw-vault/settings.toml` (or the metadata folder itself) changed.
    Settings,
    /// A path under `.excalidraw-vault/history/` (file history; kept out of `vault-change`).
    History(String),
    /// A user-visible vault-relative path.
    Entry(String),
    /// Outside the root or not a valid vault path: the frontend should rescan.
    Rescan,
}
/// Classifies a watcher event path for `vault-change` / `vault-settings-change`.
fn classify_vault_event(root: &Path, p: &Path) -> WatchedPath {
    let Ok(rel) = p.strip_prefix(root) else { return WatchedPath::Rescan };
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.split('/').any(|part| part.starts_with(".excalidraw-tmp-")) {
        return WatchedPath::Ignore;
    }
    if text == library::LIBRARY_FILE {
        return WatchedPath::Library;
    }
    // The metadata folder itself (deleted, renamed or replaced) may take settings.toml with it.
    if text == META_DIR || text == format!("{META_DIR}/{}", vault_settings::SETTINGS_FILE) {
        return WatchedPath::Settings;
    }
    if text.starts_with(&format!("{META_DIR}/{}/", history::HISTORY_DIR)) {
        return WatchedPath::History(text);
    }
    if text.starts_with(&format!("{META_DIR}/")) || text == format!("{META_DIR}.lock") {
        return WatchedPath::Ignore;
    }
    if validate_relative(&text).is_ok() {
        WatchedPath::Entry(text)
    } else {
        WatchedPath::Rescan
    }
}
fn open_vault(root: PathBuf, app: &AppHandle, service: &Service) -> Result<VaultInfo> {
    let root = root.canonicalize().map_err(ioerr)?;
    if !root.is_dir() {
        return Err(err("INVALID_PATH", "Vault must be a directory"));
    }
    let handle = random_id();
    let outcome = service.locks.acquire(&root, &format!("{META_DIR}.lock"));
    let read_only = outcome.lock.is_none();
    let lock = outcome.lock;
    let h = handle.clone();
    let r = root.clone();
    let app_handle = app.clone();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            let deadline = Instant::now() + Duration::from_millis(600);
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() { break; }
                match rx.recv_timeout(remaining.min(Duration::from_millis(160))) {
                    Ok(event) => batch.push(event),
                    Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => continue,
                    Err(_) => break,
                }
            }
            let mut paths = Vec::new();
            let mut history_paths = Vec::new();
            let mut rescan = false;
            let mut settings_changed = false;
            let mut library_changed = false;
            for event in batch {
                match event {
                    Ok(e) => {
                        for p in e.paths {
                            match classify_vault_event(&r, &p) {
                                WatchedPath::Ignore => {}
                                WatchedPath::Settings => settings_changed = true,
                                WatchedPath::Library => library_changed = true,
                                WatchedPath::History(text) => history_paths.push(text),
                                WatchedPath::Entry(text) => paths.push(text),
                                WatchedPath::Rescan => rescan = true,
                            }
                        }
                    }
                    Err(_) => {
                        rescan = true;
                        settings_changed = true;
                        library_changed = true;
                    }
                }
            }
            paths.sort();
            paths.dedup();
            if let Some(search) = app_handle.try_state::<search::SearchService>() {
                search.notify(&h, &paths, rescan);
            }
            if let Some(history) = app_handle.try_state::<history::HistoryService>() {
                history.watched(&h, &paths, &history_paths, rescan);
            }
            if settings_changed {
                let _ = app_handle.emit("vault-settings-change", VaultSettingsChange { handle: h.clone() });
            }
            if library_changed {
                library::emit_change(&app_handle, Some(h.clone()));
            }
            if !paths.is_empty() || rescan {
                control::events::vault_changed(&paths, rescan);
                let _ = app_handle.emit(
                    "vault-change",
                    VaultChange {
                        handle: h.clone(),
                        paths,
                        rescan,
                    },
                );
            }
        }
    });
    let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let _ = tx.send(event);
    })
    .ok()
    .and_then(|mut w| {
        if w.configure(Config::default().with_poll_interval(Duration::from_millis(500)))
            .is_ok()
            && w.watch(&root, RecursiveMode::Recursive).is_ok()
        {
            Some(w)
        } else {
            None
        }
    });
    if watcher.is_none() {
        let _ = app.emit("vault-change", VaultChange { handle: handle.clone(), paths: Vec::new(), rescan: true });
    }
    let vault = Arc::new(Vault {
        root: root.clone(),
        handle: handle.clone(),
        read_only,
        _lock: lock,
        _watcher: watcher,
        mutation: Mutex::new(()),
    });
    service
        .vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .insert(handle.clone(), vault.clone());
    if let Some(search) = app.try_state::<search::SearchService>() {
        search.start(&handle, root.clone(), search::tauri_emitter(app));
    }
    links::on_vault_open(app, vault);
    if let Some(history) = app.try_state::<history::HistoryService>() {
        history.start(&handle, root.clone(), read_only, history::tauri_emitter(app));
    }
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Vault")
        .to_string();
    Ok(VaultInfo {
        handle,
        path: root.to_string_lossy().into_owned(),
        name,
        read_only,
        read_only_reason: outcome.reason,
        lock_holder_pid: outcome.holder_pid,
    })
}

/// Remembers the vault for the next launch (`recent-vault`); not in smoke runs.
fn remember_vault(app: &AppHandle, info: &VaultInfo) {
    #[cfg(feature = "smoke-test")]
    if smoke::enabled() {
        return;
    }
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("recent-vault"), &info.path);
    }
}
/// A folder given by path (the control API's `vault.open`): same as choosing it in the dialog.
fn existing_vault_dir(path: &str) -> Result<PathBuf> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err(err("INVALID_PATH", "Vault path must be absolute")); }
    let canonical = p.canonicalize().map_err(ioerr)?;
    if !canonical.is_dir() { return Err(err("INVALID_PATH", "Vault must be a directory")); }
    Ok(canonical)
}
#[tauri::command]
async fn open_vault_at(path: String, app: AppHandle, state: State<'_, Service>) -> Result<VaultInfo> {
    let info = open_vault(existing_vault_dir(&path)?, &app, &state)?;
    remember_vault(&app, &info);
    Ok(info)
}
#[tauri::command]
async fn choose_vault(
    create: bool,
    app: AppHandle,
    state: State<'_, Service>,
) -> Result<Option<VaultInfo>> {
    #[cfg(feature = "smoke-test")]
    let selected = if smoke::enabled() {
        Some(smoke::choose_dir().map_err(|e| err("SMOKE_CONFIG", e))?)
    } else {
        rfd::FileDialog::new()
            .set_title(if create { "Choose or create a Vaultdraw vault" } else { "Open a Vaultdraw vault" })
            .pick_folder()
    };
    #[cfg(not(feature = "smoke-test"))]
    let selected = rfd::FileDialog::new()
        .set_title(if create { "Choose or create a Vaultdraw vault" } else { "Open a Vaultdraw vault" })
        .pick_folder();
    let Some(path) = selected else { return Ok(None); };
    let info = open_vault(path, &app, &state)?;
    remember_vault(&app, &info);
    Ok(Some(info))
}
#[tauri::command]
async fn reopen_vault(app: AppHandle, state: State<'_, Service>) -> Result<Option<VaultInfo>> {
    #[cfg(feature = "smoke-test")]
    if smoke::enabled() { return Ok(None); }
    let file = app
        .path()
        .app_config_dir()
        .map_err(|e| err("IO_ERROR", e.to_string()))?
        .join("recent-vault");
    let path = match fs::read_to_string(file) {
        Ok(p) => PathBuf::from(p.trim()),
        Err(_) => return Ok(None),
    };
    if !path.is_dir() {
        return Ok(None);
    }
    open_vault(path, &app, &state).map(Some)
}
/// Drops a handle and its services; the vault lock goes with the last handle on that root.
fn release_handle(app: &AppHandle, service: &Service, handle: &str) -> Result<()> {
    service
        .vaults
        .lock()
        .map_err(|_| err("INTERNAL", "Vault state unavailable"))?
        .remove(handle);
    if let Some(search) = app.try_state::<search::SearchService>() {
        search.stop(handle);
    }
    if let Some(history) = app.try_state::<history::HistoryService>() {
        history.stop(handle);
    }
    thumbs::release(app, handle);
    Ok(())
}
/// A (re)loaded page starts with no vault: the previous page's handles are dead,
/// so release them (and their locks, watchers and indexes) instead of leaking them.
fn release_all_handles(app: &AppHandle) {
    let Some(service) = app.try_state::<Service>() else { return };
    let handles: Vec<String> = service.vaults.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    for handle in handles {
        let _ = release_handle(app, &service, &handle);
    }
}
#[tauri::command]
async fn release_vault(handle: String, app: AppHandle, state: State<'_, Service>) -> Result<()> {
    release_handle(&app, &state, &handle)
}
/// Opens the vault behind `handle` again (a new handle) so a read-only vault can
/// become writable once its lock is free; the caller swaps handles and releases the old one.
#[tauri::command]
async fn retry_vault(handle: String, app: AppHandle, state: State<'_, Service>) -> Result<VaultInfo> {
    let root = vault_for(&state, &handle)?.root.clone();
    open_vault(root, &app, &state)
}
#[tauri::command]
async fn list_directory(
    handle: String,
    path: String,
    state: State<'_, Service>,
) -> Result<Vec<VaultEntry>> {
    let v = vault_for(&state, &handle)?;
    list_directory_in(&v, &path)
}
/// The entries of one vault folder (the UI file tree and `vault.list` share this).
fn list_directory_in(v: &Vault, path: &str) -> Result<Vec<VaultEntry>> {
    let dir = safe_path(&v.root, path, false)?;
    if !dir.is_dir() {
        return Err(err("NOT_FOUND", "Directory not found"));
    }
    let mut out = Vec::new();
    for item in fs::read_dir(dir).map_err(ioerr)? {
        let item = item.map_err(ioerr)?;
        let meta = item.file_type().map_err(ioerr)?;
        if meta.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if name.eq_ignore_ascii_case(META_DIR)
            || (!meta.is_dir() && !name.to_ascii_lowercase().ends_with(".excalidraw"))
        {
            continue;
        }
        let rel = item
            .path()
            .strip_prefix(&v.root)
            .map_err(|e| err("INVALID_PATH", e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if validate_relative(&rel).is_err() {
            continue;
        }
        let md = item.metadata().map_err(ioerr)?;
        out.push(VaultEntry {
            path: rel,
            name,
            kind: if meta.is_dir() { "folder" } else { "drawing" }.into(),
            modified_at: md.modified().map(now_ms).unwrap_or_default(),
            size: if meta.is_file() { md.len() } else { 0 },
        });
    }
    out.sort_by(|a, b| {
        (a.kind != "folder", a.name.to_lowercase())
            .cmp(&(b.kind != "folder", b.name.to_lowercase()))
    });
    Ok(out)
}
/// Hex SHA-256 length; the read frame is `<revision hex>\n<json bytes>`.
const REVISION_HEX_LEN: usize = 64;
const FRAME_PREFIX_LEN: usize = REVISION_HEX_LEN + 1;
/// Reads a drawing into one buffer laid out as `<revision hex>\n<json bytes>`: the file is
/// read straight into the buffer after a placeholder prefix, hashed in place and validated
/// as UTF-8 JSON without further copies.
fn read_drawing_file(root: &Path, path: &str) -> Result<Vec<u8>> {
    if !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Only .excalidraw files can be read as drawings")); }
    let p = safe_path(root, path, false)?;
    let file = File::open(&p).map_err(ioerr)?;
    let meta = file.metadata().map_err(ioerr)?;
    if !meta.is_file() || meta.len() > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "Drawing is not a regular file or exceeds 32 MiB")); }
    let mut buf = Vec::with_capacity(FRAME_PREFIX_LEN + meta.len() as usize);
    buf.resize(FRAME_PREFIX_LEN, 0);
    file.take(MAX_DRAWING_BYTES + 1).read_to_end(&mut buf).map_err(ioerr)?;
    if (buf.len() - FRAME_PREFIX_LEN) as u64 > MAX_DRAWING_BYTES { return Err(err("INVALID_FILE", "File exceeds its size limit")); }
    let json = std::str::from_utf8(&buf[FRAME_PREFIX_LEN..]).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    ensure_json(json)?;
    let digest = Sha256::digest(&buf[FRAME_PREFIX_LEN..]);
    hex::encode_to_slice(digest, &mut buf[..REVISION_HEX_LEN]).map_err(|e| err("INTERNAL", e.to_string()))?;
    buf[REVISION_HEX_LEN] = b'\n';
    Ok(buf)
}
/// `{ json, revision }` for small JSON-IPC readers (global templates); vault drawings use the raw frame.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawingFile {
    json: String,
    revision: String,
}
fn read_drawing_parts(root: &Path, path: &str) -> Result<DrawingFile> {
    let mut framed = read_drawing_file(root, path)?;
    let json = String::from_utf8(framed.split_off(FRAME_PREFIX_LEN)).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    framed.truncate(REVISION_HEX_LEN);
    let revision = String::from_utf8(framed).map_err(|e| err("INTERNAL", e.to_string()))?;
    Ok(DrawingFile { json, revision })
}
#[tauri::command]
async fn read_drawing(handle: String, path: String, state: State<'_, Service>) -> Result<tauri::ipc::Response> {
    let v = vault_for(&state, &handle)?;
    let framed = read_drawing_file(&v.root, &path)?;
    memory::schedule_release();
    Ok(tauri::ipc::Response::new(framed))
}
/// Revision of a drawing without sending its content; `None` when the file is missing.
fn drawing_revision_at(root: &Path, path: &str) -> Result<Option<String>> {
    if !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Only .excalidraw files have drawing revisions")); }
    match safe_path(root, path, true) {
        Ok(p) => current_revision(&p),
        Err(e) if e.code == "NOT_FOUND" => Ok(None),
        Err(e) => Err(e),
    }
}
#[tauri::command]
async fn drawing_revision(handle: String, path: String, state: State<'_, Service>) -> Result<Option<String>> {
    let v = vault_for(&state, &handle)?;
    drawing_revision_at(&v.root, &path)
}
fn write_drawing_file(v: &Vault, path: &str, json: &str, expected_revision: Option<&str>, operation_id: &str) -> Result<serde_json::Value> {
    write_drawing_file_with_commit(v, path, json, expected_revision, operation_id, |p, bytes, create| {
        if create { write_atomic_new(p, bytes) } else { write_atomic(p, bytes) }
    })
}
fn write_drawing_file_with_commit<F>(v: &Vault, path: &str, json: &str, expected_revision: Option<&str>, operation_id: &str, commit_fn: F) -> Result<serde_json::Value>
where F: FnOnce(&Path, &[u8], bool) -> Result<()> {
    ensure_json(json)?;
    if path.is_empty() || !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Drawing filenames must end in .excalidraw")); }
    if operation_id.is_empty() || operation_id.len() > 200 { return Err(err("INVALID_ARGUMENT", "Invalid operation id")); }
    let p = safe_path(&v.root, path, true)?;
    if current_revision(&p)?.as_deref() != expected_revision { return Err(err("CONFLICT", "Drawing changed on disk; save was not applied")); }
    if expected_revision.is_none() { ensure_no_sibling_collision(&p)?; }
    let snapshot = create_recovery(v, path, expected_revision, operation_id, json)?;
    let recheck = match current_revision(&p) {
        Ok(rev) => rev,
        Err(e) => { remove_recovery(&snapshot); return Err(e); }
    };
    if recheck.as_deref() != expected_revision { return Err(err("CONFLICT", "Drawing changed immediately before commit; recovery snapshot retained")); }
    commit_fn(&p, json.as_bytes(), expected_revision.is_none())?;
    let rev = revision(json.as_bytes());
    remove_recovery(&snapshot);
    Ok(serde_json::json!({"revision": rev}))
}
/// Write for the link rewriter (closed drawings only). Same path, size and JSON validation and the
/// same revision check (before the write and again right before the rename) as
/// `write_drawing_file`, but no recovery copy: the original stays intact until the atomic rename
/// and the rewrite journal makes the job re-runnable. One fsync of the temp file; the parent
/// directory is NOT synced here, the caller syncs each distinct parent once per batch
/// (`sync_dirs`). The caller holds the vault mutation guard. Returns the parent directory.
fn write_drawing_file_rewrite(v: &Vault, path: &str, json: &str, expected_revision: &str) -> Result<PathBuf> {
    ensure_json(json)?;
    if path.is_empty() || !path.to_ascii_lowercase().ends_with(".excalidraw") { return Err(err("INVALID_PATH", "Drawing filenames must end in .excalidraw")); }
    let p = safe_path(&v.root, path, false)?;
    if current_revision(&p)?.as_deref() != Some(expected_revision) { return Err(err("CONFLICT", "Drawing changed on disk; rewrite was not applied")); }
    let parent = p.parent().ok_or_else(|| err("INVALID_PATH", "File has no parent"))?.to_path_buf();
    let temp = parent.join(format!(".excalidraw-tmp-{}-{}", std::process::id(), random_id()));
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(ioerr)?;
        f.write_all(json.as_bytes()).map_err(ioerr)?;
        f.sync_all().map_err(ioerr)?;
        if current_revision(&p)?.as_deref() != Some(expected_revision) { return Err(err("CONFLICT", "Drawing changed immediately before commit; rewrite was not applied")); }
        fs::rename(&temp, &p).map_err(ioerr)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result.map(|_| parent)
}
/// fsyncs directories (best effort), making renames into them durable.
fn sync_dirs<'a>(dirs: impl IntoIterator<Item = &'a PathBuf>) {
    for d in dirs { if let Ok(f) = File::open(d) { let _ = f.sync_all(); } }
}
/// Arguments carried in the headers of the raw `write_drawing` request (percent-encoded).
#[derive(Debug)]
struct WriteHeaders { handle: String, path: String, expected_revision: Option<String>, operation_id: String }
fn parse_write_headers(headers: &tauri::http::HeaderMap) -> Result<WriteHeaders> {
    let required = |name: &str| clipboard::percent_decode(&clipboard::header_value(headers, name)?);
    // Absent or empty expected revision means create-only.
    let expected = match clipboard::header_value(headers, "x-expected-revision") {
        Ok(v) => Some(clipboard::percent_decode(&v)?).filter(|v| !v.is_empty()),
        Err(_) => None,
    };
    Ok(WriteHeaders { handle: required("x-handle")?, path: required("x-path")?, expected_revision: expected, operation_id: required("x-operation-id")? })
}
/// The raw body is the UTF-8 scene JSON; it is validated in place, never copied into a String.
fn write_drawing_raw(v: &Vault, args: &WriteHeaders, body: &[u8]) -> Result<serde_json::Value> {
    let json = std::str::from_utf8(body).map_err(|_| err("INVALID_FILE", "Drawing is not UTF-8 JSON"))?;
    write_drawing_file(v, &args.path, json, args.expected_revision.as_deref(), &args.operation_id)
}
#[tauri::command]
async fn write_drawing(request: tauri::ipc::Request<'_>, state: State<'_, Service>, history: State<'_, history::HistoryService>) -> Result<serde_json::Value> {
    let args = parse_write_headers(request.headers())?;
    let body = clipboard::raw_body(&request)?;
    let v = vault_for(&state, &args.handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    let result = write_drawing_raw(&v, &args, body);
    // File history: one clonefile + one queue push, only after a successful commit (errors ignored).
    if let Some(rev) = result.as_ref().ok().and_then(|o| o["revision"].as_str()) {
        history.after_commit(&args.handle, &args.path, rev, body.len() as u64);
        control::events::file_saved(&args.path, rev);
    }
    memory::schedule_release();
    result
}
fn create_folder_at(root: &Path, path: &str) -> Result<()> {
    if path.is_empty() { return Err(err("INVALID_PATH", "Cannot create the vault root")); }
    let p = safe_path(root, path, true)?;
    ensure_no_sibling_collision(&p)?;
    fs::create_dir(p).map_err(ioerr)
}
#[tauri::command]
async fn create_folder(handle: String, path: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    create_folder_at(&v.root, &path)
}
fn move_entry_paths(root: &Path, from: &str, to: &str) -> Result<()> {
    if from.is_empty() || to.is_empty() || from == to || to.starts_with(&format!("{from}/")) { return Err(err("INVALID_PATH", "Cannot move an entry into itself")); }
    let src = safe_path(root, from, false)?;
    let dst = safe_path(root, to, true)?;
    if !src.exists() { return Err(err("NOT_FOUND", "Source entry not found")); }
    ensure_no_sibling_collision(&dst)?;
    if let Some(parent) = dst.parent() { if !parent.is_dir() { return Err(err("NOT_FOUND", "Destination folder not found")); } }
    fs::rename(src, dst).map_err(ioerr)
}
#[tauri::command]
async fn move_entry(
    handle: String,
    from: String,
    to: String,
    state: State<'_, Service>,
    history: State<'_, history::HistoryService>,
) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    move_entry_paths(&v.root, &from, &to)?;
    history.moved(&handle, &from, &to);
    Ok(())
}
/// `move_entry` that also keeps links between drawings working (see `links::types`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn move_entry_with_links(
    app: AppHandle,
    handle: String,
    from: String,
    to: String,
    open_path: Option<String>,
    rewrite: bool,
    state: State<'_, Service>,
    search: State<'_, search::SearchService>,
    links: State<'_, links::LinksState>,
    history: State<'_, history::HistoryService>,
) -> Result<links::MoveResult> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    if !rewrite {
        let _mutation = mutation_guard(&v)?;
        move_entry_paths(&v.root, &from, &to)?;
        history.moved(&handle, &from, &to);
        return Ok(links::MoveResult::default());
    }
    let moved = links::move_command(&app, &v, &from, &to, open_path.as_deref(), &search, &links)?;
    history.moved(&handle, &from, &to);
    Ok(moved)
}
#[tauri::command]
async fn trash_entry(handle: String, path: String, state: State<'_, Service>, history: State<'_, history::HistoryService>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    let p = safe_path(&v.root, &path, false)?;
    if p == v.root {
        return Err(err("INVALID_PATH", "Cannot trash the vault root"));
    }
    if p.is_dir() && fs::read_dir(&p).map_err(ioerr)?.next().is_some() {
        return Err(err(
            "NOT_EMPTY",
            "Non-empty folders are not trashed to avoid deleting unrelated files",
        ));
    }
    trash::delete(&p).map_err(|e| {
        err(
            "TRASH_FAILED",
            format!("Could not move item to OS trash: {e}"),
        )
    })?;
    history.trashed(&handle, &path);
    Ok(())
}
/// The folder "Reveal" opens for Files > Recovery: the vault's crash-recovery
/// store, created on first use (never in a read-only vault).
fn recovery_reveal_target(v: &Vault) -> Result<PathBuf> {
    checked_recovery_dir(v, !v.read_only)?.ok_or_else(|| err("NOT_FOUND", "No recovery folder yet"))
}
#[tauri::command]
async fn reveal_recovery_dir(handle: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    config::open_dir(&recovery_reveal_target(&v)?)
}
#[tauri::command]
async fn reveal_entry(handle: String, path: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    let p = safe_path(&v.root, &path, false)?;
    #[cfg(target_os = "macos")]
    let (program, args) = (
        "open",
        vec!["-R".to_string(), p.to_string_lossy().into_owned()],
    );
    #[cfg(target_os = "windows")]
    let (program, args) = (
        "explorer",
        vec!["/select,".to_string(), p.to_string_lossy().into_owned()],
    );
    #[cfg(target_os = "linux")]
    let (program, args) = (
        "xdg-open",
        vec![p.parent().unwrap_or(&p).to_string_lossy().into_owned()],
    );
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(ioerr)
}
#[tauri::command]
async fn export_file(request: tauri::ipc::Request<'_>) -> Result<bool> {
    let name = clipboard::percent_decode(&clipboard::header(&request, "x-file-name")?)?;
    // Not clipboard::raw_body: its 64 MiB clipboard cap is too small for a PDF.
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() => bytes.as_slice(),
        _ => return Err(err("INVALID_ARGUMENT", "Expected a non-empty raw binary body")),
    };
    if bytes.len() as u64 > MAX_EXPORT_BYTES {
        return Err(err("INVALID_FILE", "Export exceeds 256 MiB"));
    }
    save_with_dialog(&name, bytes)
}
/// Asks for a destination with the native save dialog (suggesting `name`) and
/// writes `bytes` there as a new file. Ok(false) = the user cancelled.
fn save_with_dialog(name: &str, bytes: &[u8]) -> Result<bool> {
    let clean = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty() && !s.contains('/') && !s.contains('\\'))
        .unwrap_or("drawing.excalidraw");
    #[cfg(feature = "smoke-test")]
    let selected_path = if smoke::enabled() {
        let dir = smoke::export_dir().map_err(|e| err("SMOKE_CONFIG", e))?;
        Some(dir.join(clean))
    } else {
        rfd::FileDialog::new().set_file_name(clean).save_file()
    };
    #[cfg(not(feature = "smoke-test"))]
    let selected_path = rfd::FileDialog::new().set_file_name(clean).save_file();
    let Some(path) = selected_path else { return Ok(false); };
    if path.exists() {
        return Err(err(
            "NAME_COLLISION",
            "Export destination already exists; choose another name",
        ));
    }
    write_atomic_new(&path, bytes)?;
    Ok(true)
}
#[tauri::command]
async fn list_recovery(handle: String, state: State<'_, Service>) -> Result<Vec<RecoveryEntry>> {
    let v = vault_for(&state, &handle)?;
    let Some(dir) = checked_recovery_dir(&v, false)? else { return Ok(Vec::new()); };
    let mut out = Vec::new();
    let mut total = 0u64;
    for entry in fs::read_dir(dir).map_err(ioerr)? {
        let entry = entry.map_err(ioerr)?;
        let ty = entry.file_type().map_err(ioerr)?;
        if !ty.is_file()
            || ty.is_symlink()
            || !entry.file_name().to_string_lossy().ends_with(".json")
        {
            continue;
        }
        let md = entry.metadata().map_err(ioerr)?;
        total = total.saturating_add(md.len());
        if total > MAX_RECOVERY_BYTES || md.len() > MAX_RECOVERY_RECORD_BYTES {
            return Err(err(
                "RECOVERY_FULL",
                "Recovery directory exceeds its safety limit",
            ));
        }
        let data = read_bounded(&entry.path(), MAX_RECOVERY_RECORD_BYTES)?;
        let record: RecoveryRecord<'_> = match serde_json::from_slice(&data) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if ensure_json(&record.json).is_err() || validate_relative(&record.path).is_err() {
            continue;
        }
        // A successfully committed snapshot is stale; a mismatched revision remains recoverable.
        let source = safe_path(&v.root, &record.path, true)?;
        let source_rev = current_revision(&source).ok().flatten();
        if source_rev == Some(revision(record.json.as_bytes())) {
            continue;
        }
        out.push(RecoveryEntry {
            id: entry
                .file_name()
                .to_string_lossy()
                .trim_end_matches(".json")
                .into(),
            path: record.path.into_owned(),
            modified_at: record.created_at,
            json: record.json.into_owned(),
        });
    }
    out.sort_by_key(|r| r.modified_at);
    Ok(out)
}
#[tauri::command]
async fn discard_recovery(handle: String, id: String, state: State<'_, Service>) -> Result<()> {
    let v = vault_for(&state, &handle)?;
    writable(&v)?;
    let _mutation = mutation_guard(&v)?;
    if id.is_empty() || id.len() > 200 || id.contains('/') || id.contains('\\') || id.contains("..")
    {
        return Err(err("INVALID_ARGUMENT", "Invalid recovery id"));
    }
    let Some(dir) = checked_recovery_dir(&v, false)? else { return Err(err("NOT_FOUND", "Recovery entry not found")); };
    let p = dir.join(format!("{id}.json"));
    if fs::symlink_metadata(&p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(err("INVALID_PATH", "Recovery entry is a symbolic link"));
    }
    fs::remove_file(p).map_err(ioerr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    const SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[],"appState":{},"files":{}}"#;
    fn split_frame(frame: &[u8]) -> (String, &[u8]) {
        assert_eq!(frame[REVISION_HEX_LEN], b'\n');
        (String::from_utf8(frame[..REVISION_HEX_LEN].to_vec()).unwrap(), &frame[FRAME_PREFIX_LEN..])
    }
    fn vault(root: &Path) -> Vault {
        Vault { root: root.canonicalize().unwrap(), handle: "test".into(), read_only: false, _lock: None, _watcher: None, mutation: Mutex::new(()) }
    }
    /// Save/open cost breakdown on a real fixture: `PERF_FIXTURE=/path/to/x.excalidraw cargo test --release
    /// bench_write_breakdown -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench_write_breakdown() {
        use std::time::Instant;
        let Ok(src) = std::env::var("PERF_FIXTURE") else { return };
        let json = fs::read_to_string(src).unwrap();
        let t = tempdir().unwrap();
        let v = vault(t.path());
        let ms = |s: Instant| s.elapsed().as_secs_f64() * 1000.0;
        let first = write_drawing_file(&v, "a.excalidraw", &json, None, "bench-0").unwrap();
        let mut rev = first["revision"].as_str().unwrap().to_string();
        let p = safe_path(&v.root, "a.excalidraw", true).unwrap();
        for i in 0..5 {
            let s = Instant::now(); ensure_json(&json).unwrap(); let t_json = ms(s);
            let s = Instant::now(); let _ = current_revision(&p).unwrap(); let t_rev = ms(s);
            let s = Instant::now(); let snap = create_recovery(&v, "a.excalidraw", Some(&rev), "bench-r", &json).unwrap(); let t_rec = ms(s);
            remove_recovery(&snap);
            let s = Instant::now(); write_atomic(&p, json.as_bytes()).unwrap(); let t_wr = ms(s);
            let s = Instant::now(); let _ = revision(json.as_bytes()); let t_hash = ms(s);
            let s = Instant::now(); let out = write_drawing_file(&v, "a.excalidraw", &json, Some(&rev), &format!("bench-{i}")).unwrap(); let t_all = ms(s);
            rev = out["revision"].as_str().unwrap().to_string();
            let s = Instant::now(); let framed = read_drawing_file(&v.root, "a.excalidraw").unwrap(); let t_read = ms(s);
            println!("run{i} bytes={} ensure_json={t_json:.1} current_revision={t_rev:.1} create_recovery={t_rec:.1} write_atomic={t_wr:.1} hash={t_hash:.1} TOTAL_write={t_all:.1} read_drawing_file={t_read:.1} ({})", json.len(), framed.len());
        }
    }
    #[test]
    fn open_by_path_needs_an_existing_absolute_directory() {
        let d = tempfile::tempdir().unwrap();
        let ok = existing_vault_dir(d.path().to_str().unwrap()).unwrap();
        assert_eq!(ok, d.path().canonicalize().unwrap());
        assert_eq!(existing_vault_dir("relative/dir").unwrap_err().code, "INVALID_PATH");
        assert_eq!(existing_vault_dir(d.path().join("nope").to_str().unwrap()).unwrap_err().code, "NOT_FOUND");
        let f = d.path().join("f.txt");
        std::fs::write(&f, "x").unwrap();
        assert_eq!(existing_vault_dir(f.to_str().unwrap()).unwrap_err().code, "INVALID_PATH");
    }
    #[test]
    fn rejects_traversal_reserved_metadata_and_windows_names() {
        for p in ["../outside", "/tmp/x", "a/../b", "a\\b", ".excalidraw-vault/x", "a//b", "CON", "nul.txt", "a:b", "bad?.excalidraw"] { assert!(validate_relative(p).is_err(), "{p}"); }
        assert_eq!(validate_relative("").unwrap().len(), 0);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_components_and_recovery_ancestors() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap(); let root = t.path().join("root"); let outside = t.path().join("out");
        fs::create_dir(&root).unwrap(); fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        assert!(safe_path(&root, "escape/file.excalidraw", true).is_err());
        symlink(&outside, root.join(META_DIR)).unwrap();
        assert_eq!(checked_recovery_dir(&vault(&root), true).unwrap_err().code, "INVALID_PATH");
    }
    #[test]
    fn recovery_reveal_target_is_created_and_refused_when_read_only() {
        let t = tempdir().unwrap(); let root = t.path().join("root"); fs::create_dir(&root).unwrap();
        let v = vault(&root);
        let dir = recovery_reveal_target(&v).unwrap();
        assert!(dir.is_dir() && dir.ends_with(format!("{META_DIR}/{RECOVERY_DIR}")));
        let ro = t.path().join("ro"); fs::create_dir(&ro).unwrap();
        let mut v = vault(&ro); v.read_only = true;
        assert_eq!(recovery_reveal_target(&v).unwrap_err().code, "NOT_FOUND");
        assert!(!ro.join(META_DIR).exists());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_lock_file() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap(); let root = t.path().join("root"); let target = t.path().join("target");
        fs::create_dir(&root).unwrap(); fs::write(&target, "outside").unwrap();
        symlink(&target, root.join(format!("{META_DIR}.lock"))).unwrap();
        let lock_path = root.join(format!("{META_DIR}.lock"));
        assert!(vault_lock::open_lock_file(&lock_path).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "outside");
    }
    #[test]
    fn watcher_routes_settings_file_separately_from_vault_entries() {
        let root = Path::new("/v");
        let c = |p: &str| classify_vault_event(root, &root.join(p));
        assert_eq!(c(".excalidraw-vault/settings.toml"), WatchedPath::Settings);
        assert_eq!(c(".excalidraw-vault"), WatchedPath::Settings);
        assert_eq!(c(".excalidraw-vault/recovery/x.json"), WatchedPath::Ignore);
        assert_eq!(c(".excalidraw-vault/.excalidraw-tmp-1-2"), WatchedPath::Ignore);
        assert_eq!(c(".excalidraw-vault.lock"), WatchedPath::Ignore);
        assert_eq!(c("library.excalidrawlib"), WatchedPath::Library);
        assert_eq!(c("sub/library.excalidrawlib"), WatchedPath::Entry("sub/library.excalidrawlib".into()));
        assert_eq!(c("Library.excalidrawlib"), WatchedPath::Entry("Library.excalidrawlib".into()));
        assert_eq!(c(".excalidraw-tmp-1-2"), WatchedPath::Ignore);
        assert_eq!(c("a/b.excalidraw"), WatchedPath::Entry("a/b.excalidraw".into()));
        assert_eq!(c("a/.excalidraw-tmp-1"), WatchedPath::Ignore);
        assert_eq!(c("bad?.excalidraw"), WatchedPath::Rescan);
        assert_eq!(classify_vault_event(root, Path::new("/elsewhere/x")), WatchedPath::Rescan);
    }
    #[test]
    fn atomic_write_and_hash_revision_roundtrip() {
        let t = tempdir().unwrap(); let p = t.path().join("scene.excalidraw");
        write_atomic(&p, SCENE.as_bytes()).unwrap();
        let bytes = read_bounded(&p, MAX_DRAWING_BYTES).unwrap();
        assert_eq!(revision(&bytes), hex::encode(Sha256::digest(&bytes)));
        assert_eq!(String::from_utf8(bytes).unwrap(), SCENE);
        assert_eq!(fs::read_dir(t.path()).unwrap().count(), 1);
    }
    #[test]
    fn move_and_create_refuse_all_existing_destinations() {
        let t = tempdir().unwrap(); let root = t.path();
        fs::write(root.join("source.excalidraw"), SCENE).unwrap();
        fs::write(root.join("dest.excalidraw"), "keep").unwrap();
        let e = move_entry_paths(root, "source.excalidraw", "dest.excalidraw").unwrap_err();
        assert_eq!(e.code, "NAME_COLLISION");
        assert_eq!(fs::read_to_string(root.join("dest.excalidraw")).unwrap(), "keep");
        assert_eq!(move_entry_paths(root, "source.excalidraw", "source.excalidraw").unwrap_err().code, "INVALID_PATH");
        assert_eq!(create_folder_at(root, "dest.excalidraw").unwrap_err().code, "NAME_COLLISION");
        assert!(create_folder_at(root, "").is_err());
    }
    #[test]
    fn writes_are_revision_guarded_and_never_recreate_deleted_scene() {
        let t = tempdir().unwrap(); let v = vault(t.path()); let p = t.path().join("a.excalidraw");
        fs::write(&p, SCENE).unwrap(); let rev = revision(SCENE.as_bytes());
        fs::write(&p, "external").unwrap();
        assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, Some(&rev), "op1").unwrap_err().code, "CONFLICT");
        fs::remove_file(&p).unwrap();
        assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, Some(&rev), "op2").unwrap_err().code, "CONFLICT");
        assert!(!p.exists());
    }
    #[test]
    fn create_only_write_roundtrips_and_preserves_exact_embedded_json() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        let embedded = r#"{"type":"excalidraw","version":2,"elements":[{"type":"image","fileId":"f"}],"appState":{"x":1},"files":{"f":{"dataURL":"data:image/png;base64,aGVsbG8=","mimeType":"image/png"}}}"#;
        ensure_json(embedded).unwrap();
        let result = write_drawing_file(&v, "a.excalidraw", embedded, None, "op").unwrap();
        assert_eq!(result["revision"], revision(embedded.as_bytes()));
        assert_eq!(fs::read_to_string(t.path().join("a.excalidraw")).unwrap(), embedded);
        let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
        let (rev, body) = split_frame(&frame);
        assert_eq!(body, embedded.as_bytes());
        assert_eq!(rev, revision(embedded.as_bytes()));
        assert_eq!(write_drawing_file(&v, "a.excalidraw", SCENE, None, "op2").unwrap_err().code, "CONFLICT");
    }
    #[test]
    fn injected_commit_failure_retains_recovery_snapshot_and_source() {
        let t = tempdir().unwrap(); let v = vault(t.path()); let source = t.path().join("a.excalidraw");
        fs::write(&source, SCENE).unwrap(); let expected = revision(SCENE.as_bytes());
        let result = write_drawing_file_with_commit(&v, "a.excalidraw", SCENE, Some(&expected), "fault", |_, _, _| Err(err("IO_ERROR", "injected failure")));
        assert_eq!(result.unwrap_err().code, "IO_ERROR");
        assert_eq!(fs::read_to_string(source).unwrap(), SCENE);
        let recovery = checked_recovery_dir(&v, false).unwrap().unwrap();
        assert_eq!(fs::read_dir(recovery).unwrap().count(), 1);
    }
    #[test]
    fn recovery_wrapping_has_headroom_and_roundtrips() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        let json = format!(r#"{{"type":"excalidraw","data":"{}"}}"#, "\\\"".repeat(512));
        create_recovery(&v, "a.excalidraw", None, "op", &json).unwrap();
        let dir = checked_recovery_dir(&v, false).unwrap().unwrap();
        let record: RecoveryRecord = serde_json::from_slice(&read_bounded(&fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path(), MAX_RECOVERY_RECORD_BYTES).unwrap()).unwrap();
        assert_eq!(record.json, json);
    }
    #[test]
    fn bounded_reads_reject_growth_beyond_cap() {
        let t = tempdir().unwrap(); let p = t.path().join("large"); fs::write(&p, vec![b'x'; 32]).unwrap();
        assert_eq!(read_bounded(&p, 31).unwrap_err().code, "INVALID_FILE");
    }
    #[test]
    fn concurrent_mutations_are_serialized_and_ids_unique() {
        let t = tempdir().unwrap(); let v = Arc::new(vault(t.path())); let mut joins = Vec::new();
        for _ in 0..12 { let v = v.clone(); joins.push(thread::spawn(move || { let _g = mutation_guard(&v).unwrap(); thread::sleep(Duration::from_millis(1)); })); }
        for j in joins { j.join().unwrap(); }
        let ids: std::collections::HashSet<_> = (0..100).map(|_| random_id()).collect(); assert_eq!(ids.len(), 100);
    }
    #[test]
    fn json_validation_requires_excalidraw_scene_and_is_bounded() {
        assert!(ensure_json("[]").is_err()); assert!(ensure_json("{bad").is_err()); assert!(ensure_json("{\"ok\":true}").is_err());
        assert!(ensure_json(SCENE).is_ok());
        // Shapes a derived struct would otherwise accept or mis-handle.
        assert!(ensure_json(r#"["excalidraw"]"#).is_err());
        assert!(ensure_json(r#"{"type":5}"#).is_err());
        assert!(ensure_json(r#"{"type":"excalidraw"} trailing"#).is_err());
        assert!(ensure_json(r#"{"elements":[{"type":"x"}],"type":"excalidraw"}"#).is_ok());
        assert!(ensure_json(r#"  {"type":"exc\u0061lidraw"}"#).is_ok());
        assert!(ensure_json(&format!("{{\"type\":\"excalidraw\",\"x\":\"{}\"}}", "x".repeat(MAX_DRAWING_BYTES as usize))).is_err());
    }
    #[test]
    fn read_frame_has_revision_prefix_and_identical_body() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        fs::write(t.path().join("a.excalidraw"), SCENE).unwrap();
        let frame = read_drawing_file(&v.root, "a.excalidraw").unwrap();
        let (rev, body) = split_frame(&frame);
        assert_eq!(body, SCENE.as_bytes());
        assert_eq!(rev, revision(SCENE.as_bytes()));
        assert_eq!(frame.len(), FRAME_PREFIX_LEN + SCENE.len());
        assert_eq!(read_drawing_file(&v.root, "missing.excalidraw").unwrap_err().code, "NOT_FOUND");
        fs::write(t.path().join("bad.excalidraw"), [0xff, 0xfe]).unwrap();
        assert_eq!(read_drawing_file(&v.root, "bad.excalidraw").unwrap_err().code, "INVALID_FILE");
        fs::write(t.path().join("notscene.excalidraw"), "{\"a\":1}").unwrap();
        assert_eq!(read_drawing_file(&v.root, "notscene.excalidraw").unwrap_err().code, "INVALID_FILE");
    }
    #[test]
    fn streaming_revision_matches_buffered_revision() {
        let t = tempdir().unwrap(); let p = t.path().join("big.excalidraw");
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&p, &data).unwrap();
        assert_eq!(current_revision(&p).unwrap(), Some(revision(&data)));
        assert_eq!(current_revision(&t.path().join("none")).unwrap(), None);
        assert_eq!(drawing_revision_at(t.path(), "big.excalidraw").unwrap(), Some(revision(&data)));
        assert_eq!(drawing_revision_at(t.path(), "none.excalidraw").unwrap(), None);
        assert_eq!(drawing_revision_at(t.path(), "big.txt").unwrap_err().code, "INVALID_PATH");
        let (rev, n) = revision_of_reader(&data[..]).unwrap();
        assert_eq!((rev, n), (revision(&data), data.len() as u64));
    }
    #[test]
    fn recovery_streaming_record_keeps_the_json_shape() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        let snapshot = create_recovery(&v, "a.excalidraw", Some("abc"), "op", SCENE).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&snapshot).unwrap()).unwrap();
        assert_eq!(value["path"], "a.excalidraw");
        assert_eq!(value["expectedRevision"], "abc");
        assert_eq!(value["operationId"], "op");
        assert_eq!(value["json"], SCENE);
        assert!(value["createdAt"].is_u64());
        // Serialized length reported by the counting pass equals the bytes on disk.
        let record = RecoveryRecord { path: "a.excalidraw".into(), expected_revision: None, operation_id: "op".into(), json: SCENE.into(), created_at: 1 };
        let mut counter = CountingWriter(0);
        serde_json::to_writer(&mut counter, &record).unwrap();
        assert_eq!(counter.0 as usize, serde_json::to_vec(&record).unwrap().len());
        assert!(fs::read_dir(snapshot.parent().unwrap()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".excalidraw-tmp")));
    }
    #[test]
    fn write_headers_decode_and_empty_expected_means_create_only() {
        let mut h = tauri::http::HeaderMap::new();
        h.insert("x-handle", "h%2F1".parse().unwrap());
        h.insert("x-path", "f%C3%B6lder%2Fa%20b.excalidraw".parse().unwrap());
        h.insert("x-operation-id", "op-1".parse().unwrap());
        let a = parse_write_headers(&h).unwrap();
        assert_eq!((a.handle.as_str(), a.path.as_str(), a.operation_id.as_str()), ("h/1", "földer/a b.excalidraw", "op-1"));
        assert_eq!(a.expected_revision, None);
        h.insert("x-expected-revision", "".parse().unwrap());
        assert_eq!(parse_write_headers(&h).unwrap().expected_revision, None);
        h.insert("x-expected-revision", "abc123".parse().unwrap());
        assert_eq!(parse_write_headers(&h).unwrap().expected_revision.as_deref(), Some("abc123"));
        h.remove("x-path");
        assert_eq!(parse_write_headers(&h).unwrap_err().code, "INVALID_ARGUMENT");
    }
    #[test]
    fn raw_write_path_is_guarded_and_returns_revision() {
        let t = tempdir().unwrap(); let v = vault(t.path());
        let args = |expected: Option<&str>| WriteHeaders { handle: "test".into(), path: "a.excalidraw".into(), expected_revision: expected.map(str::to_owned), operation_id: "op".into() };
        let created = write_drawing_raw(&v, &args(None), SCENE.as_bytes()).unwrap();
        assert_eq!(created["revision"], revision(SCENE.as_bytes()));
        assert_eq!(write_drawing_raw(&v, &args(None), SCENE.as_bytes()).unwrap_err().code, "CONFLICT");
        let next = SCENE.replace("[]", "[{\"id\":1}]");
        let rev = created["revision"].as_str().unwrap().to_owned();
        assert_eq!(write_drawing_raw(&v, &args(Some(&rev)), next.as_bytes()).unwrap()["revision"], revision(next.as_bytes()));
        assert_eq!(fs::read_to_string(t.path().join("a.excalidraw")).unwrap(), next);
        assert_eq!(write_drawing_raw(&v, &args(Some(&rev)), SCENE.as_bytes()).unwrap_err().code, "CONFLICT");
        assert_eq!(write_drawing_raw(&v, &args(None), &[0xff]).unwrap_err().code, "INVALID_FILE");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// WKWebView configuration for the main window.
///
/// WebKit caps page rendering near 60fps by default, even on 120Hz ProMotion
/// displays. The cap is a private WebKit feature flag that only takes effect
/// when set before the webview is created, so the window is built here instead
/// of from tauri.conf.json. See `refresh_rate` (logs loudly if the flag can't
/// be applied).
#[cfg(all(target_os = "macos", not(test)))]
fn webview_configuration(
    mtm: objc2::MainThreadMarker,
) -> objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration> {
    use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};

    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // A supplied configuration bypasses the window's `incognito` setting, so
    // keep website data non-persistent here.
    unsafe { config.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm)) };
    refresh_rate::disable_near_60fps_cap(&*unsafe { config.preferences() });
    config
}

/// Env-gated startup timing (`VAULTDRAW_STARTUP_TRACE=1`): prints ms since `run()` began.
pub(crate) fn startup_trace(label: &str) {
    use std::sync::OnceLock;
    static T0: OnceLock<(Instant, bool)> = OnceLock::new();
    let (t0, on) = T0.get_or_init(|| (Instant::now(), std::env::var_os("VAULTDRAW_STARTUP_TRACE").is_some()));
    if *on {
        eprintln!("[startup] {:>7.1} ms  {label}", t0.elapsed().as_secs_f64() * 1000.0);
    }
}

pub fn run() {
    startup_trace("run");
    control::instance::claim_or_forward();
    #[cfg(not(test))]
    {
        let builder = tauri::Builder::default()
            .manage(Service::default())
            .manage(search::SearchService::default())
            .manage(links::LinksState::default())
            .manage(history::HistoryService::default())
            .manage(thumbs::ThumbsService::default())
            // A webview reload (or crash recovery) starts a fresh frontend that will
            // reopen the vault; free the old page's handles first (toimprove #39).
            .on_page_load(|webview, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    release_all_handles(webview.app_handle());
                    control::on_page_load_started();
                }
            })
            .setup(|app| {
                startup_trace("setup begin");
                // The main window is declared in tauri.conf.json with `create: false`
                // and built here so macOS can use a custom webview configuration.
                let window_config = app
                    .config()
                    .app
                    .windows
                    .first()
                    .cloned()
                    .ok_or("missing main window config")?;
                #[cfg(feature = "smoke-test")]
                smoke::background_test_app(app);
                let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?;
                #[cfg(feature = "smoke-test")]
                let builder = builder.focused(!smoke::background_test());
                #[cfg(target_os = "macos")]
                let builder = {
                    let mtm = objc2::MainThreadMarker::new()
                        .ok_or("window setup must run on the main thread")?;
                    builder.with_webview_configuration(webview_configuration(mtm))
                };
                startup_trace("window config ready");
                let main_window = builder.build()?;
                startup_trace("window built");
                control::spawn(app.handle());
                #[cfg(feature = "smoke-test")]
                smoke::harden_test_webview(&main_window);
                #[cfg(not(feature = "smoke-test"))]
                let _ = main_window;
                // Memory pressure: return free pages and let the webview purge its caches.
                pressure::start(app.handle());
                // Live-reload of the config folder, started off the setup path (it creates the
                // config files and registers an FSEvents stream); a failure only disables live reload.
                let handle = app.handle().clone();
                let spawned = thread::Builder::new().name("config-watcher-init".into()).spawn(move || {
                    match config::start_watcher(&handle) {
                        Ok(watcher) => {
                            handle.manage(watcher);
                        }
                        Err(e) => eprintln!("vaultdraw: config watcher not started: {} ({})", e.message, e.code),
                    }
                    startup_trace("watcher started");
                });
                if let Err(e) = spawned {
                    eprintln!("vaultdraw: config watcher not started: {e}");
                }
                Ok(())
            });
        #[cfg(target_os = "macos")]
        let builder = builder
            .menu(|handle| app_menu::build(handle))
            .on_menu_event(app_menu::on_event);
        let builder = thumbs::register_scheme(builder);
        // Test runs must not take focus at launch (a window manager would follow it).
        #[cfg(all(feature = "smoke-test", target_os = "macos"))]
        let builder = builder.activate_ignoring_other_apps(!smoke::background_test());
        #[cfg(feature = "smoke-test")]
        let builder = if smoke::enabled() {
            builder.invoke_handler(tauri::generate_handler![
                choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, list_directory, read_drawing, drawing_revision,
                write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, reveal_entry, reveal_recovery_dir,
                export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, list_recovery, discard_recovery,
                config::load_settings, config::update_config, config::write_state, config::open_config_dir,
                themes::list_themes, themes::open_themes_dir,
                vault_settings::load_vault_settings, vault_settings::update_vault_settings,
                search::search_vault, search::search_index_status, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
                library::read_library, library::write_library, library::pick_library_file,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
                templates::list_global_templates, templates::read_global_template,
                templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event,
                smoke::smoke_environment, smoke::smoke_log, smoke::smoke_finish, smoke::perf_process_ids,
                refresh_rate::probes::perf_display_info, refresh_rate::probes::perf_native_input,
                refresh_rate::probes::perf_window_maximize, refresh_rate::probes::perf_process_cpu,
                clipboard::smoke_read_clipboard
            ])
        } else {
            builder.invoke_handler(tauri::generate_handler![
                choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, list_directory, read_drawing, drawing_revision,
                write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, reveal_entry, reveal_recovery_dir,
                export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, list_recovery, discard_recovery,
                config::load_settings, config::update_config, config::write_state, config::open_config_dir,
                themes::list_themes, themes::open_themes_dir,
                vault_settings::load_vault_settings, vault_settings::update_vault_settings,
                search::search_vault, search::search_index_status, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
                library::read_library, library::write_library, library::pick_library_file,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
                templates::list_global_templates, templates::read_global_template,
                templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event
            ])
        };
        #[cfg(not(feature = "smoke-test"))]
        let builder = builder.invoke_handler(tauri::generate_handler![
            choose_vault, open_vault_at, reopen_vault, release_vault, retry_vault, list_directory, read_drawing, drawing_revision,
            write_drawing, create_folder, move_entry, move_entry_with_links, trash_entry, reveal_entry, reveal_recovery_dir,
            export_file, drawing_copy::save_drawing_copy, clipboard::copy_to_clipboard, pressure::release_memory, list_recovery, discard_recovery,
            config::load_settings, config::update_config, config::write_state, config::open_config_dir,
            themes::list_themes, themes::open_themes_dir,
            vault_settings::load_vault_settings, vault_settings::update_vault_settings,
            search::search_vault, search::search_index_status, search::vault_tags, search::search_list_names,
                links::vault_links, links::vault_unlinked_mentions, links::resolve_link, links::links_plan_move, links::links_remeasure, links::links_remeasure_done, links::tags_plan_rename, links::rename_tag, links::vault_graph, links::graph_layout_load, links::graph_layout_save,
                history::history_configure, history::history_status, history::history_opened, history::history_list, history::history_snapshot, history::history_checkpoint, history::history_read_version, history::history_read_blob, history::history_snapshot_bytes, history::history_restore_copy, history::history_export_file, history::history_delete_checkpoint, history::history_delete_all, history::history_exclude_from_git,
            library::read_library, library::write_library, library::pick_library_file,
                pdf_import::pdf_pick, pdf_import::pdf_open_bytes, pdf_import::pdf_render_page, pdf_import::pdf_unlock, pdf_import::pdf_close,
            templates::list_global_templates, templates::read_global_template,
            templates::write_global_template, templates::open_global_templates_dir,
                thumbs::thumbs_lookup, thumbs::thumbs_put, thumbs::thumbs_clear,
                control::bridge::control_ready, control::bridge::control_reply, control::bridge::control_commands_snapshot, control::bridge::control_install_cli, control::events::control_event
        ]);
        startup_trace("builder configured");
        let app = builder
            .build(tauri::generate_context!())
            .expect("error while building Vaultdraw");
        startup_trace("app built");
        app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                control::on_exit();
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // The test runner intentionally exits after writing its report.
                #[cfg(feature = "smoke-test")]
                if smoke::enabled() {
                    return;
                }
                // Cmd+Q / the native Quit menu must use the same awaited save
                // barrier as closing a window. Once the renderer has flushed
                // and destroyed the last window, normal process exit is safe.
                if !handle.webview_windows().is_empty() {
                    api.prevent_exit();
                    let _ = handle.emit("vault-quit-request", ());
                }
            }
        });
    }
}
