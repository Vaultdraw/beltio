//! The `folders.*` plugin gateway rows (gateway.rs allowlist, permission `folders.import`) and
//! the core-only `import_target_root` command. The logic is `vaultdraw_core::import_folder`;
//! this file holds the session registry, the native dialogs and the JSON parameter shapes.
//!
//! Rows: `folders.pickSource {title?}` → `{handle, name} | null`; `folders.list {handle}` →
//! `{entries, truncated}`; `folders.readText {handle, path}` → `{text}`; `folders.readBytes
//! {handle, path}` → `{base64}`; `folders.pickNewVault {title?}` → `{handle, name} | null`;
//! `folders.vaultTarget {path}` → `{handle, name}`; `folders.writeDrawing {handle, path, scene}`
//! → `{}`; `folders.copy {source, from, target, to}` → `{}`; `folders.convertDrawing {source, from, target, to}` → `{}`; `folders.release {handle}` → `{}`.
use crate::plugins::GatewayError;
use crate::{err, Result};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;
use tauri::AppHandle;
use vaultdraw_core::import_folder::{Registry, SourceFolder, TargetFolder};

/// Every gateway row this module serves (the allowlist pins the same names).
pub(crate) const ROWS: &[&str] = &[
    "folders.pickSource",
    "folders.list",
    "folders.readText",
    "folders.readBytes",
    "folders.pickNewVault",
    "folders.vaultTarget",
    "folders.writeDrawing",
    "folders.copy",
    "folders.convertDrawing",
    "folders.release",
];

/// Handles live for the app session; nothing is created until the first import.
fn registry() -> &'static Registry {
    static R: OnceLock<Registry> = OnceLock::new();
    R.get_or_init(Registry::new)
}

/// Core only (not a gateway row): the absolute path behind a target handle, so the app can open
/// a freshly imported vault or reveal the folder.
#[tauri::command]
pub(crate) async fn import_target_root(handle: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || Ok(registry().target(&handle)?.root().to_string_lossy().into_owned()))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

fn invalid(msg: &str) -> GatewayError {
    GatewayError::new("INVALID_ARGUMENT", msg)
}

fn object(params: Option<Value>) -> std::result::Result<Map<String, Value>, GatewayError> {
    match params {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(m)) => Ok(m),
        Some(_) => Err(invalid("params must be an object")),
    }
}

fn string<'a>(map: &'a Map<String, Value>, key: &str) -> std::result::Result<&'a str, GatewayError> {
    match map.get(key) {
        Some(Value::String(s)) => Ok(s),
        _ => Err(invalid(&format!("{key} must be a string"))),
    }
}

fn title(map: &Map<String, Value>, default: &str) -> std::result::Result<String, GatewayError> {
    match map.get("title") {
        None | Some(Value::Null) => Ok(default.to_string()),
        Some(Value::String(s)) if s.chars().count() <= 200 => Ok(s.clone()),
        _ => Err(invalid("title must be a short string")),
    }
}

/// Native folder picker for a source. `None` when cancelled.
fn pick_source_dir(title: &str) -> Option<std::path::PathBuf> {
    // Trial builds (`smoke-test`, `scripts/obsidian-trial.mjs`) answer the dialog from the environment.
    #[cfg(feature = "smoke-test")]
    if let Some(p) = std::env::var_os("VAULTDRAW_TRIAL_SRC").filter(|p| !p.is_empty()) {
        return Some(p.into());
    }
    rfd::FileDialog::new().set_title(title).pick_folder()
}

/// Native save dialog for a new vault folder. `None` when cancelled.
fn pick_new_vault_dir(title: &str) -> Option<std::path::PathBuf> {
    #[cfg(feature = "smoke-test")]
    if let Some(p) = std::env::var_os("VAULTDRAW_TRIAL_OUT").filter(|p| !p.is_empty()) {
        return Some(p.into());
    }
    rfd::FileDialog::new().set_title(title).set_file_name("Imported vault").save_file()
}

