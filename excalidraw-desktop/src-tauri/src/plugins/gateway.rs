//! `plugin_call(pluginId, method, params)`: the one native entry point of the plugin API.
//!
//! A static allowlist maps each method to the permission it needs. Gated rows check the
//! calling plugin's manifest and consent record, then run the control API's `ops::call`
//! (the same code as the CLI and MCP; it finds the active vault itself and works with the
//! control socket off). Plugin-only rows (storage) are arms here. A permission is a seatbelt,
//! not a sandbox: raw `invoke` still reaches every command (sdk/docs/permissions.md).
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
    Row { method: "storage.read", permission: None, route: Route::StorageRead },
    Row { method: "storage.write", permission: None, route: Route::StorageWrite },
];

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
/// by the user (bundled plugins need no confirmation).
pub(crate) fn authorize(
    method: &str,
    plugin_id: &str,
    plugin: Option<&PluginInfo>,
    confirmed: &consent::Record,
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
    let bundled = plugin.source == Source::Bundled;
    if !bundled && !confirmed.get(plugin_id).is_some_and(|c| c.iter().any(|p| p == permission)) {
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
        Route::Control(_) => Err(GatewayError::new("INTERNAL", "not a storage row")),
    }
}
