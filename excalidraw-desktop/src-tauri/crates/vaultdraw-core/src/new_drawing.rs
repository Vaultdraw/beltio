//! The first scene of a new drawing: the user's `[paper]` and `[page]` defaults.
//!
//! The app builds the same state in TypeScript (`src/vault/newDrawingPaper.ts`); the CLI
//! (`vaultdraw new` with the app closed) uses this module. The two must agree: the shared
//! golden file `tests/fixtures/new-drawing-parity.json` is checked by a cargo test here and
//! by a vitest in the app, so either side drifting fails a test.
//!
//! Inputs are read like the app reads them: `config.toml` (a missing or invalid value falls
//! back to its default, field by field) and the vault's `settings.toml` (only `paper.style`
//! can differ per vault). Output is the three appState fields the defaults decide.

use crate::config::{parse_config, read_toml_text};
use crate::paths::META_DIR;
use serde_json::{json, Map, Value as Json};
use std::path::Path;

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_VAULT_SETTINGS_BYTES: u64 = 256 * 1024;

/// Pattern presets: (type, spacing, major_every, margin_line).
const PATTERNS: [(&str, f64, f64, bool); 5] = [
    ("grid", 20.0, 5.0, false),
    ("lines", 32.0, 1.0, true),
    ("dots", 20.0, 1.0, false),
    ("graph", 16.0, 5.0, false),
    ("isometric", 24.0, 1.0, false),
];

/// Page size presets: (id, portrait width, portrait height) in scene px at 96 dpi.
fn preset_size(id: &str) -> Option<(f64, f64)> {
    let mm = |w: f64, h: f64| ((w * 96.0 / 25.4).round(), (h * 96.0 / 25.4).round());
    Some(match id {
        "a3" => mm(297.0, 420.0),
        "a4" => mm(210.0, 297.0),
        "a5" => mm(148.0, 210.0),
        "b5" => mm(176.0, 250.0),
        "letter" => mm(215.9, 279.4),
        "legal" => mm(215.9, 355.6),
        "tablet" => (834.0, 1194.0),
        "tabletLarge" => (1032.0, 1376.0),
        "phone" => (393.0, 852.0),
        _ => return None,
    })
}

/// The setup's fallback side for an unset custom size: A4 portrait, like the app.
const A4_PX: (f64, f64) = (794.0, 1123.0);

/// The preferences the new-drawing state depends on (config keys, validated like the app).
#[derive(Debug, Clone, PartialEq)]
struct Prefs {
    canvas_background: String,
    paper_style: String,
    paper_spacing: f64,
    paper_color: String,
    paper_opacity: f64,
    paper_major_every: f64,
    paper_margin_line: bool,
    page_mode: String,
    page_layout: String,
    page_size: String,
    page_orientation: String,
    page_width: f64,
    page_height: f64,
    page_paper_theme: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            canvas_background: "#ffffff".into(),
            paper_style: "plain".into(),
            paper_spacing: 0.0,
            paper_color: String::new(),
            paper_opacity: 1.0,
            paper_major_every: 0.0,
            paper_margin_line: true,
            page_mode: "normal".into(),
            page_layout: "separate".into(),
            page_size: "a4".into(),
            page_orientation: "portrait".into(),
            page_width: 0.0,
            page_height: 0.0,
            page_paper_theme: "normal".into(),
        }
    }
}

fn dotted<'a>(config: &'a Json, table: &str, key: &str) -> Option<&'a Json> {
    config.get(table)?.get(key)
}

fn in_range(v: f64, min: f64, max: f64) -> bool {
    v.is_finite() && v >= min && v <= max
}

fn is_integer(v: f64) -> bool {
    v.is_finite() && v.fract() == 0.0
}

/// `/^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|[a-z]+)$/i` (the app's colour test).
fn is_color(s: &str) -> bool {
    match s.strip_prefix('#') {
        Some(hex) => matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit()),
        None => !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphabetic()),
    }
}

fn is_hex6(s: &str) -> bool {
    s.len() == 7 && is_color(s) && s.starts_with('#')
}

fn is_paper_style(s: &str) -> bool {
    s == "plain" || PATTERNS.iter().any(|p| p.0 == s)
}

fn is_page_size(s: &str) -> bool {
    s == "custom" || preset_size(s).is_some()
}

