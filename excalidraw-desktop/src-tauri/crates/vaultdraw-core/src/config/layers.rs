//! The two config layers: `config.toml` (yours, never written by the app) and `overrides.toml`
//! in the state folder (written by Settings, `vaultdraw config set` and the control API).
//! A higher layer wins. This module holds the merge and the overrides writer; the files are
//! read through the helpers of the parent module.

use super::*;

pub const OVERRIDES_FILE: &str = "overrides.toml";
const MAX_OVERRIDES_BYTES: u64 = 1024 * 1024;

/// Comment block of a new `overrides.toml`.
pub const OVERRIDES_HEADER: &str = "# Written by Vaultdraw Settings. Settings wins over config.toml.\n# Safe to delete. Your own settings go in config.toml.";

/// Tables whose sub-tables are whole units: a higher layer's `[tools.arrow]` or
/// `[plugin.<id>]` replaces the lower one instead of merging key by key.
const WHOLE_TABLE_UNITS: [&str; 2] = ["tools", "plugin"];

impl Dirs {
    pub fn overrides_file(&self) -> PathBuf {
        self.state.join(OVERRIDES_FILE)
    }
}

/// A change sent by Settings, the CLI or the control API. `default` is the built-in value of
/// the key (a hint): `value: null` with a hint means "use the default".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerChange {
    pub key: String,
    #[serde(default)]
    pub value: Json,
    #[serde(default)]
    pub default: Option<Json>,
}

/// What reading one layer found.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    /// 0 = `config.toml`, 1 = `overrides.toml`.
    pub id: u8,
    pub kind: &'static str,
    pub path: String,
    /// `ok`, `missing` or `error`.
    pub status: &'static str,
    pub error: Option<ConfigError>,
    /// The layer's own parsed content (`null` unless `ok`), for per-file checks.
    pub config: Option<Json>,
}

pub(super) fn read_layer(id: u8, kind: &'static str, path: &Path, name: &str, max: u64) -> LayerInfo {
    let mut info = LayerInfo { id, kind, path: path.to_string_lossy().into_owned(), status: "ok", error: None, config: None };
    match read_toml_text(path, name, max) {
        Ok(text) => match parse_config(&text) {
            Ok(json) => info.config = Some(json),
            Err(e) => {
                info.status = "error";
                info.error = Some(e);
            }
        },
        Err(e) if e.code == "NOT_FOUND" => info.status = "missing",
        Err(e) => {
            info.status = "error";
            info.error = Some(ConfigError { message: e.message, line: None });
        }
    }
    info
}

pub(super) fn read_layers(dirs: &Dirs) -> [LayerInfo; 2] {
    [
        read_layer(0, "config", &dirs.config_file(), CONFIG_FILE, MAX_CONFIG_BYTES),
        read_layer(1, "overrides", &dirs.overrides_file(), OVERRIDES_FILE, MAX_OVERRIDES_BYTES),
    ]
}

/// The merged config of the layers that parsed, or `None` when none did.
pub(super) fn merged(layers: &[LayerInfo]) -> Option<Json> {
    let mut parsed = layers.iter().filter_map(|l| l.config.as_ref());
    let mut out = parsed.next()?.clone();
    for higher in parsed {
        merge_layer(&mut out, higher);
    }
    Some(out)
}

/// Merges `higher` over `base`: tables key by key, everything else (scalars, arrays) replaced.
/// `tools.<tool>` and `plugin.<id>` are replaced whole.
pub fn merge_layer(base: &mut Json, higher: &Json) {
    let (Some(b), Some(h)) = (base.as_object_mut(), higher.as_object()) else {
        *base = higher.clone();
        return;
    };
    for (table, value) in h {
        match (b.get_mut(table), value) {
            (Some(Json::Object(lower)), Json::Object(over)) if WHOLE_TABLE_UNITS.contains(&table.as_str()) => {
                for (k, v) in over {
                    lower.insert(k.clone(), v.clone());
                }
            }
            (Some(existing @ Json::Object(_)), Json::Object(_)) => merge_layer(existing, value),
            _ => {
                b.insert(table.clone(), value.clone());
            }
        }
    }
}

/// Equality that treats `14` and `14.0` as the same number.
pub fn same_value(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_value(p, q)),
        (Json::Object(x), Json::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_value(v, w))),
        _ => a == b,
    }
}

