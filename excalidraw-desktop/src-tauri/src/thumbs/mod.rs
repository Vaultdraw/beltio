//! Persistent drawing-thumbnail cache (F2). Content-addressed by drawing revision, kept in the
//! app state dir (never in the vault). Lazy: no disk I/O until the first lookup/put.
//! Layout: `<state>/thumbs/<vault_id>/{manifest.json, <rev[0..2]>/<rev>.v<N>.png | <rev>.v<N>.fail}`.
#![cfg_attr(test, allow(dead_code))]
mod gc;
mod manifest;
mod scheme;
mod store;
#[cfg(test)]
mod tests;

use crate::{err, ioerr, Result, Service};
use manifest::{Entry, Manifest};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime},
};
use store::{fail_path, png_path, validate_rev, Kind};
use tauri::{ipc::{InvokeBody, Request}, AppHandle, Manager, State};

const MAX_LOOKUP_PATHS: usize = 500;
const MAX_REHASH_PER_LOOKUP: usize = 64;
const PERSIST_DEBOUNCE: Duration = Duration::from_secs(5);
/// Files younger than this are never evicted (a just-written thumbnail may not be in the manifest yet).
const GC_MIN_AGE: Duration = Duration::from_secs(10);

pub(crate) fn cache_dir(state_dir: &Path, vault_id: &str) -> PathBuf {
    state_dir.join("thumbs").join(vault_id)
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ThumbState {
    Hit,
    Miss,
    Failed,
    Missing,
    Pending,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct ThumbLookup {
    pub rev: Option<String>,
    pub state: ThumbState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookupResult {
    pub vault_id: String,
    pub items: Vec<ThumbLookup>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PutResult {
    pub url: Option<String>,
}

#[derive(Default)]
struct Inner {
    manifest: Option<Manifest>,
    dirty: bool,
    persist_scheduled: bool,
    total_bytes: Option<u64>,
    gc_running: bool,
}

/// Cache state of one open vault. Tests build it directly from `(root, cache)`.
pub(crate) struct VaultThumbs {
    root: PathBuf,
    vault_id: String,
    cache: PathBuf,
    /// Cache size cap in bytes; a put may carry a new one (`interface.thumbnail_cache_mb`).
    cap: AtomicU64,
    gc_min_age: Duration,
    debounce: Duration,
    inner: Mutex<Inner>,
}

type Stat = (u64, u64);

fn stat_of(path: &Path) -> Option<Stat> {
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    Some((meta.len(), crate::now_ms(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH))))
}

impl VaultThumbs {
    pub(crate) fn new(root: PathBuf, state_dir: &Path) -> Arc<VaultThumbs> {
        let vault_id = crate::search::vault_id(&root);
        let cache = cache_dir(state_dir, &vault_id);
        Arc::new(VaultThumbs {
            root,
            vault_id,
            cache,
            cap: AtomicU64::new(gc::CAP_BYTES),
            gc_min_age: GC_MIN_AGE,
            debounce: PERSIST_DEBOUNCE,
            inner: Mutex::new(Inner::default()),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| err("INTERNAL", "Thumbnail state unavailable"))
    }

    fn manifest<'a>(&self, inner: &'a mut Inner) -> &'a mut Manifest {
        inner.manifest.get_or_insert_with(|| Manifest::load(&self.cache))
    }

    /// Drawing file for a vault-relative path (None = gone, not a drawing, reserved or a symlink).
    fn drawing_file(&self, path: &str) -> Option<PathBuf> {
        if !path.to_ascii_lowercase().ends_with(".excalidraw") {
            return None;
        }
        crate::safe_path(&self.root, path, false).ok()
    }

    /// Revision of `file` through the stat gate. `budget` counts the rehashes still allowed.
    /// Ok(None) = gone; Err(()) = rehash budget exhausted.
    fn revision_for(self: &Arc<Self>, path: &str, file: &Path, budget: &mut usize) -> std::result::Result<Option<(Stat, String)>, ()> {
        let Some(stat) = stat_of(file) else {
            self.forget(path);
            return Ok(None);
        };
        if let Some(rev) = self.gated_rev(path, stat) {
            return Ok(Some((stat, rev)));
        }
        if *budget == 0 {
            return Err(());
        }
        *budget -= 1;
        match crate::current_revision(file) {
            Ok(Some(rev)) => {
                self.record(path, stat, &rev);
                Ok(Some((stat, rev)))
            }
            _ => {
                self.forget(path);
                Ok(None)
            }
        }
    }

    fn gated_rev(&self, path: &str, (size, mtime_ms): Stat) -> Option<String> {
        let mut inner = self.lock().ok()?;
        let e = self.manifest(&mut inner).entries.get(path)?;
        (e.size == size && e.mtime_ms == mtime_ms).then(|| e.rev.clone())
    }

    fn record(self: &Arc<Self>, path: &str, (size, mtime_ms): Stat, rev: &str) {
        let Ok(mut inner) = self.lock() else { return };
        let changed = self.manifest(&mut inner).set(path, Entry { size, mtime_ms, rev: rev.to_string() });
        if changed {
            self.mark_dirty(inner);
        }
    }

    fn forget(self: &Arc<Self>, path: &str) {
        let Ok(mut inner) = self.lock() else { return };
        let had = inner.manifest.is_some() && self.manifest(&mut inner).remove(path);
        if had {
            self.mark_dirty(inner);
        }
    }

    /// Debounced persistence: the first change starts a timer thread, later ones ride along.
    fn mark_dirty(self: &Arc<Self>, mut inner: std::sync::MutexGuard<'_, Inner>) {
        inner.dirty = true;
        if inner.persist_scheduled {
            return;
        }
        inner.persist_scheduled = true;
        drop(inner);
        let me = Arc::clone(self);
        let delay = self.debounce;
        let spawned = std::thread::Builder::new().name("thumbs-persist".into()).spawn(move || {
            std::thread::sleep(delay);
            if let Ok(mut i) = me.lock() {
                i.persist_scheduled = false;
            }
            let _ = me.flush();
        });
        if spawned.is_err() {
            if let Ok(mut i) = self.lock() {
                i.persist_scheduled = false;
            }
        }
    }

    /// Write the manifest now if it changed (also called on release_vault).
    pub(crate) fn flush(&self) -> Result<()> {
        let bytes = {
            let mut inner = self.lock()?;
            if !inner.dirty {
                return Ok(());
            }
            inner.dirty = false;
            self.manifest(&mut inner).to_bytes()
        };
        let saved = Manifest::save_bytes(&self.cache, &bytes);
        if saved.is_err() {
            // Keep the changes pending so a later flush retries the write.
            if let Ok(mut inner) = self.lock() {
                inner.dirty = true;
            }
        }
        saved
    }

    /// `fail_version` names the fail markers to honour (they carry their own generation, so a
    /// renderer cap change can retry them without re-rendering every PNG).
    pub(crate) fn lookup(self: &Arc<Self>, paths: &[String], render_version: u32, fail_version: u32) -> Result<LookupResult> {
        if paths.len() > MAX_LOOKUP_PATHS {
            return Err(err("INVALID_ARGUMENT", format!("At most {MAX_LOOKUP_PATHS} paths per lookup")));
        }
        let mut budget = MAX_REHASH_PER_LOOKUP;
        let items = paths.iter().map(|p| self.lookup_one(p, render_version, fail_version, &mut budget)).collect();
        Ok(LookupResult { vault_id: self.vault_id.clone(), items })
    }

    fn lookup_one(self: &Arc<Self>, path: &str, render_version: u32, fail_version: u32, budget: &mut usize) -> ThumbLookup {
        let item = |rev: Option<String>, state| ThumbLookup { rev, state };
        let Some(file) = self.drawing_file(path) else {
            self.forget(path);
            return item(None, ThumbState::Missing);
        };
        match self.revision_for(path, &file, budget) {
            Err(()) => item(None, ThumbState::Pending),
            Ok(None) => item(None, ThumbState::Missing),
            Ok(Some((_, rev))) => {
                let state = if png_path(&self.cache, &rev, render_version).is_file() {
                    ThumbState::Hit
                } else if fail_path(&self.cache, &rev, fail_version).is_file() {
                    ThumbState::Failed
                } else {
                    ThumbState::Miss
                };
                item(Some(rev), state)
            }
        }
    }

    /// Store a rendered thumbnail (or fail marker) for revision `rev` of `path`.
    /// Set the cache cap from a put's `x-cap-mb` (megabytes); out-of-range values are ignored.
    pub(crate) fn set_cap_mb(&self, mb: u64) {
        if (gc::MIN_CAP_MB..=gc::MAX_CAP_MB).contains(&mb) {
            self.cap.store(mb * 1024 * 1024, Ordering::Relaxed);
        }
    }

    pub(crate) fn put(self: &Arc<Self>, path: &str, rev: &str, kind: Kind, render_version: u32, body: &[u8]) -> Result<PutResult> {
        validate_rev(rev)?;
        let written = store::write_entry(&self.cache, rev, kind, render_version, body)?;
        self.adopt_if_current(path, rev);
        self.account(written);
        let url = (kind == Kind::Png).then(|| format!("vdthumb://localhost/{}/{rev}.v{render_version}.png", self.vault_id));
        Ok(PutResult { url })
    }

    /// Point the manifest at `rev` only if the file on disk still has exactly that revision.
    fn adopt_if_current(self: &Arc<Self>, path: &str, rev: &str) {
        let Some(file) = self.drawing_file(path) else { return };
        let Some(stat) = stat_of(&file) else { return };
        if self.gated_rev(path, stat).as_deref() == Some(rev) {
            return;
        }
        if matches!(crate::current_revision(&file), Ok(Some(ref cur)) if cur == rev) {
            self.record(path, stat, rev);
        }
    }

    /// Track the cache size; start a background GC when a put pushes it over the cap.
    fn account(self: &Arc<Self>, added: u64) {
        let Ok(mut inner) = self.lock() else { return };
        let total = match inner.total_bytes {
            Some(t) => t + added,
            None => gc::dir_size(&self.cache), // includes the file just written
        };
        inner.total_bytes = Some(total);
        let cap = self.cap.load(Ordering::Relaxed);
        if total <= cap || inner.gc_running {
            return;
        }
        inner.gc_running = true;
        let referenced = self.manifest(&mut inner).revs();
        drop(inner);
        let me = Arc::clone(self);
        let spawned = std::thread::Builder::new().name("thumbs-gc".into()).spawn(move || {
            let left = gc::run(&me.cache, &referenced, cap, me.gc_min_age);
            if let Ok(mut i) = me.lock() {
                i.total_bytes = Some(left);
                i.gc_running = false;
            }
        });
        if spawned.is_err() {
            if let Ok(mut i) = self.lock() {
                i.gc_running = false;
            }
        }
    }

    pub(crate) fn clear(&self) -> Result<()> {
        let mut inner = self.lock()?;
        *inner = Inner { manifest: Some(Manifest::default()), ..Inner::default() };
        match fs::remove_dir_all(&self.cache) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(ioerr(e)),
        }
    }
}

/// Managed state. Holds nothing until the first command runs.
#[derive(Default)]
pub(crate) struct ThumbsService {
    vaults: Mutex<HashMap<String, Arc<VaultThumbs>>>,
}

static STATE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// State dir, resolved once (env + platform lookup) and shared with the scheme handler.
fn state_dir() -> Result<&'static Path> {
    STATE_DIR
        .get_or_init(|| crate::config::resolve_dirs().ok().map(|d| d.state))
        .as_deref()
        .ok_or_else(|| err("INTERNAL", "State directory unavailable"))
}

