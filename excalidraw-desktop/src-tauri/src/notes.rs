//! Guarded read and write of Markdown notes: `read_note` and `write_note`. The rules live in
//! `vaultdraw_core::note_file` (revision check, history copy, atomic rename); this file only
//! calls them off the async runtime and keeps the search and link indexes current. Nothing here
//! runs until a command is called.
use crate::search::SearchService;
use crate::{err, vault_for, Result, Service};
use tauri::State;
use vaultdraw_core::note_file::{read_note_file, write_note_file, NoteFile, NoteWritten};

/// Reads a vault note: its text, revision (hex SHA-256 of the bytes), modified time and size.
#[tauri::command]
pub(crate) async fn read_note(handle: String, path: String, state: State<'_, Service>) -> Result<NoteFile> {
    let root = vault_for(&state, &handle)?.root.clone();
    tauri::async_runtime::spawn_blocking(move || read_note_file(&root, &path)).await.map_err(|e| err("INTERNAL", &e.to_string()))?
}

/// Writes a vault note. `expected_revision` is the revision the caller read (null creates a new
/// note and never overwrites). A stale revision fails with `CONFLICT` and changes nothing.
#[tauri::command]
pub(crate) async fn write_note(
    handle: String,
    path: String,
    content: String,
    expected_revision: Option<String>,
    state: State<'_, Service>,
    search: State<'_, SearchService>,
) -> Result<NoteWritten> {
    let v = vault_for(&state, &handle)?;
    let p = path.clone();
    let text = content.clone();
    let written = tauri::async_runtime::spawn_blocking(move || write_note_file(&v, &p, &text, expected_revision.as_deref()))
        .await
        .map_err(|e| err("INTERNAL", &e.to_string()))??;
    // Searchable and linkable at once; the vault watcher would get there a moment later.
    search.upsert_bytes(&handle, &path, (written.bytes, written.mtime_ms), content.as_bytes());
    Ok(written)
}
