//! `vaultdraw config check` and the app's "Config: Check config files": every config layer
//! (included files, `config.toml`, `overrides.toml`) checked against the JSON Schema that the
//! app's key table generates (`docs/config.schema.json`, embedded here), with file, line and
//! column. Read-only. Same severity as the app: an unknown key is a warning (it is ignored),
//! a parse error, wrong type or value out of range is an error (the default applies).
//!
//! Only the subset of JSON Schema the generator emits is walked: `type`, `enum`, `const`,
//! `anyOf`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `format`
//! (the colour formats), `items`, `minItems`, `maxItems`, `properties`, `required`,
//! `additionalProperties`.

use super::*;
use std::sync::OnceLock;
use toml_edit::{Item, TableLike, Value as TomlValue};

/// The generated schema (see `excalidraw-desktop/src/vault/configSchema.ts`).
pub const CONFIG_SCHEMA: &str = include_str!("../../../../../../docs/config.schema.json");

pub(super) fn check_schema() -> &'static Json {
    static SCHEMA: OnceLock<Json> = OnceLock::new();
    SCHEMA.get_or_init(|| serde_json::from_str(CONFIG_SCHEMA).expect("the embedded config schema is valid JSON"))
}

pub const SEVERITY_ERROR: &str = "error";
pub const SEVERITY_WARNING: &str = "warning";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// The layer's name (`config.toml`, `overrides.toml`, an included file's name).
    pub file: String,
    pub path: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    /// Dotted key, when the problem is about one.
    pub key: Option<String>,
    /// `error` or `warning`.
    pub severity: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub file: String,
    pub path: String,
    /// `ok`, `missing` or `error`.
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    /// No errors (warnings allowed).
    pub ok: bool,
    pub errors: usize,
    pub warnings: usize,
    pub files: Vec<FileStatus>,
    pub problems: Vec<Problem>,
    /// The human report (one line per problem, then a summary).
    pub text: String,
}

/// Checks every layer of the config folder. Reads only; creates nothing.
pub fn check_config_in(dirs: &Dirs) -> CheckReport {
    check_layers(&read_layers(dirs))
}

pub(super) fn check_layers(layers: &Layers) -> CheckReport {
    let mut files = Vec::new();
    let mut problems = Vec::new();
    for layer in &layers.all {
        files.push(FileStatus { file: layer.name.clone(), path: layer.path.clone(), status: layer.status });
        match layer.status {
            "missing" => {}
            "ok" => {
                let max = if layer.kind == "overrides" { 1024 * 1024 } else if layer.kind == KIND_INCLUDE { MAX_INCLUDE_BYTES } else { MAX_CONFIG_BYTES };
                match read_toml_text(Path::new(&layer.path), &layer.name, max) {
                    Ok(text) => problems.extend(check_text(&text, &layer.name, &layer.path)),
                    Err(e) => problems.push(file_problem(layer, SEVERITY_ERROR, e.message, None)),
                }
            }
            _ => {
                let (message, line) = layer.error.as_ref().map(|e| (e.message.clone(), e.line)).unwrap_or_default();
                problems.push(file_problem(layer, SEVERITY_ERROR, message, line));
            }
        }
    }
    for warning in &layers.warnings {
        problems.push(Problem {
            file: CONFIG_FILE.into(),
            path: String::new(),
            line: None,
            column: None,
            key: Some("include".into()),
            severity: SEVERITY_WARNING,
            message: warning.clone(),
        });
    }
    report(files, problems)
}

fn file_problem(layer: &LayerInfo, severity: &'static str, message: String, line: Option<usize>) -> Problem {
    Problem { file: layer.name.clone(), path: layer.path.clone(), line, column: None, key: None, severity, message }
}

fn report(files: Vec<FileStatus>, problems: Vec<Problem>) -> CheckReport {
    let errors = problems.iter().filter(|p| p.severity == SEVERITY_ERROR).count();
    let warnings = problems.len() - errors;
    let text = render(&files, &problems, errors, warnings);
    CheckReport { ok: errors == 0, errors, warnings, files, problems, text }
}

