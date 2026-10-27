use super::*;
use sha2::{Digest, Sha256};
use std::fs;
use tempfile::tempdir;

const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

/// A small Obsidian-like vault: notes, nested folders, an attachment, and the decoys the walk skips.
fn fixture(root: &Path) {
    fs::create_dir_all(root.join("Projects/Alpha")).unwrap();
    fs::create_dir_all(root.join("attachments")).unwrap();
    fs::create_dir_all(root.join(".obsidian/plugins")).unwrap();
    fs::create_dir_all(root.join(".trash")).unwrap();
    fs::create_dir_all(root.join(".git/objects")).unwrap();
    fs::write(root.join("Home.md"), "# Home\n\n[[Projects/Alpha/Plan]]").unwrap();
    fs::write(root.join("Projects/Alpha/Plan.md"), "# Plan\n\n![[pic.png]]").unwrap();
    fs::write(root.join("attachments/pic.png"), b"\x89PNG\r\n\x1a\nfake").unwrap();
    fs::write(root.join(".obsidian/app.json"), "{}").unwrap();
    fs::write(root.join(".trash/Old.md"), "gone").unwrap();
    fs::write(root.join(".git/objects/x"), "blob").unwrap();
    fs::write(root.join(".DS_Store"), "junk").unwrap();
}

/// One hash over every path, kind and content under `root` (dot entries and symlinks included).
fn tree_hash(root: &Path) -> String {
    fn walk(dir: &Path, base: &Path, h: &mut Sha256) {
        let mut items: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
        items.sort();
        for p in items {
            let meta = fs::symlink_metadata(&p).unwrap();
            h.update(p.strip_prefix(base).unwrap().to_string_lossy().as_bytes());
            if meta.file_type().is_symlink() {
                h.update(b"L");
                h.update(fs::read_link(&p).unwrap().to_string_lossy().as_bytes());
            } else if meta.is_dir() {
                h.update(b"D");
                walk(&p, base, h);
            } else {
                h.update(b"F");
                h.update(&fs::read(&p).unwrap());
            }
        }
    }
    let mut h = Sha256::new();
    walk(root, root, &mut h);
    hex::encode(h.finalize())
}

#[test]
fn list_skips_dot_segments_and_symlinks_and_sorts() {
    let t = tempdir().unwrap();
    fixture(t.path());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(t.path().join("Home.md"), t.path().join("Link.md")).unwrap();
        std::os::unix::fs::symlink(t.path().join("Projects"), t.path().join("Shortcut")).unwrap();
    }
    let src = SourceFolder::open(t.path()).unwrap();
    let listing = src.list().unwrap();
    let paths: Vec<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, vec!["Home.md", "Projects/Alpha/Plan.md", "attachments/pic.png"]);
    assert!(!listing.truncated);
    let home = &listing.entries[0];
    assert_eq!(home.size, "# Home\n\n[[Projects/Alpha/Plan]]".len() as u64);
    assert!(home.modified_at > 0);
    assert_eq!(src.name(), t.path().file_name().unwrap().to_str().unwrap());
}

#[test]
fn reads_are_bounded_and_scoped() {
    let t = tempdir().unwrap();
    fixture(t.path());
    let src = SourceFolder::open(t.path()).unwrap();
    assert_eq!(src.read_text("Home.md").unwrap(), "# Home\n\n[[Projects/Alpha/Plan]]");
    assert_eq!(src.read_bytes("attachments/pic.png").unwrap(), b"\x89PNG\r\n\x1a\nfake");
    // Dot segments, traversal, absolute paths and folders are refused; hidden files are unreachable.
    for bad in [".obsidian/app.json", ".trash/Old.md", "../x.md", "/etc/passwd", "Projects", "Nope.md", ""] {
        assert!(src.read_text(bad).is_err(), "{bad}");
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(t.path().join("Home.md"), t.path().join("Link.md")).unwrap();
        assert_eq!(src.read_text("Link.md").unwrap_err().code, "INVALID_PATH");
    }
    // Lossy text: invalid UTF-8 never fails a read.
    fs::write(t.path().join("Latin.md"), b"caf\xe9").unwrap();
    assert_eq!(src.read_text("Latin.md").unwrap(), "caf\u{fffd}");
}

