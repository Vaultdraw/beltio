//! Rename a tag across the vault (F6 P2). Same job machinery as a drawing rename (`run_job`:
//! journal, revision-checked writes, re-measure set, one fsync per folder, `links-rewrite-done`)
//! with the rewriter in tag mode: whole `#tag` tokens under the old tag change, nothing else.
//!
//! Commands (wrappers in `mod.rs`):
//! - `tags_plan_rename(handle, from, to) -> TagRenamePlan`: pure query on the search index.
//! - `rename_tag(handle, from, to, openPath?) -> MoveResult`: the open drawing is not written;
//!   its edits come back in `openDrawingEdits` (field `text`, or `name` for a frame name).
//!
//! Errors: `INVALID_TAG` (from/to is not exactly one tag), plus the usual vault codes.

use super::journal::{self, Journal};
use super::plan::FilePlan;
use super::rewrite::{rewrite, tag_edits, FileRules, TagRule};
use super::types::{ElementEdit, MoveResult};
use super::{run_job, wait_for, Hooks, LinksState, RunGuard, MAX_JOB_WAIT, MAX_READY_WAIT};
use crate::search::{find_tags, key_under, tag_key, Index, SearchService};
use crate::{err, now_ms, Result, Vault, MAX_DRAWING_BYTES};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    sync::{atomic::Ordering, Arc},
    thread::JoinHandle,
    time::SystemTime,
};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct KeyChange {
    pub from: String,
    pub to: String,
}

/// Wire type of `tags_plan_rename` (mirror: src/tags/types.ts `TagRenamePlan`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagRenamePlan {
    pub from: String,
    pub to: String,
    pub files: u32,
    pub occurrences: u32,
    pub merges: bool,
    pub keys: Vec<KeyChange>,
}

pub(crate) struct TagPlan {
    pub response: TagRenamePlan,
    pub rule: TagRule,
    /// Drawings to rewrite, sorted, with the tokens each one changes.
    pub files: Vec<(String, u32)>,
}

/// `raw` (with or without `#`) as the body of exactly one whole tag, else `INVALID_TAG`.
fn whole_tag(raw: &str) -> Result<&str> {
    let body = raw.trim().strip_prefix('#').unwrap_or(raw.trim());
    let probe = format!("#{body}");
    match find_tags(&probe).as_slice() {
        [m] if m.range == (0, probe.len()) => Ok(body),
        _ => Err(err("INVALID_TAG", format!("\"{}\" is not a valid tag", raw.trim()))),
    }
}

/// Plans renaming `from` (and its children) to `to`. Reads only the documents that carry the tag.
pub(crate) fn plan(index: &Index, from: &str, to: &str) -> Result<TagPlan> {
    let (from_body, to_body) = (whole_tag(from)?, whole_tag(to)?);
    let (from_key, to_key) = (tag_key(from_body), tag_key(to_body));
    let rule = TagRule { from_key: from_key.clone(), to: to_body.to_string(), skip_under: None };
    let mut response = TagRenamePlan { from: from_key.clone(), to: to_body.to_string(), files: 0, occurrences: 0, merges: false, keys: Vec::new() };
    let mut files = Vec::new();
    if from_body == to_body {
        return Ok(TagPlan { response, rule, files });
    }
    let mut keys: BTreeSet<&str> = BTreeSet::new();
    let mut doc_keys: Vec<&str> = Vec::new();
    for (path, tags) in index.tag_docs() {
        // Notes are not edited by a tag rename (their tags sit in prose, code and frontmatter).
        if vaultdraw_core::search::notes::is_note_name(path) {
            continue;
        }
        doc_keys.clear();
        for t in tags {
            if key_under(&t.key, &from_key) {
                // The tag and each of its ancestors that are also under `from`.
                doc_keys.extend(t.key.match_indices('/').map(|(i, _)| &t.key[..i]).filter(|k| k.len() >= from_key.len()));
                doc_keys.push(&t.key);
            } else if key_under(&t.key, &to_key) {
                response.merges = true;
            }
        }
        if doc_keys.is_empty() {
            continue;
        }
        let changes: u32 = index.get(path).map_or(0, |d| d.items.iter().map(|i| tag_edits(&i.text, &rule).len() as u32).sum());
        if changes > 0 {
            keys.extend(doc_keys.iter().copied());
            files.push((path.to_string(), changes));
        }
    }
    files.sort();
    response.files = files.len() as u32;
    response.occurrences = files.iter().map(|f| f.1).sum();
    response.keys = keys.into_iter().map(|k| KeyChange { from: k.to_string(), to: format!("{to_key}{}", &k[from_key.len()..]) }).filter(|c| c.from != c.to).collect();
    Ok(TagPlan { response, rule, files })
}

