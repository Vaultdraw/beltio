//! Links between drawings (P1): `[[wikilinks]]` in text, drawing links in element `link`
//! fields, backlinks, rename/move safety. See `types.rs` for the command list and wire types.
//!
//! The link index lives inside the search index (`search::Index::links`): built lazily on the
//! first demand, then maintained by the same upsert/remove path. Nothing here runs, or costs
//! memory, until a link command is first used.

mod journal;
mod layout_store;
mod note_rewrite;
mod plan;
mod rewrite;
mod tag_rename;

// Grammar, link index, graph export, resolution and queries live in `vaultdraw-core`.
pub(crate) use vaultdraw_core::links::{grammar, graph, index, query, resolve, types};

#[cfg(test)]
mod bench;
#[cfg(test)]
mod tests;

pub(crate) use types::*;

use crate::search::{SearchService, VaultIndex};
use crate::{err, now_ms, Result, Vault, MAX_DRAWING_BYTES};
use journal::Journal;
use plan::{FilePlan, Plan};
use resolve::dir_of;
use rewrite::{rewrite, FileRules, TagRule};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter as _, Manager as _, State};

const DEFAULT_MENTIONS: u32 = 50;
const MAX_MENTIONS: u32 = 200;
const WAIT_STEP: Duration = Duration::from_millis(5);
const MAX_JOB_WAIT: Duration = Duration::from_secs(5);
const MAX_READY_WAIT: Duration = Duration::from_secs(3);

/// Shared, cheap-to-clone state of the links feature.
#[derive(Clone, Default)]
pub(crate) struct LinksState {
    jobs: Arc<AtomicU32>,
    running: Arc<AtomicU32>,
    /// Serialises read-modify-write of `remeasure.json`.
    io: Arc<Mutex<()>>,
}

type IndexedFn = Box<dyn Fn(&str, (u64, u64), &[u8]) + Send + Sync>;

/// What a background job needs from its environment (Tauri in the app, closures in tests).
pub(crate) struct Hooks {
    /// A drawing was rewritten: `(path, (size, mtime), bytes)`.
    pub indexed: IndexedFn,
    pub done: Box<dyn Fn(RewriteDone) + Send + Sync>,
    /// Called with the path just before a rewritten drawing is committed (a test seam).
    pub before_write: Box<dyn Fn(&str) + Send + Sync>,
    /// `<state>/links/<vault-id>`; None disables the journal and the re-measure set.
    pub dir: Option<PathBuf>,
}

fn took_ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

