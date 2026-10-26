//! The control API settings, read from the merged config layers: `config.toml` (yours) and,
//! when present, `overrides.toml` in the state folder (written by Settings). Shared by the app
//! and by `vaultdraw mcp`, read at the point of use with no cache (a few tens of microseconds).
//!
//! | Key | Default | A broken layer or a wrong type |
//! | --- | --- | --- |
//! | `control.enabled` | true | counts as unset |
//! | `control.notify_edits` | true | counts as unset |
//! | `ai.enabled` | false | AI off (fail closed) |
//! | `ai.mcp_enabled` | true | AI tools off (fail closed) |
//! | `control.uri_enabled` | true | links off (fail closed); a `control` that is not a table too |
//! | `control.uri_allow` | `[]` | nothing pre-approved (non-string entries are skipped) |

use crate::config::{read_toml_text, Dirs, OVERRIDES_FILE};
use std::path::Path;

const MAX_LAYER_BYTES: u64 = 1024 * 1024;

/// What the control server needs to know, all keys resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlSettings {
    /// `[control] enabled`: the control socket starts.
    pub enabled: bool,
    /// `[control] notify_edits`: a notice when a script or AI tool edits the drawing.
    pub notify_edits: bool,
    /// `[ai] enabled`: the AI master switch.
    pub ai_enabled: bool,
    /// `[ai] mcp_enabled`: the AI tools interface under the master switch.
    pub ai_mcp_enabled: bool,
    /// `[control] uri_enabled`: `vaultdraw://` links and files opened from outside are handled.
    pub uri_enabled: bool,
    /// `[control] uri_allow`: what a link may do without asking (the highest layer's list wins whole).
    pub uri_allow: Vec<String>,
}

impl ControlSettings {
    /// The `mcp` role (AI tools) is accepted only while both switches are on.
    pub fn mcp_open(&self) -> bool {
        self.ai_enabled && self.ai_mcp_enabled
    }
}

/// One config layer as found on disk.
#[derive(Debug, Clone, Copy)]
pub enum Layer<'a> {
    Missing,
    Text(&'a str),
    /// The file exists but could not be read (too big, not UTF-8, not a regular file…).
    Unreadable,
}

/// Reads both layers of `dirs` and resolves the settings.
pub fn control_settings(dirs: &Dirs) -> ControlSettings {
    let config = read_layer(&dirs.config_file(), "config.toml");
    let overrides = read_layer(&dirs.overrides_file(), OVERRIDES_FILE);
    // Included files sit below config.toml; read only when it has an [include] table.
    let includes = if matches!(&config, Some(Ok(t)) if t.contains("include")) {
        crate::config::included_tables(dirs)
    } else {
        Vec::new()
    };
    resolve(includes, layer(&config), layer(&overrides))
}

/// `None` = missing, `Some(Err)` = unreadable, `Some(Ok)` = text.
type Read = Option<Result<String, ()>>;

fn read_layer(path: &Path, name: &str) -> Read {
    match read_toml_text(path, name, MAX_LAYER_BYTES) {
        Ok(text) => Some(Ok(text)),
        Err(e) if e.code == "NOT_FOUND" => None,
        Err(_) => Some(Err(())),
    }
}

fn layer(read: &Read) -> Layer<'_> {
    match read {
        None => Layer::Missing,
        Some(Ok(text)) => Layer::Text(text),
        Some(Err(())) => Layer::Unreadable,
    }
}

/// Pure resolution. Per key the higher layer (`overrides`) wins over `config`.
pub fn from_layers(config: Layer, overrides: Layer) -> ControlSettings {
    resolve(Vec::new(), config, overrides)
}