/// The drawing's pending edits, computed from the bytes on disk (the open drawing is never written).
fn open_edits(v: &Vault, path: &str, rule: &TagRule) -> Vec<ElementEdit> {
    let Ok(abs) = crate::safe_path(&v.root, path, false) else { return Vec::new() };
    let Ok(bytes) = crate::read_bounded(&abs, MAX_DRAWING_BYTES) else { return Vec::new() };
    let none = Default::default();
    let rules = FileRules { old_dir: "", new_dir: "", elements: &none, tag: Some(rule), now_ms: now_ms(SystemTime::now()) };
    rewrite(&bytes, &rules).ok().flatten().map(|o| o.edits).unwrap_or_default()
}

/// Plans, journals and starts the rewrite of the closed drawings on the returned thread.
pub(crate) fn rename_tag_with(v: &Arc<Vault>, (from, to): (&str, &str), open_path: Option<&str>, (search, state): (&SearchService, &LinksState), hooks: Hooks) -> Result<(MoveResult, Option<JoinHandle<()>>)> {
    let vi = search.vault(&v.handle)?;
    crate::writable(v)?;
    // A second rename plans against the index only once the first one's rewrite has landed.
    wait_for(MAX_JOB_WAIT, || state.running.load(Ordering::SeqCst) == 0);
    wait_for(MAX_READY_WAIT, || vi.is_ready());
    let plan = plan(&vi.read(), from, to)?;
    let mut result = MoveResult::default();
    if plan.files.is_empty() {
        return Ok((result, None));
    }
    if let Some(open) = open_path.filter(|o| plan.files.iter().any(|f| f.0 == *o)) {
        result.open_drawing_edits = open_edits(v, open, &plan.rule);
    }
    let closed: Vec<&(String, u32)> = plan.files.iter().filter(|f| Some(f.0.as_str()) != open_path).collect();
    let all: Vec<FilePlan> = plan.files.iter().map(|f| FilePlan { from_path: f.0.clone(), to_path: f.0.clone(), elements: Default::default() }).collect();
    let closed_plans: Vec<FilePlan> = all.iter().filter(|f| Some(f.from_path.as_str()) != open_path).cloned().collect();
    result.planned_files = closed.len() as u32;
    result.planned_links = closed.iter().map(|f| f.1).sum();
    if closed_plans.is_empty() {
        return Ok((result, None));
    }
    let id = state.jobs.fetch_add(1, Ordering::SeqCst) + 1;
    result.job_id = Some(id);
    if let Some(dir) = &hooks.dir {
        let _guard = crate::mutation_guard(v)?;
        // Everything still to rewrite, including the open drawing (replay runs with nothing open).
        journal::write_journal(dir, &Journal::new(id, all).with_tag(plan.rule.clone()))?;
    }
    state.running.fetch_add(1, Ordering::SeqCst);
    let (v2, state2, rule) = (v.clone(), state.clone(), plan.rule);
    let run = RunGuard(state.running.clone());
    let handle = std::thread::Builder::new()
        .name("vaultdraw-tag-rename".into())
        .spawn(move || {
            let _run = run;
            crate::search::lower_priority();
            run_job(&v2, &closed_plans, Some(&rule), id, &hooks, &state2);
        })
        .map_err(|e| err("INTERNAL", format!("Cannot start the tag rename: {e}")))?;
    Ok((result, Some(handle)))
}

/// Backs `rename_tag` in mod.rs.
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn rename_command(app: &AppHandle, v: &Arc<Vault>, tags: (&str, &str), open_path: Option<&str>, search: &SearchService, state: &LinksState) -> Result<MoveResult> {
    rename_tag_with(v, tags, open_path, (search, state), super::tauri_hooks(app, v)).map(|(r, _)| r)
}
