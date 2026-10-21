//! Vault-wide search of drawing names and the text inside drawings: the pure index, extractor,
//! normaliser and snapshot store. The background worker and the Tauri commands live in the app.

pub mod extract;
pub mod index;
pub mod normalize;
pub mod packed;
pub mod scan;
pub mod store;
pub mod tags;
pub mod types;

pub use extract::{extract_items, ElementLink, ItemKind, TextItem};
pub use index::{word_snippet, DocEntry, Index};
pub use normalize::{normalize, NORMALIZER_VERSION};
pub use scan::{is_drawing_name, walk};
pub use store::vault_id;
pub use tags::{find_tags, key_under, tag_key};
pub use types::{ElementMatch, IndexState, IndexStatus, NamesListing, Scope, SearchHit, SearchResponse, TagsResponse};