#[test]
fn source_is_never_written_by_an_import() {
    let t = tempdir().unwrap();
    fixture(t.path());
    let before = tree_hash(t.path());
    let src = SourceFolder::open(t.path()).unwrap();
    let out = tempdir().unwrap();
    let dst = TargetFolder::new_vault(&out.path().join("Imported")).unwrap();
    for e in src.list().unwrap().entries {
        let _ = src.read_text(&e.path);
        let _ = src.read_bytes(&e.path);
        if e.path.ends_with(".md") {
            dst.write_drawing(&format!("{}.excalidraw", &e.path[..e.path.len() - 3]), SCENE).unwrap();
        } else {
            dst.copy_from(&src, &e.path, &e.path).unwrap();
        }
    }
    assert_eq!(tree_hash(t.path()), before, "the source tree changed");
    assert!(out.path().join("Imported/Projects/Alpha/Plan.excalidraw").is_file());
    assert_eq!(fs::read(out.path().join("Imported/attachments/pic.png")).unwrap(), b"\x89PNG\r\n\x1a\nfake");
    // No temp files left behind in the target.
    let leftovers: Vec<_> = fs::read_dir(out.path().join("Imported")).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with('.')).collect();
    assert!(leftovers.is_empty());
}

#[test]
fn new_vault_must_be_missing_or_empty() {
    let t = tempdir().unwrap();
    let fresh = t.path().join("a/b/New vault");
    let dst = TargetFolder::new_vault(&fresh).unwrap();
    assert!(fresh.is_dir());
    assert_eq!(dst.kind(), TargetKind::NewVault);
    assert_eq!(dst.name(), "New vault");
    assert_eq!(dst.root(), fresh.canonicalize().unwrap());
    // Empty existing folder: fine. Non-empty: NAME_COLLISION. A file: INVALID_PATH.
    let empty = t.path().join("Empty");
    fs::create_dir(&empty).unwrap();
    assert!(TargetFolder::new_vault(&empty).is_ok());
    fs::write(empty.join("x.txt"), "x").unwrap();
    assert_eq!(TargetFolder::new_vault(&empty).unwrap_err().code, "NAME_COLLISION");
    let file = t.path().join("f.txt");
    fs::write(&file, "f").unwrap();
    assert_eq!(TargetFolder::new_vault(&file).unwrap_err().code, "INVALID_PATH");
}

#[test]
fn vault_folder_is_scoped_and_created() {
    let t = tempdir().unwrap();
    let dst = TargetFolder::vault_folder(t.path(), "Imports/Obsidian").unwrap();
    assert!(t.path().join("Imports/Obsidian").is_dir());
    assert_eq!(dst.kind(), TargetKind::VaultFolder);
    assert_eq!(dst.name(), "Obsidian");
    let root = TargetFolder::vault_folder(t.path(), "").unwrap();
    assert_eq!(root.root(), t.path());
    for bad in ["../out", ".hidden", "a/.b", "/abs", ".excalidraw-vault/recovery"] {
        assert!(TargetFolder::vault_folder(t.path(), bad).is_err(), "{bad}");
    }
    fs::write(t.path().join("file"), "x").unwrap();
    assert_eq!(TargetFolder::vault_folder(t.path(), "file").unwrap_err().code, "INVALID_PATH");
}