/// The value a change key names in a parsed config (`table.key`, `hotkeys.<id>`,
/// `keys.labels.<sequence>`, `tools.<tool>`).
fn lookup<'a>(config: &'a Json, key: &str) -> Option<&'a Json> {
    if let Some(seq) = key.strip_prefix("keys.labels.") {
        return config.get("keys")?.get("labels")?.get(seq);
    }
    match split_key(key).ok()? {
        (Some(table), k) => config.get(table)?.get(k),
        (None, k) => config.get(k),
    }
}

/// What to write to `overrides.toml` for one change, given the layers below it (the Reset
/// table of the plan): `Some(value)` writes, `None` removes the key.
fn effective(lower: &Json, change: &LayerChange) -> Option<Json> {
    let below = lookup(lower, &change.key);
    match (&change.value, &change.default) {
        (Json::Null, Some(default)) => below.map(|_| default.clone()),
        (Json::Null, None) => None,
        (value, hint) => {
            let redundant = match below {
                Some(b) => same_value(b, value),
                None => hint.as_ref().is_some_and(|d| same_value(d, value)),
            };
            (!redundant).then(|| value.clone())
        }
    }
}

/// Renders `changes` applied to an empty document below the comment block `head`. Comments in
/// an otherwise empty document trail it in toml_edit, so the head is prepended to the body.
pub fn with_head(head: &str, changes: &[ConfigChange], name: &str, max: u64) -> Result<String> {
    let body = apply_toml_changes("", changes, name, max)?;
    let text = if head.is_empty() { body } else { format!("{head}\n\n{body}") };
    if text.len() as u64 > max {
        return Err(err("INVALID_FILE", format!("{name} would exceed {}", size_label(max))));
    }
    Ok(text)
}

