//! User configuration folder (`config.toml`, `themes/`) and machine state (`state.json`).
//!
//! See `personal/planning/config.md` for the contract implemented here. The pure read, edit and
//! write side lives in this crate so the desktop app and the offline CLI share it; the file
//! watcher and the Tauri commands stay in the app.

use crate::error::{err, ioerr, Result};
use crate::fsops::{read_bounded, write_atomic, write_atomic_new};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

mod check;
mod doctor;
mod includes;
mod layers;
pub use check::*;
pub use doctor::*;
pub use includes::*;
pub use layers::*;

pub(crate) const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_STATE_BYTES: u64 = 1024 * 1024;
const MAX_CHANGES: usize = 256;
const CONFIG_FILE: &str = "config.toml";
const STATE_FILE: &str = "state.json";
pub const THEMES_DIR: &str = "themes";
pub const TEMP_PREFIX: &str = ".excalidraw-tmp-";


/// Written verbatim on first launch (when `config.toml` does not exist).
pub const DEFAULT_CONFIG: &str = r##"# Vaultdraw configuration
# Edit by hand; changes apply live. Delete a line to go back to its default.
# This file is yours: Settings never writes to it. What you change in Settings
# is saved to overrides.toml in the state folder, and wins over this file.

[appearance]
# Colour theme: a built-in name or a theme in the themes/ folder
theme = "Default"
# light | dark | system
mode = "system"
# Make the canvas background, pencil and palette colours follow the theme
sync_canvas = false
# Canvas background for new drawings when sync_canvas is off
canvas_background = "#ffffff"
# Replace the theme's primary colour, like "#6965db" ("" = the theme's own)
# accent_color = ""
# CSS snippets to apply, by file name in snippets/, like ["wide-sidebar"]
# snippets = []

[editor]
# Defaults for new elements
# 5 Excalifont, 6 Nunito, 8 Comic Shanns, 1 Virgil, 2 Helvetica, 3 Cascadia
font_family = 5
font_size = 20
stroke_color = "#1e1e1e"
background_color = "transparent"
# solid | hachure | cross-hatch
fill_style = "solid"
stroke_width = 2
# 0 architect, 1 artist, 2 cartoonist
roughness = 1

[paper]
# Paper for new drawings (each drawing can change it from the canvas menu)
# plain | grid | lines | dots | graph | isometric
# style = "plain"
# Distance between lines or dots, 5 to 200 (0 = the style's own)
# spacing = 0
# Pattern colour like "#8899aa" ("" = automatic)
# color = ""
# 0.1 to 1
# opacity = 1
# Grid and graph: a stronger line every N lines, 1 to 20 (0 = the style's own)
# major_every = 0
# Ruled lines: draw the margin line
# margin_line = true

[page]
# Page mode for new drawings: simulated pages instead of the infinite canvas (each drawing can change it from the canvas menu)
# normal | page
# mode = "normal"
# continuous (one long page) | separate (sheets with a gap)
# layout = "separate"
# a3 | a4 | a5 | b5 | letter | legal | tablet | tabletLarge | phone | custom
# size = "a4"
# portrait | landscape
# orientation = "portrait"
# Custom size in pixels (100 to 5000), used when size = "custom" (0 = unset)
# width = 0
# height = 0
# normal | old_school | match (follow the current theme)
# paper_theme = "normal"

[pdf_import]
# Import PDF pages as images (Cmd+P: Import PDF). Longest side of each page image in pixels (600 to 3000)
# max_side = 1440
# jpeg | png
# format = "jpeg"
# JPEG quality, 0.5 to 1
# quality = 0.85
# Lock imported pages so annotating does not drag them
# lock_pages = true
# Warn before importing more pages than this
# warn_pages = 50
# Decoded-pixel budget per import in megapixels; large PDFs get a lower resolution (10 to 400)
# pixel_budget_mp = 60

[saving]
# Milliseconds of idle time before an edit is written to disk
autosave_delay_ms = 500

[interface]
# Whole-app zoom in percent (Cmd+Shift +/-/0)
# zoom = 100
# Show a drawing's tags as chips in the file navigator
# show_tag_chips = true
# Show drawing thumbnails (home, search, palette, gallery)
# thumbnails = true
# Biggest drawing (in elements) that gets a thumbnail, 100 to 50000
# thumbnail_max_elements = 8000
# Size cap of a vault's thumbnail cache in megabytes, 8 to 8192 (oldest thumbnails go first)
# thumbnail_cache_mb = 128
# Paint the file tree first, the home pane one frame later
# defer_home_pane = true
# Show the activity bar
# activity_bar = true
# Entry order: library, history, graph, gallery, search, tags, templates, hotkeys, settings
# activity_bar_order = []
# Entries to hide, like ["tags"]
# activity_bar_hidden = []

[navigator]
# name_asc | name_desc | modified_desc | modified_asc
# sort = "name_asc"

[files]
# Ask before moving a drawing to the Trash
# confirm_delete = true
# Folder for new drawings, relative to the vault root (empty = next to the open drawing)
# new_drawing_folder = ""
# Vault folder holding your templates, relative to the vault root (empty falls back to "Templates")
# templates_folder = "Templates"
# When every vault folder is listed (recent drawings, file switcher, link suggestions): open | idle | use
# list_start = "idle"
# Read and parse a drawing when you press on it (tree, tab, switcher), before the click, so it opens sooner
# speculative_open = true

[hotkeys]
# Override a command's keys; [] removes them. Example:
# "vault.newDrawing" = ["Mod+N"]

[links]
# How new [[links]] are written: shortest | relative | absolute
# new_link_format = "shortest"
# Link stored on a shape: wikilink | vaultdraw-url
# shape_link_format = "wikilink"
# Modifier that opens a link on click
# open_modifier = "mod"
# Rewrite links when a drawing is renamed or moved: true | false | "ask"
# update_on_rename = true
# Suggest drawings while typing [[
# autocomplete = true
# Letters used by link hint mode
# hint_chars = "asdfghjkl"
# Draw [[links]] in text with the link colour and an underline
# style_links = true
# Link colour: "accent" (theme accent) or "#rrggbb"
# color = "accent"
# Hover preview card: always | modifier | off
# hover_preview = "always"
# When the link index starts: open (vault open) | idle (once the app is idle) | use (first links action)
# start = "idle"   # also starts search

[tags]
# Suggest existing tags while typing #
# autocomplete = true
# Tags pane order: name | count
# pane_sort = "name"

[pens]
# Saved pens of the freedraw tool (Alt+1 .. Alt+9 by default, see [hotkeys] pen.select1..9). width: 0.5 thin, 1 medium, 2 bold, ~10 highlighter.
# pressure = variable width; smoothing 0 (raw) to 1 (smooth); highlighter = drawn behind everything.
# presets = [ { name = "Fine liner", color = "#1e1e1e", width = 0.5, opacity = 100, pressure = false, smoothing = 0.3, highlighter = false } ]

[laser]
# Laser pointer trail
# color = "red"
# size = 2          # trail thickness in pixels, 1 to 24
# decay_ms = 1000   # time until the trail fades, 200 to 5000
# length = 50       # tail length in points, 5 to 200

[tools]
# Default style per drawing tool (rectangle, diamond, ellipse, arrow, line, text).
# Only the keys you set apply; the others keep the editor's current style.
# A vault's .excalidraw-vault/settings.toml can override a whole tool table. Example:
# [tools.arrow]
# stroke_color = "#f08c00"
# stroke_width = 3
# stroke_style = "dotted"

[tabs]
# Open several drawings at once (false = one drawing at a time)
# enabled = true
# always | never (never = switch tabs with the keyboard only)
# show_strip = "always"
# Opening from the file tree: current (replace the open drawing) | new
# open_from_navigator = "current"
# Switch to a drawing opened in a new tab
# focus_new = true
# after_active | end
# new_tab_position = "after_active"
# Ctrl+Tab order: mru (last used) | order (strip order)
# ctrl_tab = "mru"
# Allow Cmd+W to close pinned tabs
# close_pinned = false
# Reopen the open tabs when a vault opens
# restore = true
# Undo history kept for background tabs in MB, 0 to 1024 (0 = none)
# undo_budget_mb = 32

[notes]
# What a note shows when it opens: reading | editing
# open_in = "reading"
# Vim keys in the note editor
# vim = false
# Wrap long lines in the editor
# line_wrap = true
# Show line numbers in the editor
# line_numbers = false
# Text size of notes in pixels, 10 to 32
# font_size = 16
# Widest the reading text gets in pixels, 0 to 2000 (0 = the whole pane)
# readable_width = 760
# Save this many milliseconds after the last keystroke, 0 to 60000 (0 = only with Notes: Save)
# autosave_ms = 800
# Colour code blocks in the reading view
# highlight_code = true
# Render $...$ and $$...$$ as formulas
# math = true
# Load images from http(s) addresses (false keeps notes fully offline)
# remote_images = false
# Tick task checkboxes by clicking them in the reading view
# toggle_tasks = true

[layout]
# Show the header above the canvas (title, save status, History, Graph)
# header = true
# Show Excalidraw's footer (zoom, undo and redo, help)
# footer = true
# A preset to apply at launch, like "focus" ("" = none)
# preset = ""
# Named presets, written as [layout.presets.<name>] tables that set header,
# navigator, activity_bar, tab_strip or footer to true or false ("focus" is built in)
# presets = {}

[keys]
# The key <leader> stands for in a sequence
# leader = "Backslash"
# Milliseconds allowed between the keys of a sequence (0 = wait for a key)
# timeout_ms = 1000
# Drop a half-typed sequence after this many milliseconds (0 = never)
# cancel_after_ms = 5000
# Show the which-key popup while a sequence is half typed
# which_key = true
# Milliseconds before the popup appears
# which_key_delay_ms = 400
# Where the popup shows: "bottom" or "center"
# which_key_position = "bottom"

[memory]
# Free image data of deleted images once no undo or redo step can restore it
# free_unused_images = true
# Undo steps kept per drawing, 10 to 10000 (older steps go, with the images only they could restore)
# undo_steps = 1000
# Seconds hidden before caches are freed, 0 to 86400 (0 = never)
# hidden_purge_s = 120
# Seconds without input before off-screen caches are freed, 0 to 86400 (0 = never)
# idle_purge_s = 180

[extensions]
# Built-in extensions: false = not loaded at all (no memory, no work). Changes apply live.
# search = true       # search inside drawings (off: file names only)
# links = true        # links dock, [[ autocomplete, link styling, hints
# tags = true         # tags pane, tag chips, tag search and rename
# graph = true        # graph view
# library = true      # library sidebar
# templates = true    # new from template, save as template
# formula = true      # LaTeX formulas
# mermaid = true      # Mermaid to Excalidraw
# pdf-import = true   # PDF import
# notes = true        # Markdown notes: reading view and editor