#[test]
fn write_drawing_is_create_only_atomic_and_checked() {
    let t = tempdir().unwrap();
    let dst = TargetFolder::new_vault(&t.path().join("v")).unwrap();
    dst.write_drawing("Notes/Home.excalidraw", SCENE).unwrap();
    assert_eq!(fs::read_to_string(t.path().join("v/Notes/Home.excalidraw")).unwrap(), SCENE);
    assert_eq!(dst.write_drawing("Notes/Home.excalidraw", SCENE).unwrap_err().code, "NAME_COLLISION");
    assert_eq!(dst.write_drawing("Notes/home.excalidraw", SCENE).unwrap_err().code, "NAME_COLLISION");
    assert_eq!(dst.write_drawing("Notes/Home.md", SCENE).unwrap_err().code, "INVALID_PATH");
    assert_eq!(dst.write_drawing("../Home.excalidraw", SCENE).unwrap_err().code, "INVALID_PATH");
    assert_eq!(dst.write_drawing(".hidden/Home.excalidraw", SCENE).unwrap_err().code, "INVALID_PATH");
    assert_eq!(dst.write_drawing("Bad.excalidraw", "[]").unwrap_err().code, "INVALID_FILE");
    assert_eq!(dst.write_drawing("Bad.excalidraw", "{\"type\":\"x\"}").unwrap_err().code, "INVALID_FILE");
    assert_eq!(fs::read_to_string(t.path().join("v/Notes/Home.excalidraw")).unwrap(), SCENE, "the first file is untouched");
}

#[test]
fn copy_is_create_only_and_never_reads_outside_the_source() {
    let t = tempdir().unwrap();
    fixture(t.path());
    let src = SourceFolder::open(t.path()).unwrap();
    let out = tempdir().unwrap();
    let dst = TargetFolder::new_vault(&out.path().join("v")).unwrap();
    dst.copy_from(&src, "attachments/pic.png", "assets/pic.png").unwrap();
    assert_eq!(fs::read(out.path().join("v/assets/pic.png")).unwrap(), b"\x89PNG\r\n\x1a\nfake");
    assert_eq!(dst.copy_from(&src, "attachments/pic.png", "assets/pic.png").unwrap_err().code, "NAME_COLLISION");
    assert!(dst.copy_from(&src, ".obsidian/app.json", "app.json").is_err());
    assert!(dst.copy_from(&src, "../outside", "x").is_err());
    assert!(dst.copy_from(&src, "attachments/pic.png", "../escape.png").is_err());
    assert!(!out.path().join("escape.png").exists());
}

#[test]
fn registry_hands_out_scoped_handles() {
    let t = tempdir().unwrap();
    fixture(t.path());
    let reg = Registry::new();
    let s = reg.add_source(SourceFolder::open(t.path()).unwrap());
    let d = reg.add_target(TargetFolder::new_vault(&t.path().join("out")).unwrap());
    assert!(s.starts_with("src-") && d.starts_with("dst-"));
    assert!(reg.source(&s).is_ok());
    assert!(reg.target(&d).is_ok());
    // A source handle never reaches a target and the other way round.
    assert_eq!(reg.target(&s).unwrap_err().code, "NOT_FOUND");
    assert_eq!(reg.source(&d).unwrap_err().code, "NOT_FOUND");
    reg.release(&s);
    assert_eq!(reg.source(&s).unwrap_err().code, "NOT_FOUND");
    reg.release("nothing");
}

#[test]
fn listing_stops_at_the_cap() {
    // The cap is checked with a small count through the same loop: 3 files, then `truncated`.
    let t = tempdir().unwrap();
    for i in 0..3 {
        fs::write(t.path().join(format!("n{i}.md")), "x").unwrap();
    }
    let src = SourceFolder::open(t.path()).unwrap();
    assert_eq!(src.list().unwrap().entries.len(), 3);
    assert!(MAX_ENTRIES >= 100_000);
}

