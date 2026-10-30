//! `config.get` / `config.set` on the config folder (the same files and edits as the settings UI).

use super::target::native_err;
use crate::config::{self, Dirs, LayerChange};
use serde_json::{json, Value};
use vaultdraw_protocol::RpcError;

/// `config.get {key?}`: the parsed config, or the value at a dotted key (`null` when unset).
pub fn get(dirs: &Dirs, params: &Value) -> Result<Value, RpcError> {
    let key = match params.get("key") {
        None | Some(Value::Null) => None,
        Some(Value::String(k)) if !k.is_empty() => Some(k.as_str()),
        Some(_) => return Err(RpcError::invalid_params("key must be a non-empty string")),
    };
    let settings = config::load_settings_in(dirs).map_err(native_err)?;
    let layers = settings.layers.clone();
    let loaded = serde_json::to_value(settings).unwrap_or(Value::Null);
    if let Some(message) = loaded["configError"]["message"].as_str() {
        return Err(RpcError::app("CONFIG_INVALID", format!("config.toml does not parse: {message}")));
    }
    // A broken overrides.toml is skipped, as in the app; the reply says so.
    let warning = loaded["overridesError"]["message"].as_str().map(|m| format!("overrides.toml is broken and ignored: {m}"));
    let Some(config) = loaded.get("config").filter(|c| !c.is_null()) else {
        return Err(RpcError::app("CONFIG_INVALID", "config.toml is unreadable"));
    };
    let value = match key {
        None => config.clone(),
        Some(k) => config::lookup_key(config, k).cloned().unwrap_or(Value::Null),
    };
    let mut reply = json!({"key": key, "value": value});
    if let Some(w) = warning {
        reply["warning"] = json!(w);
    }
    // `source: true` adds the layer that wins, and what a lower layer says when it is hidden.
    if params.get("source").and_then(Value::as_bool) == Some(true) {
        if let Some(k) = key {
            let found = config::key_source(&layers, k);
            reply["source"] = json!(found.source);
            if let Some(h) = found.hidden {
                reply["hidden"] = h;
            }
        }
    }
    Ok(reply)
}