fn plural(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

/// `config.toml:3:1: warning: unknown key …`, then a summary line.
fn render(files: &[FileStatus], problems: &[Problem], errors: usize, warnings: usize) -> String {
    let mut out = String::new();
    for p in problems {
        let at = match (p.line, p.column) {
            (Some(l), Some(c)) => format!("{}:{l}:{c}", p.file),
            (Some(l), None) => format!("{}:{l}", p.file),
            _ => p.file.clone(),
        };
        out.push_str(&format!("{at}: {}: {}\n", p.severity, p.message));
    }
    let present = files.iter().filter(|f| f.status != "missing").count();
    if present == 0 {
        out.push_str("No config files yet: the defaults apply.\n");
    } else if problems.is_empty() {
        out.push_str(&format!("No problems in {}.\n", plural(present, "config file")));
    } else {
        let mut parts = Vec::new();
        if errors > 0 {
            parts.push(plural(errors, "error"));
        }
        if warnings > 0 {
            parts.push(plural(warnings, "warning"));
        }
        out.push_str(&format!("{} in {}.\n", parts.join(", "), plural(present, "config file")));
    }
    out
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

/// Line and column (both from 1) of a byte offset.
fn position(text: &str, offset: usize) -> (usize, usize) {
    let end = offset.min(text.len());
    let before = &text[..end];
    let line = before.bytes().filter(|b| *b == b'\n').count() + 1;
    let column = before.rfind('\n').map_or(before.chars().count(), |i| before[i + 1..].chars().count()) + 1;
    (line, column)
}

struct Walk<'a> {
    text: &'a str,
    file: &'a str,
    path: &'a str,
    out: Vec<Problem>,
}

impl Walk<'_> {
    fn push(&mut self, span: Option<std::ops::Range<usize>>, key: &str, severity: &'static str, message: String) {
        let (line, column) = span.map(|s| position(self.text, s.start)).map_or((None, None), |(l, c)| (Some(l), Some(c)));
        self.out.push(Problem {
            file: self.file.into(),
            path: self.path.into(),
            line,
            column,
            key: (!key.is_empty()).then(|| key.to_string()),
            severity,
            message,
        });
    }

    /// The keys of a table against an object schema.
    fn table(&mut self, table: &dyn TableLike, schema: &Json, prefix: &str) {
        let props = schema.get("properties").and_then(Json::as_object);
        let extra = schema.get("additionalProperties");
        for (name, item) in table.iter() {
            let key = if prefix.is_empty() { name.to_string() } else { format!("{prefix}.{name}") };
            let span = table.get_key_value(name).and_then(|(k, _)| k.span());
            match props.and_then(|p| p.get(name)) {
                Some(sub) => self.item(item, sub, &key, span),
                None => match extra {
                    Some(Json::Bool(false)) => {
                        let guess = props.and_then(|p| closest(name, p.keys().map(String::as_str)));
                        let hint = guess.map(|g| format!("; did you mean {}?", if prefix.is_empty() { g.to_string() } else { format!("{prefix}.{g}") }));
                        self.push(span, &key, SEVERITY_WARNING, format!("unknown key {key} (ignored{})", hint.unwrap_or_default()));
                    }
                    Some(sub @ Json::Object(_)) => self.item(item, sub, &key, span),
                    _ => {}
                },
            }
        }
    }

    fn item(&mut self, item: &Item, schema: &Json, key: &str, span: Option<std::ops::Range<usize>>) {
        let is_table_schema = schema.get("type").and_then(Json::as_str) == Some("object");
        if is_table_schema {
            if let Some(table) = item.as_table_like() {
                if schema.get("properties").is_some() || schema.get("additionalProperties").is_some() {
                    return self.table(table, schema, key);
                }
                return;
            }
            if !key.contains('.') {
                // A known table written as a value: the app ignores it with a warning.
                return self.push(span, key, SEVERITY_WARNING, format!("{key} must be a table like [{key}] (ignored)"));
            }
        }
        let value = item_to_json(item);
        if !accepts(schema, &value) {
            self.push(span, key, SEVERITY_ERROR, format!("{key} = {} is not valid (expected {})", show(&value), describe(schema)));
        }
    }
}

/// Problems in one file's text, in file order.
pub fn check_text(text: &str, file: &str, path: &str) -> Vec<Problem> {
    let mut walk = Walk { text, file, path, out: Vec::new() };
    match text.parse::<toml_edit::Document<String>>() {
        Ok(doc) => walk.table(doc.as_table(), check_schema(), ""),
        Err(e) => {
            let message = e.message().trim().to_string();
            walk.push(e.span(), "", SEVERITY_ERROR, message);
        }
    }
    walk.out
}

