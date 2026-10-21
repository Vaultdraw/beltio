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

pub use graph::GraphCache;
pub use index::LinkIndex;
pub use types::*;
