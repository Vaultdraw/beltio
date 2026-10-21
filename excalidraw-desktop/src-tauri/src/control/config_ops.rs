//! `config.get` / `config.set` on the config folder (the same files and edits as the settings UI).

use super::target::native_err;
use crate::config::{self, ConfigChange, Dirs};
use serde_json::{json, Value};
use vaultdraw_protocol::RpcError;

/// `config.get {key?}`: the parsed config, or the value at a dotted key (`null` when unset).
pub(crate) fn get(dirs: &Dirs, params: &Value) -> Result<Value, RpcError> {
    let key = match params.get("key") {
        None | Some(Value::Null) => None,
        Some(Value::String(k)) if !k.is_empty() => Some(k.as_str()),
        Some(_) => return Err(RpcError::invalid_params("key must be a non-empty string")),
    };
    let loaded = serde_json::to_value(config::load_settings_in(dirs).map_err(native_err)?).unwrap_or(Value::Null);
    let Some(config) = loaded.get("config").filter(|c| !c.is_null()) else {
        let message = loaded["configError"]["message"].as_str().unwrap_or("config.toml is unreadable");
        return Err(RpcError::app("CONFIG_INVALID", format!("config.toml does not parse: {message}")));
    };
    let value = match key {
        None => config.clone(),
        Some(k) => k.split('.').try_fold(config, |v, part| v.get(part)).cloned().unwrap_or(Value::Null),
    };
    Ok(json!({"key": key, "value": value}))
}

/// `config.set {changes: [{key, value}]}`: all-or-nothing, like `update_config`.
pub(crate) fn set(dirs: &Dirs, params: &Value) -> Result<Value, RpcError> {
    let changes: Vec<ConfigChange> = params
        .get("changes")
        .cloned()
        .ok_or_else(|| RpcError::invalid_params("changes is required"))
        .and_then(|c| serde_json::from_value(c).map_err(|e| RpcError::invalid_params(format!("changes: {e}"))))?;
    config::update_config_in(dirs, &changes).map_err(native_err)?;
    Ok(json!({"changed": changes.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> (tempfile::TempDir, Dirs) {
        let t = tempfile::tempdir().unwrap();
        let d = Dirs { config: t.path().join("config"), state: t.path().join("state") };
        (t, d)
    }

    #[test]
    fn set_then_get_dotted_key_and_whole_config() {
        let (_t, d) = dirs();
        let r = set(&d, &json!({"changes": [{"key": "control.enabled", "value": false}]})).unwrap();
        assert_eq!(r, json!({"changed": 1}));
        assert_eq!(get(&d, &json!({"key": "control.enabled"})).unwrap(), json!({"key": "control.enabled", "value": false}));
        assert_eq!(get(&d, &json!({"key": "control.nope.deeper"})).unwrap()["value"], Value::Null);
        let all = get(&d, &json!({})).unwrap();
        assert_eq!(all["key"], Value::Null);
        assert_eq!(all["value"]["control"]["enabled"], false);
    }

    #[test]
    fn bad_params_are_invalid() {
        let (_t, d) = dirs();
        assert_eq!(set(&d, &json!({})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
        assert_eq!(set(&d, &json!({"changes": [{"value": 1}]})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
        assert_eq!(get(&d, &json!({"key": 5})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
    }
}
