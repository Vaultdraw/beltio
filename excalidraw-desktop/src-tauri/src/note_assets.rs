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

/// Walk limit when an image is found by its bare name.
const MAX_WALK: usize = 100_000;

/// The vault-relative path of the image `target` names, as seen from the note in folder `from`:
/// next to the note, from the vault root, else the closest file with that name (Obsidian's rule).
pub(crate) fn locate(root: &Path, from: &str, target: &str) -> Result<String> {
    let target = target.trim().trim_start_matches('/');
    let dir = from.rsplit_once('/').map_or("", |(d, _)| d);
    // `./pic.png` and `../pics/pic.png` are relative to the note's folder; the rest of the rules see a plain path.
    if target.starts_with("./") || target.starts_with("../") {
        let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
        let mut inside = true;
        for part in target.split('/') {
            match part {
                "" | "." => {}
                ".." => inside &= parts.pop().is_some(),
                p => parts.push(p),
            }
        }
        if inside {
            let joined = parts.join("/");
            if asset_file(root, &joined).map(|f| f.is_file()).unwrap_or(false) {
                return Ok(joined);
            }
        }
        // Not there: Obsidian then falls back to the name alone.
        let name = target.rsplit('/').next().unwrap_or(target).to_string();
        return locate(root, from, &name);
    }
    for cand in [if dir.is_empty() { target.to_string() } else { format!("{dir}/{target}") }, target.to_string()] {
        if asset_file(root, &cand).map(|f| f.is_file()).unwrap_or(false) {
            return Ok(cand);
        }
    }
    asset_file(root, target)?; // path and extension rules before any walk
    let name = target.rsplit('/').next().unwrap_or(target).to_lowercase();
    let mut best: Option<(usize, String)> = None;
    let mut stack = vec![(root.to_path_buf(), String::new())];
    let mut seen = 0usize;
    while let Some((path, rel)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&path) else { continue };
        for entry in rd.flatten() {
            seen += 1;
            if seen > MAX_WALK {
                return best.map(|b| b.1).ok_or_else(|| err("NOT_FOUND", "Image not found"));
            }
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue };
            let child = if rel.is_empty() { fname.clone() } else { format!("{rel}/{fname}") };
            if ft.is_dir() {
                stack.push((entry.path(), child));
            } else if ft.is_file() && fname.to_lowercase() == name {
                let shared = child.split('/').zip(dir.split('/')).take_while(|(a, b)| a == b).count();
                if best.as_ref().map_or(true, |(s, p)| shared > *s || (shared == *s && child.len() < p.len())) {
                    best = Some((shared, child));
                }
            }
        }
    }
    best.map(|b| b.1).ok_or_else(|| err("NOT_FOUND", "Image not found"))
}

fn read_asset(root: &Path, from: &str, target: &str) -> Result<Vec<u8>> {
    let path = locate(root, from, target)?;
    let full = asset_file(root, &path)?;
    let real = dunce::canonicalize(full).map_err(|_| err("NOT_FOUND", "Image not found"))?;
    let base = dunce::canonicalize(root).map_err(|_| err("NOT_FOUND", "Vault not found"))?;
    if !real.starts_with(&base) {
        return Err(err("INVALID_PATH", "Image is outside the vault"));
    }
    let meta = std::fs::metadata(&real).map_err(|_| err("NOT_FOUND", "Image not found"))?;
    if !meta.is_file() || meta.len() > MAX_ASSET_BYTES {
        return Err(err("INVALID_FILE", "Not an image of a size the reading view loads"));
    }
    std::fs::read(&real).map_err(|e| err("IO", &e.to_string()))
}

/// The raw bytes of the vault image `target` (a name or path as written in the note at `from`), off the async runtime.
#[tauri::command]
pub(crate) async fn read_note_asset(handle: String, from: String, target: String, state: State<'_, Service>) -> Result<tauri::ipc::Response> {
    let root = vault_for(&state, &handle)?.root.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || read_asset(&root, &from, &target))
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
    fn relative_forms_resolve_from_the_notes_folder() {
        let dir = std::env::temp_dir().join(format!("vd-rel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for d in ["a/b", "pics", "my folder", "Ünï"] {
            std::fs::create_dir_all(dir.join(d)).unwrap();
        }
        std::fs::write(dir.join("a/b/x.png"), [1u8]).unwrap();
        std::fs::write(dir.join("a/y.gif"), [2u8]).unwrap();
        std::fs::write(dir.join("pics/z.webp"), [3u8]).unwrap();
        std::fs::write(dir.join("my folder/s p.svg"), [4u8]).unwrap();
        std::fs::write(dir.join("Ünï/u.png"), [5u8]).unwrap();
        assert_eq!(read_asset(&dir, "a/n.md", "./b/x.png").unwrap(), vec![1]);
        assert_eq!(read_asset(&dir, "a/b/n.md", "../y.gif").unwrap(), vec![2]);
        assert_eq!(read_asset(&dir, "a/b/n.md", "../../pics/z.webp").unwrap(), vec![3]);
        assert_eq!(read_asset(&dir, "a/n.md", "../../../pics/z.webp").unwrap(), vec![3], "leaving the vault falls back to the name");
        assert_eq!(read_asset(&dir, "n.md", "my folder/s p.svg").unwrap(), vec![4]);
        assert_eq!(read_asset(&dir, "a/n.md", "Ünï/u.png").unwrap(), vec![5]);
        assert_eq!(read_asset(&dir, "n.md", "u.png").unwrap(), vec![5], "by name in a non-ASCII folder");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_inside_the_vault_only() {
        let dir = std::env::temp_dir().join(format!("vd-asset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pics")).unwrap();
        std::fs::write(dir.join("pics/a.png"), [1u8, 2, 3]).unwrap();
        assert_eq!(read_asset(&dir, "n.md", "pics/a.png").unwrap(), vec![1, 2, 3]);
        assert_eq!(read_asset(&dir, "n.md", "a.png").unwrap(), vec![1, 2, 3], "by bare name");
        assert_eq!(read_asset(&dir, "pics/n.md", "a.PNG").unwrap(), vec![1, 2, 3], "next to the note");
        assert_eq!(read_asset(&dir, "n.md", "pics/missing.png").unwrap_err().code, "NOT_FOUND");
        #[cfg(unix)]
        {
            let outside = std::env::temp_dir().join(format!("vd-outside-{}.png", std::process::id()));
            std::fs::write(&outside, [9u8]).unwrap();
            std::os::unix::fs::symlink(&outside, dir.join("pics/link.png")).unwrap();
            assert_eq!(read_asset(&dir, "n.md", "pics/link.png").unwrap_err().code, "INVALID_PATH");
            let _ = std::fs::remove_file(&outside);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