fn value_to_json(v: &TomlValue) -> Json {
    match v {
        TomlValue::String(s) => Json::String(s.value().clone()),
        TomlValue::Integer(i) => Json::from(*i.value()),
        TomlValue::Float(f) => serde_json::Number::from_f64(*f.value()).map(Json::Number).unwrap_or(Json::Null),
        TomlValue::Boolean(b) => Json::Bool(*b.value()),
        TomlValue::Datetime(d) => Json::String(d.value().to_string()),
        TomlValue::Array(a) => Json::Array(a.iter().map(value_to_json).collect()),
        TomlValue::InlineTable(t) => Json::Object(t.iter().map(|(k, v)| (k.to_string(), value_to_json(v))).collect()),
    }
}

fn item_to_json(item: &Item) -> Json {
    match item {
        Item::None => Json::Null,
        Item::Value(v) => value_to_json(v),
        Item::Table(t) => Json::Object(t.iter().map(|(k, v)| (k.to_string(), item_to_json(v))).collect()),
        Item::ArrayOfTables(a) => Json::Array(a.iter().map(|t| Json::Object(t.iter().map(|(k, v)| (k.to_string(), item_to_json(v))).collect())).collect()),
    }
}

/// A value as the app's messages show it: strings quoted, the rest as JSON.
fn show(value: &Json) -> String {
    let text = value.to_string();
    if text.len() > 80 {
        format!("{}…", text.chars().take(77).collect::<String>())
    } else {
        text
    }
}

// ---------------------------------------------------------------------------
// The schema subset
// ---------------------------------------------------------------------------

fn type_ok(ty: &str, v: &Json) -> bool {
    match ty {
        // TOML `5.0` is a whole number for the app (JavaScript has one number type).
        "integer" => v.as_i64().is_some() || v.as_f64().is_some_and(|f| f.is_finite() && f.fract() == 0.0),
        "number" => v.as_f64().is_some_and(f64::is_finite),
        "string" => v.is_string(),
        "boolean" => v.is_boolean(),
        "array" => v.is_array(),
        "object" => v.is_object(),
        _ => true,
    }
}

fn same(a: &Json, b: &Json) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

/// The colour formats (same rules as the `pattern` next to them in the schema).
fn format_ok(format: &str, s: &str) -> bool {
    let hex = |h: &str| !h.is_empty() && h.bytes().all(|b| b.is_ascii_hexdigit());
    let hash = s.strip_prefix('#');
    match format {
        "color" => match hash {
            Some(h) => hex(h) && matches!(h.len(), 3 | 4 | 6 | 8),
            None => !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphabetic()),
        },
        "hex6" => hash.is_some_and(|h| hex(h) && h.len() == 6),
        "hex3or6" => hash.is_some_and(|h| hex(h) && matches!(h.len(), 3 | 6)),
        _ => true,
    }
}

/// Whether `v` satisfies `schema` (the generator's subset).
pub fn accepts(schema: &Json, v: &Json) -> bool {
    if let Some(any) = schema.get("anyOf").and_then(Json::as_array) {
        return any.iter().any(|s| accepts(s, v));
    }
    if let Some(c) = schema.get("const") {
        if !same(c, v) {
            return false;
        }
    }
    if let Some(list) = schema.get("enum").and_then(Json::as_array) {
        if !list.iter().any(|e| same(e, v)) {
            return false;
        }
    }
    if let Some(ty) = schema.get("type").and_then(Json::as_str) {
        if !type_ok(ty, v) {
            return false;
        }
    }
    let num = |k: &str| schema.get(k).and_then(Json::as_f64);
    let count = |k: &str| schema.get(k).and_then(Json::as_u64).map(|n| n as usize);
    if let Some(n) = v.as_f64() {
        if num("minimum").is_some_and(|m| n < m) || num("maximum").is_some_and(|m| n > m) || num("exclusiveMinimum").is_some_and(|m| n <= m) {
            return false;
        }
    }
    if let Some(s) = v.as_str() {
        // JSON Schema lengths count UTF-16 code units; the app's checks count them too.
        let len = s.encode_utf16().count();
        if count("minLength").is_some_and(|m| len < m) || count("maxLength").is_some_and(|m| len > m) {
            return false;
        }
        if let Some(f) = schema.get("format").and_then(Json::as_str) {
            if !format_ok(f, s) {
                return false;
            }
        }
    }
    if let Some(items) = v.as_array() {
        if count("minItems").is_some_and(|m| items.len() < m) || count("maxItems").is_some_and(|m| items.len() > m) {
            return false;
        }
        if let Some(item) = schema.get("items") {
            if !items.iter().all(|i| accepts(item, i)) {
                return false;
            }
        }
    }
    if let Some(map) = v.as_object() {
        let props = schema.get("properties").and_then(Json::as_object);
        if let Some(required) = schema.get("required").and_then(Json::as_array) {
            if required.iter().filter_map(Json::as_str).any(|r| !map.contains_key(r)) {
                return false;
            }
        }
        for (name, value) in map {
            match (props.and_then(|p| p.get(name)), schema.get("additionalProperties")) {
                (Some(sub), _) => {
                    if !accepts(sub, value) {
                        return false;
                    }
                }
                (None, Some(Json::Bool(false))) => return false,
                (None, Some(sub @ Json::Object(_))) => {
                    if !accepts(sub, value) {
                        return false;
                    }
                }
                _ => {}
            }
        }
    }
    true
}