[search]
# Milliseconds to wait after a keystroke before searching, 0 to 2000
# debounce_ms = 60
# Most drawings listed in the results, 1 to 200
# max_drawings = 50
# Most matching elements shown per drawing, 1 to 5
# max_snippets = 5
# Search the Markdown notes (.md) of the vault, with their #tags and links (read when the index starts)
# notes = true
# Megabytes of note text kept in memory, 0 to 4096 (past it a note keeps its name, headings, tags and links)
# note_text_mb = 48
# When the search index starts: open (vault open) | idle (once the app is idle) | use (first search)
# start = "idle"   # tags show once it has started

[history]
# Version history of each drawing (false = no versions at all)
# enabled = true
# Minutes between timed versions, 0 to 1440 (0 = none)
# interval_minutes = 5
# Keep every version for this many hours, then one per hour, per day, per week
# keep_all_hours = 1
# keep_hourly_hours = 24
# keep_daily_days = 30
# Weeks of weekly versions (0 = forever)
# keep_weekly_weeks = 0
# Size cap per vault in MB (0 = none)
# size_cap_mb = 500
# Highlight what changed in the History preview
# highlight_changes = true
# When file history starts: open (vault open) | idle | use (first edit or history action).
# Edits made before history starts are not versioned.
# start = "open"

[plugins]
# Ids of the plugins to load from the plugins/ folder, like ["hello-command"].
# The official markdown-import plugin is on by default and loads on first use;
# `enabled = []` turns it off, and a list of your own plugins should keep "markdown-import" in it.
# enabled = ["markdown-import"]
# Most data one plugin may save, in KiB, 64 to 16384
# storage_limit_kb = 1024
# Which plugin imports an extension when two claim it, like { txt = "text-import" }
# importers = {}
# Most ops in one plugin scene.batch call, 1 to 1000
# scene_max_ops = 500

[ai]
# The AI master switch; Settings and AI: Toggle AI show a warning first
# enabled = false
# The AI tools interface (mcp role of the control socket), open only while both are true
# mcp_enabled = true

[control]
# Show a notice when a script or AI tool edits the drawing on screen
# notify_edits = true

[watchdog]
# A Wait / Quit dialog when the page stops answering (macOS); off with enabled = false
# enabled = true
# How long the page must stay unresponsive first, in milliseconds (1000 to 60000)
# grace_ms = 5000

[window]
# Linux only: "custom" = one title bar (the app header has minimize, maximize and close),
# "native" = the system title bar. Needs a restart.
# decorations = "custom"

[network]
# Master switch for every feature that uses the internet
# enabled = true    # false = never connect
# Install themes from a URL or GitHub repo: absent = ask on first use, true = allow, false = refuse
# allow_themes = false

[themes]
# Largest theme file to install from the internet, in KB, 1 to 256
# max_install_kb = 64

# To split this file, add an [include] table that lists other TOML files or folders
# (relative to this file, or starting with ~). See "Including other files" in
# docs/configuration.md. This file wins over what it includes.
"##;

/// Serializes every config/state write within the process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn write_guard() -> Result<std::sync::MutexGuard<'static, ()>> {
    WRITE_LOCK
        .lock()
        .map_err(|_| err("INTERNAL", "Config write state unavailable"))
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirs {
    pub config: PathBuf,
    pub state: PathBuf,
}
impl Dirs {
    pub fn config_file(&self) -> PathBuf {
        self.config.join(CONFIG_FILE)
    }
    fn state_file(&self) -> PathBuf {
        self.state.join(STATE_FILE)
    }
}

/// Pure resolution: `get` reads an environment variable, `windows` selects the
/// platform table and `smoke_root` (smoke-test builds only) replaces the platform
/// default when the override is unset. Empty variables count as unset; relative
/// XDG values are ignored as the XDG spec requires.
pub fn resolve_dirs_with(
    get: impl Fn(&str) -> Option<OsString>,
    windows: bool,
    smoke_root: Option<&Path>,
) -> Result<Dirs> {
    vaultdraw_protocol::dirs::resolve_dirs_with(get, windows, smoke_root)
        .map(|d| Dirs { config: d.config, state: d.state })
        .map_err(|msg| err("CONFIG_DIR", msg))
}



// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigError {
    pub message: String,
    pub line: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettings {
    config_dir: String,
    config_path: String,
    state_path: String,
    /// The merge of the layers that parsed (`config.toml`, then `overrides.toml` over it).
    config: Option<Json>,
    config_error: Option<ConfigError>,
    /// Why `overrides.toml` was skipped, if it is broken.
    overrides_error: Option<ConfigError>,
    overrides_path: String,
    /// Per-layer status, lowest layer first.
    pub layers: Vec<LayerInfo>,
    /// Include problems that name no file of their own (cycles, depth, caps, `[include]` in overrides).
    include_warnings: Vec<String>,
    state: Json,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChange {
    pub key: String,
    #[serde(default)]
    pub value: Json,
}

// Files
// ---------------------------------------------------------------------------

/// Creates the config dir, `themes/` and a default `config.toml` if missing.
pub fn ensure_config_files(dirs: &Dirs) -> Result<()> {
    fs::create_dir_all(&dirs.config).map_err(ioerr)?;
    let themes = dirs.config.join(THEMES_DIR);
    if fs::symlink_metadata(&themes).is_err() {
        fs::create_dir_all(&themes).map_err(ioerr)?;
    }
    let path = dirs.config_file();
    match fs::symlink_metadata(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match write_atomic_new(&path, DEFAULT_CONFIG.as_bytes()) {
                // Another writer created it first; keep theirs.
                Err(e) if e.code == "NAME_COLLISION" => Ok(()),
                other => other,
            }
        }
        Err(e) => Err(ioerr(e)),
    }
}

/// Reads `config.toml` as UTF-8: regular files only, capped at 1 MiB.
fn read_config_text(path: &Path) -> Result<String> {
    read_toml_text(path, CONFIG_FILE, MAX_CONFIG_BYTES)
}

/// Reads a TOML settings file named `name` as UTF-8: regular files only (symbolic
/// links are refused), capped at `max` bytes.
pub fn read_toml_text(path: &Path, name: &str, max: u64) -> Result<String> {
    let meta = fs::symlink_metadata(path).map_err(ioerr)?;
    if meta.file_type().is_symlink() {
        return Err(err("INVALID_PATH", format!("{name} is a symbolic link; only regular files are read")));
    }
    if !meta.is_file() {
        return Err(err("INVALID_PATH", format!("{name} is not a regular file")));
    }
    let bytes = read_bounded(path, max)
        .map_err(|e| if e.code == "INVALID_FILE" { err("INVALID_FILE", format!("{name} exceeds {}", size_label(max))) } else { e })?;
    String::from_utf8(bytes).map_err(|_| err("INVALID_FILE", format!("{name} is not valid UTF-8")))
}

fn size_label(bytes: u64) -> String {
    if bytes >= 1024 * 1024 && bytes % (1024 * 1024) == 0 {
        format!("{} MiB", bytes / (1024 * 1024))
    } else {
        format!("{} KiB", bytes / 1024)
    }
}

fn line_of(text: &str, offset: usize) -> usize {
    let end = offset.min(text.len());
    text.as_bytes()[..end].iter().filter(|b| **b == b'\n').count() + 1
}

fn toml_to_json(v: toml::Value) -> Json {
    match v {
        toml::Value::String(s) => Json::String(s),
        toml::Value::Integer(i) => Json::from(i),
        toml::Value::Float(f) => serde_json::Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        toml::Value::Boolean(b) => Json::Bool(b),
        toml::Value::Datetime(d) => Json::String(d.to_string()),
        toml::Value::Array(a) => Json::Array(a.into_iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => table_to_json(t),
    }
}
fn table_to_json(t: toml::Table) -> Json {
    Json::Object(t.into_iter().map(|(k, v)| (k, toml_to_json(v))).collect())
}

/// Parses TOML text into a JSON object, or a `{ message, line }` error.
pub fn parse_config(text: &str) -> std::result::Result<Json, ConfigError> {
    toml::from_str::<toml::Table>(text).map(table_to_json).map_err(|e| ConfigError {
        message: e.message().trim().to_string(),
        line: e.span().map(|s| line_of(text, s.start)),
    })
}

fn read_state(path: &Path) -> Json {
    let empty = || Json::Object(Default::default());
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() => {}
        _ => return empty(),
    }
    read_bounded(path, MAX_STATE_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Json>(&bytes).ok())
        .filter(Json::is_object)
        .unwrap_or_else(empty)
}

/// The merged config as the webview sees it (`config.toml` with its includes, then
/// `overrides.toml` over it), read only; `Null` when nothing parses.
pub fn read_merged_config(dirs: &Dirs) -> Json {
    merged(&read_layers(dirs).all).unwrap_or(Json::Null)
}

pub fn load_settings_in(dirs: &Dirs) -> Result<LoadedSettings> {
    {
        let _guard = write_guard()?;
        ensure_config_files(dirs)?;
    }
    let config_path = dirs.config_file();
    let layers = read_layers(dirs);
    let config = merged(&layers.all);
    let (config_error, overrides_error) = (layers.of_kind("config").error.clone(), layers.of_kind("overrides").error.clone());
    let state_path = dirs.state_file();
    Ok(LoadedSettings {
        config_dir: dirs.config.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
        state_path: state_path.to_string_lossy().into_owned(),
        config,
        config_error,
        overrides_error,
        overrides_path: dirs.overrides_file().to_string_lossy().into_owned(),
        layers: layers.all,
        include_warnings: layers.warnings,
        state: read_state(&state_path),
    })
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/// Splits `table.key` on the **first** dot: the table name is `[A-Za-z0-9_-]`, the
/// key may also contain dots (`hotkeys.vault.newDrawing` → `hotkeys` / `vault.newDrawing`),
/// which `toml_edit` writes as a quoted key. A key without a dot is a root key.
fn split_key(key: &str) -> Result<(Option<&str>, &str)> {
    let bad = || err("INVALID_ARGUMENT", format!("Invalid config key \"{key}\"; expected \"table.key\""));
    let valid = |s: &str, dots: bool| {
        !s.is_empty()
            && s.len() <= 64
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || (dots && c == '.'))
            && !s.starts_with('.')
            && !s.ends_with('.')
            && !s.contains("..")
    };
    // Dynamic hotkey ids (`hotkeys.drawing.open:Graphs/BFS.excalidraw`) may hold any
    // non-control character; the TOML writer quotes the key.
    let free_hotkey = |s: &str| !s.is_empty() && s.chars().count() <= 1024 && !s.chars().any(char::is_control);
    match key.split_once('.') {
        None if valid(key, false) => Ok((None, key)),
        Some(("hotkeys", k)) if free_hotkey(k) => Ok((Some("hotkeys"), k)),
        Some((t, k)) if valid(t, false) && valid(k, true) => Ok((Some(t), k)),
        _ => Err(bad()),
    }
}