fn links_dir_for(v: &Vault) -> Option<PathBuf> {
    crate::config::resolve_dirs().ok().map(|d| journal::links_dir(&d.state, &v.root))
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn tauri_hooks(app: &AppHandle, v: &Vault) -> Hooks {
    let (a1, a2, a3, h1, h3) = (app.clone(), app.clone(), app.clone(), v.handle.clone(), v.handle.clone());
    Hooks {
        indexed: Box::new(move |path, stat, bytes| {
            if let Some(s) = a1.try_state::<SearchService>() {
                s.upsert_bytes(&h1, path, stat, bytes);
            }
        }),
        done: Box::new(move |d| {
            let _ = a2.emit("links-rewrite-done", d);
        }),
        // File history keeps the pre-rewrite state (D-R2): one clone + one queue push.
        before_write: Box::new(move |path| {
            if let Some(h) = a3.try_state::<crate::history::HistoryService>() {
                h.before_link_rewrite(&h3, path);
            }
        }),
        dir: links_dir_for(v),
    }
}

/// `vault.links` of the control API: the drawing's links and backlinks.
pub(crate) fn links_of(vi: &VaultIndex, path: &str) -> LinksResponse {
    with_links(vi, |i| vaultdraw_core::links::links_of(i, path))
}

/// Resolves a link-style name (`[[name]]`, from the vault root) to a drawing path.
pub(crate) fn resolve_name(vi: &VaultIndex, name: &str) -> Option<String> {
    with_links(vi, |i| vaultdraw_core::links::resolve_name(i, name))
}

/// Runs `f` with the vault's read-locked index once the link index exists.
fn with_links<T>(vi: &VaultIndex, f: impl Fn(&crate::search::Index) -> T) -> T {
    loop {
        vi.ensure_links();
        let g = vi.read();
        if g.links().is_some() {
            return f(&g);
        }
    }
}

// ---- rewriting files ----

struct RunGuard(Arc<AtomicU32>);
impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn failure(path: &str, code: &str, message: impl Into<String>) -> RewriteFailure {
    RewriteFailure { path: path.to_string(), code: code.to_string(), message: message.into() }
}

/// Rewrites one closed drawing; `Ok(None)` when nothing needed changing.
fn rewrite_file(v: &Vault, f: &FilePlan, tag: Option<&TagRule>, hooks: &Hooks, parents: &mut std::collections::BTreeSet<PathBuf>) -> std::result::Result<Option<(u32, Vec<String>)>, RewriteFailure> {
    if resolve::is_note_path(&f.to_path) {
        return rewrite_note_file(v, f, tag, hooks);
    }
    let fail = |e: crate::NativeError| failure(&f.to_path, if e.code == "CONFLICT" { "CONFLICT" } else if e.code == "INVALID_FILE" { "INVALID_FILE" } else { "IO" }, e.message);
    let abs = crate::safe_path(&v.root, &f.to_path, false).map_err(fail)?;
    let bytes = match crate::read_bounded(&abs, MAX_DRAWING_BYTES) {
        Ok(b) => b,
        Err(e) if e.code == "NOT_FOUND" => return Ok(None),
        Err(e) => return Err(fail(e)),
    };
    let revision = crate::revision(&bytes);
    let rules = FileRules { old_dir: dir_of(&f.from_path), new_dir: dir_of(&f.to_path), elements: &f.elements, tag, now_ms: now_ms(SystemTime::now()) };
    let Some(out) = rewrite(&bytes, &rules).map_err(fail)? else { return Ok(None) };
    let json = String::from_utf8(out.bytes).map_err(|_| failure(&f.to_path, "INVALID_FILE", "Rewritten drawing is not UTF-8"))?;
    (hooks.before_write)(&f.to_path);
    {
        let _mutation = crate::mutation_guard(v).map_err(fail)?;
        parents.insert(crate::write_drawing_file_rewrite(v, &f.to_path, &json, &revision).map_err(fail)?);
    }
    let stat = std::fs::metadata(&abs).map(|m| (m.len(), m.modified().map(now_ms).unwrap_or(0))).unwrap_or((json.len() as u64, 0));
    (hooks.indexed)(&f.to_path, stat, json.as_bytes());
    Ok(Some((out.links, out.text_elements)))
}

/// Rewrites the links of one note through the guarded write (revision check, history copy,
/// atomic rename). A tag rename never edits notes.
fn rewrite_note_file(v: &Vault, f: &FilePlan, tag: Option<&TagRule>, hooks: &Hooks) -> std::result::Result<Option<(u32, Vec<String>)>, RewriteFailure> {
    use vaultdraw_core::note_file::{read_note_file, write_note_file};
    let fail = |e: crate::NativeError| failure(&f.to_path, if e.code == "CONFLICT" { "CONFLICT" } else if e.code == "INVALID_FILE" || e.code == "INVALID_PATH" { "INVALID_FILE" } else { "IO" }, e.message);
    if tag.is_some() {
        return Ok(None);
    }
    let note = match read_note_file(&v.root, &f.to_path) {
        Ok(n) => n,
        Err(e) if e.code == "NOT_FOUND" => return Ok(None),
        Err(e) => return Err(fail(e)),
    };
    let Some(out) = note_rewrite::rewrite_note(&note.content, f) else { return Ok(None) };
    let w = write_note_file(v, &f.to_path, &out.text, Some(&note.revision)).map_err(fail)?;
    (hooks.indexed)(&f.to_path, (w.bytes, w.mtime_ms), out.text.as_bytes());
    Ok(Some((out.links, Vec::new())))
}

/// Rewrites `files` (closed drawings and notes) and finishes the job: re-measure set, journal, event.
/// `tag` switches the rewriter to tag mode (the files carry no element lists then).
fn run_job(v: &Vault, files: &[FilePlan], tag: Option<&TagRule>, job_id: u32, hooks: &Hooks, state: &LinksState) -> RewriteDone {
    let started = Instant::now();
    let mut done = RewriteDone { handle: v.handle.clone(), job_id, rewritten: 0, links: 0, failed: Vec::new(), took_ms: 0.0 };
    let mut remeasure = Vec::new();
    if let Err(e) = crate::writable(v) {
        done.failed = files.iter().map(|f| failure(&f.to_path, "IO", e.message.clone())).collect();
    } else {
        let mut parents = std::collections::BTreeSet::new();
        for f in files {
            match rewrite_file(v, f, tag, hooks, &mut parents) {
                Ok(Some((links, texts))) => {
                    done.rewritten += 1;
                    done.links += links;
                    if !texts.is_empty() {
                        remeasure.push((f.to_path.clone(), texts));
                    }
                }
                Ok(None) => {}
                Err(f) => done.failed.push(f),
            }
        }
        // One directory fsync per folder makes all the renames durable; only then is the journal dropped.
        crate::sync_dirs(&parents);
    }
    if let Some(dir) = &hooks.dir {
        let _io = state.io.lock().unwrap_or_else(|p| p.into_inner());
        if let Err(e) = journal::add_remeasure(dir, remeasure) {
            eprintln!("vaultdraw: re-measure set not saved: {} ({})", e.message, e.code);
        }
        journal::clear_journal(dir);
    }
    done.took_ms = took_ms(started);
    (hooks.done)(done.clone());
    done
}

/// Replays an interrupted rename's journal (idempotent). Call when the vault opens.
pub(crate) fn replay_journal(v: &Vault, hooks: &Hooks, state: &LinksState) -> Option<RewriteDone> {
    let dir = hooks.dir.as_ref()?;
    if !journal::journal_exists(dir) {
        return None;
    }
    let Some(j) = journal::read_journal(dir) else {
        journal::clear_journal(dir);
        return None;
    };
    // A rename whose new tag lies under the old one is not idempotent token by token: on replay,
    // tokens already under the new tag count as done.
    let tag = j.tag.map(|mut t| {
        let to_key = crate::search::tag_key(&t.to);
        if crate::search::key_under(&to_key, &t.from_key) {
            t.skip_under = Some(to_key);
        }
        t
    });
    Some(run_job(v, &j.files, tag.as_ref(), j.job_id, hooks, state))
}

/// Starts the journal replay for a vault that was just opened (a no-op without a journal).
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn on_vault_open(app: &AppHandle, v: Arc<Vault>) {
    let Some(dir) = links_dir_for(&v) else { return };
    if !journal::journal_exists(&dir) {
        return;
    }
    let (app, hooks) = (app.clone(), tauri_hooks(app, &v));
    let _ = std::thread::Builder::new().name("vaultdraw-links-replay".into()).spawn(move || {
        if let Some(state) = app.try_state::<LinksState>() {
            replay_journal(&v, &hooks, &state);
        }
    });
}

/// Builds the link index in the background once the search index is ready (`links.start` =
/// open or idle), so the first backlinks query does not pay for it. Sleeps on the index's
/// ready signal (no polling) and ends when the vault closes.
pub(crate) fn prewarm(vi: Arc<VaultIndex>) {
    let _ = std::thread::Builder::new().name("vaultdraw-links-prewarm".into()).spawn(move || {
        crate::search::lower_priority();
        if vi.wait_ready() {
            vi.ensure_links();
        }
    });
}

// ---- move with links ----

fn wait_for(limit: Duration, mut cond: impl FnMut() -> bool) {
    let t = Instant::now();
    while !cond() && t.elapsed() < limit {
        std::thread::sleep(WAIT_STEP);
    }
}

/// One rename or move request.
pub(crate) struct MoveRequest<'a> {
    pub from: &'a str,
    pub to: &'a str,
    /// Pre-move path of the drawing open in the editor.
    pub open_path: Option<&'a str>,
}

