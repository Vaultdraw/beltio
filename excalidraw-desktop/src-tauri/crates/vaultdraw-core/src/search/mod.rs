//! Vault-wide search of drawing names and the text inside drawings: the pure index, extractor,
//! normaliser and snapshot store. The background worker and the Tauri commands live in the app.

pub mod extract;
pub mod headless;
pub mod index;
pub mod normalize;
pub mod packed;
pub mod scan;
pub mod store;
pub mod tags;
#[doc(hidden)]
pub mod testgen;
pub mod types;

pub use extract::{extract_items, ElementLink, ItemKind, TextItem};
pub use headless::load_or_build;
pub use index::{word_snippet, DocEntry, Index};
pub use normalize::{normalize, NORMALIZER_VERSION};
pub use scan::{is_drawing_name, walk};
pub use store::vault_id;
pub use tags::{find_tags, key_under, tag_key};
pub use types::{ElementMatch, IndexState, IndexStatus, NamesListing, Scope, SearchHit, SearchResponse, TagsResponse};

/// Longest query accepted, in characters.
pub const MAX_QUERY_CHARS: usize = 256;
/// Results returned when the caller gives no limit.
pub const DEFAULT_LIMIT: u32 = 50;
/// Upper bound for a caller's limit.
pub const MAX_LIMIT: u32 = 200;

/// Validates a search request the same way for the app and the CLI: refuses an over-long query
/// (`INVALID_QUERY`) and clamps the limit to 1..=MAX_LIMIT (default DEFAULT_LIMIT).
pub fn checked_limit(query: &str, limit: Option<u32>) -> crate::Result<usize> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(crate::err("INVALID_QUERY", format!("Query is longer than {MAX_QUERY_CHARS} characters")));
    }
    Ok(limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize)
}