fn json_to_toml(key: &str, v: &Json, nested: bool) -> Result<toml_edit::Value> {
    let bad = |what: &str| err("INVALID_ARGUMENT", format!("Unsupported value for \"{key}\": {what}"));
    Ok(match v {
        Json::Bool(b) => (*b).into(),
        Json::String(s) => s.as_str().into(),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into()
            } else if n.is_u64() {
                return Err(bad("integer out of range"));
            } else {
                n.as_f64().ok_or_else(|| bad("number"))?.into()
            }
        }
        Json::Array(items) if !nested => {
            let mut arr = toml_edit::Array::new();
            for item in items {
                arr.push(json_to_toml(key, item, true)?);
            }
            if arr.iter().any(toml_edit::Value::is_inline_table) {
                // One inline table per line, so a long list stays hand-editable.
                arr.set_trailing_comma(true);
                arr.set_trailing("\n");
                for item in arr.iter_mut() {
                    item.decor_mut().set_prefix("\n  ");
                    item.decor_mut().set_suffix("");
                }
            }
            arr.into()
        }
        Json::Array(_) => return Err(bad("nested arrays")),
        // Flat only, and only as an array item: an inline table of scalars (a pen preset).
        Json::Object(_) if !nested => return Err(bad("objects outside an array")),
        Json::Object(fields) => {
            let mut table = toml_edit::InlineTable::new();
            for (k, field) in fields {
                if matches!(field, Json::Array(_) | Json::Object(_)) {
                    return Err(bad("nested arrays or objects inside an object"));
                }
                table.insert(k, json_to_toml(key, field, true)?);
            }
            table.into()
        }
        Json::Null => return Err(bad("null inside an array or object")),
    })
}

/// A flat JSON object of scalars as a `[table.key]` sub-table (tool defaults).
fn json_to_table(key: &str, fields: &serde_json::Map<String, Json>) -> Result<toml_edit::Table> {
    let mut table = toml_edit::Table::new();
    for (k, field) in fields {
        if matches!(field, Json::Array(_) | Json::Object(_)) {
            return Err(err("INVALID_ARGUMENT", format!("Unsupported value for \"{key}\": nested arrays or objects inside an object")));
        }
        table.insert(k, toml_edit::Item::Value(json_to_toml(key, field, true)?));
    }
    Ok(table)
}

/// `keys.labels.<sequence>` addresses one entry of the nested `[keys.labels]` table; the
/// rest of the key is the sequence, taken verbatim (`<leader> f f`, `g g`) and quoted by
/// the writer. `split_key` stays one level deep for every other key.
const LABELS_PREFIX: &str = "keys.labels.";

/// A label change: `Some(text)` sets the entry, `None` removes it.
struct LabelChange {
    seq: String,
    text: Option<String>,
}

/// Validates a `keys.labels.<seq>` change, or `None` when `key` is not one.
fn plan_label(key: &str, value: &Json) -> Option<Result<LabelChange>> {
    let seq = key.strip_prefix(LABELS_PREFIX)?;
    let bad = |what: &str| err("INVALID_ARGUMENT", format!("Invalid config key \"{key}\": {what}"));
    if seq.is_empty() || seq.chars().count() > 1024 || seq.chars().any(char::is_control) {
        return Some(Err(bad("the key sequence is empty, too long or has control characters")));
    }
    let text = match value {
        Json::Null => None,
        Json::String(s) if !s.trim().is_empty() && s.chars().count() <= 1024 && !s.chars().any(char::is_control) => {
            Some(s.clone())
        }
        _ => return Some(Err(bad("a label must be a non-empty text without control characters"))),
    };
    Some(Ok(LabelChange { seq: seq.to_owned(), text }))
}

/// Sets or removes one `[keys.labels]` entry, creating the table (under an implicit
/// `[keys]`) on the first label. A removed entry's comments move to the next entry (the last
/// entry's go with it), and a table left empty and uncommented is dropped along with an empty implicit `[keys]`.
fn apply_label(doc: &mut toml_edit::DocumentMut, label: &LabelChange, name: &str) -> Result<()> {
    let not_table = |t: &str| err("INVALID_ARGUMENT", format!("\"{t}\" in {name} is not a table"));
    let root = doc.as_table_mut();
    let Some(text) = &label.text else {
        remove_label(root, &label.seq);
        return Ok(());
    };
    if !root.contains_key("keys") {
        let mut parent = toml_edit::Table::new();
        parent.set_implicit(true);
        root.insert("keys", toml_edit::Item::Table(parent));
    }
    let keys = root.get_mut("keys").and_then(toml_edit::Item::as_table_like_mut).ok_or_else(|| not_table("keys"))?;
    if !keys.contains_key("labels") {
        keys.insert("labels", toml_edit::Item::Table(toml_edit::Table::new()));
    }
    let labels = keys.get_mut("labels").and_then(toml_edit::Item::as_table_like_mut).ok_or_else(|| not_table("keys.labels"))?;
    let mut new = toml_edit::Value::from(text.as_str());
    match labels.get_mut(&label.seq) {
        Some(existing) if existing.is_value() => {
            if let Some(old) = existing.as_value() {
                *new.decor_mut() = old.decor().clone();
            }
            *existing = toml_edit::Item::Value(new);
        }
        Some(_) => return Err(err("INVALID_ARGUMENT", format!("\"keys.labels.{}\" in {name} is a table, not a value", label.seq))),
        None => {
            labels.insert(&label.seq, toml_edit::Item::Value(new));
        }
    }
    Ok(())
}

fn remove_label(root: &mut toml_edit::Table, seq: &str) {
    let Some(keys) = root.get_mut("keys").and_then(toml_edit::Item::as_table_like_mut) else { return };
    let Some(labels) = keys.get_mut("labels").and_then(toml_edit::Item::as_table_like_mut) else { return };
    let Some(comments) = labels.key(seq).map(|k| k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned())
    else {
        return;
    };
    let next = labels.iter().skip_while(|(k, _)| *k != seq).nth(1).map(|(k, _)| k.to_owned());
    labels.remove(seq);
    if let (Some(next), false) = (next, comments.is_empty()) {
        if let Some(mut k) = labels.key_mut(&next) {
            let existing = k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned();
            k.leaf_decor_mut().set_prefix(format!("{comments}{existing}"));
        }
    }
    if !labels.is_empty() {
        return;
    }
    // Only a plain `[keys.labels]` without comments of its own is dropped.
    let plain = keys.get("labels").and_then(toml_edit::Item::as_table).is_some_and(|t| {
        let text = |r: Option<&toml_edit::RawString>| r.and_then(|r| r.as_str()).unwrap_or("").to_owned();
        !text(t.decor().prefix()).contains('#') && !text(t.decor().suffix()).contains('#')
    });
    if !plain {
        return;
    }
    keys.remove("labels");
    if keys.is_empty() && root.get("keys").and_then(toml_edit::Item::as_table).is_some_and(toml_edit::Table::is_implicit) {
        root.remove("keys");
    }
}

/// One validated change: remove the key, set a scalar/array, or set a sub-table.
enum Planned {
    Remove,
    Value(toml_edit::Value),
    Table(toml_edit::Table),
}

/// Applies `changes` to `config.toml` text, preserving comments, order and formatting.
/// Removing a key that took the place of a commented example from [`DEFAULT_CONFIG`]
/// puts that example back, so setting and then removing a key restores the text.
pub fn apply_changes(text: &str, changes: &[ConfigChange]) -> Result<String> {
    edit_toml(text, changes, CONFIG_FILE, MAX_CONFIG_BYTES, Some(DEFAULT_CONFIG), false)
}

/// Applies `changes` to the TOML text of the file `name` (a per-vault settings file),
/// preserving comments, order and formatting. Everything is validated first, so a bad
/// change applies nothing. A table left empty and uncommented by a removal is dropped.
pub fn apply_toml_changes(text: &str, changes: &[ConfigChange], name: &str, max: u64) -> Result<String> {
    edit_toml(text, changes, name, max, None, true)
}

/// `defaults` is the text whose commented examples a removal may restore; `prune` drops
/// tables that a removal leaves without values or comments of their own.
fn edit_toml(
    text: &str,
    changes: &[ConfigChange],
    name: &str,
    max: u64,
    defaults: Option<&str>,
    prune: bool,
) -> Result<String> {
    if changes.len() > MAX_CHANGES {
        return Err(err("INVALID_ARGUMENT", "Too many config changes in one call"));
    }
    if let Err(e) = parse_config(text) {
        let at = e.line.map(|l| format!(" (line {l})")).unwrap_or_default();
        return Err(err("CONFIG_INVALID", format!("{name} does not parse{at}: {}", e.message)));
    }
    let mut doc: toml_edit::DocumentMut = text
        .parse()
        .map_err(|e: toml_edit::TomlError| err("CONFIG_INVALID", format!("{name} does not parse: {}", e.message())))?;
    // Validate everything before mutating so a bad change applies nothing.
    let mut planned = Vec::with_capacity(changes.len());
    let mut labels = Vec::new();
    for change in changes {
        if let Some(label) = plan_label(&change.key, &change.value) {
            labels.push(label?);
            continue;
        }
        let (table, key) = split_key(&change.key)?;
        let value = match &change.value {
            Json::Null => Planned::Remove,
            Json::Object(fields) if table.is_some() => Planned::Table(json_to_table(&change.key, fields)?),
            Json::Object(_) => return Err(err("INVALID_ARGUMENT", format!("Unsupported value for \"{}\": objects outside a table", change.key))),
            v => Planned::Value(json_to_toml(&change.key, v, false)?),
        };
        planned.push((table, key, value));
    }
    for (table, key, value) in planned {
        let value = match (table, value) {
            (Some(t), Planned::Table(new)) => {
                set_table(&mut doc, t, key, new, name)?;
                continue;
            }
            (Some(t), Planned::Remove) if is_plain_subtable(&doc, t, key) => {
                remove_table(&mut doc, t, key, prune);
                continue;
            }
            (_, Planned::Remove) => None,
            (_, Planned::Value(v)) => Some(v),
            (None, Planned::Table(_)) => continue, // rejected while planning
        };
        let root = doc.as_table_mut();
        let target: &mut dyn toml_edit::TableLike = match table {
            None => root,
            Some(t) => {
                if !root.contains_key(t) {
                    if value.is_none() {
                        continue;
                    }
                    root.insert(t, toml_edit::Item::Table(toml_edit::Table::new()));
                }
                root.get_mut(t)
                    .and_then(toml_edit::Item::as_table_like_mut)
                    .ok_or_else(|| err("INVALID_ARGUMENT", format!("\"{t}\" in {name} is not a table")))?
            }
        };
        match value {
            None => remove_key(&mut doc, table, key, defaults, prune),
            Some(mut new) => match target.get_mut(key) {
                Some(existing) if existing.is_value() => {
                    if let Some(old) = existing.as_value() {
                        *new.decor_mut() = old.decor().clone();
                    }
                    *existing = toml_edit::Item::Value(new);
                }
                Some(_) => {
                    return Err(err("INVALID_ARGUMENT", format!("\"{}\" in {name} is a table, not a value", change_key(table, key))))
                }
                None => {
                    target.insert(key, toml_edit::Item::Value(new));
                    if let Some(t) = table {
                        adopt_commented_default(&mut doc, t, key);
                    }
                }
            },
        }
    }
    for label in &labels {
        apply_label(&mut doc, label, name)?;
    }
    let out = doc.to_string();
    if out.len() as u64 > max {
        return Err(err("INVALID_FILE", format!("{name} would exceed {}", size_label(max))));
    }
    Ok(out)
}

