//! `plugin.toml`: strict parsing and validation (contract: personal/feature/plugins/PLUGIN-API.md).
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::HashSet;

pub(crate) const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// The plugin API level this app implements (1.0).
pub(crate) const SUPPORTED_API: u32 = 1;
/// The pre-1.0 level. A manifest that says `api = 0` still loads, with a warning, until API 2.0.
pub(crate) const LEGACY_API: u32 = 0;
/// The API revision this app implements: the version of `sdk/api/package.json` (a test keeps them equal).
pub(crate) const API_REVISION: &str = "1.0.0";
const MAX_COMMANDS: usize = 200;
const MAX_PANELS: usize = 20;
const MAX_SETTINGS: usize = 100;
const MAX_TITLE: usize = 200;
const MAX_TEXT: usize = 1000;
const MAX_PATH: usize = 260;
const MAX_PERMISSIONS: usize = 8;
const MAX_IMPORTERS: usize = 8;
const MAX_STATUS_ITEMS: usize = 8;
const MAX_VIEWS: usize = 8;
const MAX_MENUS: usize = 16;
const MAX_TOOLBAR: usize = 8;
const MAX_TOOLS: usize = 8;
const MAX_SHAPES: usize = 8;
const MAX_METHODS: usize = 16;
const METHOD_TIMEOUT_MS: std::ops::RangeInclusive<u32> = 100..=120_000;
const SHAPE_SIDE: std::ops::RangeInclusive<u32> = 8..=4000;
const TOOL_CURSORS: [&str; 5] = ["crosshair", "default", "pointer", "grab", "text"];
const MAX_ICON: usize = 1000;
const TREE_KINDS: [&str; 3] = ["drawing", "note", "folder"];
const MAX_IMPORTER_EXTENSIONS: usize = 8;
const MAX_DATA_KEY: usize = 64;
const MAX_EXTENSION: usize = 32;
/// Activation event prefix: `onDrop:<ext>` is accepted only when an importer declares `<ext>`.
const ON_DROP: &str = "onDrop:";

/// Extensions the app handles itself, so no importer may claim them. The same list is in
/// `plugin.schema.json` (`definitions.importer`, `not.enum`) and `sdk/cli/src/manifest.mjs`; a
/// test ties it to the schema, and the web view's test ties it to `IMAGE_MIME_TYPES`.
pub(crate) const RESERVED_EXTENSIONS: [&str; 15] = [
    "excalidraw", "excalidrawlib", "json", "jpeg", "svg", "png", "jpg", "gif", "webp", "bmp", "ico", "avif", "jfif", "excalidraw.png",
    "excalidraw.svg",
];

/// Permissions a plugin may declare. A declaration and a consent line, not a sandbox.
pub(crate) const PERMISSIONS: [&str; 7] = ["vault.read", "vault.write", "folders.import", "control", "pdf", "clipboard", "network.images"];
/// Names kept for later API revisions: an app that knows them as reserved refuses a manifest that uses one.
const RESERVED_PERMISSIONS: [&str; 2] = ["net", "secret"];

/// A write permission changes files with no undo: adding one needs the user's review.
pub(crate) fn is_write_permission(p: &str) -> bool {
    p.ends_with(".write") || p == "folders.import" || p == "control"
}

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
    #[serde(default)]
    pub repeat: bool,
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

/// A file kind a plugin imports: dropped or picked files with one of `extensions` go to it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Importer {
    pub id: String,
    pub title: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Surface {
    Tree,
    Tab,
    Canvas,
}

/// A context menu item (`[[contributes.menus]]`): runs a command of the plugin from a right-click menu.
/// `kinds` (tree only) limits it to `drawing`, `note` or `folder` rows; empty means all.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MenuItem {
    pub surface: Surface,
    pub command: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
}

/// A toolbar button (`[[contributes.toolbar]]`): runs a command of the plugin. `icon` is SVG path data
/// on a 24 by 24 grid (never markup); without it the button shows the first letter of its title.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ToolbarItem {
    pub command: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub priority: i32,
}

/// A canvas tool (`[[contributes.tools]]`): the plugin gets the pointer while it is the active tool
/// (`ctx.tools.register`). The app adds a palette command and a toolbar button for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ToolDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
}

