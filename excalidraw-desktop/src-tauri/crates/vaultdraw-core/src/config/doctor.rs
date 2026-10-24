//! `vaultdraw doctor` and the app's "Config: Show debug info": one read-only report for bug
//! reports (borrowed from Neovim's `:checkhealth`, Helix's `--health` and Obsidian's "Show
//! debug info"). Reads files and their metadata only: never creates a folder or a file, never
//! touches the network. What only a running process knows (versions, the socket state) comes
//! in through [`DoctorInput`].

use super::*;
use crate::search::store::snapshot_path;
use std::time::SystemTime;

/// Where user plugins live, inside the config folder (same name as the app's plugin scanner).
pub const PLUGINS_DIR: &str = "plugins";
const PLUGIN_MANIFEST: &str = "plugin.toml";

/// What the caller knows: the CLI probes the socket, the app knows itself.
#[derive(Debug, Default, Clone)]
pub struct DoctorInput {
    /// `vaultdraw` CLI version, when the report comes from the CLI.
    pub cli_version: Option<String>,
    /// The app's version, when it is running (or is the caller).
    pub app_version: Option<String>,
    /// `running`, `starting`, `not running` (or `this app` from inside the app).
    pub app_state: String,
    pub api_level: u32,
    /// The control socket path and what a connect attempt found.
    pub socket: Option<PathBuf>,
    pub socket_state: String,
    /// The vault in use (the app's) or the one offline commands would use.
    pub vault: Option<PathBuf>,
    /// Where `vault` came from (`the app`, `--vault`, `the last opened vault`).
    pub vault_from: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    /// The human report.
    pub text: String,
    /// The same facts as JSON (`vaultdraw doctor --json`).
    pub report: Json,
}

/// A key some layer sets to something other than the built-in default.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedKey {
    pub key: String,
    pub value: Json,
    /// The layer that wins (`config.toml`, `overrides.toml` or an included file's path).
    pub source: String,
}

/// Every key the merged config sets to a non-default value, with the layer it comes from.
/// Keys of open tables (`[hotkeys]`, `[plugin.<id>]`) have no default and are always listed.
pub fn changed_keys(layers: &[LayerInfo]) -> Vec<ChangedKey> {
    let Some(merged) = merged(layers) else {
        return Vec::new();
    };
    let props = check_schema().get("properties");
    let mut out = Vec::new();
    for (table, keys) in merged.as_object().into_iter().flatten() {
        let Some(keys) = keys.as_object() else {
            continue;
        };
        for (name, value) in keys {
            let key = format!("{table}.{name}");
            let default =
                props.and_then(|p| p.get(table)?.get("properties")?.get(name)?.get("default"));
            if default.is_some_and(|d| same_value(d, value)) {
                continue;
            }
            out.push(ChangedKey {
                source: key_source(layers, &key).source,
                key,
                value: value.clone(),
            });
        }
    }
    out
}

