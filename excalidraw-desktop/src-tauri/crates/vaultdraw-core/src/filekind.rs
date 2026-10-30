//! What a vault file is, decided by its name alone: one place for the extension rules that used to be
//! repeated as `ends_with(".excalidraw")`. The TypeScript twin is `src/vault/fileKind.ts`
//! (shared fixtures: `fixtures/filekind.json`, asserted by Rust and TS).

/// The native drawing extension.
pub const DRAWING_EXT: &str = ".excalidraw";
/// Markdown notes.
pub const NOTE_EXT: &str = ".md";
/// Obsidian Excalidraw plugin drawings (a Markdown file holding a scene).
pub const EXCALIDRAW_MD_EXT: &str = ".excalidraw.md";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FileKind {
    /// `*.excalidraw`: a native drawing.
    Drawing,
    /// `*.md`: a Markdown note (not `.excalidraw.md`).
    Note,
    /// `*.excalidraw.md`: an Obsidian Excalidraw plugin drawing.
    ExcalidrawMd,
    /// Anything else.
    Other,
}

impl FileKind {
    /// The wire name used in the tree listing (`VaultEntry.kind`) and by the TypeScript twin.
    pub fn as_str(self) -> &'static str {
        match self {
            FileKind::Drawing => "drawing",
            FileKind::Note => "note",
            FileKind::ExcalidrawMd => "excalidrawMd",
            FileKind::Other => "other",
        }
    }
}