/// A custom shape (`[[contributes.shapes]]`): the plugin draws it as SVG (`ctx.shapes.register`).
/// `width` and `height` are the size of a new shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ShapeDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_shape_width")]
    pub width: u32,
    #[serde(default = "default_shape_height")]
    pub height: u32,
}

fn default_shape_width() -> u32 {
    160
}

fn default_shape_height() -> u32 {
    100
}

/// A method other programs can call (`[[contributes.methods]]`, permission `control`): the `vaultdraw`
/// command, scripts and, with `mcp = true` while AI is on, AI apps. The plugin answers with
/// `ctx.methods.register`; JSON in, JSON out. `params` is an optional JSON Schema (an object) for the input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MethodDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub params: Option<Json>,
    /// Offer the method to AI apps as a tool (only while `ai.enabled`).
    #[serde(default)]
    pub mcp: bool,
    /// The method changes the vault or a drawing (AI clients are told).
    #[serde(default)]
    pub write: bool,
    #[serde(default)]
    pub timeout_ms: Option<u32>,
}

/// A view of a file type in the main pane (`[[contributes.views]]`): notes whose name ends in one of
/// `extensions` (`kanban.md`) open in the plugin's component instead of the Markdown note view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct View {
    pub id: String,
    pub title: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Align {
    Left,
    #[default]
    Right,
}

/// A status bar item (`[[contributes.status_bar]]`): the plugin fills it with `ctx.statusBar.set`.
/// `command` (a command id of this plugin) runs when the user clicks the item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StatusItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub align: Align,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub command: Option<String>,
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
    /// Always sent to the web view, possibly empty.
    #[serde(default)]
    pub importers: Vec<Importer>,
    /// `[[contributes.status_bar]]`; the web view gets the same key.
    #[serde(default)]
    pub status_bar: Vec<StatusItem>,
    #[serde(default)]
    pub views: Vec<View>,
    #[serde(default)]
    pub menus: Vec<MenuItem>,
    #[serde(default)]
    pub toolbar: Vec<ToolbarItem>,
    #[serde(default)]
    pub tools: Vec<ToolDecl>,
    #[serde(default)]
    pub shapes: Vec<ShapeDecl>,
    #[serde(default)]
    pub methods: Vec<MethodDecl>,
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
    /// The oldest API revision the plugin needs, such as `1.2.0`.
    #[serde(default)]
    min_api: Option<String>,
    main: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    activation: Vec<String>,
    #[serde(default)]
    permissions: Vec<String>,
    /// The customData key of the plugin's element data (default `plugins.<id>`).
    #[serde(default)]
    data_key: Option<String>,
    #[serde(default)]
    contributes: Contributes,
    /// Dev plugins are watched and reloaded when their files change.
    #[serde(default)]
    dev: bool,
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
    pub min_api: Option<String>,
    pub main: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub activation: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub data_key: Option<String>,
    pub contributes: Contributes,
    #[serde(default)]
    pub dev: bool,
}

/// Ids a new plugin may not take: the built-in command groups (a plugin's commands are named
/// `<id>.<name>`, so a plugin called `vault` would add commands that look built in). The official
/// plugins are bundled and exempt. Checked when a plugin is installed, so a plugin that is already
/// installed under one of these names keeps working.
const RESERVED_IDS: &[&str] = &[
    "ai", "app", "appearance", "backup", "canvas", "cli", "command", "commands", "config", "control", "drawing", "excalidraw",
    "export", "extensions", "file", "focus", "help", "history", "keys", "layout", "library", "links", "memory", "navigator",
    "notes", "page", "palette", "paper", "pens", "plugins", "profile", "settings", "snippets", "sync", "tabs", "tags",
    "templates", "theme", "thumbnails", "tools", "uri", "vault", "vaultdraw", "view", "watchdog", "window",
];