/// `includes` are the included files' tables, highest first, below `config`.
fn resolve(includes: Vec<toml::Table>, config: Layer, overrides: Layer) -> ControlSettings {
    let parse = |l: Layer| -> Result<Option<toml::Table>, ()> {
        match l {
            Layer::Missing => Ok(None),
            Layer::Text(t) => t.parse::<toml::Table>().map(Some).map_err(|_| ()),
            Layer::Unreadable => Err(()),
        }
    };
    let (config, overrides) = (parse(config), parse(overrides));
    let broken = config.is_err() || overrides.is_err();
    // Higher layer first; a broken layer contributes nothing.
    let mut layers: Vec<toml::Table> = [overrides, config].into_iter().filter_map(|l| l.ok().flatten()).collect();
    layers.extend(includes);
    let value = |table: &str, key: &str| layers.iter().find_map(|t| t.get(table)?.get(key).cloned());
    let soft = |table: &str, key: &str, default: bool| match value(table, key) {
        Some(v) => v.as_bool().unwrap_or(default),
        None => default,
    };
    // Fail closed: a broken layer, or a value that is not a boolean, turns AI off.
    let strict = |key: &str, default: bool| {
        !broken
            && match value("ai", key) {
                Some(v) => v.as_bool() == Some(true),
                None => default,
            }
    };
    // Links fail closed too: a broken layer, a `control` that is not a table in any layer, or a
    // switch that is not a boolean turns them off, so a typo never re-enables what the user disabled.
    let control_ok = layers.iter().all(|t| t.get("control").is_none_or(toml::Value::is_table));
    let uri_enabled = !broken
        && control_ok
        && match value("control", "uri_enabled") {
            Some(v) => v.as_bool() == Some(true),
            None => true,
        };
    let uri_allow = match value("control", "uri_allow") {
        Some(toml::Value::Array(a)) if control_ok => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        _ => Vec::new(),
    };
    ControlSettings {
        enabled: soft("control", "enabled", true),
        notify_edits: soft("control", "notify_edits", true),
        ai_enabled: strict("enabled", false),
        ai_mcp_enabled: strict("mcp_enabled", true),
        uri_enabled,
        uri_allow,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Layer::*;

    const ON: &str = "[ai]\nenabled = true\n";

    #[test]
    fn defaults_with_no_files() {
        let s = from_layers(Missing, Missing);
        assert_eq!(
            s,
            ControlSettings {
                enabled: true,
                notify_edits: true,
                ai_enabled: false,
                ai_mcp_enabled: true,
                uri_enabled: true,
                uri_allow: vec![]
            }
        );
        assert!(!s.mcp_open(), "AI is off by default");
    }

    #[test]
    fn config_alone_without_overrides_file() {
        let s = from_layers(Text(ON), Missing);
        assert!(s.ai_enabled && s.ai_mcp_enabled && s.mcp_open());
        let s = from_layers(Text("[ai]\nenabled = true\nmcp_enabled = false\n"), Missing);
        assert!(s.ai_enabled && !s.mcp_open(), "AI on, MCP off");
        let s = from_layers(Text("[control]\nenabled = false\nnotify_edits = false\n"), Missing);
        assert!(!s.enabled && !s.notify_edits);
    }

    #[test]
    fn overrides_win_key_by_key() {
        let s = from_layers(Text(ON), Text("[ai]\nenabled = false\n"));
        assert!(!s.ai_enabled, "Settings turned AI off over config.toml");
        let s = from_layers(Text("[ai]\nenabled = false\n"), Text(ON));
        assert!(s.mcp_open(), "Settings turned AI on");
        let s = from_layers(Text("[ai]\nmcp_enabled = false\n"), Text(ON));
        assert!(s.ai_enabled && !s.ai_mcp_enabled, "unset in overrides falls through to config.toml");
        let s = from_layers(Missing, Text("[ai]\nenabled = true\n[control]\nnotify_edits = false\n"));
        assert!(s.mcp_open() && !s.notify_edits, "overrides alone count");
    }

    #[test]
    fn a_broken_layer_closes_ai_and_links_only() {
        for (c, o) in [(Text("not toml ["), Text(ON)), (Text(ON), Text("broken [")), (Unreadable, Text(ON)), (Text(ON), Unreadable)] {
            let s = from_layers(c, o);
            assert!(!s.ai_enabled && !s.ai_mcp_enabled && !s.mcp_open() && !s.uri_enabled, "{c:?} {o:?}");
            assert!(s.enabled && s.notify_edits, "the other keys keep their defaults");
        }
        let s = from_layers(Text("[control]\nenabled = false\n"), Text("broken ["));
        assert!(!s.enabled, "a broken overrides file is skipped for the soft keys");
    }

    #[test]
    fn a_wrong_type_is_off_for_ai_and_default_for_the_rest() {
        let s = from_layers(Text("[ai]\nenabled = \"yes\"\n"), Missing);
        assert!(!s.ai_enabled);
        let s = from_layers(Text("[ai]\nenabled = true\nmcp_enabled = 1\n"), Missing);
        assert!(s.ai_enabled && !s.ai_mcp_enabled);
        let s = from_layers(Text("ai = true\n"), Missing);
        assert!(!s.ai_enabled, "ai must be a table");
        let s = from_layers(Text("[control]\nenabled = \"no\"\nnotify_edits = 0\n"), Missing);
        assert!(s.enabled && s.notify_edits);
    }

    #[test]
    fn links_switch_and_allow_list_come_from_every_layer() {
        let s = from_layers(Text("[control]\nuri_enabled = false\nuri_allow = [\"new\", 3, \"a.b\"]\n"), Missing);
        assert!(!s.uri_enabled);
        assert_eq!(s.uri_allow, vec!["new".to_string(), "a.b".into()], "non-strings skipped");
        let s = from_layers(Text("[control]\nuri_enabled = false\n"), Text("[control]\nuri_enabled = true\n"));
        assert!(s.uri_enabled, "Settings turned links back on");
        let s = from_layers(Text("[control]\nuri_allow = [\"new\"]\n"), Text("[control]\nuri_allow = [\"switch-vault\"]\n"));
        assert_eq!(s.uri_allow, vec!["switch-vault".to_string()], "the higher layer's list wins whole");
        let s = from_layers(Text("[control]\nuri_allow = [\"new\"]\n"), Text("[control]\nenabled = true\n"));
        assert_eq!(s.uri_allow, vec!["new".to_string()], "unset in overrides falls through");
        assert!(from_layers(Text("[control]\nenabled = false\n"), Missing).uri_enabled, "the socket switch is not the link switch");
    }

    #[test]
    fn links_fail_closed() {
        for (c, o) in [
            (Text("not toml ["), Missing),
            (Missing, Text("broken [")),
            (Unreadable, Missing),
            (Missing, Unreadable),
            (Text("control = 1\n"), Missing),
            (Missing, Text("control = \"x\"\n")),
            (Text("[control]\nuri_enabled = \"true\"\n"), Missing),
            (Text("[control]\nuri_enabled = 1\n"), Missing),
        ] {
            assert!(!from_layers(c, o).uri_enabled, "{c:?} {o:?}");
        }
        assert!(from_layers(Text("   \n"), Missing).uri_enabled, "an empty config.toml is defaults");
        assert!(from_layers(Text("[control]\nuri_allow = \"new\"\n"), Missing).uri_allow.is_empty(), "a wrong list pre-approves nothing");
    }

    fn dirs(root: &Path) -> Dirs {
        let d = Dirs { config: root.join("config"), state: root.join("state") };
        std::fs::create_dir_all(&d.config).unwrap();
        std::fs::create_dir_all(&d.state).unwrap();
        d
    }

    #[test]
    fn included_files_sit_below_config_toml() {
        let tmp = tempfile::tempdir().unwrap();
        let d = dirs(tmp.path());
        let (on, off) = ("[control]\nenabled = true\n", "[control]\nenabled = false\n");
        std::fs::write(d.config.join("c.toml"), off).unwrap();
        std::fs::write(d.config_file(), "[include]\nfiles = [\"c.toml\"]\n").unwrap();
        assert!(!control_settings(&d).enabled, "off in an included file");
        std::fs::write(d.config.join("c.toml"), on).unwrap();
        assert!(control_settings(&d).enabled, "on in an included file");
        std::fs::write(d.config.join("c.toml"), off).unwrap();
        std::fs::write(d.config_file(), "[include]\nfiles = [\"c.toml\"]\n[control]\nenabled = true\n").unwrap();
        assert!(control_settings(&d).enabled, "config.toml wins over the include");
        std::fs::write(d.config.join("c.toml"), "[ai]\nenabled = true\n").unwrap();
        std::fs::write(d.config_file(), "[include]\nfiles = [\"c.toml\"]\n").unwrap();
        assert!(control_settings(&d).ai_enabled, "ai keys read from an include too");
        std::fs::write(d.overrides_file(), "[ai]\nenabled = false\n").unwrap();
        assert!(!control_settings(&d).ai_enabled, "overrides win over the include");
        std::fs::remove_file(d.overrides_file()).unwrap();
        std::fs::write(d.config.join("c.toml"), "[control]\nuri_enabled = false\nuri_allow = [\"new\"]\n").unwrap();
        let s = control_settings(&d);
        assert!(!s.uri_enabled && s.uri_allow == ["new"], "link keys read from an include");
        std::fs::write(d.overrides_file(), "[control]\nuri_enabled = true\n").unwrap();
        assert!(control_settings(&d).uri_enabled, "overrides win over the include for links too");
    }

    #[test]
    fn reads_the_files_with_and_without_overrides() {
        let tmp = tempfile::tempdir().unwrap();
        let d = dirs(tmp.path());
        assert!(!control_settings(&d).mcp_open(), "no files: off");
        std::fs::write(d.config_file(), ON).unwrap();
        assert!(control_settings(&d).mcp_open(), "config.toml only");
        std::fs::write(d.state.join(OVERRIDES_FILE), "[ai]\nmcp_enabled = false\n").unwrap();
        let s = control_settings(&d);
        assert!(s.ai_enabled && !s.mcp_open(), "overrides.toml present and merged");
        std::fs::write(d.state.join(OVERRIDES_FILE), [0xff, 0xfe]).unwrap();
        assert!(!control_settings(&d).mcp_open(), "an unreadable overrides.toml fails closed");
        std::fs::remove_file(d.state.join(OVERRIDES_FILE)).unwrap();
        std::fs::create_dir(d.state.join(OVERRIDES_FILE)).unwrap();
        assert!(!control_settings(&d).mcp_open(), "a folder in its place fails closed");
    }

    #[test]
    fn reading_cost_report() {
        let tmp = tempfile::tempdir().unwrap();
        let d = dirs(tmp.path());
        let filler: String = (0..200).map(|i| format!("key_{i} = {i}\n")).collect();
        std::fs::write(d.config_file(), format!("{ON}[editor]\n{filler}")).unwrap();
        std::fs::write(d.state.join(OVERRIDES_FILE), "[ai]\nmcp_enabled = true\n").unwrap();
        let mut times: Vec<_> = (0..200)
            .map(|_| {
                let t = std::time::Instant::now();
                assert!(control_settings(&d).mcp_open());
                t.elapsed()
            })
            .collect();
        times.sort();
        let (p50, p95) = (times[100], times[190]);
        // Reported, not asserted: wall-clock asserts fail under machine load.
        eprintln!("control_settings p50 {p50:?} p95 {p95:?}");
    }
}
