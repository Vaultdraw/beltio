//! `plugin_call(pluginId, method, params)`: the one native entry point of the plugin API.
//!
//! A static allowlist maps each method to the permission it needs. Gated rows check the
//! calling plugin's manifest and consent record, then run the control API's `ops::call`
//! (the same code as the CLI and MCP; it finds the active vault itself and works with the
//! control socket off). Plugin-only rows (storage) are arms here. A permission is a seatbelt,
//! not a sandbox: raw `invoke` still reaches every command (sdk/docs/permissions.md).
use super::vault_paths::{check_plugin_path, has_dot_segment, Kind};
use super::{consent, scan::PluginInfo, scan::Source, storage};
use serde::Serialize;
use serde_json::{Map, Value};
use vaultdraw_protocol::methods::{FILE_READ, FILE_WRITE, VAULT_LIST};
use vaultdraw_protocol::RpcError;

/// Where a method runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Route {
    /// `control::ops::call` with this method name.
    Control(&'static str),
    StorageRead,
    StorageWrite,
    /// `vaultdraw_core::markdown::parse_markdown` on `params.text` (pure: no vault access).
    MarkdownParse,
    /// `crate::import_folder::folders_call`: capability-scoped source and target folders for
    /// importers (read-only source handles, create-only targets).
    Folders,
    /// `plugin_call_raw`: binary bodies in and out (graph bytes, layout bytes); never `plugin_call`.
    Raw,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Row {
    pub method: &'static str,
    /// `None` = free for every installed plugin.
    pub permission: Option<&'static str>,
    pub route: Route,
}

/// Every method a plugin may call. Plugin rows stay out of `api-v1.json` (the CLI and MCP promise).
pub(crate) const ALLOWLIST: &[Row] = &[
    Row { method: VAULT_LIST, permission: Some("vault.read"), route: Route::Control(VAULT_LIST) },
    Row { method: FILE_READ, permission: Some("vault.read"), route: Route::Control(FILE_READ) },
    Row { method: FILE_WRITE, permission: Some("vault.write"), route: Route::Control(FILE_WRITE) },
    Row { method: "vault.graph", permission: Some("vault.read"), route: Route::Raw },
    Row { method: "vault.graphLayout.load", permission: Some("vault.read"), route: Route::Raw },
    Row { method: "vault.graphLayout.save", permission: Some("vault.write"), route: Route::Raw },
    Row { method: "storage.read", permission: None, route: Route::StorageRead },
    Row { method: "storage.write", permission: None, route: Route::StorageWrite },
    Row { method: "markdown.parse", permission: None, route: Route::MarkdownParse },
    Row { method: "folders.pickSource", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.list", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.readText", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.readBytes", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.pickNewVault", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.vaultTarget", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.writeDrawing", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.copy", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.convertDrawing", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
    Row { method: "folders.release", permission: Some(FOLDERS_IMPORT), route: Route::Folders },
];

/// The one permission every `folders.*` row needs: pick folders, read one, create files in another.
pub(crate) const FOLDERS_IMPORT: &str = "folders.import";

/// An error as the host sees it: `{code, message, ...detail}` (detail such as `reason: "dirty"`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct GatewayError {
    pub code: String,
    pub message: String,
    #[serde(flatten)]
    pub detail: Map<String, Value>,
}

impl GatewayError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        GatewayError { code: code.into(), message: message.into(), detail: Map::new() }
    }
}

impl From<crate::NativeError> for GatewayError {
    fn from(e: crate::NativeError) -> Self {
        GatewayError::new(&e.code, e.message)
    }
}

impl From<RpcError> for GatewayError {
    fn from(e: RpcError) -> Self {
        match e.data {
            Some(d) => GatewayError { code: d.code, message: e.message, detail: d.extra },
            None => {
                let code = match e.code {
                    vaultdraw_protocol::INVALID_PARAMS => "INVALID_ARGUMENT",
                    vaultdraw_protocol::METHOD_NOT_FOUND => "NOT_FOUND",
                    _ => "INTERNAL",
                };
                GatewayError::new(code, e.message)
            }
        }
    }
}

