//! Wire payloads (frozen contract, PLAN.md). Serde camelCase.

use super::extract::ItemKind;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexState {
    Loading,
    Building,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub handle: String,
    pub state: IndexState,
    /// Drawings with content indexed.
    pub indexed: u32,
    /// Drawings known (walk so far).
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    All,
    Names,
    Content,
}

impl Scope {
    pub fn parse(s: Option<&str>) -> Option<Scope> {
        match s {
            None | Some("all") => Some(Scope::All),
            Some("names") => Some(Scope::Names),
            Some("content") => Some(Scope::Content),
            Some(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementMatch {
    pub element_id: String,
    pub container_id: Option<String>,
    pub kind: ItemKind,
    pub snippet: String,
    /// UTF-16 `[start, end)` into `snippet`.
    pub highlights: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub score: f32,
    /// UTF-16 `[start, end)` into `name`.
    pub name_highlights: Vec<[u32; 2]>,
    pub matches: Vec<ElementMatch>,
    pub match_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub results: Vec<SearchHit>,
    pub total_matches: u32,
    pub status: IndexStatus,
    pub took_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    /// Case/accent-folded key (`dsa/graphs`); what `tag:#...` filters on.
    pub tag: String,
    /// Spelling shown in the UI (`DSA/Graphs`).
    pub display: String,
    /// Drawings with this tag or a child tag.
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSummary {
    /// Sorted by key; includes every ancestor of a nested tag.
    pub tags: Vec<TagCount>,
    /// Vault-relative path to the display spellings of its tags (tagged drawings only).
    pub by_path: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsResponse {
    #[serde(flatten)]
    pub summary: TagSummary,
    pub status: IndexStatus,
    pub took_ms: f64,
}

/// Every drawing path the index knows (what `scope: "names"` searches).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamesListing {
    /// Vault-relative, forward slashes, sorted.
    pub paths: Vec<String>,
    pub status: IndexStatus,
}