pub(crate) fn is_reserved_id(id: &str) -> bool {
    RESERVED_IDS.contains(&id)
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

/// `^[a-z0-9]+(\.[a-z0-9]+)*$`, at most 32 bytes.
fn is_valid_extension(e: &str) -> bool {
    e.len() <= MAX_EXTENSION && e.split('.').all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

fn check_importers(list: &[Importer]) -> Result<(), String> {
    if list.len() > MAX_IMPORTERS {
        return Err(format!("Too many importers (max {MAX_IMPORTERS})"));
    }
    check_unique_ids("importer", list.iter().map(|x| x.id.as_str()))?;
    let mut seen = HashSet::new();
    for x in list {
        check_title("importer title", &x.title)?;
        if x.extensions.is_empty() || x.extensions.len() > MAX_IMPORTER_EXTENSIONS {
            return Err(format!("Importer '{}' needs 1 to {MAX_IMPORTER_EXTENSIONS} extensions", x.id));
        }
        for e in &x.extensions {
            if !is_valid_extension(e) {
                return Err(format!("Extension '{e}' is invalid (lower case letters and digits, dots between parts, at most {MAX_EXTENSION} bytes, no leading dot)"));
            }
            if RESERVED_EXTENSIONS.contains(&e.as_str()) {
                return Err(format!("Extension '{e}' is handled by the app"));
            }
            if !seen.insert(e.as_str()) {
                return Err(format!("Duplicate importer extension '{e}'"));
            }
        }
    }
    Ok(())
}

/// Names the Markdown note view owns: a plugin view needs a longer suffix such as `kanban.md`.
const NOTE_EXTENSIONS: [&str; 3] = ["md", "markdown", "excalidraw.md"];

fn check_views(list: &[View]) -> Result<(), String> {
    if list.len() > MAX_VIEWS {
        return Err(format!("Too many views (max {MAX_VIEWS})"));
    }
    check_unique_ids("view", list.iter().map(|x| x.id.as_str()))?;
    let mut seen = HashSet::new();
    for x in list {
        check_title("view title", &x.title)?;
        if x.extensions.is_empty() || x.extensions.len() > MAX_IMPORTER_EXTENSIONS {
            return Err(format!("View '{}' needs 1 to {MAX_IMPORTER_EXTENSIONS} extensions", x.id));
        }
        for e in &x.extensions {
            if !is_valid_extension(e) {
                return Err(format!("Extension '{e}' is invalid (lower case letters and digits, dots between parts, at most {MAX_EXTENSION} bytes, no leading dot)"));
            }
            if NOTE_EXTENSIONS.contains(&e.as_str()) || !e.ends_with(".md") {
                return Err(format!("View extension '{e}' must end in '.md' with a name before it, like 'kanban.md' (only notes open in views for now)"));
            }
            if !seen.insert(e.as_str()) {
                return Err(format!("Duplicate view extension '{e}'"));
            }
        }
    }
    Ok(())
}

fn check_menus(list: &[MenuItem], commands: &[Command]) -> Result<(), String> {
    if list.len() > MAX_MENUS {
        return Err(format!("Too many menu items (max {MAX_MENUS})"));
    }
    let mut seen = HashSet::new();
    for x in list {
        if !commands.iter().any(|c| c.id == x.command) {
            return Err(format!("Menu item names command '{}', which the plugin does not declare", x.command));
        }
        if let Some(t) = &x.title {
            check_title("menu item title", t)?;
        }
        if !x.kinds.is_empty() && x.surface != Surface::Tree {
            return Err("Menu item 'kinds' applies to the tree surface only".into());
        }
        if let Some(k) = x.kinds.iter().find(|k| !TREE_KINDS.contains(&k.as_str())) {
            return Err(format!("Menu item kind '{k}' is unknown (use drawing, note or folder)"));
        }
        if !seen.insert((x.surface, x.command.as_str())) {
            return Err(format!("Duplicate menu item for command '{}' on the same surface", x.command));
        }
    }
    Ok(())
}

fn check_icon(what: &str, i: &str) -> Result<(), String> {
    let ok = !i.trim().is_empty() && i.len() <= MAX_ICON && i.chars().all(|c| c.is_ascii_alphanumeric() || " .,+-".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("{what} icon must be SVG path data (letters, digits, spaces and . , + -; 1 to {MAX_ICON} characters)"))
    }
}

fn check_tools(list: &[ToolDecl]) -> Result<(), String> {
    if list.len() > MAX_TOOLS {
        return Err(format!("Too many tools (max {MAX_TOOLS})"));
    }
    check_unique_ids("tool", list.iter().map(|x| x.id.as_str()))?;
    for x in list {
        check_title("tool title", &x.title)?;
        if let Some(i) = &x.icon {
            check_icon("Tool", i)?;
        }
        if let Some(c) = &x.cursor {
            if !TOOL_CURSORS.contains(&c.as_str()) {
                return Err(format!("Tool cursor '{c}' is unknown (use crosshair, default, pointer, grab or text)"));
            }
        }
    }
    Ok(())
}

fn check_shapes(list: &[ShapeDecl]) -> Result<(), String> {
    if list.len() > MAX_SHAPES {
        return Err(format!("Too many shapes (max {MAX_SHAPES})"));
    }
    check_unique_ids("shape", list.iter().map(|x| x.id.as_str()))?;
    for x in list {
        check_title("shape title", &x.title)?;
        if let Some(i) = &x.icon {
            check_icon("Shape", i)?;
        }
        if !SHAPE_SIDE.contains(&x.width) || !SHAPE_SIDE.contains(&x.height) {
            return Err(format!("Shape '{}' width and height must be between {} and {}", x.id, SHAPE_SIDE.start(), SHAPE_SIDE.end()));
        }
    }
    Ok(())
}

fn check_methods(list: &[MethodDecl], permissions: &[String]) -> Result<(), String> {
    if list.len() > MAX_METHODS {
        return Err(format!("Too many methods (max {MAX_METHODS})"));
    }
    if !list.is_empty() && !permissions.iter().any(|p| p == "control") {
        return Err("Declaring methods needs the permission 'control'".into());
    }
    check_unique_ids("method", list.iter().map(|x| x.id.as_str()))?;
    for x in list {
        check_title("method title", &x.title)?;
        let b = x.id.as_bytes();
        if b.len() > 48 || !b[0].is_ascii_lowercase() || !b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_') {
            return Err(format!("Method id '{}' must be lowercase letters, digits and _, starting with a letter (at most 48)", x.id));
        }
        if x.description.as_ref().is_some_and(|d| d.len() > MAX_TEXT) {
            return Err(format!("Method '{}' description is too long (max {MAX_TEXT} characters)", x.id));
        }
        if x.params.as_ref().is_some_and(|p| !p.is_object()) {
            return Err(format!("Method '{}' params must be a JSON Schema object", x.id));
        }
        if x.timeout_ms.is_some_and(|t| !METHOD_TIMEOUT_MS.contains(&t)) {
            return Err(format!("Method '{}' timeout_ms must be between {} and {}", x.id, METHOD_TIMEOUT_MS.start(), METHOD_TIMEOUT_MS.end()));
        }
    }
    Ok(())
}

