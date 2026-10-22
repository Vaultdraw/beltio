//! Links between drawings, query side: grammar, the link index, the graph export, resolution
//! and the backlinks/mentions queries. Rewriting files on rename stays in the app.

pub mod grammar;
pub mod graph;
pub mod index;
pub mod query;
pub mod resolve;
#[doc(hidden)]
pub mod testkit;
#[cfg(test)]
mod tests;
pub mod types;

use crate::search::Index;

/// `vault.links`: the drawing's links and backlinks. The link index must exist
/// (`Index::ensure_links`); without it the response is empty.
pub fn links_of(index: &Index, path: &str) -> LinksResponse {
    query::links_response(index, path)
}

/// Resolves a link-style name (`[[name]]`, from the vault root) to a drawing path.
pub fn resolve_name(index: &Index, name: &str) -> Option<String> {
    query::resolve_raw(index, "", name).path
}

pub use graph::GraphCache;
pub use index::LinkIndex;
pub use types::*;