fn installed_plugins(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| fs::symlink_metadata(e.path().join(PLUGIN_MANIFEST)).is_ok_and(|m| m.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    ids.sort();
    ids
}

/// `3 min ago`, `5 h ago`, `2 days ago`.
fn age(t: SystemTime, now: SystemTime) -> String {
    let s = now.duration_since(t).map(|d| d.as_secs()).unwrap_or(0);
    match s {
        0..=59 => "just now".into(),
        60..=3599 => format!("{} min ago", s / 60),
        3600..=172_799 => format!("{} h ago", s / 3600),
        _ => format!("{} days ago", s / 86_400),
    }
}

fn size(bytes: u64) -> String {
    match bytes {
        0..=1023 => format!("{bytes} B"),
        1024..=1_048_575 => format!("{:.1} KB", bytes as f64 / 1024.0),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
    }
}

struct Lines(String);
impl Lines {
    fn head(&mut self, title: &str) {
        if !self.0.is_empty() {
            self.0.push('\n');
        }
        self.0.push_str(title);
        self.0.push('\n');
    }
    fn row(&mut self, label: &str, value: impl std::fmt::Display) {
        self.0.push_str(&format!("  {label:<15} {value}\n"));
    }
}

/// The report. Reads only.
pub fn doctor_in(dirs: &Dirs, input: &DoctorInput) -> DoctorReport {
    doctor_with(dirs, input, SystemTime::now())
}

pub(super) fn doctor_with(dirs: &Dirs, input: &DoctorInput, now: SystemTime) -> DoctorReport {
    let layers = read_layers(dirs);
    let check = check_layers(&layers);
    let changed = changed_keys(&layers.all);
    let merged = merged(&layers.all).unwrap_or(Json::Null);
    let plugins_dir = dirs.config.join(PLUGINS_DIR);
    let installed = installed_plugins(&plugins_dir);
    let enabled: Vec<String> = merged
        .get("plugins")
        .and_then(|p| p.get("enabled"))
        .and_then(Json::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Json::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let control_enabled = merged
        .get("control")
        .and_then(|c| c.get("enabled"))
        .and_then(Json::as_bool)
        .unwrap_or(true);
    let index = input.vault.as_ref().map(|v| {
        let path = snapshot_path(&dirs.state, v);
        let meta = fs::metadata(&path).ok().filter(|m| m.is_file());
        (
            path,
            meta.as_ref().map(|m| m.len()),
            meta.and_then(|m| m.modified().ok()),
        )
    });
    let show = |p: &Path| p.to_string_lossy().into_owned();

    let mut t = Lines(String::new());
    t.head("Vaultdraw doctor (read-only: nothing was changed)");
    t.head("Versions");
    if let Some(v) = &input.cli_version {
        t.row(
            "vaultdraw CLI",
            format!("{v} (control API {})", input.api_level),
        );
    }
    match &input.app_version {
        Some(v) => t.row("app", format!("{v}, {}", input.app_state)),
        None => t.row("app", &input.app_state),
    }
    t.head("Paths");
    t.row("config folder", show(&dirs.config));
    t.row("state folder", show(&dirs.state));
    t.row("plugins folder", show(&plugins_dir));
    t.head("Config");
    for f in &check.files {
        t.row(&f.file, format!("{:<8}{}", f.status, f.path));
    }
    t.row(
        "check",
        if check.problems.is_empty() {
            "no problems".to_string()
        } else {
            format!(
                "{} error(s), {} warning(s): run `vaultdraw config check`",
                check.errors, check.warnings
            )
        },
    );
    if changed.is_empty() {
        t.row("changed keys", "none (every key has its default)");
    } else {
        t.row(
            "changed keys",
            format!("{} (key = value, from)", changed.len()),
        );
        for c in &changed {
            let value = c.value.to_string();
            let value = if value.len() > 48 {
                format!("{}…", value.chars().take(45).collect::<String>())
            } else {
                value
            };
            t.0.push_str(&format!("    {} = {value}  ({})\n", c.key, c.source));
        }
    }
    t.head("Extensions");
    t.row(
        "installed",
        format!(
            "{} in the plugins folder{}",
            installed.len(),
            if installed.is_empty() {
                String::new()
            } else {
                format!(": {}", installed.join(", "))
            }
        ),
    );
    t.row(
        "enabled",
        if enabled.is_empty() {
            "none".to_string()
        } else {
            enabled.join(", ")
        },
    );
    t.row(
        "startup cost",
        "measured by the app while it runs (Settings → Extensions); not stored on disk",
    );
    t.head("Vault");
    match (&input.vault, &index) {
        (Some(v), Some((path, bytes, modified))) => {
            t.row("vault", format!("{} ({})", show(v), input.vault_from));
            t.row(
                "search index",
                match (bytes, modified) {
                    (Some(b), Some(m)) => {
                        format!("saved {}, {} ({})", age(*m, now), size(*b), show(path))
                    }
                    (Some(b), None) => format!("{} ({})", size(*b), show(path)),
                    _ => format!("not saved yet; built on first search ({})", show(path)),
                },
            );
        }
        _ => t.row("vault", "none found (open one in the app, or pass --vault)"),
    }
    t.head("Control");
    t.row("[control] enabled", control_enabled);
    match &input.socket {
        Some(s) => t.row("socket", format!("{}: {}", show(s), input.socket_state)),
        None => t.row("socket", &input.socket_state),
    }

    let report = serde_json::json!({
        "versions": { "cli": input.cli_version, "app": input.app_version, "appState": input.app_state, "api": input.api_level },
        "paths": { "configDir": dirs.config, "stateDir": dirs.state, "pluginsDir": plugins_dir },
        "config": { "files": check.files, "errors": check.errors, "warnings": check.warnings, "changed": changed },
        "extensions": { "installed": installed, "enabled": enabled, "startupCost": null },
        "vault": input.vault.as_ref().map(|v| serde_json::json!({
            "path": v,
            "from": input.vault_from,
            "index": index.as_ref().map(|(path, bytes, modified)| serde_json::json!({
                "path": path,
                "bytes": bytes,
                "savedMs": modified.and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64),
            })),
        })),
        "control": { "enabled": control_enabled, "socket": input.socket, "state": input.socket_state },
    });
    DoctorReport { text: t.0, report }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use tempfile::tempdir;

    fn env() -> (tempfile::TempDir, Dirs) {
        let t = tempdir().unwrap();
        let dirs = Dirs {
            config: t.path().join("config"),
            state: t.path().join("state"),
        };
        (t, dirs)
    }

    fn input() -> DoctorInput {
        DoctorInput {
            cli_version: Some("9.9.9".into()),
            app_state: "not running".into(),
            api_level: 1,
            socket: Some("/run/v.sock".into()),
            socket_state: "no app (socket absent)".into(),
            ..Default::default()
        }
    }

    #[test]
    fn empty_config_reports_defaults_and_creates_nothing() {
        let (_t, dirs) = env();
        let r = doctor_in(&dirs, &input());
        assert!(r.text.contains("changed keys    none"), "{}", r.text);
        assert!(
            r.text.contains("vaultdraw CLI   9.9.9 (control API 1)"),
            "{}",
            r.text
        );
        assert!(r.text.contains("[control] enabled true"), "{}", r.text);
        assert!(!dirs.config.exists() && !dirs.state.exists());
    }

    #[test]
    fn names_the_layer_of_each_changed_key_and_skips_defaults() {
        let (_t, dirs) = env();
        fs::create_dir_all(&dirs.config).unwrap();
        fs::create_dir_all(&dirs.state).unwrap();
        fs::write(dirs.config_file(), "[interface]\nzoom = 120\nthumbnails = true\n[appearance]\nmode = \"dark\"\n[hotkeys]\n\"file.save\" = [\"Mod+S\"]\n").unwrap();
        fs::write(dirs.overrides_file(), "[appearance]\nmode = \"light\"\n").unwrap();
        let layers = read_layers(&dirs);
        let changed = changed_keys(&layers.all);
        let pairs: Vec<_> = changed
            .iter()
            .map(|c| (c.key.as_str(), c.value.clone(), c.source.as_str()))
            .collect();
        assert!(
            pairs.contains(&("interface.zoom", json!(120), "config.toml")),
            "{pairs:?}"
        );
        assert!(
            pairs.contains(&("appearance.mode", json!("light"), "overrides.toml")),
            "{pairs:?}"
        );
        assert!(
            pairs.contains(&("hotkeys.file.save", json!(["Mod+S"]), "config.toml")),
            "{pairs:?}"
        );
        assert!(
            !pairs.iter().any(|p| p.0 == "interface.thumbnails"),
            "a default value is not listed"
        );
    }

    #[test]
    fn counts_plugins_and_reports_the_index() {
        let (_t, dirs) = env();
        let plugin = dirs.config.join(PLUGINS_DIR).join("hello");
        fs::create_dir_all(&plugin).unwrap();
        fs::write(plugin.join(PLUGIN_MANIFEST), "id = \"hello\"\n").unwrap();
        fs::create_dir_all(dirs.config.join(PLUGINS_DIR).join("not-a-plugin")).unwrap();
        fs::write(dirs.config_file(), "[plugins]\nenabled = [\"hello\"]\n").unwrap();
        let vault = dirs.config.join("vault");
        let snap = snapshot_path(&dirs.state, &vault);
        fs::create_dir_all(snap.parent().unwrap()).unwrap();
        fs::write(&snap, vec![0u8; 2048]).unwrap();
        let mut i = input();
        i.vault = Some(vault);
        i.vault_from = "--vault".into();
        let later = SystemTime::now() + Duration::from_secs(600);
        let r = doctor_with(&dirs, &i, later);
        assert!(
            r.text
                .contains("installed       1 in the plugins folder: hello"),
            "{}",
            r.text
        );
        assert!(r.text.contains("enabled         hello"), "{}", r.text);
        assert!(
            r.text.contains("search index    saved 10 min ago, 2.0 KB"),
            "{}",
            r.text
        );
        assert_eq!(r.report["extensions"]["installed"], json!(["hello"]));
        assert_eq!(r.report["vault"]["index"]["bytes"], json!(2048));
    }

    #[test]
    fn config_problems_point_to_config_check() {
        let (_t, dirs) = env();
        fs::create_dir_all(&dirs.config).unwrap();
        fs::write(dirs.config_file(), "[interface]\nzom = 1\n").unwrap();
        let r = doctor_in(&dirs, &input());
        assert!(
            r.text
                .contains("0 error(s), 1 warning(s): run `vaultdraw config check`"),
            "{}",
            r.text
        );
    }
}