/// Plans, journals and renames; the closed drawings are rewritten on the returned thread.
/// `rename` performs the actual move (the caller's `move_entry_paths`).
pub(crate) fn move_with_links(
    v: &Arc<Vault>,
    req: &MoveRequest,
    (search, state): (&SearchService, &LinksState),
    hooks: Hooks,
    rename: impl FnOnce() -> Result<()>,
) -> Result<(MoveResult, Option<JoinHandle<()>>)> {
    let MoveRequest { from, to, open_path } = *req;
    let Ok(vi) = search.vault(&v.handle) else {
        let _g = crate::mutation_guard(v)?;
        rename()?;
        return Ok((MoveResult::default(), None));
    };
    // A second rename plans against the index only once the first one's rewrite has landed.
    wait_for(MAX_JOB_WAIT, || state.running.load(Ordering::SeqCst) == 0);
    wait_for(MAX_READY_WAIT, || vi.is_ready());
    let guard = crate::mutation_guard(v)?;
    vi.ensure_links();
    let plan: Plan = plan::plan_move(&mut vi.write(), from, to);
    let mut result = MoveResult::default();
    let open_plan = open_path.and_then(|o| plan.files.iter().find(|f| f.from_path == o));
    if let Some(f) = open_plan {
        if let Ok(abs) = crate::safe_path(&v.root, &f.from_path, false) {
            if let Ok(bytes) = crate::read_bounded(&abs, MAX_DRAWING_BYTES) {
                let rules = FileRules { old_dir: dir_of(&f.from_path), new_dir: dir_of(&f.to_path), elements: &f.elements, tag: None, now_ms: now_ms(SystemTime::now()) };
                if let Ok(Some(out)) = rewrite(&bytes, &rules) {
                    result.open_drawing_edits = out.edits;
                }
            }
        }
    }
    let closed: Vec<FilePlan> = plan.files.iter().filter(|f| Some(f.from_path.as_str()) != open_path).cloned().collect();
    let job_id = (!closed.is_empty()).then(|| state.jobs.fetch_add(1, Ordering::SeqCst) + 1);
    if let (Some(id), Some(dir)) = (job_id, &hooks.dir) {
        // Everything still to rewrite, including the open drawing (replay runs with nothing open).
        journal::write_journal(dir, &Journal::new(id, plan.files.clone()))?;
    }
    if let Err(e) = rename() {
        if let Some(dir) = &hooks.dir {
            journal::clear_journal(dir);
        }
        return Err(e);
    }
    vi.write().move_docs(from, to);
    if let Some(dir) = &hooks.dir {
        let _io = state.io.lock().unwrap_or_else(|p| p.into_inner());
        let _ = journal::remap_remeasure(dir, &plan.moves);
    }
    drop(guard);
    result.job_id = job_id;
    result.planned_files = closed.len() as u32;
    result.planned_links = closed.iter().map(FilePlan::links).sum();
    let Some(id) = job_id else { return Ok((result, None)) };
    state.running.fetch_add(1, Ordering::SeqCst);
    let (v2, state2) = (v.clone(), state.clone());
    let run = RunGuard(state.running.clone());
    let handle = std::thread::Builder::new()
        .name("vaultdraw-links-rewrite".into())
        .spawn(move || {
            let _run = run;
            crate::search::lower_priority();
            run_job(&v2, &closed, None, id, &hooks, &state2);
        })
        .map_err(|e| err("INTERNAL", format!("Cannot start the link rewrite: {e}")))?;
    Ok((result, Some(handle)))
}