impl ThumbsService {
    fn vault(&self, handle: &str, root: &Path) -> Result<Arc<VaultThumbs>> {
        let mut map = self.vaults.lock().map_err(|_| err("INTERNAL", "Thumbnail state unavailable"))?;
        if let Some(v) = map.get(handle) {
            return Ok(Arc::clone(v));
        }
        let v = VaultThumbs::new(root.to_path_buf(), state_dir()?);
        map.insert(handle.to_string(), Arc::clone(&v));
        Ok(v)
    }

    /// Called from release_vault: drop the vault and persist its manifest.
    pub(crate) fn stop(&self, handle: &str) {
        let removed = self.vaults.lock().ok().and_then(|mut m| m.remove(handle));
        if let Some(v) = removed {
            let _ = v.flush();
        }
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| err("INTERNAL", format!("Thumbnail task failed: {e}")))?
}

fn vault_thumbs(handle: &str, svc: &Service, thumbs: &ThumbsService) -> Result<Arc<VaultThumbs>> {
    let v = crate::vault_for(svc, handle)?;
    thumbs.vault(handle, &v.root)
}

#[tauri::command]
pub(crate) async fn thumbs_lookup(
    handle: String,
    paths: Vec<String>,
    render_version: u32,
    fail_version: Option<u32>,
    svc: State<'_, Service>,
    thumbs: State<'_, ThumbsService>,
) -> Result<LookupResult> {
    let vt = vault_thumbs(&handle, &svc, &thumbs)?;
    let fail_version = fail_version.unwrap_or(render_version);
    blocking(move || vt.lookup(&paths, render_version, fail_version)).await
}