fn check_toolbar(list: &[ToolbarItem], commands: &[Command]) -> Result<(), String> {
    if list.len() > MAX_TOOLBAR {
        return Err(format!("Too many toolbar buttons (max {MAX_TOOLBAR})"));
    }
    let mut seen = HashSet::new();
    for x in list {
        if !commands.iter().any(|c| c.id == x.command) {
            return Err(format!("Toolbar button names command '{}', which the plugin does not declare", x.command));
        }
        if let Some(t) = &x.title {
            check_title("toolbar button title", t)?;
        }
        if let Some(i) = &x.icon {
            check_icon("Toolbar", i)?;
        }
        if !seen.insert(x.command.as_str()) {
            return Err(format!("Duplicate toolbar button for command '{}'", x.command));
        }
    }
    Ok(())
}

fn check_status_bar(list: &[StatusItem], commands: &[Command]) -> Result<(), String> {
    if list.len() > MAX_STATUS_ITEMS {
        return Err(format!("Too many status bar items (max {MAX_STATUS_ITEMS})"));
    }
    check_unique_ids("status bar item", list.iter().map(|x| x.id.as_str()))?;
    for x in list {
        check_title("status bar item title", &x.title)?;
        if let Some(c) = &x.command {
            if !commands.iter().any(|d| &d.id == c) {
                return Err(format!("Status bar item '{}' names command '{c}', which the plugin does not declare", x.id));
            }
        }
    }
    Ok(())
}

/// `onStartupFinished`, `onPaste` (the permission `clipboard` is the one that makes it useful), or `onDrop:<ext>` for an extension one of `importers` declares.
fn check_activation(events: &[String], importers: &[Importer]) -> Result<(), String> {
    for a in events {
        let covered = a.strip_prefix(ON_DROP).is_some_and(|ext| importers.iter().any(|i| i.extensions.iter().any(|e| e == ext)));
        if a != "onStartupFinished" && a != "onPaste" && !covered {
            return Err(format!("Unknown activation event '{a}'"));
        }
    }
    Ok(())
}

