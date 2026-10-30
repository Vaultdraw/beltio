//! Validator, 2026-10-30 (hunter F-14, toimprove 190): the app's own next-free names ("Untitled",
//! "Untitled 1", "Untitled 2"; "Plan copy", "Plan copy 2") are not sync conflict copies. The real
//! listing of a real folder runs here; the `sync_names` rule flags every "<name> N" beside "<name>"
//! even when no sync service is involved, so the third new drawing shows a "conflict" badge.
//! Fixed (toimprove 190): numbered names count as iCloud copies only in a folder iCloud manages.

use std::fs;
use vaultdraw_core::{list_directory_in, Vault};

const SCENE: &str = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[],"appState":{},"files":{}}"#;

fn flagged(names: &[&str]) -> Vec<String> {
    let dir = std::env::temp_dir().join(format!("vd-genname-{}-{}", std::process::id(), names.len()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    for n in names {
        fs::write(dir.join(n), if n.ends_with(".md") { "note" } else { SCENE }).unwrap();
    }
    let v = Vault::new(dir.clone(), "h".into(), false, None);
    let out: Vec<String> = list_directory_in(&v, "").unwrap().into_iter().filter(|e| e.sync.is_some()).map(|e| e.name).collect();
    fs::remove_dir_all(&dir).unwrap();
    out
}

#[test]
fn the_apps_own_numbered_names_are_not_conflicts() {
    let f = flagged(&["Untitled.excalidraw", "Untitled 1.excalidraw", "Untitled 2.excalidraw", "Plan copy.excalidraw", "Plan copy 2.excalidraw", "Untitled.md", "Untitled 2.md"]);
    assert!(f.is_empty(), "generated names flagged: {f:?}");
}