/// True when `table.key` is a `[table.key]` section (not an inline or dotted table).
fn is_plain_subtable(doc: &toml_edit::DocumentMut, table: &str, key: &str) -> bool {
    doc.get(table)
        .and_then(toml_edit::Item::as_table_like)
        .and_then(|t| t.get(key))
        .and_then(toml_edit::Item::as_table)
        .is_some_and(|t| !t.is_dotted())
}

/// Writes `new` as `table.key`. An existing table keeps its form (`[table.key]`, inline or
/// dotted) and decor, and only its keys are replaced. A new `[table.key]` is added under an
/// implicit parent if the parent is missing, and, when the parent is a documented empty
/// `[table]`, takes the comments that follow it so the documentation stays above it.
fn set_table(doc: &mut toml_edit::DocumentMut, table: &str, key: &str, new: toml_edit::Table, name: &str) -> Result<()> {
    let root = doc.as_table_mut();
    if !root.contains_key(table) {
        let mut parent = toml_edit::Table::new();
        parent.set_implicit(true);
        root.insert(table, toml_edit::Item::Table(parent));
    }
    let not_table = || err("INVALID_ARGUMENT", format!("\"{table}\" in {name} is not a table"));
    let parent = root.get(table).and_then(toml_edit::Item::as_table_like).ok_or_else(not_table)?;
    let fresh = parent.is_empty() && !parent.contains_key(key);
    let gap = if fresh { gap_after(doc, Some(table)) } else { None };
    let comments = gap.as_ref().and_then(|g| gap_text(doc, g)).unwrap_or_default();
    let parent = doc.get_mut(table).and_then(toml_edit::Item::as_table_like_mut).ok_or_else(not_table)?;
    match parent.get_mut(key) {
        Some(existing) => {
            if let Some(old) = existing.as_table_like_mut() {
                old.clear();
                for (k, v) in new.iter() {
                    old.insert(k, v.clone());
                }
                if let Some(inline) = existing.as_inline_table_mut() {
                    inline.fmt();
                }
            } else {
                *existing = toml_edit::Item::Table(new);
            }
        }
        None => {
            parent.insert(key, toml_edit::Item::Table(new));
            if let Some(gap) = gap.filter(|_| !comments.is_empty()) {
                // A blank line that separated the comments from the next header stays before it.
                let blank_before_next = matches!(gap, Gap::Table(_)) && comments.ends_with("\n\n");
                set_gap_text(doc, &gap, if blank_before_next { "\n".to_owned() } else { String::new() });
                let blank = if comments.ends_with("\n\n") { "" } else { "\n" };
                if let Some(t) = doc.get_mut(table).and_then(|t| t.get_mut(key)).and_then(toml_edit::Item::as_table_mut) {
                    t.decor_mut().set_prefix(format!("{comments}{blank}"));
                }
            }
        }
    }
    Ok(())
}

/// Removes the `[table.key]` section. Its comments move to the gap after the parent (undoing
/// [`set_table`]), and a parent left empty is dropped when it is implicit or `prune` is set.
fn remove_table(doc: &mut toml_edit::DocumentMut, table: &str, key: &str, prune: bool) {
    let Some(parent) = doc.get_mut(table).and_then(toml_edit::Item::as_table_like_mut) else { return };
    let Some(removed) = parent.remove(key) else { return };
    let empty = parent.is_empty();
    let prefix = removed.as_table().and_then(|t| t.decor().prefix()).and_then(|r| r.as_str()).unwrap_or("").to_owned();
    let implicit = doc.get(table).and_then(toml_edit::Item::as_table).is_some_and(toml_edit::Table::is_implicit);
    if empty && implicit {
        doc.as_table_mut().remove(table);
        return;
    }
    let comments = prefix.strip_suffix('\n').filter(|p| p.ends_with('\n')).unwrap_or(&prefix).to_owned();
    let Some(gap) = gap_after(doc, Some(table)) else { return };
    let Some(existing) = gap_text(doc, &gap) else { return };
    let text = comments + &existing;
    set_gap_text(doc, &gap, text.clone());
    if empty && prune && !prefix.contains('#') {
        prune_table(doc, table, &gap, &text);
    }
}
fn change_key(table: Option<&str>, key: &str) -> String {
    table.map(|t| format!("{t}.{key}")).unwrap_or_else(|| key.to_string())
}

/// True when `line` is a commented-out assignment of `key`, e.g. `# zoom = 1.0` or
/// `# "vault.newDrawing" = ["Mod+N"]`.
fn is_commented_assignment(line: &str, key: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix('#') else { return false };
    let rest = rest.trim_start();
    let (name, after) = if let Some(quoted) = rest.strip_prefix('"') {
        match quoted.split_once('"') {
            Some((name, after)) => (name, after),
            None => return false,
        }
    } else {
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .unwrap_or(rest.len());
        rest.split_at(end)
    };
    name == key && after.trim_start().starts_with('=')
}

/// Where the comments that follow a table's last value live in `toml_edit`: the prefix
/// of the next explicit table (as a path from the root), or the document trailer.
enum Gap {
    Table(Vec<String>),
    Trailing,
}

/// The gap after `table` (`None`: the root table, whose values precede every table).
/// `None` when the table is implicit or has no document position (created in this edit).
fn gap_after(doc: &toml_edit::DocumentMut, table: Option<&str>) -> Option<Gap> {
    fn positions(t: &toml_edit::Table, path: &mut Vec<String>, out: &mut Vec<(isize, Vec<String>)>) {
        for (k, item) in t.iter() {
            if let Some(sub) = item.as_table() {
                path.push(k.to_string());
                if let Some(pos) = sub.position().filter(|_| !sub.is_implicit()) {
                    out.push((pos, path.clone()));
                }
                positions(sub, path, out);
                path.pop();
            }
        }
    }
    let own_pos = match table {
        None => isize::MIN,
        Some(t) => {
            let own = doc.get(t)?.as_table()?;
            if own.is_implicit() {
                return None;
            }
            own.position()?
        }
    };
    let mut all = Vec::new();
    positions(doc.as_table(), &mut Vec::new(), &mut all);
    let next = all.into_iter().filter(|(p, _)| *p > own_pos).min_by_key(|(p, _)| *p).map(|(_, path)| path);
    Some(next.map_or(Gap::Trailing, Gap::Table))
}
fn gap_text(doc: &toml_edit::DocumentMut, gap: &Gap) -> Option<String> {
    match gap {
        Gap::Table(path) => table_at(doc, path)?.decor().prefix()?.as_str().map(str::to_owned),
        Gap::Trailing => doc.trailing().as_str().map(str::to_owned),
    }
}
fn set_gap_text(doc: &mut toml_edit::DocumentMut, gap: &Gap, text: String) {
    match gap {
        Gap::Table(path) => {
            if let Some(t) = table_at_mut(doc, path) {
                t.decor_mut().set_prefix(text);
            }
        }
        Gap::Trailing => doc.set_trailing(text),
    }
}

/// Finds the commented example for `key` in the gap after `table`: the gap's lines
/// before it, the example line itself and the lines after it.
fn commented_example(doc: &toml_edit::DocumentMut, table: &str, key: &str) -> Option<(Gap, String, String, String)> {
    let gap = gap_after(doc, Some(table))?;
    let text = gap_text(doc, &gap)?;
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let i = lines.iter().position(|l| is_commented_assignment(l, key))?;
    let (before, line, after) = (lines[..i].concat(), lines[i].to_owned(), lines[i + 1..].concat());
    Some((gap, before, line, after))
}

/// A key newly added to an explicit `[table]` is appended after the table's last value,
/// i.e. *before* any comments that follow it (`toml_edit` stores those as the prefix of
/// the next table, or as the document trailer). If those comments contain a commented
/// default for the key (`# zoom = 1.0`), the new value takes that line's place and the
/// comments above it become the key's own comments, so the documentation stays with it.
fn adopt_commented_default(doc: &mut toml_edit::DocumentMut, table: &str, key: &str) {
    let Some((gap, before, _, after)) = commented_example(doc, table, key) else { return };
    set_gap_text(doc, &gap, after);
    if let Some(mut k) = doc.get_mut(table).and_then(toml_edit::Item::as_table_mut).and_then(|t| t.key_mut(key)) {
        k.leaf_decor_mut().set_prefix(before);
    }
}

/// Removes `key` from `table` without losing the comments above it: they move to the
/// next value in the table, or (for the table's last value) into the gap after the table.
/// When the key had taken the place of a commented example in `defaults` (see
/// [`adopt_commented_default`]), that example line is restored below those comments, so
/// set-then-remove gives back the original text. With `prune`, a table left without
/// values or comments of its own is dropped.
fn remove_key(doc: &mut toml_edit::DocumentMut, table: Option<&str>, key: &str, defaults: Option<&str>, prune: bool) {
    let target: &mut dyn toml_edit::TableLike = match table {
        None => doc.as_table_mut(),
        Some(t) => match doc.get_mut(t).and_then(toml_edit::Item::as_table_like_mut) {
            Some(target) => target,
            None => return,
        },
    };
    let Some(comments) = target.key(key).map(|k| k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned())
    else {
        return;
    };
    let next_key = target
        .iter()
        .skip_while(|(k, _)| *k != key)
        .skip(1)
        .find(|(_, item)| item.is_value())
        .map(|(k, _)| k.to_owned());
    target.remove(key);
    let now_empty = target.is_empty();

    // The example line to restore, if the key replaced one from `defaults`.
    let example = match (defaults, table) {
        (Some(d), Some(t)) => d
            .parse::<toml_edit::DocumentMut>()
            .ok()
            .and_then(|d| commented_example(&d, t, key))
            .filter(|(_, before, _, _)| !before.is_empty() && comments.ends_with(before.as_str()))
            .map(|(_, _, line, _)| line),
        _ => None,
    };
    let mut moved = comments.clone();

    if let Some(next) = next_key {
        if let Some(mut k) = target.key_mut(&next) {
            let existing = k.leaf_decor().prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned();
            if let Some(line) = example.filter(|_| !existing.lines().any(|l| is_commented_assignment(l, key))) {
                moved.push_str(&line);
            }
            if !moved.is_empty() {
                k.leaf_decor_mut().set_prefix(moved + &existing);
            }
        }
        return;
    }
    let Some(gap) = gap_after(doc, table) else {
        // A table created in this same edit: nothing of the original text to keep.
        if prune && now_empty {
            if let Some(t) = table {
                doc.as_table_mut().remove(t);
            }
        }
        return;
    };
    let Some(existing) = gap_text(doc, &gap) else { return };
    if let Some(line) = example.filter(|_| !existing.lines().any(|l| is_commented_assignment(l, key))) {
        moved.push_str(&line);
    }
    if !moved.is_empty() {
        set_gap_text(doc, &gap, moved.clone() + &existing);
    }
    if prune && now_empty && !comments.contains('#') {
        if let Some(t) = table {
            prune_table(doc, t, &gap, &(moved + &existing));
        }
    }
}