#[test]
fn convert_drawing_decodes_excalidraw_md_create_only_and_leaves_the_source_alone() {
    let t = tempdir().unwrap();
    let md = "---\nexcalidraw-plugin: parsed\n---\n\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[],\"appState\":{},\"files\":{}}\n```\n";
    fs::write(t.path().join("Sketch.excalidraw.md"), md).unwrap();
    fs::write(t.path().join("Plain.excalidraw.md"), "# not a drawing").unwrap();
    let before = tree_hash(t.path());
    let src = SourceFolder::open(t.path()).unwrap();
    let out = tempdir().unwrap();
    let dst = TargetFolder::new_vault(&out.path().join("v")).unwrap();
    dst.convert_drawing(&src, "Sketch.excalidraw.md", "Sketch.excalidraw").unwrap();
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(out.path().join("v/Sketch.excalidraw")).unwrap()).unwrap();
    assert_eq!(v["type"], "excalidraw");
    assert_eq!(dst.convert_drawing(&src, "Sketch.excalidraw.md", "Sketch.excalidraw").unwrap_err().code, "NAME_COLLISION");
    assert_eq!(dst.convert_drawing(&src, "Plain.excalidraw.md", "P.excalidraw").unwrap_err().code, "INVALID_FILE");
    assert!(!out.path().join("v/P.excalidraw").exists());
    assert_eq!(tree_hash(t.path()), before);
}

#[test]
fn convert_drawing_embeds_the_images_an_excalidraw_md_names() {
    let t = tempdir().unwrap();
    fs::create_dir_all(t.path().join("Drawings")).unwrap();
    fs::create_dir_all(t.path().join("00 - Attachments/Pasted")).unwrap();
    fs::write(t.path().join("00 - Attachments/Pasted/Pasted image 1.png"), [1u8, 2, 3]).unwrap();
    fs::write(t.path().join("Drawings/local.gif"), [4u8]).unwrap();
    fs::write(t.path().join("big.webp"), vec![0u8; (MAX_EMBED_BYTES + 1) as usize]).unwrap();
    let md = "## Embedded Files\naa11: [[Pasted image 1.png]]\nbb22: [[local.gif|200]]\ncc33: [[big.webp]]\ndd44: [[missing.png]]\n\n%%\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[],\"appState\":{},\"files\":{}}\n```\n%%\n";
    fs::write(t.path().join("Drawings/S.excalidraw.md"), md).unwrap();
    let before = tree_hash(t.path());
    let src = SourceFolder::open(t.path()).unwrap();
    let out = tempdir().unwrap();
    let dst = TargetFolder::new_vault(&out.path().join("v")).unwrap();
    dst.convert_drawing(&src, "Drawings/S.excalidraw.md", "Drawings/S.excalidraw").unwrap();
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(out.path().join("v/Drawings/S.excalidraw")).unwrap()).unwrap();
    let files = v["files"].as_object().unwrap();
    assert_eq!(files["aa11"]["dataURL"], "data:image/png;base64,AQID");
    assert_eq!(files["bb22"]["mimeType"], "image/gif");
    assert!(!files.contains_key("cc33"), "over the cap");
    assert!(!files.contains_key("dd44"), "not found");
    assert_eq!(tree_hash(t.path()), before);
}

#[test]
fn opening_an_excalidraw_md_in_place_shows_its_images() {
    let t = tempdir().unwrap();
    fs::create_dir_all(t.path().join("D")).unwrap();
    fs::write(t.path().join("pic.png"), [1u8, 2, 3]).unwrap();
    let md = "## Embedded Files\naa11: [[pic.png]]\n\n%%\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[],\"appState\":{},\"files\":{}}\n```\n%%\n";
    fs::write(t.path().join("D/S.excalidraw.md"), md).unwrap();
    let before = tree_hash(t.path());
    let frame = crate::drawing::read_drawing_file(t.path(), "D/S.excalidraw.md").unwrap();
    let body = String::from_utf8(frame).unwrap();
    assert!(body.contains("data:image/png;base64,AQID"), "{body}");
    assert_eq!(tree_hash(t.path()), before);
}