/// Applies Settings changes to `overrides.toml` (created with a header on the first write).
/// Reads `config.toml` to drop values it already gives and to decide what "use the default"
/// means; never writes `config.toml`.
pub fn update_overrides_in(dirs: &Dirs, changes: &[LayerChange]) -> Result<()> {
    let _guard = write_guard()?;
    ensure_config_files(dirs)?;
    let below = read_layer(0, "config", &dirs.config_file(), CONFIG_FILE, MAX_CONFIG_BYTES).config.unwrap_or(Json::Null);
    let plain: Vec<ConfigChange> = changes
        .iter()
        .map(|c| ConfigChange { key: c.key.clone(), value: effective(&below, c).unwrap_or(Json::Null) })
        .collect();
    let only_removals = plain.iter().all(|c| c.value.is_null());
    let path = dirs.overrides_file();
    let existing = match read_toml_text(&path, OVERRIDES_FILE, MAX_OVERRIDES_BYTES) {
        Ok(text) => Some(text),
        Err(e) if e.code == "NOT_FOUND" => None,
        Err(e) => return Err(e),
    };
    let updated = match &existing {
        Some(text) => {
            if let Err(e) = parse_config(text) {
                let at = e.line.map(|l| format!(" at line {l}")).unwrap_or_default();
                return Err(err("CONFIG_INVALID", format!("overrides.toml is broken{at}: {}. Open it to fix it, or reset the Settings changes.", e.message)));
            }
            // A file holding only comments is rebuilt like a new one, so its comments stay on top.
            let comments_only = matches!(parse_config(text), Ok(Json::Object(m)) if m.is_empty());
            if comments_only && !only_removals {
                with_head(text.trim_end(), &plain, OVERRIDES_FILE, MAX_OVERRIDES_BYTES)?
            } else {
                apply_toml_changes(text, &plain, OVERRIDES_FILE, MAX_OVERRIDES_BYTES)?
            }
        }
        None => {
            // Still validate the keys, so a bad call fails the same way with or without a file.
            let text = with_head(OVERRIDES_HEADER, &plain, OVERRIDES_FILE, MAX_OVERRIDES_BYTES)?;
            if only_removals {
                return Ok(());
            }
            text
        }
    };
    if existing.as_deref() != Some(updated.as_str()) {
        fs::create_dir_all(&dirs.state).map_err(ioerr)?;
        write_atomic(&path, updated.as_bytes())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn dirs_in(root: &Path) -> Dirs {
        Dirs { config: root.join("config"), state: root.join("state") }
    }
    fn set(key: &str, value: Json) -> LayerChange {
        LayerChange { key: key.into(), value, default: None }
    }
    fn reset(key: &str, default: Json) -> LayerChange {
        LayerChange { key: key.into(), value: Json::Null, default: Some(default) }
    }
    fn write_config(d: &Dirs, text: &str) {
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join(CONFIG_FILE), text).unwrap();
    }
    fn overrides(d: &Dirs) -> String {
        fs::read_to_string(d.overrides_file()).unwrap_or_default()
    }
    fn effective_config(d: &Dirs) -> Json {
        load_settings_in(d).unwrap().config.unwrap()
    }

    #[test]
    fn merge_replaces_scalars_and_arrays_and_merges_tables_by_key() {
        let mut base = json!({"editor": {"font_size": 14, "stroke_color": "#111"}, "interface": {"activity_bar_order": ["a", "b"]}, "root": 1});
        merge_layer(&mut base, &json!({"editor": {"font_size": 20}, "interface": {"activity_bar_order": ["c"]}, "root": 2}));
        assert_eq!(
            base,
            json!({"editor": {"font_size": 20, "stroke_color": "#111"}, "interface": {"activity_bar_order": ["c"]}, "root": 2})
        );
    }

    #[test]
    fn tool_and_plugin_tables_are_replaced_whole_and_hotkeys_merge_per_id() {
        let mut base = json!({
            "tools": {"arrow": {"stroke_width": 4, "roughness": 0}, "text": {"font_size": 30}},
            "plugin": {"p": {"a": 1, "b": 2}},
            "hotkeys": {"vault.newDrawing": ["Mod+N"], "file.rename": ["F2"]},
            "keys": {"labels": {"g g": "top", "<leader> f": "files"}},
        });
        merge_layer(
            &mut base,
            &json!({
                "tools": {"arrow": {"roughness": 2}},
                "plugin": {"p": {"a": 9}},
                "hotkeys": {"file.rename": []},
                "keys": {"labels": {"g g": "start"}},
            }),
        );
        assert_eq!(base["tools"]["arrow"], json!({"roughness": 2}));
        assert_eq!(base["tools"]["text"], json!({"font_size": 30}));
        assert_eq!(base["plugin"]["p"], json!({"a": 9}));
        assert_eq!(base["hotkeys"], json!({"vault.newDrawing": ["Mod+N"], "file.rename": []}));
        assert_eq!(base["keys"]["labels"], json!({"g g": "start", "<leader> f": "files"}));
    }

    #[test]
    fn numbers_compare_as_numbers() {
        assert!(same_value(&json!(14), &json!(14.0)));
        assert!(same_value(&json!([1, {"a": 2.0}]), &json!([1.0, {"a": 2}])));
        assert!(!same_value(&json!(14), &json!(15)));
        assert!(!same_value(&json!("14"), &json!(14)));
    }

    #[test]
    fn first_write_creates_the_state_folder_and_a_header_and_leaves_config_toml_alone() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "# mine\n[editor]\nfont_size = 14 # keep\n");
        let before = fs::read(d.config.join(CONFIG_FILE)).unwrap();
        update_overrides_in(&d, &[set("editor.font_size", json!(20)), set("saving.autosave_delay_ms", json!(900))]).unwrap();
        assert_eq!(fs::read(d.config.join(CONFIG_FILE)).unwrap(), before, "config.toml bytes changed");
        let text = overrides(&d);
        assert!(text.starts_with("# Written by Vaultdraw Settings."), "{text}");
        assert!(text.contains("font_size = 20"), "{text}");
        assert_eq!(effective_config(&d)["editor"]["font_size"], json!(20));
        assert_eq!(effective_config(&d)["saving"]["autosave_delay_ms"], json!(900));
        // More writes, reset and removal: config.toml still never changes.
        update_overrides_in(&d, &[reset("editor.font_size", json!(20)), set("saving.autosave_delay_ms", Json::Null)]).unwrap();
        assert_eq!(fs::read(d.config.join(CONFIG_FILE)).unwrap(), before);
    }

    #[test]
    fn the_default_config_is_never_rewritten_after_its_first_creation() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        let before = fs::read(d.config.join(CONFIG_FILE)).unwrap();
        update_overrides_in(&d, &[set("editor.font_size", json!(21)), set("hotkeys.vault.newDrawing", json!(["Mod+Y"]))]).unwrap();
        update_overrides_in(&d, &[set("editor.font_size", Json::Null)]).unwrap();
        assert_eq!(fs::read(d.config.join(CONFIG_FILE)).unwrap(), before);
    }

    #[test]
    fn a_value_equal_to_the_lower_layer_is_not_stored_and_removes_the_override() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[editor]\nfont_size = 14\n");
        update_overrides_in(&d, &[set("editor.font_size", json!(14.0))]).unwrap();
        assert_eq!(overrides(&d), "", "nothing to write, file not created");
        update_overrides_in(&d, &[set("editor.font_size", json!(30))]).unwrap();
        assert!(overrides(&d).contains("font_size = 30"));
        update_overrides_in(&d, &[set("editor.font_size", json!(14))]).unwrap();
        assert!(!overrides(&d).contains("font_size"), "{}", overrides(&d));
        assert_eq!(effective_config(&d)["editor"]["font_size"], json!(14));
    }

    #[test]
    fn use_default_is_stored_only_when_a_lower_layer_sets_the_key() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[editor]\nfont_size = 14\n");
        // config.toml sets it: the default (20) is pinned in overrides.
        update_overrides_in(&d, &[reset("editor.font_size", json!(20))]).unwrap();
        assert!(overrides(&d).contains("font_size = 20"));
        assert_eq!(effective_config(&d)["editor"]["font_size"], json!(20));
        // "Reset to config.toml value": null without a hint removes the override.
        update_overrides_in(&d, &[set("editor.font_size", Json::Null)]).unwrap();
        assert_eq!(effective_config(&d)["editor"]["font_size"], json!(14));
        // config.toml does not set it: reset removes, nothing is pinned.
        update_overrides_in(&d, &[set("editor.roughness", json!(2))]).unwrap();
        update_overrides_in(&d, &[reset("editor.roughness", json!(1))]).unwrap();
        assert!(!overrides(&d).contains("roughness"));
        // A value equal to the built-in default (hint) with no lower layer is not stored.
        update_overrides_in(&d, &[LayerChange { key: "editor.roughness".into(), value: json!(1), default: Some(json!(1)) }]).unwrap();
        assert!(!overrides(&d).contains("roughness"));
    }

    #[test]
    fn hotkey_reset_pins_the_default_binding_over_config_toml() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[hotkeys]\n\"vault.newDrawing\" = [\"Mod+K\"]\n");
        update_overrides_in(&d, &[reset("hotkeys.vault.newDrawing", json!(["Mod+N"]))]).unwrap();
        assert_eq!(effective_config(&d)["hotkeys"]["vault.newDrawing"], json!(["Mod+N"]));
        update_overrides_in(&d, &[set("hotkeys.vault.newDrawing", Json::Null)]).unwrap();
        assert_eq!(effective_config(&d)["hotkeys"]["vault.newDrawing"], json!(["Mod+K"]));
    }

    #[test]
    fn a_tool_table_reset_writes_an_empty_table_that_survives() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[tools.arrow]\nstroke_width = 4\n");
        update_overrides_in(&d, &[reset("tools.arrow", json!({}))]).unwrap();
        let text = overrides(&d);
        assert!(text.contains("[tools.arrow]"), "{text}");
        assert_eq!(effective_config(&d)["tools"]["arrow"], json!({}));
        // Without a lower table the reset removes the override table and the parent.
        update_overrides_in(&d, &[set("tools.text", json!({"font_size": 30}))]).unwrap();
        update_overrides_in(&d, &[reset("tools.text", json!({}))]).unwrap();
        assert!(!overrides(&d).contains("tools.text"), "{}", overrides(&d));
        assert_eq!(effective_config(&d)["tools"]["arrow"], json!({}));
    }

    #[test]
    fn removals_on_a_missing_file_create_nothing_and_bad_keys_still_fail() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        update_overrides_in(&d, &[set("editor.font_size", Json::Null)]).unwrap();
        assert!(!d.overrides_file().exists());
        assert!(!d.state.exists(), "the state folder is created by the first real write only");
        assert!(update_overrides_in(&d, &[set("not a key", json!(1))]).is_err());
    }

    #[test]
    fn a_broken_overrides_file_refuses_writes_and_is_left_untouched() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        fs::create_dir_all(&d.state).unwrap();
        fs::write(d.overrides_file(), "a = 1\nb = \"oops\n").unwrap();
        let e = update_overrides_in(&d, &[set("editor.font_size", json!(20))]).unwrap_err();
        assert!(e.message.starts_with("overrides.toml is broken at line 2"), "{}", e.message);
        assert_eq!(overrides(&d), "a = 1\nb = \"oops\n");
    }

    #[test]
    fn load_reports_each_layer_and_a_broken_one_is_skipped() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[editor]\nfont_size = 14\nroughness = 2\n");
        let loaded = serde_json::to_value(load_settings_in(&d).unwrap()).unwrap();
        assert_eq!(loaded["layers"][0]["status"], "ok");
        assert_eq!(loaded["layers"][1]["status"], "missing");
        assert_eq!(loaded["layers"][1]["kind"], "overrides");
        assert!(loaded["overridesPath"].as_str().unwrap().ends_with("overrides.toml"));

        fs::create_dir_all(&d.state).unwrap();
        fs::write(d.overrides_file(), "[editor]\nfont_size = 20\n").unwrap();
        let loaded = serde_json::to_value(load_settings_in(&d).unwrap()).unwrap();
        assert_eq!(loaded["config"]["editor"], json!({"font_size": 20, "roughness": 2}));
        assert_eq!(loaded["layers"][1]["status"], "ok");

        // A broken overrides file: config.toml still applies, the error names the file's layer.
        fs::write(d.overrides_file(), "[editor\n").unwrap();
        let loaded = serde_json::to_value(load_settings_in(&d).unwrap()).unwrap();
        assert_eq!(loaded["config"]["editor"], json!({"font_size": 14, "roughness": 2}));
        assert_eq!(loaded["configError"], Json::Null);
        assert_eq!(loaded["overridesError"]["line"], 1);
        assert_eq!(loaded["layers"][1]["status"], "error");

        // A broken config.toml: the overrides still apply.
        fs::write(d.overrides_file(), "[editor]\nfont_size = 20\n").unwrap();
        write_config(&d, "[editor\n");
        let loaded = serde_json::to_value(load_settings_in(&d).unwrap()).unwrap();
        assert_eq!(loaded["config"], json!({"editor": {"font_size": 20}}));
        assert_eq!(loaded["configError"]["line"], 1);
    }

    #[test]
    fn deleting_overrides_falls_back_to_config_toml() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[editor]\nfont_size = 14\n");
        update_overrides_in(&d, &[set("editor.font_size", json!(20))]).unwrap();
        fs::remove_file(d.overrides_file()).unwrap();
        assert_eq!(effective_config(&d)["editor"]["font_size"], json!(14));
    }

    #[test]
    fn label_changes_follow_the_same_rules() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        write_config(&d, "[keys.labels]\n\"g g\" = \"top\"\n");
        update_overrides_in(&d, &[set("keys.labels.g g", json!("top"))]).unwrap();
        assert_eq!(overrides(&d), "");
        update_overrides_in(&d, &[set("keys.labels.g g", json!("start")), set("keys.labels.g h", json!("home"))]).unwrap();
        assert_eq!(effective_config(&d)["keys"]["labels"], json!({"g g": "start", "g h": "home"}));
    }

    /// Timing of `load_settings_in` (run with `--release --ignored --nocapture`).
    #[test]
    #[ignore]
    fn bench_load_settings() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        let time = |label: &str, f: &dyn Fn()| {
            let mut us: Vec<f64> = (0..3000)
                .map(|_| {
                    let start = std::time::Instant::now();
                    f();
                    start.elapsed().as_secs_f64() * 1e6
                })
                .collect();
            us.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("{label}: p50 {:.0} us, p95 {:.0} us", us[us.len() / 2], us[us.len() * 95 / 100]);
        };
        time("config.toml only, old path (read + parse)", &|| {
            let _ = read_layer(0, "config", &d.config_file(), CONFIG_FILE, MAX_CONFIG_BYTES);
        });
        time("load_settings_in, no overrides.toml", &|| {
            load_settings_in(&d).unwrap();
        });
        update_overrides_in(&d, &[set("editor.font_size", json!(33)), set("interface.zoom", json!(110)), set("saving.autosave_delay_ms", json!(800))]).unwrap();
        time("load_settings_in, small overrides.toml", &|| {
            load_settings_in(&d).unwrap();
        });
    }
}