impl Prefs {
    fn from_config(config: &Json) -> Prefs {
        let mut p = Prefs::default();
        let text = |t: &str, k: &str, ok: &dyn Fn(&str) -> bool| -> Option<String> {
            dotted(config, t, k).and_then(Json::as_str).filter(|s| ok(s)).map(str::to_string)
        };
        let num = |t: &str, k: &str, ok: &dyn Fn(f64) -> bool| -> Option<f64> {
            dotted(config, t, k).and_then(Json::as_f64).filter(|n| ok(*n))
        };
        if let Some(v) = text("appearance", "canvas_background", &is_color) {
            p.canvas_background = v;
        }
        if let Some(v) = text("paper", "style", &is_paper_style) {
            p.paper_style = v;
        }
        if let Some(v) = num("paper", "spacing", &|n| n == 0.0 || in_range(n, 5.0, 200.0)) {
            p.paper_spacing = v;
        }
        if let Some(v) = text("paper", "color", &|s| s.is_empty() || is_hex6(s)) {
            p.paper_color = v;
        }
        if let Some(v) = num("paper", "opacity", &|n| in_range(n, 0.1, 1.0)) {
            p.paper_opacity = v;
        }
        if let Some(v) = num("paper", "major_every", &|n| n == 0.0 || (is_integer(n) && in_range(n, 1.0, 20.0))) {
            p.paper_major_every = v;
        }
        if let Some(v) = dotted(config, "paper", "margin_line").and_then(Json::as_bool) {
            p.paper_margin_line = v;
        }
        if let Some(v) = text("page", "mode", &|s| s == "normal" || s == "page") {
            p.page_mode = v;
        }
        if let Some(v) = text("page", "layout", &|s| s == "continuous" || s == "separate") {
            p.page_layout = v;
        }
        if let Some(v) = text("page", "size", &is_page_size) {
            p.page_size = v;
        }
        if let Some(v) = text("page", "orientation", &|s| s == "portrait" || s == "landscape") {
            p.page_orientation = v;
        }
        let side = |n: f64| n == 0.0 || (is_integer(n) && in_range(n, 100.0, 5000.0));
        if let Some(v) = num("page", "width", &side) {
            p.page_width = v;
        }
        if let Some(v) = num("page", "height", &side) {
            p.page_height = v;
        }
        if let Some(v) = text("page", "paper_theme", &|s| matches!(s, "normal" | "old_school" | "match")) {
            p.page_paper_theme = v;
        }
        p
    }
}

/// A whole number prints as an integer (like `JSON.stringify` of a JS number).
fn num(n: f64) -> Json {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        Json::from(n as i64)
    } else {
        json!(n)
    }
}

/// A pattern like the app's `createBackgroundPattern(type, overrides)` after validation.
fn pattern(style: &str, spacing: f64, major_every: f64, color: &str, opacity: f64, margin_line: bool) -> Option<Map<String, Json>> {
    let &(ty, p_spacing, p_major, _) = PATTERNS.iter().find(|p| p.0 == style)?;
    let spacing = if spacing > 0.0 { spacing } else { p_spacing };
    let major = if major_every > 0.0 { major_every } else { p_major };
    let mut m = Map::new();
    m.insert("type".into(), json!(ty));
    m.insert("spacing".into(), num(spacing.clamp(5.0, 200.0)));
    m.insert("color".into(), if color.is_empty() { Json::Null } else { json!(color.to_ascii_lowercase()) });
    m.insert("opacity".into(), num(opacity.clamp(0.1, 1.0)));
    m.insert("majorEvery".into(), num(major.clamp(1.0, 20.0).round()));
    m.insert("marginLine".into(), json!(margin_line));
    Some(m)
}