fn check_permissions(list: &[String]) -> Result<(), String> {
    if list.len() > MAX_PERMISSIONS {
        return Err(format!("Too many permissions (max {MAX_PERMISSIONS})"));
    }
    let mut seen = HashSet::new();
    for p in list {
        if RESERVED_PERMISSIONS.contains(&p.as_str()) {
            return Err(format!("Permission '{p}' is reserved and cannot be used yet"));
        }
        if !PERMISSIONS.contains(&p.as_str()) {
            return Err(format!("Unknown permission '{p}' (known: {})", PERMISSIONS.join(", ")));
        }
        if !seen.insert(p) {
            return Err(format!("Duplicate permission '{p}'"));
        }
    }
    Ok(())
}

/// `^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$`, at most 64 bytes (same rule as the host's `dataKeyProblem`).
pub(crate) fn is_valid_data_key(k: &str) -> bool {
    let b = k.as_bytes();
    (1..=MAX_DATA_KEY).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && k.split('.').all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'))
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
    if let Some(m) = &raw.min_api {
        Version::parse(m).map_err(|_| format!("min_api '{m}' is not a semantic version"))?;
    }
    if !is_safe_rel_path(&raw.main) {
        return Err(format!("main '{}' must be a relative path inside the plugin folder", raw.main));
    }
    for (what, v) in [("description", &raw.description), ("author", &raw.author)] {
        if v.as_ref().is_some_and(|s| s.chars().count() > MAX_TEXT) {
            return Err(format!("{what} is longer than {MAX_TEXT} characters"));
        }
    }
    check_activation(&raw.activation, &raw.contributes.importers)?;
    check_permissions(&raw.permissions)?;
    if let Some(k) = &raw.data_key {
        if !is_valid_data_key(k) {
            return Err(format!("data_key '{k}' is invalid (lower case letters, digits, _ and -, parts joined by '.', at most {MAX_DATA_KEY} characters)"));
        }
        // Keys under `plugins.` belong to the plugin of that id (no reading another plugin's data).
        if (k == "plugins" || k.starts_with("plugins.")) && *k != format!("plugins.{}", raw.id) {
            return Err(format!("data_key '{k}' belongs to another plugin: keys under 'plugins.' must be 'plugins.{}'", raw.id));
        }
    }
    let c = &raw.contributes;
    if c.commands.len() > MAX_COMMANDS || c.panels.len() > MAX_PANELS || c.settings.len() > MAX_SETTINGS {
        return Err(format!("Too many contributions (max {MAX_COMMANDS} commands, {MAX_PANELS} panels, {MAX_SETTINGS} settings)"));
    }
    check_importers(&c.importers)?;
    check_status_bar(&c.status_bar, &c.commands)?;
    check_views(&c.views)?;
    check_menus(&c.menus, &c.commands)?;
    check_toolbar(&c.toolbar, &c.commands)?;
    check_tools(&c.tools)?;
    check_shapes(&c.shapes)?;
    check_methods(&c.methods, &raw.permissions)?;
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
        min_api: raw.min_api,
        main: raw.main,
        description: raw.description,
        author: raw.author,
        activation: raw.activation,
        permissions: raw.permissions,
        data_key: raw.data_key,
        contributes: raw.contributes,
        dev: raw.dev,
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
    if m.api != SUPPORTED_API && m.api != LEGACY_API {
        return (false, Some(format!("Plugin API {} is not supported (this app implements {SUPPORTED_API})", m.api)));
    }
    if let (Some(min), Ok(have)) = (&m.min_api, Version::parse(API_REVISION)) {
        if Version::parse(min).is_ok_and(|min| min > have) {
            return (false, Some(format!("Needs plugin API \u{2265} {min} (this app has {API_REVISION})")));
        }
    }
    if let (Some(min), Ok(app)) = (&m.min_app, Version::parse(app_version)) {
        if Version::parse(min).is_ok_and(|min| min > app) {
            return (false, Some(format!("Needs app \u{2265} {min}")));
        }
    }
    (true, None)
}