/// Drops the empty `[table]` unless a comment belongs to it: one on its header line, or
/// one directly above the header. Comments above it that are separated by a blank line
/// (e.g. a file header) move into `gap`, whose current text is `gap_now`.
fn prune_table(doc: &mut toml_edit::DocumentMut, table: &str, gap: &Gap, gap_now: &str) {
    let Some(t) = doc.get(table).and_then(toml_edit::Item::as_table) else { return };
    if t.is_implicit() || !t.is_empty() {
        return;
    }
    let decor = t.decor();
    let suffix = decor.suffix().and_then(|r| r.as_str()).unwrap_or("");
    let prefix = decor.prefix().and_then(|r| r.as_str()).unwrap_or("").to_owned();
    let attached = prefix.split_inclusive('\n').last().is_some_and(|l| l.contains('#'));
    if suffix.contains('#') || attached {
        return;
    }
    doc.as_table_mut().remove(table);
    if prefix.contains('#') {
        let text = if gap_now.trim().is_empty() { prefix } else { prefix + gap_now };
        set_gap_text(doc, gap, text);
    }
}
fn table_at<'a>(doc: &'a toml_edit::DocumentMut, path: &[String]) -> Option<&'a toml_edit::Table> {
    path.iter().try_fold(doc.as_table(), |t, k| t.get(k)?.as_table())
}
fn table_at_mut<'a>(doc: &'a mut toml_edit::DocumentMut, path: &[String]) -> Option<&'a mut toml_edit::Table> {
    path.iter().try_fold(doc.as_table_mut(), |t, k| t.get_mut(k)?.as_table_mut())
}

pub fn update_config_in(dirs: &Dirs, changes: &[ConfigChange]) -> Result<()> {
    let _guard = write_guard()?;
    ensure_config_files(dirs)?;
    let path = dirs.config_file();
    let text = read_config_text(&path)?;
    let updated = apply_changes(&text, changes)?;
    if updated != text {
        write_atomic(&path, updated.as_bytes())?;
    }
    Ok(())
}