/// The page setup of a new drawing, or `None` when the default mode is Normal.
fn page_setup(p: &Prefs) -> Option<Map<String, Json>> {
    if p.page_mode != "page" {
        return None;
    }
    let landscape = p.page_orientation == "landscape";
    let (width, height) = if p.page_size == "custom" {
        let side = |v: f64, fallback: f64| (if v > 0.0 { v } else { fallback }).clamp(100.0, 5000.0).round();
        (side(p.page_width, A4_PX.0), side(p.page_height, A4_PX.1))
    } else {
        let (w, h) = preset_size(&p.page_size)?;
        if landscape { (h, w) } else { (w, h) }
    };
    let theme = match p.page_paper_theme.as_str() {
        "old_school" => "oldSchool",
        other => other,
    };
    let mut m = Map::new();
    m.insert("enabled".into(), json!(true));
    m.insert("layout".into(), json!(p.page_layout));
    m.insert("size".into(), json!(p.page_size));
    m.insert("orientation".into(), json!(p.page_orientation));
    m.insert("width".into(), num(width));
    m.insert("height".into(), num(height));
    m.insert("pageCount".into(), json!(1));
    m.insert("paperTheme".into(), json!(theme));
    Some(m)
}

/// The appState fields the defaults decide: `viewBackgroundColor`, `viewBackgroundPattern`
/// and `pageSetup`. `config` is the parsed `config.toml`, `vault` the parsed vault
/// `settings.toml` (both as JSON objects; `Null` for none).
pub fn new_drawing_state(config: &Json, vault: &Json) -> Json {
    let prefs = Prefs::from_config(config);
    // A vault's own paper style wins; a style that differs from the global one starts from
    // its preset spacing and major lines.
    let vault_style = dotted(vault, "paper", "style").and_then(Json::as_str).filter(|s| is_paper_style(s));
    let (style, spacing, major) = match vault_style {
        Some(s) if s != prefs.paper_style => (s.to_string(), 0.0, 0.0),
        _ => (prefs.paper_style.clone(), prefs.paper_spacing, prefs.paper_major_every),
    };
    let mut background = prefs.canvas_background.clone();
    let mut pat = pattern(&style, spacing, major, &prefs.paper_color, prefs.paper_opacity, prefs.paper_margin_line);
    let setup = page_setup(&prefs);
    if let Some(s) = &setup {
        // The paper theme stamps the page colours (page fill, pattern colour); old school
        // is ruled paper, so a plain drawing gets ruled lines.
        let old_school = s["paperTheme"] == "oldSchool";
        let (fill, color) = if old_school { ("#f8efd4", Some("#8fb1d9")) } else { ("#ffffff", None) };
        background = fill.to_string();
        if pat.is_none() && old_school {
            pat = pattern("lines", 0.0, 0.0, "", 1.0, true);
        }
        if let Some(p) = pat.as_mut() {
            p.insert("color".into(), color.map_or(Json::Null, |c| json!(c)));
        }
    }
    json!({
        "viewBackgroundColor": background,
        "viewBackgroundPattern": pat.map_or(Json::Null, Json::Object),
        "pageSetup": setup.map_or(Json::Null, Json::Object),
    })
}