/// Finds `method` and checks that `plugin` may call it. `plugin` is `None` when no installed
/// plugin has the id. A gated row needs the permission declared in `plugin.toml` and confirmed
/// by the user (bundled plugins need no confirmation). `confirmed` loads the consent record.
pub(crate) fn authorize(
    method: &str,
    plugin_id: &str,
    plugin: Option<&PluginInfo>,
    confirmed: impl FnOnce() -> consent::Record,
) -> Result<&'static Row, GatewayError> {
    let row = ALLOWLIST
        .iter()
        .find(|r| r.method == method)
        .ok_or_else(|| GatewayError::new("NOT_FOUND", format!("Plugins cannot call \"{method}\"")))?;
    let plugin = plugin.ok_or_else(|| GatewayError::new("NOT_FOUND", format!("No installed plugin has the id \"{plugin_id}\"")))?;
    let Some(permission) = row.permission else { return Ok(row) };
    let refuse = |why: &str| {
        let mut e = GatewayError::new("PERMISSION", format!("{plugin_id}: {method} needs the permission \"{permission}\", {why}"));
        e.detail.insert("permission".into(), Value::String(permission.into()));
        e
    };
    if !plugin.manifest.permissions.iter().any(|p| p == permission) {
        return Err(refuse("which plugin.toml does not declare"));
    }
    // The consent file is read only for gated rows of user plugins.
    let bundled = plugin.source == Source::Bundled;
    if !bundled && !confirmed().get(plugin_id).is_some_and(|c| c.iter().any(|p| p == permission)) {
        return Err(refuse("which you have not confirmed (Settings → Plugins)"));
    }
    Ok(row)
}

/// Plugins only create drawings: `expectedRevision` must be absent or null (it is set to null).
pub(crate) fn create_only(params: Option<Value>) -> Result<Value, GatewayError> {
    let mut map = match params {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m,
        Some(_) => return Err(GatewayError::new("INVALID_ARGUMENT", "params must be an object")),
    };
    if map.get("expectedRevision").is_some_and(|v| !v.is_null()) {
        return Err(GatewayError::new("PERMISSION", "Plugins can only create new drawings, not overwrite them"));
    }
    map.insert("expectedRevision".into(), Value::Null);
    Ok(Value::Object(map))
}

/// The string `key` of `params`, which plugin calls must give as `path` (never the link-style `file`).
fn path_param<'a>(params: &'a Map<String, Value>, key: &str) -> Result<&'a str, GatewayError> {
    match params.get(key) {
        Some(Value::String(s)) => Ok(s),
        _ => Err(GatewayError::new("INVALID_ARGUMENT", format!("{key} must be a string"))),
    }
}

/// The params a plugin's vault call hands to the control API: path rules checked first, and only
/// the keys the call needs, so a link-style `file` name or `recursive: true` cannot get through.
pub(crate) fn plugin_params(method: &str, params: Option<Value>) -> Result<Value, GatewayError> {
    let checked = |path: &str, kind| check_plugin_path(path, kind).map_err(GatewayError::from);
    match method {
        VAULT_LIST => {
            let map = object_params(params)?;
            let dir = match map.get("dir") {
                None | Some(Value::Null) => "",
                _ => path_param(&map, "dir")?,
            };
            checked(dir, Kind::Folder)?;
            Ok(serde_json::json!({ "dir": dir, "recursive": false }))
        }
        FILE_READ => {
            let map = object_params(params)?;
            let path = path_param(&map, "path")?;
            checked(path, Kind::File)?;
            Ok(serde_json::json!({ "path": path }))
        }
        FILE_WRITE => {
            let map = object_params(Some(create_only(params)?))?;
            let path = path_param(&map, "path")?;
            checked(path, Kind::File)?;
            Ok(serde_json::json!({ "path": path, "scene": map.get("scene").cloned().unwrap_or(Value::Null), "expectedRevision": null }))
        }
        _ => Ok(params.unwrap_or(Value::Null)),
    }
}

