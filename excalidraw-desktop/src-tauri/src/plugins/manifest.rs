//! `plugin.toml`: strict parsing and validation (contract: personal/feature/plugins/PLUGIN-API.md).
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::HashSet;

pub(crate) const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// The plugin API major this app implements.
pub(crate) const SUPPORTED_API: u32 = 0;
const MAX_COMMANDS: usize = 200;
const MAX_PANELS: usize = 20;
const MAX_SETTINGS: usize = 100;
const MAX_TITLE: usize = 200;
const MAX_TEXT: usize = 1000;
const MAX_PATH: usize = 260;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Command {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub keys: Vec<String>,
    #[serde(default)]
    pub when: Vec<String>,
    #[serde(default = "yes")]
    pub palette: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Group {
    #[default]
    Top,
    Bottom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Panel {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub group: Group,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Contributes {
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub panels: Vec<Panel>,
    /// Passed through; the TS settings registry validates the rest.
    #[serde(default)]
    pub settings: Vec<Json>,
}

fn yes() -> bool {
    true
}

/// Input shape (snake_case keys as written in plugin.toml).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    id: String,
    name: String,
    version: String,
    api: u32,
    #[serde(default)]
    min_app: Option<String>,
    main: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    activation: Vec<String>,
    #[serde(default)]
    contributes: Contributes,
}

/// A validated manifest, in the camelCase shape sent to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api: u32,
    pub min_app: Option<String>,
    pub main: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub activation: Vec<String>,
    pub contributes: Contributes,
}

/// `^[a-z0-9][a-z0-9-]{1,38}$`
pub(crate) fn is_valid_id(s: &str) -> bool {
    let b = s.as_bytes();
    (2..=39).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

/// `^[A-Za-z][A-Za-z0-9_-]{0,63}$`
fn is_valid_short_id(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=64).contains(&b.len())
        && b[0].is_ascii_alphabetic()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
}

/// A relative `/`-separated path with no `..`, `.`, empty segments, backslash, NUL, drive colon or leading `/`.
pub(crate) fn is_safe_rel_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= MAX_PATH
        && !p.contains(['\\', '\0', ':'])
        && p.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

fn check_title(what: &str, t: &str) -> Result<(), String> {
    if t.trim().is_empty() || t.chars().count() > MAX_TITLE {
        return Err(format!("{what} must be 1 to {MAX_TITLE} characters"));
    }
    Ok(())
}

fn check_unique_ids<'a>(what: &str, ids: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for id in ids {
        if !is_valid_short_id(id) {
            return Err(format!("{what} id '{id}' is invalid (letters, digits, - and _, starting with a letter)"));
        }
        if !seen.insert(id) {
            return Err(format!("Duplicate {what} id '{id}'"));
        }
    }
    Ok(())
}

fn validate(raw: Raw) -> Result<Manifest, String> {
    if !is_valid_id(&raw.id) {
        return Err(format!("Plugin id '{}' is invalid (a-z, 0-9 and -, 2 to 39 characters)", raw.id));
    }
    check_title("name", &raw.name)?;
    Version::parse(&raw.version).map_err(|_| format!("version '{}' is not a semantic version", raw.version))?;
    if let Some(m) = &raw.min_app {
        Version::parse(m).map_err(|_| format!("min_app '{m}' is not a semantic version"))?;
    }
    if !is_safe_rel_path(&raw.main) {
        return Err(format!("main '{}' must be a relative path inside the plugin folder", raw.main));
    }
    for (what, v) in [("description", &raw.description), ("author", &raw.author)] {
        if v.as_ref().is_some_and(|s| s.chars().count() > MAX_TEXT) {
            return Err(format!("{what} is longer than {MAX_TEXT} characters"));
        }
    }
    if let Some(a) = raw.activation.iter().find(|a| *a != "onStartupFinished") {
        return Err(format!("Unknown activation event '{a}'"));
    }
    let c = &raw.contributes;
    if c.commands.len() > MAX_COMMANDS || c.panels.len() > MAX_PANELS || c.settings.len() > MAX_SETTINGS {
        return Err(format!("Too many contributions (max {MAX_COMMANDS} commands, {MAX_PANELS} panels, {MAX_SETTINGS} settings)"));
    }
    check_unique_ids("command", c.commands.iter().map(|x| x.id.as_str()))?;
    check_unique_ids("panel", c.panels.iter().map(|x| x.id.as_str()))?;
    for x in &c.commands {
        check_title("command title", &x.title)?;
    }
    for x in &c.panels {
        check_title("panel title", &x.title)?;
    }
    for s in &c.settings {
        let field = |k: &str| s.get(k).and_then(Json::as_str).filter(|v| !v.is_empty());
        if field("key").is_none() || field("type").is_none() {
            return Err("Every setting needs a string 'key' and 'type'".into());
        }
    }
    Ok(Manifest {
        id: raw.id,
        name: raw.name,
        version: raw.version,
        api: raw.api,
        min_app: raw.min_app,
        main: raw.main,
        description: raw.description,
        author: raw.author,
        activation: raw.activation,
        contributes: raw.contributes,
    })
}

/// Parses and validates `plugin.toml` text. Top-level tables named `x-*` are ignored.
pub(crate) fn parse(text: &str) -> Result<Manifest, String> {
    if text.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("plugin.toml is larger than 64 KB".into());
    }
    let mut table: toml::Table = text.parse().map_err(|e: toml::de::Error| e.message().to_string())?;
    table.retain(|k, v| !(k.starts_with("x-") && v.is_table()));
    let raw: Raw = table.try_into().map_err(|e: toml::de::Error| e.to_string())?;
    validate(raw)
}

/// `(compatible, problem)` for this app version.
pub(crate) fn compatibility(m: &Manifest, app_version: &str) -> (bool, Option<String>) {
    if m.api != SUPPORTED_API {
        return (false, Some(format!("Plugin API {} is not supported", m.api)));
    }
    if let (Some(min), Ok(app)) = (&m.min_app, Version::parse(app_version)) {
        if Version::parse(min).is_ok_and(|min| min > app) {
            return (false, Some(format!("Needs app \u{2265} {min}")));
        }
    }
    (true, None)
}