/// A blank scene with the user's defaults: reads `<config_dir>/config.toml` and
/// `<vault>/.excalidraw-vault/settings.toml`. A missing, unreadable or invalid file counts as
/// empty (the app shows such problems; a new drawing must not fail on them).
pub fn blank_scene(config_dir: &Path, vault_root: &Path) -> Json {
    let read = |path: &Path, name: &str, max: u64| -> Json {
        read_toml_text(path, name, max).ok().and_then(|t| parse_config(&t).ok()).unwrap_or(Json::Null)
    };
    let config = read(&config_dir.join("config.toml"), "config.toml", MAX_CONFIG_BYTES);
    let vault = read(&vault_root.join(META_DIR).join("settings.toml"), "settings.toml", MAX_VAULT_SETTINGS_BYTES);
    json!({
        "type": "excalidraw",
        "version": 2,
        "source": "vaultdraw-cli",
        "elements": [],
        "appState": new_drawing_state(&config, &vault),
        "files": {},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(config: &str, vault: &str) -> Json {
        let parse = |t: &str| parse_config(t).unwrap();
        new_drawing_state(&parse(config), &parse(vault))
    }

    #[test]
    fn empty_config_is_plain_white_on_the_infinite_canvas() {
        assert_eq!(state("", ""), json!({"viewBackgroundColor": "#ffffff", "viewBackgroundPattern": null, "pageSetup": null}));
    }

    #[test]
    fn canvas_background_is_used() {
        assert_eq!(state("[appearance]\ncanvas_background = \"#121212\"", "")["viewBackgroundColor"], "#121212");
        assert_eq!(state("[appearance]\ncanvas_background = \"not a colour\"", "")["viewBackgroundColor"], "#ffffff");
    }

    #[test]
    fn paper_style_gets_its_preset() {
        let p = &state("[paper]\nstyle = \"lines\"", "")["viewBackgroundPattern"];
        assert_eq!(*p, json!({"type": "lines", "spacing": 32, "color": null, "opacity": 1, "majorEvery": 1, "marginLine": true}));
        let p = &state("[paper]\nstyle = \"grid\"", "")["viewBackgroundPattern"];
        assert_eq!(p["spacing"], 20);
        assert_eq!(p["majorEvery"], 5);
    }

    #[test]
    fn paper_spacing_color_opacity_major_every_and_margin_line_apply() {
        let p = &state("[paper]\nstyle = \"graph\"\nspacing = 24\ncolor = \"#AABBCC\"\nopacity = 0.4\nmajor_every = 10\nmargin_line = false", "")["viewBackgroundPattern"];
        assert_eq!(*p, json!({"type": "graph", "spacing": 24, "color": "#aabbcc", "opacity": 0.4, "majorEvery": 10, "marginLine": false}));
    }

    #[test]
    fn invalid_paper_values_fall_back_one_by_one() {
        let p = &state("[paper]\nstyle = \"dots\"\nspacing = 3\ncolor = \"red\"\nopacity = 5\nmajor_every = 2.5", "")["viewBackgroundPattern"];
        assert_eq!(*p, json!({"type": "dots", "spacing": 20, "color": null, "opacity": 1, "majorEvery": 1, "marginLine": true}));
        assert_eq!(state("[paper]\nstyle = \"wavy\"", "")["viewBackgroundPattern"], Json::Null);
    }

    #[test]
    fn a_vault_style_overrides_and_resets_spacing_and_major_lines() {
        let s = state("[paper]\nstyle = \"grid\"\nspacing = 40\nmajor_every = 8", "[paper]\nstyle = \"dots\"");
        assert_eq!(s["viewBackgroundPattern"]["type"], "dots");
        assert_eq!(s["viewBackgroundPattern"]["spacing"], 20);
        let same = state("[paper]\nstyle = \"grid\"\nspacing = 40\nmajor_every = 8", "[paper]\nstyle = \"grid\"");
        assert_eq!(same["viewBackgroundPattern"]["spacing"], 40);
        assert_eq!(same["viewBackgroundPattern"]["majorEvery"], 8);
        assert_eq!(state("", "[paper]\nstyle = \"plain\"")["viewBackgroundPattern"], Json::Null);
        assert_eq!(state("[paper]\nstyle = \"grid\"", "[paper]\nstyle = \"plain\"")["viewBackgroundPattern"], Json::Null);
        assert_eq!(state("[paper]\nstyle = \"grid\"", "[paper]\nstyle = \"bogus\"")["viewBackgroundPattern"]["type"], "grid");
    }

    #[test]
    fn normal_page_mode_has_no_setup() {
        assert_eq!(state("[page]\nmode = \"normal\"\nsize = \"a3\"", "")["pageSetup"], Json::Null);
    }

    #[test]
    fn page_mode_stamps_a_setup() {
        let s = state("[page]\nmode = \"page\"", "");
        assert_eq!(
            s["pageSetup"],
            json!({"enabled": true, "layout": "separate", "size": "a4", "orientation": "portrait", "width": 794, "height": 1123, "pageCount": 1, "paperTheme": "normal"})
        );
        assert_eq!(s["viewBackgroundColor"], "#ffffff");
    }

    #[test]
    fn page_sizes_orientation_and_layout() {
        let s = state("[page]\nmode = \"page\"\nsize = \"letter\"\norientation = \"landscape\"\nlayout = \"continuous\"", "")["pageSetup"].clone();
        assert_eq!((s["width"].clone(), s["height"].clone()), (json!(1056), json!(816)));
        assert_eq!(s["layout"], "continuous");
        let s = state("[page]\nmode = \"page\"\nsize = \"phone\"", "")["pageSetup"].clone();
        assert_eq!((s["width"].clone(), s["height"].clone()), (json!(393), json!(852)));
    }

    #[test]
    fn custom_page_size_uses_width_and_height_or_a4_for_unset_sides() {
        let s = state("[page]\nmode = \"page\"\nsize = \"custom\"\nwidth = 600\nheight = 900", "")["pageSetup"].clone();
        assert_eq!((s["width"].clone(), s["height"].clone()), (json!(600), json!(900)));
        let s = state("[page]\nmode = \"page\"\nsize = \"custom\"\nwidth = 600", "")["pageSetup"].clone();
        assert_eq!((s["width"].clone(), s["height"].clone()), (json!(600), json!(1123)));
        let s = state("[page]\nmode = \"page\"\nsize = \"custom\"\nwidth = 50", "")["pageSetup"].clone();
        assert_eq!(s["width"], 794);
    }

    #[test]
    fn old_school_paper_stamps_cream_and_ruled_blue_lines() {
        let s = state("[page]\nmode = \"page\"\npaper_theme = \"old_school\"", "");
        assert_eq!(s["pageSetup"]["paperTheme"], "oldSchool");
        assert_eq!(s["viewBackgroundColor"], "#f8efd4");
        assert_eq!(
            s["viewBackgroundPattern"],
            json!({"type": "lines", "spacing": 32, "color": "#8fb1d9", "opacity": 1, "majorEvery": 1, "marginLine": true})
        );
    }

    #[test]
    fn old_school_keeps_an_existing_pattern_type_and_recolours_it() {
        let s = state("[paper]\nstyle = \"dots\"\ncolor = \"#112233\"\n[page]\nmode = \"page\"\npaper_theme = \"old_school\"", "");
        assert_eq!(s["viewBackgroundPattern"]["type"], "dots");
        assert_eq!(s["viewBackgroundPattern"]["color"], "#8fb1d9");
    }

    #[test]
    fn normal_and_match_themes_reset_the_background_and_the_pattern_colour() {
        for theme in ["normal", "match"] {
            let cfg = format!("[appearance]\ncanvas_background = \"#222222\"\n[paper]\nstyle = \"grid\"\ncolor = \"#112233\"\n[page]\nmode = \"page\"\npaper_theme = \"{theme}\"");
            let s = state(&cfg, "");
            assert_eq!(s["viewBackgroundColor"], "#ffffff");
            assert_eq!(s["viewBackgroundPattern"]["color"], Json::Null);
        }
    }

    #[test]
    fn blank_scene_reads_the_files_and_survives_missing_or_broken_ones() {
        let dir = tempfile::tempdir().unwrap();
        let (cfg, vault) = (dir.path().join("cfg"), dir.path().join("vault"));
        std::fs::create_dir_all(vault.join(META_DIR)).unwrap();
        std::fs::create_dir_all(&cfg).unwrap();
        let none = blank_scene(&cfg, &vault);
        assert_eq!(none["appState"]["viewBackgroundPattern"], Json::Null);
        assert_eq!(none["elements"], json!([]));
        std::fs::write(cfg.join("config.toml"), "[paper]\nstyle = \"grid\"\n").unwrap();
        assert_eq!(blank_scene(&cfg, &vault)["appState"]["viewBackgroundPattern"]["type"], "grid");
        std::fs::write(vault.join(META_DIR).join("settings.toml"), "[paper]\nstyle = \"dots\"\n").unwrap();
        assert_eq!(blank_scene(&cfg, &vault)["appState"]["viewBackgroundPattern"]["type"], "dots");
        std::fs::write(cfg.join("config.toml"), "this is = = not toml").unwrap();
        std::fs::write(vault.join(META_DIR).join("settings.toml"), "[[[").unwrap();
        assert_eq!(blank_scene(&cfg, &vault)["appState"]["viewBackgroundPattern"], Json::Null);
    }

    /// Golden cases shared with the app's vitest (`newDrawingPaper.test.ts`): same config in,
    /// same state out. Change a default in one place and this or that test fails.
    #[test]
    fn matches_the_golden_parity_file() {
        let golden: Json = serde_json::from_str(include_str!("../tests/fixtures/new-drawing-parity.json")).unwrap();
        let cases = golden["cases"].as_array().unwrap();
        assert!(cases.len() >= 20, "parity file has {} cases", cases.len());
        for c in cases {
            let got = new_drawing_state(&c["config"], &c["vault"]);
            assert_eq!(got, c["expected"], "case {}", c["name"]);
        }
    }
}
