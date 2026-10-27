//! `read_note_asset`: the bytes of an image a note shows (`![[pic.png]]`, `![](pics/a.png)`).
//! Images only, vault-relative, no dot-folders, no symlinks out of the vault, size capped.
//! Nothing here runs until the reading view asks for an image.
use crate::{err, vault_for, Result, Service};
use std::path::{Component, Path, PathBuf};
use tauri::State;

/// Largest image the reading view loads.
pub(crate) const MAX_ASSET_BYTES: u64 = 25 * 1024 * 1024;
const EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"];

/// The file inside `root` that `path` names, or an error: the path rules of notes plus an image extension.
pub(crate) fn asset_file(root: &Path, path: &str) -> Result<PathBuf> {
    let bad = || err("INVALID_PATH", "Only images outside dot-folders");
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return Err(bad());
    }
    let mut full = root.to_path_buf();
    for part in path.split('/') {
        if part.is_empty() || part.starts_with('.') || Path::new(part).components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(bad());
        }
        full.push(part);
    }
    let ext = full.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err(bad());
    }
    Ok(full)
}

fn read_asset(root: &Path, path: &str) -> Result<Vec<u8>> {
    let full = asset_file(root, path)?;
    let real = full.canonicalize().map_err(|_| err("NOT_FOUND", "Image not found"))?;
    let base = root.canonicalize().map_err(|_| err("NOT_FOUND", "Vault not found"))?;
    if !real.starts_with(&base) {
        return Err(err("INVALID_PATH", "Image is outside the vault"));
    }
    let meta = std::fs::metadata(&real).map_err(|_| err("NOT_FOUND", "Image not found"))?;
    if !meta.is_file() || meta.len() > MAX_ASSET_BYTES {
        return Err(err("INVALID_FILE", "Not an image of a size the reading view loads"));
    }
    std::fs::read(&real).map_err(|e| err("IO", &e.to_string()))
}

/// The raw bytes of a vault image, off the async runtime.
#[tauri::command]
pub(crate) async fn read_note_asset(handle: String, path: String, state: State<'_, Service>) -> Result<tauri::ipc::Response> {
    let root = vault_for(&state, &handle)?.root.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || read_asset(&root, &path))
        .await
        .map_err(|e| err("INTERNAL", &e.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_rules() {
        let root = Path::new("/v");
        assert!(asset_file(root, "pics/a.PNG").is_ok());
        for bad in ["", "/a.png", "a\\b.png", "../a.png", "pics/../a.png", ".obsidian/a.png", "pics/.x/a.png", "a.txt", "a.md", "noext", "pics//a.png"] {
            assert!(asset_file(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_inside_the_vault_only() {
        let dir = std::env::temp_dir().join(format!("vd-asset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pics")).unwrap();
        std::fs::write(dir.join("pics/a.png"), [1u8, 2, 3]).unwrap();
        assert_eq!(read_asset(&dir, "pics/a.png").unwrap(), vec![1, 2, 3]);
        assert_eq!(read_asset(&dir, "pics/missing.png").unwrap_err().code, "NOT_FOUND");
        #[cfg(unix)]
        {
            let outside = std::env::temp_dir().join(format!("vd-outside-{}.png", std::process::id()));
            std::fs::write(&outside, [9u8]).unwrap();
            std::os::unix::fs::symlink(&outside, dir.join("pics/link.png")).unwrap();
            assert_eq!(read_asset(&dir, "pics/link.png").unwrap_err().code, "INVALID_PATH");
            let _ = std::fs::remove_file(&outside);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
