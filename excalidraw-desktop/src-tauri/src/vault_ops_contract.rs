//! The shared fake/native contract for vault operations (`contract/vault_ops.json`): create folder,
//! move, trash, write drawing, list directory. The TypeScript side (`src/tests/vaultOpsContract.test.ts`)
//! runs the same table against FakeVaultRepository, so a refusal the backend has and the fake lacks
//! (or the reverse) fails a test instead of hiding from every browser test.
use std::path::Path;

use vaultdraw_core::{drawing, fsops};

const TABLE: &str = include_str!("../crates/vaultdraw-core/src/contract/vault_ops.json");
const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

fn build_disk(root: &Path, disk: &serde_json::Map<String, serde_json::Value>) {
    for (p, text) in disk {
        if let Some(dir) = p.strip_suffix('/') {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        } else {
            let file = root.join(p);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            let body = if p.ends_with(".excalidraw") { SCENE } else { text.as_str().unwrap_or("") };
            std::fs::write(file, body).unwrap();
        }
    }
}

fn run(root: &Path, op: &serde_json::Value) -> Result<(), String> {
    let s = |k: &str| op[k].as_str().unwrap_or("").to_string();
    let code = |e: vaultdraw_core::NativeError| e.code.to_string();
    match op["kind"].as_str().unwrap() {
        "createFolder" => fsops::create_folder_at(root, &s("path")).map_err(code),
        "move" => fsops::move_entry_paths(root, &s("from"), &s("to")).map_err(code),
        "trash" => {
            let bin = tempfile::tempdir().unwrap();
            crate::trash_in(root, &s("path"), |p| std::fs::rename(p, bin.path().join("trashed")).map_err(|e| e.to_string())).map(|_| ()).map_err(code)
        }
        "writeDrawing" => {
            let v = crate::Vault::for_tests(root.to_path_buf(), "h", false);
            let path = s("path");
            let current = drawing::drawing_revision_at(root, &path).ok().flatten();
            let expected = match (op["base"].as_str().unwrap(), current) {
                ("none", _) => None,
                ("current", Some(rev)) => Some(rev),
                _ => Some("0".repeat(64)),
            };
            drawing::write_drawing_file(&v, &path, SCENE, expected.as_deref(), "contract-op").map(|_| ()).map_err(code)
        }
        "listDirectory" => {
            let v = crate::Vault::for_tests(root.to_path_buf(), "h", false);
            let entries = drawing::list_directory_in(&v, &s("path")).map_err(code)?;
            if let Some(names) = op["names"].as_array() {
                let got: Vec<String> = entries.into_iter().map(|e| e.name).collect();
                let want: Vec<String> = names.iter().map(|n| n.as_str().unwrap().to_string()).collect();
                if got != want {
                    return Err(format!("listed {got:?}, expected {want:?}"));
                }
            }
            Ok(())
        }
        other => panic!("unknown operation {other}"),
    }
}

#[test]
fn native_vault_operations_follow_the_shared_table() {
    let table: serde_json::Value = serde_json::from_str(TABLE).unwrap();
    let mut failures = Vec::new();
    for case in table["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        build_disk(&root, case["disk"].as_object().unwrap());
        let got = run(&root, &case["op"]);
        let want = case["expect"].as_str().unwrap();
        let got_text = match &got {
            Ok(()) => "ok".to_string(),
            Err(e) => e.clone(),
        };
        if got_text != want {
            failures.push(format!("{name}: expected {want}, got {got_text}"));
            continue;
        }
        if let Some(after) = case["after"].as_object() {
            for (p, state) in after {
                let exists = root.join(p.trim_end_matches('/')).exists();
                if exists != (state == "exists") {
                    failures.push(format!("{name}: {p} should be {state}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "native differs from the table:\n{}", failures.join("\n"));
}