fn object_params(params: Option<Value>) -> Result<Map<String, Value>, GatewayError> {
    match params {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(m)) => Ok(m),
        Some(_) => Err(GatewayError::new("INVALID_ARGUMENT", "params must be an object")),
    }
}

/// `file.write` for a plugin is create only, so the core's `CONFLICT` (the name already holds a
/// drawing, saved or open and unsaved) reads as `NAME_COLLISION`, like the case-insensitive match.
pub(crate) fn create_error(e: GatewayError) -> GatewayError {
    if e.code == "CONFLICT" {
        GatewayError::new("NAME_COLLISION", "A drawing with this name already exists")
    } else {
        e
    }
}

/// `vault.list` for a plugin: entries whose path has a dot segment are removed (the core already
/// skips symlinks and its metadata folder).
pub(crate) fn filter_list(mut result: Value) -> Value {
    if let Some(entries) = result.get_mut("entries").and_then(Value::as_array_mut) {
        entries.retain(|e| e.get("path").and_then(Value::as_str).is_some_and(|p| !has_dot_segment(p)));
    }
    result
}

/// Runs a storage row for `plugin_id` in `state_dir`.
pub(crate) fn storage_call(state_dir: &std::path::Path, plugin_id: &str, route: Route, params: &Value) -> Result<Value, GatewayError> {
    match route {
        Route::StorageRead => Ok(storage::read(state_dir, plugin_id)?),
        Route::StorageWrite => {
            let text = params
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| GatewayError::new("INVALID_ARGUMENT", "text must be a string"))?;
            storage::write(state_dir, plugin_id, text)?;
            Ok(Value::Null)
        }
        Route::Control(_) | Route::MarkdownParse | Route::Folders | Route::Raw => Err(GatewayError::new("INTERNAL", "not a storage row")),
    }
}

/// `markdown.parse`: `{ text, softBreakNewline? }` to a `NoteDoc` (16 MiB cap, like notes on disk).
pub(crate) fn markdown_call(params: Option<Value>) -> Result<Value, GatewayError> {
    let map = object_params(params)?;
    let text = map
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| GatewayError::new("INVALID_ARGUMENT", "text must be a string"))?;
    let soft = match map.get("softBreakNewline") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(b)) => Some(*b),
        Some(_) => return Err(GatewayError::new("INVALID_ARGUMENT", "softBreakNewline must be a boolean")),
    };
    crate::markdown::check_size(text)?;
    let doc = vaultdraw_core::markdown::parse_markdown(text, &crate::markdown::options(soft));
    serde_json::to_value(doc).map_err(|e| GatewayError::new("INTERNAL", e.to_string()))
}

/// Runs a `Route::Raw` method against the open vault (the one the control API calls active).
pub(crate) fn raw_call(app: &tauri::AppHandle, method: &str, body: &[u8]) -> Result<Vec<u8>, GatewayError> {
    use tauri::Manager as _;
    let vault = crate::control_active_vault(app).ok_or_else(|| GatewayError::new("NO_VAULT", "No vault is open"))?;
    match method {
        "vault.graph" => {
            let search = app.try_state::<crate::search::SearchService>().ok_or_else(|| GatewayError::new("INTERNAL", "Search service unavailable"))?;
            Ok(crate::links::graph_bytes(&search, &vault.handle)?)
        }
        "vault.graphLayout.load" => Ok(crate::links::layout_bytes(&vault)),
        "vault.graphLayout.save" => {
            crate::links::layout_write(&vault, body)?;
            Ok(Vec::new())
        }
        _ => Err(GatewayError::new("NOT_FOUND", format!("Plugins cannot call \"{method}\""))),
    }
}
