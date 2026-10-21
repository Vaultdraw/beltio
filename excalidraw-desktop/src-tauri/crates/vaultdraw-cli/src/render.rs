//! Human text (not a stable interface). `--json` bypasses this module.

use serde_json::Value;
use std::fmt::Write;

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn status(v: &Value) -> String {
    let mut out = String::new();
    let _ = write!(
        out,
        "Vaultdraw {} (api {}, pid {})",
        s(v, "app"),
        v.get("api").and_then(Value::as_u64).unwrap_or(0),
        v.get("pid").and_then(Value::as_u64).unwrap_or(0)
    );
    match v.get("vault").filter(|x| x.is_object()) {
        Some(vault) => {
            let ro = if vault.get("readOnly").and_then(Value::as_bool) == Some(true) { " [read-only]" } else { "" };
            let _ = write!(out, "\nvault: {} ({}){ro}", s(vault, "name"), s(vault, "path"));
        }
        None => out.push_str("\nvault: none open"),
    }
    if let Some(d) = v.get("activeDrawing").filter(|x| x.is_object()) {
        let dirty = if d.get("dirty").and_then(Value::as_bool) == Some(true) { " (unsaved)" } else { "" };
        let _ = write!(out, "\ndrawing: {}{dirty}", s(d, "path"));
    }
    if let Some(t) = v.get("tabs").and_then(Value::as_u64) {
        let _ = write!(out, "\ntabs: {t}");
    }
    if v.get("windowReady").and_then(Value::as_bool) == Some(false) {
        out.push_str("\nwindow: loading");
    }
    out
}

/// Left-aligned columns, two spaces apart, no trailing spaces.
fn table(rows: &[Vec<String>]) -> String {
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let widths: Vec<usize> =
        (0..cols).map(|c| rows.iter().filter_map(|r| r.get(c)).map(|x| x.chars().count()).max().unwrap_or(0)).collect();
    rows.iter()
        .map(|r| {
            let line = r
                .iter()
                .enumerate()
                .map(|(i, cell)| format!("{cell:<w$}", w = widths[i]))
                .collect::<Vec<_>>()
                .join("  ");
            line.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn methods(v: &Value) -> String {
    let rows: Vec<Vec<String>> = v
        .get("methods")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|m| vec![s(m, "name").to_string(), s(m, "summary").to_string()]).collect())
        .unwrap_or_default();
    table(&rows)
}

pub fn commands(list: &[Value]) -> String {
    let with_avail = list.iter().any(|c| c.get("available").is_some());
    let mut rows = vec![{
        let mut h = vec!["ID".to_string(), "TITLE".to_string(), "CATEGORY".to_string(), "KEYS".to_string()];
        if with_avail {
            h.push("AVAILABLE".into());
        }
        h
    }];
    for c in list {
        let keys = c
            .get("keys")
            .and_then(Value::as_array)
            .map(|k| k.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let mut row = vec![s(c, "id").to_string(), s(c, "title").to_string(), s(c, "category").to_string(), keys];
        if with_avail {
            row.push(if c.get("available").and_then(Value::as_bool) == Some(true) { "yes" } else { "no" }.into());
        }
        rows.push(row);
    }
    table(&rows)
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// A list item that is either a bare string or an object holding the string under one of `keys`.
fn text_of<'a>(item: &'a Value, keys: &[&str]) -> Option<&'a str> {
    item.as_str().or_else(|| keys.iter().find_map(|k| item.get(*k).and_then(Value::as_str)))
}

/// Folders first (trailing `/`), then drawings; each group keeps the app's order.
pub fn ls(v: &Value) -> String {
    let entries = arr(v, "entries");
    let is_folder = |e: &Value| s(e, "kind") == "folder";
    let name = |e: &Value| if s(e, "path").is_empty() { s(e, "name").to_string() } else { s(e, "path").to_string() };
    let folders = entries.iter().filter(|e| is_folder(e)).map(|e| format!("{}/", name(e).trim_end_matches('/')));
    let files = entries.iter().filter(|e| !is_folder(e)).map(name);
    folders.chain(files).collect::<Vec<_>>().join("\n")
}

/// One hit per line: the path, then a tab and the matched element text when there is one.
pub fn search(v: &Value) -> String {
    arr(v, "results")
        .iter()
        .map(|r| match text_of(r, &["text", "snippet"]).filter(|_| r.is_object()) {
            Some(t) => format!("{}\t{}", s(r, "path"), t.replace('\n', " ")),
            None => s(r, "path").to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Resolved outgoing link targets, or the backlink sources, each path once in first-seen order.
/// The app sends `outgoing: [{resolved: "<path>", ...}]` and `backlinks: [{path, ...}]` (one
/// entry per linking element); `links` / `path` / `resolved: bool` are tolerated too.
pub fn links(v: &Value, backlinks: bool) -> String {
    let found: Vec<&str> = if backlinks {
        arr(v, "backlinks").iter().filter_map(|b| text_of(b, &["path", "source", "from"])).collect()
    } else {
        let list = if v.get("outgoing").is_some() { arr(v, "outgoing") } else { arr(v, "links") };
        list.iter()
            .filter(|l| l.get("resolved").and_then(Value::as_bool) != Some(false))
            .filter_map(|l| l.get("resolved").and_then(Value::as_str).or_else(|| text_of(l, &["path"])))
            .collect()
    };
    let mut seen = std::collections::HashSet::new();
    found.into_iter().filter(|p| seen.insert(*p)).collect::<Vec<_>>().join("\n")
}

/// `tag count` per line; accepts `[{tag|name, count}]` or a `{tag: count}` map.
pub fn tags(v: &Value) -> String {
    let count = |c: Option<&Value>| c.and_then(Value::as_u64).unwrap_or(0);
    match v.get("tags") {
        Some(Value::Object(m)) => m.iter().map(|(t, c)| format!("{t} {}", count(Some(c)))).collect::<Vec<_>>().join("\n"),
        _ => arr(v, "tags").iter().map(|t| format!("{} {}", text_of(t, &["tag", "name"]).unwrap_or(""), count(t.get("count")))).collect::<Vec<_>>().join("\n"),
    }
}

/// `*` marks the active tab, then the 1-based index, the path (or `(home)`) and `[+]` when dirty.
pub fn tabs(v: &Value) -> String {
    let active_id = v.get("activeId").and_then(Value::as_str);
    arr(v, "tabs")
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let active = t.get("active").and_then(Value::as_bool).unwrap_or_else(|| active_id.is_some() && active_id == t.get("id").and_then(Value::as_str));
            let path = if s(t, "path").is_empty() { "(home)" } else { s(t, "path") };
            let dirty = if t.get("dirty").and_then(Value::as_bool) == Some(true) { " [+]" } else { "" };
            format!("{} {} {path}{dirty}", if active { "*" } else { " " }, i + 1)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Strings print bare, everything else as JSON (objects pretty-printed).
pub fn value(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Object(_) | Value::Array(_) => serde_json::to_string_pretty(v).unwrap_or_default(),
        _ => v.to_string(),
    }
}

pub fn vault(v: &Value) -> String {
    let ro = if v.get("readOnly").and_then(Value::as_bool) == Some(true) { " [read-only]" } else { "" };
    format!("{} ({}){ro}", s(v, "name"), s(v, "path"))
}