/// Backs `move_entry_with_links` in lib.rs.
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn move_command(app: &AppHandle, v: &Arc<Vault>, from: &str, to: &str, open_path: Option<&str>, search: &SearchService, state: &LinksState) -> Result<MoveResult> {
    let hooks = tauri_hooks(app, v);
    let rename = || crate::move_entry_paths(&v.root, from, to);
    move_with_links(v, &MoveRequest { from, to, open_path }, (search, state), hooks, rename).map(|(r, _)| r)
}

// ---- tag rename commands (logic in tag_rename.rs) ----

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn tags_plan_rename(handle: String, from: String, to: String, search: State<'_, SearchService>) -> Result<tag_rename::TagRenamePlan> {
    let vi = vault_index(&search, &handle)?;
    let g = vi.read();
    tag_rename::plan(&g, &from, &to).map(|p| p.response)
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn rename_tag(app: AppHandle, handle: String, from: String, to: String, open_path: Option<String>, state: State<'_, crate::Service>, search: State<'_, SearchService>, links: State<'_, LinksState>) -> Result<MoveResult> {
    let v = crate::vault_for(&state, &handle)?;
    tag_rename::rename_command(&app, &v, (&from, &to), open_path.as_deref(), &search, &links)
}

// ---- commands ----

fn vault_index(search: &SearchService, handle: &str) -> Result<Arc<VaultIndex>> {
    search.vault(handle)
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn vault_links(handle: String, path: String, search: State<'_, SearchService>) -> Result<LinksResponse> {
    let vi = vault_index(&search, &handle)?;
    Ok(with_links(&vi, |i| query::links_response(i, &path)))
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn vault_unlinked_mentions(handle: String, path: String, limit: Option<u32>, search: State<'_, SearchService>) -> Result<MentionsResponse> {
    let vi = vault_index(&search, &handle)?;
    let limit = limit.unwrap_or(DEFAULT_MENTIONS).clamp(1, MAX_MENTIONS) as usize;
    Ok(with_links(&vi, |i| query::mentions_response(i, &path, limit)))
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn resolve_link(handle: String, from_path: String, raw: String, search: State<'_, SearchService>) -> Result<Resolution> {
    let vi = vault_index(&search, &handle)?;
    if raw.len() > 4096 {
        return Ok(Resolution { path: None, candidates: Vec::new() });
    }
    // `![[image.png]]` and `[[paper.pdf]]` name files that are not in the search index.
    if let Some(target) = vaultdraw_core::links::attach::attachment_target(&raw) {
        let path = vi.attachments().resolve(&from_path, &target);
        return Ok(Resolution { path, candidates: Vec::new() });
    }
    Ok(with_links(&vi, |i| query::resolve_raw(i, &from_path, &raw)))
}

pub(crate) fn move_plan(vi: &VaultIndex, from: &str, to: &str) -> MovePlan {
    vi.ensure_links();
    let plan = plan::plan_move(&mut vi.write(), from, to);
    MovePlan { files: plan.files.len() as u32, links: plan.files.iter().map(FilePlan::links).sum(), re_pointed: plan.re_pointed }
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn links_plan_move(handle: String, from: String, to: String, search: State<'_, SearchService>) -> Result<MovePlan> {
    crate::validate_relative(&from)?;
    crate::validate_relative(&to)?;
    let vi = vault_index(&search, &handle)?;
    Ok(move_plan(&vi, &from, &to))
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn links_remeasure(handle: String, state: State<'_, crate::Service>) -> Result<RemeasureSet> {
    let v = crate::vault_for(&state, &handle)?;
    Ok(links_dir_for(&v).map(|d| journal::load_remeasure(&d)).unwrap_or_default())
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn links_remeasure_done(handle: String, path: String, state: State<'_, crate::Service>, links: State<'_, LinksState>) -> Result<()> {
    let v = crate::vault_for(&state, &handle)?;
    let Some(dir) = links_dir_for(&v) else { return Ok(()) };
    let _io = links.io.lock().unwrap_or_else(|p| p.into_inner());
    journal::remeasure_done(&dir, &path)
}

// ---- graph view (P3) ----

/// Whole-vault graph as raw `VDG1` bytes (format in `graph.rs`).
#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn vault_graph(handle: String, search: State<'_, SearchService>) -> Result<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(graph_bytes(&search, &handle)?))
}

/// The graph bytes behind `vault_graph` (also the plugin gateway's raw route `vault.graph`).
pub(crate) fn graph_bytes(search: &SearchService, handle: &str) -> Result<Vec<u8>> {
    let vi = vault_index(search, handle)?;
    let bytes = with_links(&vi, |i| i.graph_bytes(graph::export).unwrap_or_default());
    Ok(bytes.to_vec())
}

/// Saved layout bytes of a vault (also the plugin gateway's raw route `vault.graphLayout.load`).
pub(crate) fn layout_bytes(v: &Vault) -> Vec<u8> {
    graph_dir_for(v).map(|d| layout_store::load(&d)).unwrap_or_default()
}

/// Saves layout bytes of a vault; empty clears (also the plugin gateway's `vault.graphLayout.save`).
pub(crate) fn layout_write(v: &Vault, bytes: &[u8]) -> Result<()> {
    layout_store::save(&graph_dir_for(v)?, bytes)
}

fn graph_dir_for(v: &Vault) -> Result<PathBuf> {
    let d = crate::config::resolve_dirs()?;
    Ok(layout_store::graph_dir(&d.state, &v.root))
}

/// Saved graph layout bytes (empty when none); the format is owned by `src/graph/layoutStore.ts`.
#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn graph_layout_load(handle: String, state: State<'_, crate::Service>) -> Result<tauri::ipc::Response> {
    let v = crate::vault_for(&state, &handle)?;
    Ok(tauri::ipc::Response::new(layout_bytes(&v)))
}

/// Saves the layout: raw request body, vault handle in the `handle` header (empty body clears).
#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn graph_layout_save(request: tauri::ipc::Request<'_>, state: State<'_, crate::Service>) -> Result<()> {
    let handle = crate::clipboard::header(&request, "handle")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(err("INVALID_ARGUMENT", "Expected a raw binary body"));
    };
    let v = crate::vault_for(&state, &handle)?;
    layout_write(&v, bytes)
}