/// `config.set {changes: [{key, value}]}`: all-or-nothing, like `update_config`. Writes
/// `overrides.toml` in the state folder; `config.toml` is never edited.
pub fn set(dirs: &Dirs, params: &Value) -> Result<Value, RpcError> {
    let changes: Vec<LayerChange> = params
        .get("changes")
        .cloned()
        .ok_or_else(|| RpcError::invalid_params("changes is required"))
        .and_then(|c| serde_json::from_value(c).map_err(|e| RpcError::invalid_params(format!("changes: {e}"))))?;
    config::update_overrides_in(dirs, &changes).map_err(native_err)?;
    Ok(json!({"changed": changes.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    fn set_writes_overrides_only_and_a_broken_overrides_file_warns_on_get_and_refuses_set() {
        let (_t, d) = dirs();
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join("config.toml"), "[editor]\nfont_size = 14\n").unwrap();
        set(&d, &json!({"changes": [{"key": "editor.font_size", "value": 20}]})).unwrap();
        assert_eq!(fs::read_to_string(d.config.join("config.toml")).unwrap(), "[editor]\nfont_size = 14\n");
        assert_eq!(get(&d, &json!({"key": "editor.font_size"})).unwrap()["value"], 20);
        fs::write(d.overrides_file(), "[editor\n").unwrap();
        let r = get(&d, &json!({"key": "editor.font_size"})).unwrap();
        assert_eq!(r["value"], 14);
        assert!(r["warning"].as_str().unwrap().starts_with("overrides.toml is broken and ignored"));
        assert!(set(&d, &json!({"changes": [{"key": "editor.font_size", "value": 21}]})).is_err());
    }

    #[test]
    fn get_with_source_names_the_layer_and_the_hidden_value() {
        let (_t, d) = dirs();
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join("config.toml"), "[editor]\nfont_size = 14\nroughness = 2\n").unwrap();
        set(&d, &json!({"changes": [{"key": "editor.font_size", "value": 20}]})).unwrap();
        let r = get(&d, &json!({"key": "editor.font_size", "source": true})).unwrap();
        assert_eq!(r["value"], 20);
        assert_eq!(r["source"], "overrides.toml");
        assert_eq!(r["hidden"], json!({"file": "config.toml", "value": 14}));
        let r = get(&d, &json!({"key": "editor.roughness", "source": true})).unwrap();
        assert_eq!((r["source"].as_str(), r.get("hidden")), (Some("config.toml"), None));
        let r = get(&d, &json!({"key": "interface.zoom", "source": true})).unwrap();
        assert_eq!((r["source"].as_str(), r["value"].is_null()), (Some("default"), true));
        // Without the flag the reply is as before.
        assert!(get(&d, &json!({"key": "editor.font_size"})).unwrap().get("source").is_none());
    }

    #[test]
    fn get_reads_dotted_hotkey_ids_and_deep_keys_like_the_source() {
        let (_t, d) = dirs();
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join("config.toml"), "[hotkeys]\n\"vault.newDrawing\" = [\"Mod+K\"]\n[tools.arrow]\nroughness = 2\n").unwrap();
        let r = get(&d, &json!({"key": "hotkeys.vault.newDrawing", "source": true})).unwrap();
        assert_eq!((r["value"].clone(), r["source"].as_str()), (json!(["Mod+K"]), Some("config.toml")));
        let r = get(&d, &json!({"key": "tools.arrow.roughness", "source": true})).unwrap();
        assert_eq!((r["value"].clone(), r["source"].as_str()), (json!(2), Some("config.toml")));
    }

    #[test]
    fn set_refuses_a_wrong_type_an_unknown_key_and_a_value_out_of_range_and_writes_nothing() {
        // The same schema `config check` uses; one table row per refusal (hunter C, C-9).
        let rows: [(&str, Value, &str); 5] = [
            ("files.auto_reload", json!("banana"), "files.auto_reload"),
            ("files.auto_reloadd", json!(false), "did you mean files.auto_reload"),
            ("editor.font_size", json!("big"), "editor.font_size"),
            ("nosuch.key", json!(1), "unknown key nosuch"),
            ("control.enabled", json!(3), "control.enabled"),
        ];
        for (key, value, says) in rows {
            let (_t, d) = dirs();
            let e = set(&d, &json!({"changes": [{"key": key, "value": value}]})).unwrap_err();
            assert!(e.message.contains(says), "{key}: {}", e.message);
            assert!(e.message.contains("Nothing was changed"), "{}", e.message);
            assert!(!d.overrides_file().exists(), "{key} wrote a file");
        }
        // One bad change in a batch refuses the whole batch.
        let (_t, d) = dirs();
        assert!(set(&d, &json!({"changes": [{"key": "editor.font_size", "value": 20}, {"key": "nope.x", "value": 1}]})).is_err());
        assert!(!d.overrides_file().exists());
    }

    #[test]
    fn set_accepts_good_values_resets_and_hand_written_problems_do_not_block_a_good_change() {
        let (_t, d) = dirs();
        fs::create_dir_all(&d.state).unwrap();
        fs::write(d.overrides_file(), "[files]\nauto_reload = \"banana\"\n").unwrap();
        set(&d, &json!({"changes": [{"key": "editor.font_size", "value": 20}]})).unwrap();
        // Putting a correct value over the bad one is allowed too.
        set(&d, &json!({"changes": [{"key": "files.auto_reload", "value": true}]})).unwrap();
        set(&d, &json!({"changes": [{"key": "editor.font_size", "value": null}]})).unwrap();
    }

    #[test]
    fn bad_params_are_invalid() {
        let (_t, d) = dirs();
        assert_eq!(set(&d, &json!({})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
        assert_eq!(set(&d, &json!({"changes": [{"value": 1}]})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
        assert_eq!(get(&d, &json!({"key": 5})).unwrap_err().code, vaultdraw_protocol::INVALID_PARAMS);
    }
}
