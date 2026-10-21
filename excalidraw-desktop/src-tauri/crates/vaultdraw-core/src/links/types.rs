//! Links P1 wire payloads (FROZEN CONTRACT; mirror: src/links/types.ts). Serde camelCase.
//!
//! Commands (all take the vault `handle`; paths are vault-relative, forward
//! slashes, with the `.excalidraw` extension):
//! - `vault_links(handle, path) -> LinksResponse`
//!   Outgoing links, backlinks (with snippets) and unresolved links of one drawing.
//!   Builds the link index lazily on first call (indexer thread), then incremental.
//! - `vault_unlinked_mentions(handle, path, limit?) -> MentionsResponse`
//!   Text that mentions the drawing's name without linking to it. Only called when
//!   the user expands the collapsed "Unlinked mentions" section.
//! - `resolve_link(handle, fromPath, raw) -> Resolution`
//!   `raw` is the link as written: `[[x|y]]`, `x`, `vaultdraw://open?file=x`, `./x.excalidraw`.
//! - `links_plan_move(handle, from, to) -> MovePlan`
//!   Read-only preview (for `links.update_on_rename = "ask"` and the re-point warning).
//!   `from`/`to` may be drawings or folders.
//! - `move_entry_with_links(handle, from, to, openPath?, rewrite) -> MoveResult`
//!   Same checks as `move_entry` (mutation guard, collision, read-only). When `rewrite`
//!   is true: plan, journal, rename, then rewrite closed drawings on a background
//!   thread (byte-preserving scanner, revision-checked atomic writes). `openPath` is the
//!   PRE-move path of the drawing open in the editor; it is never written on disk, its
//!   edits come back in `openDrawingEdits` (keyed by element id) for the editor to apply.
//!   Emits `links-rewrite-done` (RewriteDone) when the background job finishes.
//!   With `rewrite` false it behaves exactly like `move_entry`.
//! - `links_remeasure(handle) -> RemeasureSet`
//!   Drawings whose text Vaultdraw rewrote while closed, with the element ids to
//!   re-measure on next open. Fetched once per vault when idle (not on the open path).
//! - `links_remeasure_done(handle, path)` drops one drawing from the set.
//!
//! Events: `links-rewrite-done` (RewriteDone).
//! Crash journal: `<state>/links/<vault-id>/pending.json`, replayed when the vault opens.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Where a link lives in its drawing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    /// `[[...]]` inside a text element (free text, shape label, arrow label).
    Text,
    /// The element `link` field of any element.
    Shape,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutLink {
    pub element_id: String,
    /// Bound text: the shape/arrow it labels.
    pub container_id: Option<String>,
    pub kind: LinkKind,
    /// Target as written, without brackets, label or `.excalidraw`, e.g. `Graphs/BFS`.
    pub target: String,
    /// `[[target|label]]` label, if any.
    pub label: Option<String>,
    /// Resolved vault-relative path; None = unresolved.
    pub resolved: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackLink {
    /// The drawing that links here.
    pub path: String,
    pub element_id: String,
    pub container_id: Option<String>,
    pub kind: LinkKind,
    /// One line of the linking text (≤ 120 chars), or for shape links the shape's
    /// label text if any, else "".
    pub snippet: String,
    /// UTF-16 `[start, end)` of the link inside `snippet`.
    pub highlights: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinksResponse {
    pub path: String,
    /// Resolved outgoing links, document order.
    pub outgoing: Vec<OutLink>,
    /// Outgoing links that resolve to nothing (`resolved` is None).
    pub unresolved: Vec<OutLink>,
    /// Grouped by source path (sorted), then document order.
    pub backlinks: Vec<BackLink>,
    pub took_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionsResponse {
    pub path: String,
    /// Same shape as backlinks (`kind` is always Text).
    pub mentions: Vec<BackLink>,
    pub took_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    /// Resolved path, or None.
    pub path: Option<String>,
    /// More than one drawing matched; `path` is the shortest of them.
    pub candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RePointed {
    /// Drawing containing the link.
    pub path: String,
    /// The link text as written.
    pub target: String,
    /// Where it resolves now.
    pub from: Option<String>,
    /// Where it would resolve after the move.
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MovePlan {
    /// Closed drawings that would be rewritten (the open drawing is not counted).
    pub files: u32,
    /// Links that would be rewritten, in all drawings including the open one.
    pub links: u32,
    /// Links that are not rewritten but would resolve elsewhere after the move
    /// (e.g. renaming onto a basename that already exists). Non-empty = confirm first.
    pub re_pointed: Vec<RePointed>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ElementEdit {
    pub element_id: String,
    /// "text" edits set `text` and `originalText` to `value`; "link" sets `link`.
    pub field: EditField,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditField {
    Text,
    Link,
    /// Frame `name` (tag renames reach frame names).
    Name,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    /// Background rewrite id, echoed by `links-rewrite-done`; None when nothing to rewrite.
    pub job_id: Option<u32>,
    /// Closed drawings queued for rewrite.
    pub planned_files: u32,
    pub planned_links: u32,
    /// Edits for the open drawing (empty when none or no `openPath`).
    pub open_drawing_edits: Vec<ElementEdit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteFailure {
    pub path: String,
    /// "CONFLICT" (changed on disk; skipped, never overwritten), "IO", "INVALID_FILE".
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteDone {
    pub handle: String,
    pub job_id: u32,
    /// Drawings rewritten on disk.
    pub rewritten: u32,
    /// Links updated across those drawings (excludes the open drawing).
    pub links: u32,
    pub failed: Vec<RewriteFailure>,
    pub took_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemeasureSet {
    /// Vault-relative path -> text element ids to re-measure on open.
    pub paths: HashMap<String, Vec<String>>,
}
