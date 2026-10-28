//! Vaultdraw's vault logic without a UI or a window system: path rules, atomic writes, the
//! crash-recovery store, the vault lock, drawing read/write, the search index and the links
//! index. The desktop app and the `vaultdraw` CLI are thin shells over this crate.

pub mod backup;
pub mod config;
pub mod control_settings;
pub mod drawing;
pub mod error;
pub mod excalidraw_md;
pub mod filekind;
pub mod fsbulk;
pub mod fsops;
pub mod import_folder;
pub mod instance;
pub mod json_ascii;
pub mod links;
pub mod lock;
pub mod markdown;
pub mod migrate;
pub mod note_file;
pub mod new_drawing;
pub mod ops;
pub mod paths;
pub mod recovery;
pub mod scene_project;
pub mod search;
pub mod staging;
pub mod uri;
pub mod vault;
pub mod vault_path;

pub use drawing::*;
pub use error::{err, ioerr, NativeError, Result};
pub use filekind::{file_kind, has_drawing_ext, FileKind, DRAWING_EXT};
pub use fsops::*;
pub use paths::*;
pub use recovery::*;
pub use vault::{mutation_guard, writable, Vault};

#[cfg(test)]
mod tests;