/// True when `name` ends with `ext`, ignoring ASCII case (never panics on a non-char boundary).
pub fn ends_with_ci(name: &str, ext: &str) -> bool {
    name.len() >= ext.len() && name.get(name.len() - ext.len()..).is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// `name` (a file name or a vault-relative path) ends with `.excalidraw`, in any case.
pub fn has_drawing_ext(name: &str) -> bool {
    ends_with_ci(name, DRAWING_EXT)
}

/// A drawing file name: `.excalidraw` after a non-empty stem.
pub fn is_drawing_name(name: &str) -> bool {
    name.len() > DRAWING_EXT.len() && has_drawing_ext(name)
}

/// `name` without a trailing `.excalidraw` (any case); unchanged when it has none.
pub fn strip_drawing_ext(name: &str) -> &str {
    if has_drawing_ext(name) {
        &name[..name.len() - DRAWING_EXT.len()]
    } else {
        name
    }
}

/// Classifies a file name or path.
pub fn file_kind(name: &str) -> FileKind {
    if has_drawing_ext(name) {
        FileKind::Drawing
    } else if ends_with_ci(name, EXCALIDRAW_MD_EXT) {
        FileKind::ExcalidrawMd
    } else if ends_with_ci(name, NOTE_EXT) {
        FileKind::Note
    } else {
        FileKind::Other
    }
}

/// A name starting with a dot (`.obsidian`, `.trash`, `.git`, ...): never listed,
/// scanned, indexed or watched.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

/// True when any component of a vault-relative path is hidden (see [`is_hidden_name`]).
pub fn has_hidden_component(rel: &str) -> bool {
    rel.split('/').any(is_hidden_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_name() {
        assert_eq!(file_kind("a.excalidraw"), FileKind::Drawing);
        assert_eq!(file_kind("Dir/A.EXCALIDRAW"), FileKind::Drawing);
        assert_eq!(file_kind("a.md"), FileKind::Note);
        assert_eq!(file_kind("a.MD"), FileKind::Note);
        assert_eq!(file_kind("a.excalidraw.md"), FileKind::ExcalidrawMd);
        assert_eq!(file_kind("a.Excalidraw.MD"), FileKind::ExcalidrawMd);
        assert_eq!(file_kind("a.excalidraw.png"), FileKind::Other);
        assert_eq!(file_kind("a.png"), FileKind::Other);
        assert_eq!(file_kind("é"), FileKind::Other);
        assert_eq!(file_kind(""), FileKind::Other);
        assert_eq!(file_kind("md"), FileKind::Other);
    }

    #[test]
    fn matches_the_shared_fixtures() {
        let fx: serde_json::Value = serde_json::from_str(include_str!("../../../../src/vault/fixtures/filekind.json")).unwrap();
        for c in fx["kinds"].as_array().unwrap() {
            assert_eq!(file_kind(c[0].as_str().unwrap()).as_str(), c[1].as_str().unwrap(), "{}", c[0]);
        }
        for c in fx["hidden"].as_array().unwrap() {
            assert_eq!(is_hidden_name(c[0].as_str().unwrap()), c[1].as_bool().unwrap(), "{}", c[0]);
        }
        for c in fx["strip"].as_array().unwrap() {
            assert_eq!(strip_drawing_ext(c[0].as_str().unwrap()), c[1].as_str().unwrap(), "{}", c[0]);
        }
    }

    #[test]
    fn drawing_name_needs_a_stem() {
        assert!(is_drawing_name("a.excalidraw"));
        assert!(!is_drawing_name(".excalidraw"));
        assert!(has_drawing_ext(".excalidraw"));
        assert!(!is_drawing_name("é.excalid"));
    }

    #[test]
    fn strips_the_extension() {
        assert_eq!(strip_drawing_ext("Graphs/BFS.excalidraw"), "Graphs/BFS");
        assert_eq!(strip_drawing_ext("x.Excalidraw"), "x");
        assert_eq!(strip_drawing_ext("x.md"), "x.md");
        assert_eq!(strip_drawing_ext("日本"), "日本");
    }

    #[test]
    fn hidden_names() {
        assert!(is_hidden_name(".obsidian"));
        assert!(!is_hidden_name("notes"));
        assert!(has_hidden_component("a/.trash/b.md"));
        assert!(!has_hidden_component("a/b.md"));
    }

    #[test]
    fn wire_names() {
        assert_eq!(FileKind::ExcalidrawMd.as_str(), "excalidrawMd");
        assert_eq!(FileKind::Drawing.as_str(), "drawing");
    }

    // ---- the Obsidian-style fixture vault -------------------------------------------------

    use std::{collections::BTreeMap, fs, path::Path};

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../src/vault/fixtures/obsidian-vault");

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for e in fs::read_dir(from).unwrap().flatten() {
            let t = to.join(e.file_name());
            if e.file_type().unwrap().is_dir() {
                copy_dir(&e.path(), &t);
            } else {
                fs::copy(e.path(), t).unwrap();
            }
        }
    }

    fn fixture_copy() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        copy_dir(Path::new(FIXTURE), d.path());
        // A `.git` folder cannot live inside this repository's fixtures.
        fs::create_dir_all(d.path().join(".git")).unwrap();
        fs::write(d.path().join(".git/config"), "[core]\n").unwrap();
        d
    }

    /// Every file under `root` (relative path -> SHA-256), `.excalidraw-vault*` excluded.
    fn snapshot(root: &Path) -> BTreeMap<String, String> {
        use sha2::{Digest, Sha256};
        fn go(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let rel = e.path().strip_prefix(root).unwrap().to_string_lossy().into_owned();
                if rel.starts_with(".excalidraw-vault") {
                    continue;
                }
                if e.file_type().unwrap().is_dir() {
                    out.insert(format!("{rel}/"), String::new());
                    go(root, &e.path(), out);
                } else {
                    out.insert(rel, hex::encode(Sha256::digest(fs::read(e.path()).unwrap())));
                }
            }
        }
        let mut out = BTreeMap::new();
        go(root, root, &mut out);
        out
    }

    fn vault(root: &Path) -> crate::Vault {
        crate::Vault::new(dunce::canonicalize(root).unwrap(), "t".into(), false, None)
    }

    fn listed(v: &crate::Vault, dir: &str) -> Vec<(String, String)> {
        crate::list_directory_in(v, dir).unwrap().into_iter().map(|e| (e.path, e.kind)).collect()
    }

    #[test]
    fn the_tree_lists_notes_and_skips_dot_folders() {
        let d = fixture_copy();
        let v = vault(d.path());
        let top = listed(&v, "");
        let names: Vec<_> = top.iter().map(|(p, k)| format!("{p}:{k}")).collect();
        assert_eq!(names, ["Daily:folder", "Drawings:folder", "Ideas.md:note", "Welcome.md:note"]);
        assert_eq!(
            listed(&v, "Drawings"),
            [
                ("Drawings/Compressed.excalidraw.md".into(), "excalidrawMd".into()),
                ("Drawings/Plain.excalidraw.md".into(), "excalidrawMd".into()),
                ("Drawings/Sketch.excalidraw".into(), "drawing".into()),
            ]
        );
    }

    #[test]
    fn the_index_walk_skips_dot_folders() {
        let d = fixture_copy();
        fs::write(d.path().join(".obsidian/hidden.excalidraw"), "{}").unwrap();
        fs::write(d.path().join(".trash/gone.excalidraw"), "{}").unwrap();
        let paths: Vec<String> = crate::search::scan::walk(d.path(), "").into_iter().map(|f| f.path).collect();
        let mut paths = paths;
        paths.sort();
        assert_eq!(paths, ["Daily/2026-10-27.md", "Drawings/Sketch.excalidraw", "Ideas.md", "Welcome.md"]);
    }

    #[test]
    fn dot_folders_are_never_written() {
        let d = fixture_copy();
        let v = vault(d.path());
        let scene = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;
        for p in [".obsidian/x.excalidraw", ".trash/x.excalidraw", "a/.git/x.excalidraw"] {
            assert_eq!(crate::write_drawing_file(&v, p, scene, None, "op").unwrap_err().code, "INVALID_PATH", "{p}");
        }
        assert_eq!(crate::create_folder_at(d.path(), ".obsidian2").unwrap_err().code, "INVALID_PATH");
        assert_eq!(crate::move_entry_paths(d.path(), "Ideas.md", ".trash/Ideas.md").unwrap_err().code, "INVALID_PATH");
        assert!(!d.path().join(".trash/x.excalidraw").exists());
    }

    #[test]
    fn excalidraw_md_reads_as_a_drawing_frame_and_cannot_be_saved() {
        let d = fixture_copy();
        let v = vault(d.path());
        let framed = crate::read_drawing_file(d.path(), "Drawings/Compressed.excalidraw.md").unwrap();
        let (rev, body) = framed.split_at(crate::REVISION_HEX_LEN);
        let raw = fs::read(d.path().join("Drawings/Compressed.excalidraw.md")).unwrap();
        use sha2::{Digest, Sha256};
        assert_eq!(std::str::from_utf8(rev).unwrap(), hex::encode(Sha256::digest(raw)));
        let scene: serde_json::Value = serde_json::from_slice(&body[1..]).unwrap();
        assert_eq!(scene["elements"].as_array().unwrap().len(), 2);
        assert!(crate::drawing_revision_at(d.path(), "Drawings/Compressed.excalidraw.md").unwrap().is_some());
        let json = std::str::from_utf8(&body[1..]).unwrap();
        let e = crate::write_drawing_file(&v, "Drawings/Compressed.excalidraw.md", json, Some("x"), "op").unwrap_err();
        assert_eq!(e.code, "INVALID_PATH");
        let n = crate::read_drawing_file(d.path(), "Welcome.md").unwrap_err();
        assert_eq!(n.code, "INVALID_PATH");
    }

    #[test]
    fn opening_browsing_and_closing_leaves_the_vault_byte_identical() {
        let d = fixture_copy();
        let before = snapshot(d.path());
        {
            let root = dunce::canonicalize(d.path()).unwrap();
            let outcome = crate::lock::LockRegistry::default().acquire(&root, ".excalidraw-vault.lock");
            let v = crate::Vault::new(root.clone(), "t".into(), outcome.lock.is_none(), outcome.lock);
            let mut pending = vec![String::new()];
            while let Some(dir) = pending.pop() {
                for e in crate::list_directory_in(&v, &dir).unwrap() {
                    if e.kind == "folder" {
                        pending.push(e.path);
                    } else if e.kind != "note" {
                        crate::read_drawing_file(&root, &e.path).unwrap();
                    } else {
                        fs::read(root.join(&e.path)).unwrap();
                    }
                }
            }
            let _ = crate::search::scan::walk_parallel(&root, 2);
        }
        assert_eq!(snapshot(d.path()), before, "the vault changed while it was only opened and browsed");
    }
}