#[tauri::command]
pub(crate) async fn thumbs_put(request: Request<'_>, svc: State<'_, Service>, thumbs: State<'_, ThumbsService>) -> Result<PutResult> {
    use crate::clipboard::{header_value, percent_decode};
    let h = request.headers();
    let handle = percent_decode(&header_value(h, "x-handle")?)?;
    let path = percent_decode(&header_value(h, "x-path")?)?;
    let rev = header_value(h, "x-revision")?;
    let kind = store::parse_kind(&header_value(h, "x-kind")?)?;
    let render_version: u32 = header_value(h, "x-render-version")?
        .parse()
        .map_err(|_| err("INVALID_ARGUMENT", "x-render-version must be an unsigned integer"))?;
    let body = match request.body() {
        InvokeBody::Raw(b) if b.len() > store::MAX_PNG_BYTES => return Err(err("INVALID_FILE", "Thumbnail exceeds 1 MB")),
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => Vec::new(), // rejected by validate_body (not a PNG / not empty)
    };
    let vt = vault_thumbs(&handle, &svc, &thumbs)?;
    if let Some(mb) = h.get("x-cap-mb").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()) {
        vt.set_cap_mb(mb);
    }
    blocking(move || vt.put(&path, &rev, kind, render_version, &body)).await
}

#[tauri::command]
pub(crate) async fn thumbs_clear(handle: String, svc: State<'_, Service>, thumbs: State<'_, ThumbsService>) -> Result<()> {
    let vt = vault_thumbs(&handle, &svc, &thumbs)?;
    blocking(move || vt.clear()).await
}

/// Register the `vdthumb` scheme: validated hex names only, file I/O off the main thread.
pub(crate) fn register_scheme<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("vdthumb", |_ctx, request, responder| {
        let uri_path = request.uri().path().to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let png = state_dir().ok().and_then(|d| scheme::read(d, &uri_path));
            responder.respond(scheme::response(png));
        });
    })
}

/// release_vault hook (kept here so lib.rs only adds one call).
pub(crate) fn release(app: &AppHandle, handle: &str) {
    if let Some(t) = app.try_state::<ThumbsService>() {
        t.stop(handle);
    }
}