pub fn write_state_in(dirs: &Dirs, state: &Json) -> Result<()> {
    if !state.is_object() {
        return Err(err("INVALID_ARGUMENT", "state must be a JSON object"));
    }
    let mut bytes = serde_json::to_vec_pretty(state).map_err(|e| err("INTERNAL", e.to_string()))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(err("INVALID_FILE", "state.json would exceed 1 MiB"));
    }
    let _guard = write_guard()?;
    fs::create_dir_all(&dirs.state).map_err(ioerr)?;
    write_atomic(&dirs.state_file(), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use tempfile::tempdir;

    fn dirs_in(root: &Path) -> Dirs {
        Dirs { config: root.join("config"), state: root.join("state") }
    }
    fn change(key: &str, value: Json) -> ConfigChange {
        ConfigChange { key: key.into(), value }
    }
    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = vars.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn first_load_writes_default_config_verbatim_and_themes_dir() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        let loaded = load_settings_in(&d).unwrap();
        assert_eq!(fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap(), DEFAULT_CONFIG);
        assert!(d.config.join(THEMES_DIR).is_dir());
        assert!(loaded.config_error.is_none());
        assert_eq!(loaded.state, json!({}));
        let out = serde_json::to_value(&loaded).unwrap();
        for k in ["configDir", "configPath", "statePath", "config", "configError", "state"] {
            assert!(out.get(k).is_some(), "{k}");
        }
        assert!(out["configError"].is_null());
        // A second load keeps an edited file.
        fs::write(d.config.join(CONFIG_FILE), "x = 1\n").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().config, Some(json!({"x": 1})));
    }

    #[test]
    fn default_config_parses_to_json() {
        let v = parse_config(DEFAULT_CONFIG).unwrap();
        assert_eq!(v["appearance"]["theme"], "Default");
        assert_eq!(v["appearance"]["mode"], "system");
        assert_eq!(v["appearance"]["sync_canvas"], false);
        assert_eq!(v["editor"]["font_family"], 5);
        assert_eq!(v["editor"]["background_color"], "transparent");
        assert_eq!(v["saving"]["autosave_delay_ms"], 500);
        assert_eq!(parse_config("a = 1.5\nb = [1, 2]").unwrap(), json!({"a": 1.5, "b": [1, 2]}));
    }

    #[test]
    fn parse_error_reports_one_based_line() {
        let e = parse_config("[appearance]\nmode = \"dark\"\ntheme = \n").unwrap_err();
        assert_eq!(e.line, Some(3));
        assert!(!e.message.is_empty());
        assert_eq!(parse_config("= 1").unwrap_err().line, Some(1));

        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join(CONFIG_FILE), "a = 1\nb = \"unterminated\n").unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert_eq!(loaded.config_error.unwrap().line, Some(2));
    }

    #[test]
    fn update_preserves_comments_order_and_other_keys() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("appearance.mode", json!("dark")), change("editor.font_size", json!(28))]).unwrap();
        let text = fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap();
        let expected = DEFAULT_CONFIG
            .replace("mode = \"system\"", "mode = \"dark\"")
            .replace("font_size = 20", "font_size = 28");
        assert_eq!(text, expected);
    }

    #[test]
    fn update_keeps_trailing_comments_and_creates_missing_tables() {
        let src = "# top\n[editor]\nfont_size = 20 # big\nroughness = 1\n";
        let out = apply_changes(
            src,
            &[
                change("editor.font_size", json!(12)),
                change("editor.fill_style", json!("hachure")),
                change("saving.autosave_delay_ms", json!(750)),
                change("appearance.tags", json!(["a", "b"])),
                change("appearance.ratio", json!(0.5)),
            ],
        )
        .unwrap();
        assert!(out.starts_with("# top\n[editor]\nfont_size = 12 # big\nroughness = 1\nfill_style = \"hachure\"\n"), "{out}");
        let v = parse_config(&out).unwrap();
        assert_eq!(v["saving"]["autosave_delay_ms"], 750);
        assert_eq!(v["appearance"]["tags"], json!(["a", "b"]));
        assert_eq!(v["appearance"]["ratio"], 0.5);
    }

    #[test]
    fn null_removes_key_and_missing_removals_are_noops() {
        let out = apply_changes(
            DEFAULT_CONFIG,
            &[change("appearance.mode", Json::Null), change("nothing.here", Json::Null)],
        )
        .unwrap();
        let v = parse_config(&out).unwrap();
        assert!(v["appearance"].get("mode").is_none());
        assert_eq!(v["appearance"]["theme"], "Default");
        assert!(v.get("nothing").is_none());
        assert!(out.contains("# Colour theme"));
    }

    #[test]
    fn rejects_bad_keys_and_values_without_partial_application() {
        for (k, v) in [("a.b..c", json!(1)), ("a.b.", json!(1)), (".a", json!(1)), ("a.", json!(1)), ("a.b c", json!(1)), ("a.b\"c", json!(1)), ("a.b/c", json!(1)), ("", json!(1)), ("a b.c", json!(1)), ("a.b", json!({"x": {"y": 1}})), ("a.b", json!([[1]])), ("a.b", json!(u64::MAX))] {
            let e = apply_changes(DEFAULT_CONFIG, &[change("appearance.mode", json!("dark")), change(k, v)]).unwrap_err();
            assert_eq!(e.code, "INVALID_ARGUMENT", "{k}");
        }
        assert_eq!(apply_changes("[editor]\n", &[change("editor", json!(1))]).unwrap_err().code, "INVALID_ARGUMENT");
    }

    fn presets() -> Json {
        json!([
            {"name": "Fine liner", "color": "#1e1e1e", "width": 0.5, "opacity": 100, "pressure": false, "smoothing": 0.3, "highlighter": false},
            {"name": "Marker", "color": "#ffd43b", "width": 1.5, "opacity": 40, "pressure": true, "smoothing": 1, "highlighter": true}
        ])
    }

    #[test]
    fn pen_presets_round_trip_as_multiline_inline_tables() {
        let out = apply_changes(DEFAULT_CONFIG, &[change("pens.presets", presets())]).unwrap();
        assert_eq!(parse_config(&out).unwrap()["pens"]["presets"], presets());
        assert!(
            // (keys come out alphabetically: serde_json maps are sorted)
            out.contains("presets = [\n  { color = \"#1e1e1e\", highlighter = false, name = \"Fine liner\", opacity = 100, pressure = false, smoothing = 0.3, width = 0.5 },\n  { color = \"#ffd43b\""),
            "{out}"
        );
        assert!(out.contains("width = 1.5 },\n]\n"), "{out}");
        // A bare flat object is not a pen: it becomes a sub-table, `[pens.one]`.
        let out = apply_changes(DEFAULT_CONFIG, &[change("pens.one", presets()[0].clone())]).unwrap();
        assert_eq!(parse_config(&out).unwrap()["pens"]["one"], presets()[0]);
        assert!(out.contains("\n[pens.one]\n"), "{out}");
        // Arrays of scalars keep the single-line form.
        let out = apply_changes(DEFAULT_CONFIG, &[change("pens.tags", json!(["a", "b"]))]).unwrap();
        assert!(out.contains("tags = [\"a\", \"b\"]\n"), "{out}");
    }

    #[test]
    fn replacing_presets_keeps_surrounding_comments() {
        let text = "# top\n[pens]\n# my pens\npresets = [ { name = \"Old\" } ] # trailing\nother = 1\n\n# end\n";
        let out = apply_changes(text, &[change("pens.presets", presets())]).unwrap();
        assert!(out.starts_with("# top\n[pens]\n# my pens\npresets = [\n  { color = \"#1e1e1e\""), "{out}");
        assert!(out.contains("# trailing\nother = 1\n\n# end\n"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["pens"]["presets"], presets());
    }

    #[test]
    fn nested_values_in_presets_are_rejected() {
        for v in [json!([{"a": [1]}]), json!([{"a": {"b": 1}}]), json!({"a": {"b": 1}}), json!([[{"a": 1}]]), json!([{"a": null}])] {
            let e = apply_changes(DEFAULT_CONFIG, &[change("pens.presets", v.clone())]).unwrap_err();
            assert!(e.message.contains("Unsupported value"), "{v}: {}", e.message);
        }
    }

    #[test]
    fn removing_presets_restores_the_documented_example() {
        let set = apply_changes(DEFAULT_CONFIG, &[change("pens.presets", presets())]).unwrap();
        assert!(!set.contains("# presets = ["));
        let removed = apply_changes(&set, &[change("pens.presets", Json::Null)]).unwrap();
        assert!(parse_config(&removed).unwrap()["pens"].get("presets").is_none());
        assert_eq!(removed, DEFAULT_CONFIG);
    }

    fn arrow() -> Json {
        json!({"stroke_color": "#f08c00", "stroke_width": 3, "stroke_style": "dotted"})
    }

    #[test]
    fn tool_table_lands_after_the_documented_tools_block_and_removal_restores_it() {
        let out = apply_changes(DEFAULT_CONFIG, &[change("tools.arrow", arrow())]).unwrap();
        assert_eq!(parse_config(&out).unwrap()["tools"]["arrow"], arrow());
        // (keys come out alphabetically: serde_json maps are sorted)
        let tail = "# stroke_style = \"dotted\"\n\n[tools.arrow]\nstroke_color = \"#f08c00\"\nstroke_style = \"dotted\"\nstroke_width = 3\n";
        // The table lands right after the documented [tools] block (later tables such as [tabs] follow it).
        assert!(out.contains(&format!("{tail}\n[tabs]")), "{out}");
        assert!(out.contains("# Default style per drawing tool"), "{out}");
        // Replacing swaps the keys and keeps the header's comments.
        let src = "[tools]\n\n# my arrow\n[tools.arrow]\nstroke_width = 9\nfill_style = \"solid\"\n";
        let out2 = apply_changes(src, &[change("tools.arrow", arrow())]).unwrap();
        assert!(out2.contains("# my arrow\n[tools.arrow]\nstroke_color"), "{out2}");
        assert_eq!(parse_config(&out2).unwrap()["tools"]["arrow"], arrow());
        let out = apply_changes(&out, &[change("tools.arrow", json!({"stroke_width": 5}))]).unwrap();
        assert_eq!(parse_config(&out).unwrap()["tools"]["arrow"], json!({"stroke_width": 5}));
        let removed = apply_changes(&out, &[change("tools.arrow", Json::Null)]).unwrap();
        assert_eq!(removed, DEFAULT_CONFIG);
        assert_eq!(apply_changes(DEFAULT_CONFIG, &[change("tools.arrow", Json::Null)]).unwrap(), DEFAULT_CONFIG);
    }

    #[test]
    fn tool_table_on_empty_text_has_no_empty_parent_header_and_removal_drops_it() {
        let out = apply_changes("", &[change("tools.arrow", arrow())]).unwrap();
        assert_eq!(out, "[tools.arrow]\nstroke_color = \"#f08c00\"\nstroke_style = \"dotted\"\nstroke_width = 3\n");
        assert_eq!(apply_changes(&out, &[change("tools.arrow", Json::Null)]).unwrap(), "");
        // Two tools at once; removing one keeps the other.
        let two = apply_changes("", &[change("tools.arrow", arrow()), change("tools.line", json!({"stroke_width": 1}))]).unwrap();
        assert_eq!(parse_config(&two).unwrap()["tools"], json!({"arrow": arrow(), "line": {"stroke_width": 1}}));
        let one = apply_changes(&two, &[change("tools.arrow", Json::Null)]).unwrap();
        assert_eq!(parse_config(&one).unwrap(), json!({"tools": {"line": {"stroke_width": 1}}}));
    }

    #[test]
    fn plugin_settings_table_round_trips_in_config_and_vault_files() {
        // The app writes one change per plugin: the whole `[plugin.<id>]` table.
        let fields = json!({"color": "#fff3a3", "fontSize": 16, "on": true});
        let out = apply_changes(DEFAULT_CONFIG, &[change("plugin.sticky-notes", fields.clone())]).unwrap();
        assert!(out.contains("[plugin.sticky-notes]\n"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["plugin"]["sticky-notes"], fields);
        assert_eq!(apply_changes(&out, &[change("plugin.sticky-notes", Json::Null)]).unwrap(), DEFAULT_CONFIG);
        let vault =
            apply_toml_changes("", &[change("plugin.sticky-notes", json!({"on": false}))], "settings.toml", MAX_CONFIG_BYTES).unwrap();
        assert_eq!(vault, "[plugin.sticky-notes]\non = false\n");
        let cleared = apply_toml_changes(&vault, &[change("plugin.sticky-notes", Json::Null)], "settings.toml", MAX_CONFIG_BYTES);
        assert_eq!(cleared.unwrap(), "");
    }

    #[test]
    fn tool_table_keeps_a_hand_written_inline_or_dotted_form() {
        let inline = "[tools]\n# styles\narrow = { stroke_width = 1 } # mine\n";
        let out = apply_changes(inline, &[change("tools.arrow", arrow())]).unwrap();
        assert!(out.starts_with("[tools]\n# styles\narrow = { "), "{out}");
        assert!(out.ends_with(" } # mine\n"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["tools"]["arrow"], arrow());
        let removed = apply_changes(&out, &[change("tools.arrow", Json::Null)]).unwrap();
        assert!(!removed.contains("arrow"), "{removed}");

        let dotted = "[tools]\narrow.stroke_width = 1\n";
        let out = apply_changes(dotted, &[change("tools.arrow", arrow())]).unwrap();
        assert!(out.contains("arrow.stroke_color"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["tools"]["arrow"], arrow());
    }

    #[test]
    fn vault_settings_prune_the_emptied_tools_table() {
        let name = "settings.toml";
        let set = apply_toml_changes("# vault\n", &[change("tools.arrow", arrow())], name, 1 << 20).unwrap();
        assert!(!set.contains("[tools]"), "{set}");
        assert_eq!(apply_toml_changes(&set, &[change("tools.arrow", Json::Null)], name, 1 << 20).unwrap(), "# vault\n");
        // An explicit empty [tools] header is pruned too, and removing a missing table is a no-op.
        let out = apply_toml_changes("[tools]\n[tools.arrow]\nstroke_width = 2\n", &[change("tools.arrow", Json::Null)], name, 1 << 20).unwrap();
        assert_eq!(out, "");
        assert_eq!(apply_toml_changes("a = 1\n", &[change("tools.arrow", Json::Null)], name, 1 << 20).unwrap(), "a = 1\n");
        // An empty object is a real (empty) table: "no defaults for this tool in this vault".
        let empty = apply_toml_changes("", &[change("tools.arrow", json!({}))], name, 1 << 20).unwrap();
        assert_eq!(parse_config(&empty).unwrap()["tools"]["arrow"], json!({}), "{empty}");
        let refill = apply_toml_changes(&empty, &[change("tools.arrow", arrow())], name, 1 << 20).unwrap();
        assert_eq!(parse_config(&refill).unwrap()["tools"]["arrow"], arrow());
    }

    #[test]
    fn tool_table_rejects_nested_null_and_root_objects() {
        for v in [json!({"a": [1]}), json!({"a": {"b": 1}}), json!({"a": null})] {
            let e = apply_changes(DEFAULT_CONFIG, &[change("tools.arrow", v.clone())]).unwrap_err();
            assert!(e.message.contains("Unsupported value"), "{v}: {}", e.message);
        }
        assert_eq!(apply_changes("", &[change("tools", arrow())]).unwrap_err().code, "INVALID_ARGUMENT");
    }

    #[test]
    fn load_settings_returns_tool_tables_as_objects() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("tools.arrow", arrow())]).unwrap();
        assert_eq!(load_settings_in(&d).unwrap().config.unwrap()["tools"]["arrow"], arrow());
    }

    #[test]
    fn split_key_uses_the_first_dot_only() {
        assert_eq!(split_key("hotkeys.vault.newDrawing").unwrap(), (Some("hotkeys"), "vault.newDrawing"));
        assert_eq!(split_key("appearance.mode").unwrap(), (Some("appearance"), "mode"));
        assert_eq!(split_key("root").unwrap(), (None, "root"));
        assert_eq!(split_key("hotkeys.view.zoom-in_2").unwrap(), (Some("hotkeys"), "view.zoom-in_2"));
    }

    #[test]
    fn dynamic_per_drawing_hotkey_ids_round_trip() {
        let id = "hotkeys.drawing.open:Graphs/BFS and \"DFS\" #1.excalidraw";
        assert!(split_key(id).is_ok());
        assert!(split_key("hotkeys.bad\u{7}").is_err());
        assert!(split_key(&format!("hotkeys.{}", "a".repeat(1025))).is_err());
        assert!(split_key("saving.a/b").is_err());
        let out = apply_changes("[hotkeys]\n", &[change(id, json!(["Mod+1"]))]).unwrap();
        let v = parse_config(&out).unwrap();
        assert_eq!(v["hotkeys"]["drawing.open:Graphs/BFS and \"DFS\" #1.excalidraw"], json!(["Mod+1"]));
        let out = apply_changes(&out, &[change(id, Json::Null)]).unwrap();
        assert_eq!(out, "[hotkeys]\n");
    }

    #[test]
    fn dotted_hotkey_keys_round_trip_quoted_with_comments_preserved() {
        let src = "# top\n[hotkeys]\n# mine\n\"file.save\" = [\"Mod+S\"] # keep\n\n[saving]\nautosave_delay_ms = 500\n";
        let out = apply_changes(
            src,
            &[
                change("hotkeys.vault.newDrawing", json!(["Mod+N", "Mod+Alt+N"])),
                change("hotkeys.view.toggleNavigator", json!([])),
                change("hotkeys.file.save", json!(["Mod+Shift+S"])),
            ],
        )
        .unwrap();
        assert_eq!(
            out,
            "# top\n[hotkeys]\n# mine\n\"file.save\" = [\"Mod+Shift+S\"] # keep\n\"vault.newDrawing\" = [\"Mod+N\", \"Mod+Alt+N\"]\n\"view.toggleNavigator\" = []\n\n[saving]\nautosave_delay_ms = 500\n"
        );
        let v = parse_config(&out).unwrap();
        assert_eq!(v["hotkeys"]["vault.newDrawing"], json!(["Mod+N", "Mod+Alt+N"]));
        assert_eq!(v["hotkeys"]["view.toggleNavigator"], json!([]));
        assert_eq!(v["hotkeys"]["file.save"], json!(["Mod+Shift+S"]));
        // Removing restores the default (line deleted); other comments stay.
        let out = apply_changes(&out, &[change("hotkeys.vault.newDrawing", Json::Null), change("hotkeys.view.toggleNavigator", Json::Null)]).unwrap();
        assert_eq!(out, src.replace("[\"Mod+S\"]", "[\"Mod+Shift+S\"]"));
    }

    #[test]
    fn load_settings_returns_dotted_hotkeys_as_flat_keys() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", json!(["Mod+N"])), change("hotkeys.file.rename", json!([]))]).unwrap();
        let config = load_settings_in(&d).unwrap().config.unwrap();
        assert_eq!(config["hotkeys"]["vault.newDrawing"], json!(["Mod+N"]));
        assert_eq!(config["hotkeys"]["file.rename"], json!([]));
        let text = fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap();
        // The commented example is replaced by the real binding; its explanation stays above it.
        assert!(
            text.contains("[hotkeys]\n# Override a command's keys; [] removes them. Example:\n\"vault.newDrawing\" = [\"Mod+N\"]\n\"file.rename\" = []\n\n[links]\n"),
            "{text}"
        );
    }

    #[test]
    fn default_config_documents_upcoming_tables_without_values() {
        for section in ["[interface]\n# Whole-app zoom", "# zoom = 100", "[navigator]\n", "# sort = \"name_asc\"", "[files]\n", "# new_drawing_folder = \"\"", "# templates_folder = \"Templates\"", "[paper]\n# Paper for new drawings", "# style = \"plain\"", "# major_every = 0", "[page]\n# Page mode for new drawings", "# mode = \"normal\"", "# paper_theme = \"normal\"", "[pdf_import]\n# Import PDF pages", "# max_side = 1440", "# pixel_budget_mp = 60", "[hotkeys]\n", "# \"vault.newDrawing\" = [\"Mod+N\"]", "[watchdog]\n", "# grace_ms = 5000", "[window]\n", "# decorations = \"custom\""] {
            assert!(DEFAULT_CONFIG.contains(section), "{section}");
        }
        let v = parse_config(DEFAULT_CONFIG).unwrap();
        for table in ["paper", "page", "pdf_import", "interface", "navigator", "files", "hotkeys", "watchdog", "window"] {
            assert_eq!(v[table], json!({}), "{table}");
        }
    }

    #[test]
    fn new_keys_land_in_their_commented_tables() {
        let out = apply_changes(
            DEFAULT_CONFIG,
            &[change("interface.zoom", json!(125)), change("navigator.sort", json!("modified_desc")), change("files.new_drawing_folder", json!("Inbox")), change("paper.style", json!("grid"))],
        )
        .unwrap();
        assert!(out.contains("[paper]\n# Paper for new drawings (each drawing can change it from the canvas menu)\n# plain | grid | lines | dots | graph | isometric\nstyle = \"grid\"\n"), "{out}");
        assert!(
            out.contains("[interface]\n# Whole-app zoom in percent (Cmd+Shift +/-/0)\nzoom = 125\n# Show a drawing's tags as chips in the file navigator\n"),
            "{out}"
        );
        assert!(
            out.contains("# activity_bar_hidden = []\n\n[navigator]\n# name_asc | name_desc | modified_desc | modified_asc\nsort = \"modified_desc\"\n\n[files]\n# Ask before moving a drawing to the Trash\n# confirm_delete = true\n# Folder for new drawings, relative to the vault root (empty = next to the open drawing)\nnew_drawing_folder = \"Inbox\"\n# Vault folder holding your templates, relative to the vault root (empty falls back to \"Templates\")\n# templates_folder = \"Templates\"\n# When every vault folder is listed (recent drawings, file switcher, link suggestions): open | idle | use\n# list_start = \"idle\"\n# Read and parse a drawing when you press on it (tree, tab, switcher), before the click, so it opens sooner\n# speculative_open = true\n\n[hotkeys]\n"),
            "{out}"
        );
        assert_eq!(out.matches("[interface]").count(), 1);
        let v = parse_config(&out).unwrap();
        assert_eq!(v["interface"]["zoom"], 125);
        assert_eq!(v["navigator"]["sort"], "modified_desc");
        // Everything before the new tables is untouched.
        let head = &DEFAULT_CONFIG[..DEFAULT_CONFIG.find("[paper]").unwrap()];
        assert!(out.starts_with(head));
        // A key that isn't documented by a comment is simply appended to its table.
        let out = apply_changes(DEFAULT_CONFIG, &[change("interface.show_hints", json!(false))]).unwrap();
        assert!(out.contains("[interface]\nshow_hints = false\n# Whole-app zoom"), "{out}");
        assert_eq!(parse_config(&out).unwrap()["interface"]["show_hints"], false);
    }

    /// Every setting documented in DEFAULT_CONFIG: `(table, key, default, line, commented)`.
    /// Uncommented keys come from the parsed default; commented examples (`# key = value`)
    /// from the text, under the `[table]` they appear in.
    fn default_settings() -> Vec<(String, String, Json, String, bool)> {
        let parsed = parse_config(DEFAULT_CONFIG).unwrap();
        let mut table = String::new();
        let mut found = Vec::new();
        for line in DEFAULT_CONFIG.lines() {
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                table = name.to_string();
                continue;
            }
            let (body, commented) = match line.strip_prefix("# ") {
                Some(rest) => (rest, true),
                None => (line, false),
            };
            // [tools] documents a sub-table example, not settings of its own.
            if table.is_empty() || table == "tools" || body.is_empty() {
                continue;
            }
            let Ok(Json::Object(kv)) = parse_config(body) else { continue };
            let (key, value) = kv.into_iter().next().unwrap();
            // A table value (`# importers = {}`) is written as its own `[table.key]`
            // section, never on the example line, so it has no line to round-trip.
            if value.is_object() {
                continue;
            }
            found.push((table.clone(), key, value, line.to_string(), commented));
        }
        // The text scan sees exactly the parsed default's values.
        let mut uncommented: Vec<_> = found.iter().filter(|f| !f.4).map(|f| (f.0.clone(), f.1.clone(), f.2.clone())).collect();
        let mut expected = Vec::new();
        for (t, keys) in parsed.as_object().unwrap() {
            for (k, v) in keys.as_object().unwrap() {
                expected.push((t.clone(), k.clone(), v.clone()));
            }
        }
        uncommented.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        expected.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        assert_eq!(uncommented, expected);
        found
    }
    fn other_value(v: &Json) -> Json {
        match v {
            Json::String(s) => json!(format!("{s}x")),
            Json::Number(n) => n.as_i64().map_or_else(|| json!(n.as_f64().unwrap() - 0.05), |i| json!(i + 1)),
            Json::Bool(b) => json!(!b),
            Json::Array(_) => json!(["Mod+Shift+X"]),
            other => panic!("unexpected default {other}"),
        }
    }
    /// The text of `[table]`: from its header to the next top-level table header.
    fn table_section<'a>(text: &'a str, table: &str) -> &'a str {
        let header = format!("[{table}]\n");
        let start = text.find(&header).unwrap_or_else(|| panic!("no [{table}]")) + header.len();
        let rest = &text[start..];
        let end = rest.match_indices("\n[").map(|(i, _)| i).find(|&i| !rest[i + 1..].starts_with("[tools.")).unwrap_or(rest.len());
        &rest[..end]
    }
    fn comment_lines(text: &str) -> Vec<&str> {
        text.lines().filter(|l| l.trim_start().starts_with('#')).collect()
    }

    #[test]
    fn set_then_remove_keeps_every_comment_of_the_default_config() {
        let settings = default_settings();
        assert_eq!(settings.iter().filter(|s| s.4).count(), 120, "{settings:?}");
        for (table, key, default, line, commented) in settings {
            let k = format!("{table}.{key}");
            let set = apply_changes(DEFAULT_CONFIG, &[change(&k, other_value(&default))]).unwrap();
            assert_eq!(parse_config(&set).unwrap()[&table][&key], other_value(&default), "{k}");
            let removed = apply_changes(&set, &[change(&k, Json::Null)]).unwrap();
            assert!(parse_config(&removed).unwrap()[&table].get(&key).is_none(), "{k}");
            if commented {
                // The example line was replaced by the value and comes back on removal.
                // Several tables may share an example line (`# enabled = true`), so look in
                // the key's own table only.
                assert!(table_section(&DEFAULT_CONFIG, &table).lines().any(|l| l == line), "{k}");
                assert!(!table_section(&set, &table).lines().any(|l| l == line), "{k}");
                assert_eq!(removed, DEFAULT_CONFIG, "{k}");
                // And the cycle repeats.
                let again = apply_changes(&removed, &[change(&k, other_value(&default))]).unwrap();
                assert_eq!(again, set, "{k}");
            } else {
                // The key's line is gone; its comments stay where they were.
                assert_eq!(removed, DEFAULT_CONFIG.replacen(&format!("{line}\n"), "", 1), "{k}");
                assert_eq!(comment_lines(&removed), comment_lines(DEFAULT_CONFIG), "{k}");
            }
        }
    }

    #[test]
    fn hotkey_set_and_remove_round_trips_the_default_config() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        load_settings_in(&d).unwrap();
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", json!(["Mod+N"]))]).unwrap();
        let path = d.config.join(CONFIG_FILE);
        assert_ne!(fs::read_to_string(&path).unwrap(), DEFAULT_CONFIG);
        update_config_in(&d, &[change("hotkeys.vault.newDrawing", Json::Null)]).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), DEFAULT_CONFIG);

        // Several keys at once, removed in a different order.
        let set = apply_changes(
            DEFAULT_CONFIG,
            &[change("hotkeys.vault.newDrawing", json!(["Mod+N"])), change("hotkeys.file.save", json!([])), change("interface.zoom", json!(90))],
        )
        .unwrap();
        let out = apply_changes(
            &set,
            &[change("hotkeys.file.save", Json::Null), change("interface.zoom", Json::Null), change("hotkeys.vault.newDrawing", Json::Null)],
        )
        .unwrap();
        assert_eq!(out, DEFAULT_CONFIG);
        let out = apply_changes(
            &set,
            &[change("hotkeys.vault.newDrawing", Json::Null), change("hotkeys.file.save", Json::Null), change("interface.zoom", Json::Null)],
        )
        .unwrap();
        assert_eq!(out, DEFAULT_CONFIG);
    }

    #[test]
    fn removal_moves_comments_to_the_next_key_or_the_gap_after_the_table() {
        let src = "top = 1\n# about a\na = 1\n\n[t]\n# about x\nx = 1 # inline\n# about y\ny = 2\n# tail\n";
        let out = apply_changes(src, &[change("t.x", Json::Null)]).unwrap();
        assert_eq!(out, "top = 1\n# about a\na = 1\n\n[t]\n# about x\n# about y\ny = 2\n# tail\n");
        let out = apply_changes(&out, &[change("t.y", Json::Null), change("a", Json::Null)]).unwrap();
        assert_eq!(out, "top = 1\n# about a\n\n[t]\n# about x\n# about y\n# tail\n");
        // Without a matching comment block, no example line is invented.
        let out = apply_changes("[interface]\nzoom = 120\n", &[change("interface.zoom", Json::Null)]).unwrap();
        assert_eq!(out, "[interface]\n");
    }

    #[test]
    fn commented_assignment_matching() {
        assert!(is_commented_assignment("# zoom = 1.0\n", "zoom"));
        assert!(is_commented_assignment("  #zoom=1", "zoom"));
        assert!(is_commented_assignment("# \"vault.newDrawing\" = [\"Mod+N\"]\n", "vault.newDrawing"));
        assert!(!is_commented_assignment("# zoomed = 1", "zoom"));
        assert!(!is_commented_assignment("# Whole-app zoom in percent (Cmd+Shift +/-/0)", "zoom"));
        assert!(!is_commented_assignment("zoom = 1", "zoom"));
        assert!(!is_commented_assignment("# vault.newDrawing = []", "vault.newDrawing"));
    }

    #[test]
    fn invalid_config_is_refused_and_left_untouched() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        let broken = "# mine\n[appearance\nmode = \"dark\"\n";
        fs::write(d.config.join(CONFIG_FILE), broken).unwrap();
        let e = update_config_in(&d, &[change("appearance.mode", json!("light"))]).unwrap_err();
        assert_eq!(e.code, "CONFIG_INVALID");
        assert_eq!(fs::read_to_string(d.config.join(CONFIG_FILE)).unwrap(), broken);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_config_is_refused() {
        use std::os::unix::fs::symlink;
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        let target = t.path().join("elsewhere.toml");
        fs::write(&target, "x = 1\n").unwrap();
        symlink(&target, d.config.join(CONFIG_FILE)).unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert!(loaded.config_error.is_some());
        assert_eq!(update_config_in(&d, &[change("x", json!(2))]).unwrap_err().code, "INVALID_PATH");
        assert_eq!(fs::read_to_string(target).unwrap(), "x = 1\n");
    }

    #[test]
    fn oversized_config_is_reported() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        fs::create_dir_all(&d.config).unwrap();
        fs::write(d.config.join(CONFIG_FILE), vec![b'#'; MAX_CONFIG_BYTES as usize + 1]).unwrap();
        let loaded = load_settings_in(&d).unwrap();
        assert!(loaded.config.is_none());
        assert_eq!(loaded.config_error.unwrap().line, None);
    }

    #[test]
    fn state_roundtrips_and_bad_state_reads_as_empty() {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path());
        let state = json!({"recentVaults": ["/a"], "lastVaultPath": null, "navigatorCollapsed": false, "navigatorWidth": 280, "expandedFolders": {"x": true}});
        write_state_in(&d, &state).unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, state);
        assert_eq!(write_state_in(&d, &json!([1])).unwrap_err().code, "INVALID_ARGUMENT");
        let big = json!({"x": "y".repeat(MAX_STATE_BYTES as usize)});
        assert_eq!(write_state_in(&d, &big).unwrap_err().code, "INVALID_FILE");
        fs::write(d.state.join(STATE_FILE), "{nope").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, json!({}));
        fs::write(d.state.join(STATE_FILE), "[1]").unwrap();
        assert_eq!(load_settings_in(&d).unwrap().state, json!({}));
    }

    #[test]
    fn resolves_overrides_xdg_home_windows_and_smoke() {
        let o = resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "/o/c"), ("VAULTDRAW_STATE_DIR", "/o/s"), ("HOME", "/h")]), false, Some(Path::new("/tmp/vs"))).unwrap();
        assert_eq!(o, Dirs { config: "/o/c".into(), state: "/o/s".into() });

        let x = resolve_dirs_with(env(&[("XDG_CONFIG_HOME", "/x/c"), ("XDG_STATE_HOME", "/x/s"), ("HOME", "/h")]), false, None).unwrap();
        assert_eq!(x, Dirs { config: "/x/c/vaultdraw".into(), state: "/x/s/vaultdraw".into() });

        let h = resolve_dirs_with(env(&[("XDG_CONFIG_HOME", ""), ("XDG_STATE_HOME", "relative"), ("HOME", "/h")]), false, None).unwrap();
        assert_eq!(h, Dirs { config: "/h/.config/vaultdraw".into(), state: "/h/.local/state/vaultdraw".into() });

        let s = resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "/o/c"), ("HOME", "/h")]), false, Some(Path::new("/tmp/vs"))).unwrap();
        assert_eq!(s, Dirs { config: "/o/c".into(), state: "/tmp/vs/state".into() });

        assert_eq!(resolve_dirs_with(env(&[("VAULTDRAW_CONFIG_DIR", "rel")]), false, None).unwrap_err().code, "CONFIG_DIR");
        assert_eq!(resolve_dirs_with(env(&[]), false, None).unwrap_err().code, "CONFIG_DIR");

        #[cfg(windows)]
        {
            let w = resolve_dirs_with(env(&[("APPDATA", r"C:\R"), ("LOCALAPPDATA", r"C:\L")]), true, None).unwrap();
            assert_eq!(w, Dirs { config: PathBuf::from(r"C:\R").join("Vaultdraw"), state: PathBuf::from(r"C:\L").join("Vaultdraw") });
        }
        #[cfg(not(windows))]
        {
            let w = resolve_dirs_with(env(&[("APPDATA", "/r"), ("LOCALAPPDATA", "/l"), ("XDG_CONFIG_HOME", "/x")]), true, None).unwrap();
            assert_eq!(w, Dirs { config: "/r/Vaultdraw".into(), state: "/l/Vaultdraw".into() });
        }
    }

    #[test]
    fn labels_write_a_quoted_key_into_keys_labels() {
        let out = apply_changes("", &[change("keys.labels.<leader> f f", json!("find file"))]).unwrap();
        assert_eq!(out, "[keys.labels]\n\"<leader> f f\" = \"find file\"\n");
        assert_eq!(parse_config(&out).unwrap()["keys"]["labels"]["<leader> f f"], json!("find file"));
        // Removing the only label drops the table again (and the implicit [keys]).
        assert_eq!(apply_changes(&out, &[change("keys.labels.<leader> f f", Json::Null)]).unwrap(), "");
    }

    #[test]
    fn labels_keep_comments_and_sit_beside_scalar_keys() {
        let src = "# top\n[keys]\nleader = \"Space\" # mine\n\n[keys.labels]\n# files\n\"<leader> f\" = \"file\" # keep\n\"g g\" = \"top\"\n\n[saving]\nautosave_delay_ms = 500\n";
        let out = apply_changes(
            src,
            &[
                change("keys.labels.<leader> f", json!("files")),
                change("keys.labels.<leader> b", json!("buffers")),
                change("keys.timeout_ms", json!(800)),
            ],
        )
        .unwrap();
        assert_eq!(
            out,
            "# top\n[keys]\nleader = \"Space\" # mine\ntimeout_ms = 800\n\n[keys.labels]\n# files\n\"<leader> f\" = \"files\" # keep\n\"g g\" = \"top\"\n\"<leader> b\" = \"buffers\"\n\n[saving]\nautosave_delay_ms = 500\n"
        );
        // Removing the commented entry hands its comment to the next one.
        let out = apply_changes(&out, &[change("keys.labels.<leader> f", Json::Null)]).unwrap();
        assert!(out.contains("[keys.labels]\n# files\n\"g g\" = \"top\"\n"), "{out}");
        // Removing a label that is not there changes nothing.
        assert_eq!(apply_changes(&out, &[change("keys.labels.nope", Json::Null)]).unwrap(), out);
    }

    #[test]
    fn labels_create_the_table_below_an_existing_keys_table() {
        let out = apply_changes("[keys]\nleader = \"Space\"\n", &[change("keys.labels.g g", json!("top"))]).unwrap();
        assert_eq!(out, "[keys]\nleader = \"Space\"\n\n[keys.labels]\n\"g g\" = \"top\"\n");
        let v = parse_config(&out).unwrap();
        assert_eq!(v["keys"]["leader"], json!("Space"));
        // [keys] itself stays when it holds other keys.
        assert_eq!(apply_changes(&out, &[change("keys.labels.g g", Json::Null)]).unwrap(), "[keys]\nleader = \"Space\"\n");
    }

    #[test]
    fn labels_reject_bad_input_and_a_non_table_without_partial_writes() {
        for (key, v) in [
            ("keys.labels.", json!("x")),
            ("keys.labels.g g", json!("")),
            ("keys.labels.g g", json!(3)),
            ("keys.labels.g g", json!(["a"])),
            ("keys.labels.g\u{7}", json!("x")),
        ] {
            let e = apply_changes("", &[change("keys.timeout_ms", json!(5)), change(key, v.clone())]).unwrap_err();
            assert_eq!(e.code, "INVALID_ARGUMENT", "{key} {v}");
        }
        let e = apply_changes("keys = 1\n", &[change("keys.labels.g g", json!("x"))]).unwrap_err();
        assert!(e.message.contains("not a table"), "{}", e.message);
        let e = apply_changes("[keys]\nlabels = 1\n", &[change("keys.labels.g g", json!("x"))]).unwrap_err();
        assert!(e.message.contains("keys.labels"), "{}", e.message);
    }

    #[test]
    fn labels_write_into_an_inline_table_and_vault_settings() {
        let out = apply_changes("[keys]\nlabels = { \"g g\" = \"top\" }\n", &[change("keys.labels.g h", json!("home"))]).unwrap();
        let v = parse_config(&out).unwrap();
        assert_eq!(v["keys"]["labels"], json!({"g g": "top", "g h": "home"}));
        let dotted = apply_changes("", &[change("keys.labels.<leader> .", json!("dot"))]).unwrap();
        assert_eq!(parse_config(&dotted).unwrap()["keys"]["labels"]["<leader> ."], json!("dot"));
        let vault = apply_toml_changes("", &[change("keys.labels.<leader> f", json!("file"))], "settings.toml", MAX_CONFIG_BYTES).unwrap();
        assert_eq!(vault, "[keys.labels]\n\"<leader> f\" = \"file\"\n");
    }
}