/// Runs one `folders.*` row. Called from `plugin_call` on a blocking thread (dialogs block).
pub(crate) fn folders_call(app: &AppHandle, method: &str, params: Option<Value>) -> std::result::Result<Value, GatewayError> {
    let map = object(params)?;
    let reg = registry();
    match method {
        "folders.pickSource" => {
            let Some(dir) = pick_source_dir(&title(&map, "Choose the folder to import")?) else { return Ok(Value::Null) };
            let src = SourceFolder::open(&dir)?;
            let name = src.name().to_string();
            Ok(json!({ "handle": reg.add_source(src), "name": name }))
        }
        "folders.list" => {
            let listing = reg.source(string(&map, "handle")?)?.list()?;
            serde_json::to_value(listing).map_err(|e| GatewayError::new("INTERNAL", e.to_string()))
        }
        "folders.readText" => {
            let text = reg.source(string(&map, "handle")?)?.read_text(string(&map, "path")?)?;
            Ok(json!({ "text": text }))
        }
        "folders.readBytes" => {
            let bytes = reg.source(string(&map, "handle")?)?.read_bytes(string(&map, "path")?)?;
            Ok(json!({ "base64": base64_encode(&bytes) }))
        }
        "folders.pickNewVault" => {
            let Some(dir) = pick_new_vault_dir(&title(&map, "Create the new vault")?) else { return Ok(Value::Null) };
            let dst = TargetFolder::new_vault(&dir)?;
            let name = dst.name().to_string();
            Ok(json!({ "handle": reg.add_target(dst), "name": name }))
        }
        "folders.vaultTarget" => {
            let path = match map.get("path") {
                None | Some(Value::Null) => "",
                _ => string(&map, "path")?,
            };
            let vault = crate::control_active_vault(app).ok_or_else(|| GatewayError::new("NO_VAULT", "No vault is open"))?;
            vaultdraw_core::writable(&vault)?;
            let dst = TargetFolder::vault_folder(&vault.root, path)?;
            let name = dst.name().to_string();
            Ok(json!({ "handle": reg.add_target(dst), "name": name }))
        }
        "folders.writeDrawing" => {
            let scene = map.get("scene").ok_or_else(|| invalid("scene is required"))?;
            let json = match scene {
                Value::String(s) => s.clone(),
                Value::Object(_) => serde_json::to_string(scene).map_err(|e| GatewayError::new("INTERNAL", e.to_string()))?,
                _ => return Err(invalid("scene must be a scene object or its JSON text")),
            };
            reg.target(string(&map, "handle")?)?.write_drawing(string(&map, "path")?, &json)?;
            Ok(json!({}))
        }
        "folders.copy" => {
            let src = reg.source(string(&map, "source")?)?;
            let dst = reg.target(string(&map, "target")?)?;
            dst.copy_from(&src, string(&map, "from")?, string(&map, "to")?)?;
            Ok(json!({}))
        }
        "folders.convertDrawing" => {
            let src = reg.source(string(&map, "source")?)?;
            let dst = reg.target(string(&map, "target")?)?;
            dst.convert_drawing(&src, string(&map, "from")?, string(&map, "to")?)?;
            Ok(json!({}))
        }
        "folders.release" => {
            reg.release(string(&map, "handle")?);
            Ok(json!({}))
        }
        _ => Err(GatewayError::new("NOT_FOUND", format!("Unknown folders row \"{method}\""))),
    }
}

/// Standard base64 (with padding), no dependency: attachments the plugin lays out are small.
fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (chunk.get(1).copied().unwrap_or(0) as u32) << 8 | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0xff, 0xfe, 0xfd]), "//79");
    }

    /// The rows that need no app or dialog, through the registry: list, read, write, copy, release.
    #[test]
    fn rows_round_trip_through_handles() {
        let t = tempdir().unwrap();
        fs::create_dir_all(t.path().join("src/.obsidian")).unwrap();
        fs::write(t.path().join("src/Note.md"), "# Hi").unwrap();
        fs::write(t.path().join("src/pic.png"), b"\x01\x02").unwrap();
        fs::write(t.path().join("src/.obsidian/app.json"), "{}").unwrap();
        let reg = registry();
        let s = reg.add_source(SourceFolder::open(&t.path().join("src")).unwrap());
        let d = reg.add_target(TargetFolder::new_vault(&t.path().join("dst")).unwrap());
        // No AppHandle in unit tests: the rows below never touch it, so a null pointer-free path is
        // exercised by calling the registry directly through the same helpers.
        let listing = reg.source(&s).unwrap().list().unwrap();
        assert_eq!(listing.entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["Note.md", "pic.png"]);
        assert_eq!(reg.source(&s).unwrap().read_text("Note.md").unwrap(), "# Hi");
        assert_eq!(base64_encode(&reg.source(&s).unwrap().read_bytes("pic.png").unwrap()), "AQI=");
        let scene = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;
        reg.target(&d).unwrap().write_drawing("Note.excalidraw", scene).unwrap();
        assert_eq!(reg.target(&d).unwrap().write_drawing("Note.excalidraw", scene).unwrap_err().code, "NAME_COLLISION");
        reg.target(&d).unwrap().copy_from(&reg.source(&s).unwrap(), "pic.png", "pic.png").unwrap();
        assert_eq!(fs::read(t.path().join("dst/pic.png")).unwrap(), b"\x01\x02");
        reg.release(&s);
        assert_eq!(reg.source(&s).unwrap_err().code, "NOT_FOUND");
        // Parameter shapes.
        assert_eq!(string(&Map::new(), "handle").unwrap_err().code, "INVALID_ARGUMENT");
        assert!(object(Some(json!([]))).is_err());
        assert_eq!(title(&Map::new(), "x").unwrap(), "x");
        let mut m = Map::new();
        m.insert("title".into(), json!(5));
        assert!(title(&m, "x").is_err());
    }
}