fn join_or(parts: Vec<String>) -> String {
    match parts.len() {
        0 => String::new(),
        1 => parts[0].clone(),
        n => format!("{} or {}", parts[..n - 1].join(", "), parts[n - 1]),
    }
}

/// What a schema accepts, in the words the app's messages use.
pub fn describe(schema: &Json) -> String {
    if let Some(any) = schema.get("anyOf").and_then(Json::as_array) {
        return join_or(any.iter().map(describe).collect());
    }
    if let Some(c) = schema.get("const") {
        return c.to_string();
    }
    if let Some(list) = schema.get("enum").and_then(Json::as_array) {
        return join_or(list.iter().map(Json::to_string).collect());
    }
    let num = |k: &str| schema.get(k).and_then(Json::as_f64).map(|n| Json::from(n).to_string().trim_end_matches(".0").to_string());
    let ty = schema.get("type").and_then(Json::as_str).unwrap_or("");
    match ty {
        "boolean" => "true or false".into(),
        "integer" | "number" => {
            let what = if ty == "integer" { "a whole number" } else { "a number" };
            match (num("minimum"), num("maximum"), num("exclusiveMinimum")) {
                (Some(lo), Some(hi), _) => format!("{what} between {lo} and {hi}"),
                (None, Some(hi), Some(_)) => format!("a positive number up to {hi}"),
                _ => what.into(),
            }
        }
        "string" => match schema.get("format").and_then(Json::as_str) {
            Some("color") => "a colour like \"#1e1e1e\"".into(),
            Some("hex6") => "a hex colour like \"#6965db\"".into(),
            Some("hex3or6") => "a hex colour like \"#6965db\" or \"#abc\"".into(),
            _ if schema.get("minLength").and_then(Json::as_u64).unwrap_or(0) > 0 => "a non-empty string".into(),
            _ => "a string".into(),
        },
        "array" => match schema.get("items").and_then(|i| i.get("type")).and_then(Json::as_str) {
            Some("string") => "a list of strings".into(),
            Some("object") => {
                let n = |k: &str| schema.get(k).and_then(Json::as_u64);
                match (n("minItems"), n("maxItems")) {
                    (Some(lo), Some(hi)) => format!("a list of {lo} to {hi} tables (see docs/configuration.md)"),
                    _ => "a list of tables".into(),
                }
            }
            _ => "a list".into(),
        },
        "object" => "a table".into(),
        _ => "a valid value".into(),
    }
}

// ---------------------------------------------------------------------------
// Did you mean (the same rule as the app's configKeys.ts)
// ---------------------------------------------------------------------------

/// Edit distance counting a swap of two neighbours as one edit (optimal string alignment),
/// capped: returns `max + 1` once it is exceeded.
pub fn edit_distance(a: &str, b: &str, max: usize) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max {
        return max + 1;
    }
    let mut before: Vec<usize> = Vec::new();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut prev_best = 0;
    for i in 1..=a.len() {
        let mut row = vec![i; b.len() + 1];
        let mut best = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            row[j] = (prev[j] + 1).min(row[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                row[j] = row[j].min(before[j - 2] + 1);
            }
            best = best.min(row[j]);
        }
        if best > max && prev_best > max {
            return max + 1;
        }
        before = std::mem::replace(&mut prev, row);
        prev_best = best;
    }
    prev[b.len()].min(max + 1)
}

