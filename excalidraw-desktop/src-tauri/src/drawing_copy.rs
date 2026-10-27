//! "Save a copy…" from the navigator: copies a vault drawing's bytes, exactly
//! as they are on disk, to a destination picked in the native save dialog.
//! No IPC round trip of the file and no re-serialization.

use std::{fs, path::Path};

use tauri::State;

use crate::{err, ioerr, read_bounded, safe_path, save_with_dialog, vault_for, Result, Service, MAX_DRAWING_BYTES};

/// Reads the drawing at `path` (vault-relative) and returns its file name and
/// raw bytes.
fn read_copy_source(root: &Path, path: &str) -> Result<(String, Vec<u8>)> {
    if !vaultdraw_core::has_drawing_ext(path) {
        return Err(err("INVALID_PATH", "Only .excalidraw drawings can be copied"));
    }
    let p = safe_path(root, path, false)?;
    let meta = fs::metadata(&p).map_err(ioerr)?;
    if !meta.is_file() || meta.len() > MAX_DRAWING_BYTES {
        return Err(err("INVALID_FILE", "Drawing is not a regular file or exceeds 32 MiB"));
    }
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("drawing.excalidraw")
        .to_string();
    Ok((name, read_bounded(&p, MAX_DRAWING_BYTES)?))
}

/// Ok(false) = the user cancelled the save dialog.
#[tauri::command]
pub(crate) async fn save_drawing_copy(handle: String, path: String, state: State<'_, Service>) -> Result<bool> {
    let v = vault_for(&state, &handle)?;
    let (name, bytes) = read_copy_source(&v.root, &path)?;
    save_with_dialog(&name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_exact_bytes_and_name() {
        let dir = tempfile::tempdir().unwrap();
        let raw = b"{\"type\":\"excalidraw\",\"elements\":[]}\n\xef\xbb\xbf  ";
        fs::create_dir_all(dir.path().join("A")).unwrap();
        fs::write(dir.path().join("A/My Drawing.excalidraw"), raw).unwrap();
        let (name, bytes) = read_copy_source(dir.path(), "A/My Drawing.excalidraw").unwrap();
        assert_eq!(name, "My Drawing.excalidraw");
        assert_eq!(bytes, raw.to_vec());
    }

    #[test]
    fn rejects_non_drawings_and_escapes() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        assert!(read_copy_source(dir.path(), "notes.txt").is_err());
        assert!(read_copy_source(dir.path(), "../outside.excalidraw").is_err());
        assert!(read_copy_source(dir.path(), "missing.excalidraw").is_err());
    }
}