/// The closest candidate within a third of the word's length (at least 1, at most 3).
pub fn closest<'a>(word: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let max = (word.chars().count() / 3).clamp(1, 3);
    let mut best = None;
    let mut best_distance = max + 1;
    for c in candidates {
        let d = edit_distance(word, c, max);
        if d < best_distance {
            best = Some(c);
            best_distance = d;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn check(text: &str) -> Vec<Problem> {
        check_text(text, "config.toml", "/c/config.toml")
    }

    #[test]
    fn the_embedded_schema_parses_and_knows_every_table() {
        let s = check_schema();
        for t in ["appearance", "editor", "interface", "hotkeys", "plugin", "include", "control", "tools", "pens"] {
            assert!(s["properties"].get(t).is_some(), "{t}");
        }
    }

    #[test]
    fn the_first_launch_config_has_no_problems() {
        assert_eq!(check(DEFAULT_CONFIG), vec![]);
    }

    #[test]
    fn unknown_key_is_a_warning_with_line_column_and_suggestion() {
        let p = check("[interface]\nzoom = 120\n  zom = 3\n");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].severity, SEVERITY_WARNING);
        assert_eq!((p[0].line, p[0].column), (Some(3), Some(3)));
        assert_eq!(p[0].key.as_deref(), Some("interface.zom"));
        assert_eq!(p[0].message, "unknown key interface.zom (ignored; did you mean interface.zoom?)");
    }

    #[test]
    fn unknown_table_suggests_a_table() {
        let p = check("[apearance]\nmode = \"dark\"\n");
        assert_eq!(p[0].message, "unknown key apearance (ignored; did you mean appearance?)");
        assert_eq!(p[0].line, Some(1));
    }

    #[test]
    fn wrong_type_and_out_of_range_are_errors() {
        let p = check("[paper]\nopacity = 5\n[interface]\nthumbnails = \"yes\"\n[appearance]\nmode = \"dim\"\n");
        let messages: Vec<_> = p.iter().map(|p| (p.severity, p.line, p.message.as_str())).collect();
        assert_eq!(
            messages,
            vec![
                (SEVERITY_ERROR, Some(2), "paper.opacity = 5 is not valid (expected a number between 0.1 and 1)"),
                (SEVERITY_ERROR, Some(4), "interface.thumbnails = \"yes\" is not valid (expected true or false)"),
                (SEVERITY_ERROR, Some(6), "appearance.mode = \"dim\" is not valid (expected \"light\", \"dark\" or \"system\")"),
            ]
        );
    }

    #[test]
    fn whole_numbers_written_as_floats_pass_like_in_the_app() {
        assert_eq!(check("[interface]\nzoom = 120.0\n"), vec![]);
        let p = check("[interface]\nzoom = 120.5\n");
        assert_eq!(p[0].message, "interface.zoom = 120.5 is not valid (expected a whole number between 50 and 200)");
    }

    #[test]
    fn zero_or_range_and_colours() {
        assert_eq!(check("[paper]\nspacing = 0\ncolor = \"\"\n[links]\ncolor = \"accent\"\n"), vec![]);
        let p = check("[paper]\nspacing = 2\ncolor = \"red\"\n");
        assert_eq!(p[0].message, "paper.spacing = 2 is not valid (expected 0 or a number between 5 and 200)");
        assert_eq!(p[1].message, "paper.color = \"red\" is not valid (expected \"\" or a hex colour like \"#6965db\")");
    }

    #[test]
    fn nested_tool_keys_and_pens() {
        let p = check("[tools.arrow]\nroughnes = 1\nopacity = 500\n");
        assert_eq!(p[0].severity, SEVERITY_WARNING);
        assert_eq!(p[0].message, "unknown key tools.arrow.roughnes (ignored; did you mean tools.arrow.roughness?)");
        assert_eq!(p[1].severity, SEVERITY_ERROR);
        assert!(p[1].message.starts_with("tools.arrow.opacity = 500 is not valid"), "{}", p[1].message);
        assert_eq!(check("[[pens.presets]]\nname = \"Pen\"\ncolor = \"#000000\"\nwidth = 2\n"), vec![]);
        let p = check("[[pens.presets]]\nname = \"Pen\"\ncolor = \"#000000\"\nwidth = 99\n");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].key.as_deref(), Some("pens.presets"));
    }

    #[test]
    fn open_tables_check_shapes_only() {
        assert_eq!(check("[hotkeys]\n\"file.save\" = [\"Mod+S\"]\n\"my.plugin.cmd\" = []\n[plugin.hello]\nanything = 1\n[control]\nenabled = false\n"), vec![]);
        let p = check("[hotkeys]\n\"file.save\" = \"Mod+S\"\n");
        assert_eq!(p[0].severity, SEVERITY_ERROR);
        assert_eq!(p[0].message, "hotkeys.file.save = \"Mod+S\" is not valid (expected a list of strings)");
    }

    #[test]
    fn a_table_written_as_a_value_is_a_warning() {
        let p = check("interface = 1\n");
        assert_eq!(p[0].severity, SEVERITY_WARNING);
        assert_eq!(p[0].message, "interface must be a table like [interface] (ignored)");
    }

    #[test]
    fn parse_error_has_a_line() {
        let p = check("[appearance]\nmode = \n");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].severity, SEVERITY_ERROR);
        assert_eq!(p[0].line, Some(2));
    }

    #[test]
    fn edit_distance_matches_the_app() {
        assert_eq!(edit_distance("srot", "sort", 3), 1);
        assert_eq!(edit_distance("zom", "zoom", 1), 1);
        assert_eq!(edit_distance("abcdef", "x", 2), 3);
        assert_eq!(closest("zom", ["zoom", "thumbnails"].into_iter()), Some("zoom"));
        assert_eq!(closest("qqqq", ["zoom"].into_iter()), None);
    }

    #[test]
    fn accepts_matches_the_subset() {
        let s = json!({"anyOf": [{"const": 0}, {"type": "integer", "minimum": 1, "maximum": 20}]});
        assert!(accepts(&s, &json!(0)) && accepts(&s, &json!(20)) && !accepts(&s, &json!(21)) && !accepts(&s, &json!(1.5)));
        assert!(format_ok("color", "#abc") && format_ok("color", "transparent") && !format_ok("color", "#ggg") && !format_ok("color", ""));
        assert!(format_ok("hex6", "#AABBCC") && !format_ok("hex6", "#abc"));
    }

    #[test]
    fn checks_every_layer_and_names_the_file() {
        let t = tempdir().unwrap();
        let dirs = Dirs { config: t.path().join("config"), state: t.path().join("state") };
        fs::create_dir_all(&dirs.config).unwrap();
        fs::create_dir_all(&dirs.state).unwrap();
        fs::write(dirs.config_file(), "[include]\nfiles = [\"extra.toml\"]\n[interface]\nzom = 1\n").unwrap();
        fs::write(dirs.config.join("extra.toml"), "[paper]\nopacity = 9\n").unwrap();
        fs::write(dirs.overrides_file(), "[appearance]\nmode = 3\n").unwrap();
        let r = check_config_in(&dirs);
        let files: Vec<_> = r.problems.iter().map(|p| (p.file.as_str(), p.severity, p.line)).collect();
        assert_eq!(files, vec![("extra.toml", SEVERITY_ERROR, Some(2)), ("config.toml", SEVERITY_WARNING, Some(4)), ("overrides.toml", SEVERITY_ERROR, Some(2))]);
        assert_eq!((r.ok, r.errors, r.warnings), (false, 2, 1));
        assert!(r.text.ends_with("2 errors, 1 warning in 3 config files.\n"), "{}", r.text);
        assert!(r.text.starts_with("extra.toml:2:1: error: paper.opacity = 9 is not valid"), "{}", r.text);
    }

    #[test]
    fn no_files_reads_as_defaults_and_creates_nothing() {
        let t = tempdir().unwrap();
        let dirs = Dirs { config: t.path().join("config"), state: t.path().join("state") };
        let r = check_config_in(&dirs);
        assert!(r.ok);
        assert_eq!(r.text, "No config files yet: the defaults apply.\n");
        assert!(!dirs.config.exists() && !dirs.state.exists());
    }
}
