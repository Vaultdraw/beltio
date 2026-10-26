//! A small line parser for the YAML frontmatter Obsidian writes: `key: value`, flow lists
//! `[a, b]` and block lists (`- a`). Not a YAML parser: anchors, nested maps and the like are
//! kept as plain text.

use super::model::{Frontmatter, Range};
use std::collections::BTreeMap;

fn unquote(s: &str) -> &str {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() >= 2 && ((b[0] == b'"' && b[b.len() - 1] == b'"') || (b[0] == b'\'' && b[b.len() - 1] == b'\'')) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn split_flow(inner: &str) -> Vec<String> {
    inner.split(',').map(|p| unquote(p).to_string()).filter(|p| !p.is_empty()).collect()
}

fn clean_tag(t: &str) -> String {
    t.trim().trim_start_matches('#').to_string()
}

pub fn parse(raw: &str, range: Range) -> Frontmatter {
    let raw = raw.replace('\r', "");
    let mut lists: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut scalars: BTreeMap<String, String> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut cur: Option<String> = None;
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        if let Some(key) = cur.as_ref().filter(|_| indented || t.starts_with("- ") || t == "-") {
            if let Some(item) = t.strip_prefix("- ").or(if t == "-" { Some("") } else { None }) {
                lists.entry(key.clone()).or_default().push(unquote(item).to_string());
            } else {
                let v = scalars.entry(key.clone()).or_default();
                if !v.is_empty() {
                    v.push('\n');
                }
                v.push_str(t);
            }
            continue;
        }
        let Some(i) = line.find(':') else { continue };
        let key = line[..i].trim().to_string();
        if key.is_empty() {
            continue;
        }
        let val = line[i + 1..].trim();
        if !order.contains(&key) {
            order.push(key.clone());
        }
        if val.len() >= 2 && val.starts_with('[') && val.ends_with(']') {
            lists.insert(key.clone(), split_flow(&val[1..val.len() - 1]));
        } else if val.is_empty() || val == "|" || val == ">" || val == "|-" || val == ">-" {
            // A block list or block scalar follows (or the value is empty).
            scalars.entry(key.clone()).or_default();
        } else {
            scalars.insert(key.clone(), unquote(val).to_string());
        }
        cur = Some(key);
    }
    let mut properties = BTreeMap::new();
    for k in &order {
        let v = match lists.get(k) {
            Some(l) => l.join(", "),
            None => scalars.get(k).cloned().unwrap_or_default(),
        };
        properties.insert(k.clone(), v);
    }
    let get = |names: &[&str], split_ws: bool| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for k in order.iter().filter(|k| names.iter().any(|n| k.eq_ignore_ascii_case(n))) {
            if let Some(l) = lists.get(k) {
                out.extend(l.iter().cloned());
            } else if let Some(s) = scalars.get(k) {
                let parts: Vec<&str> = if split_ws {
                    s.split([',', ' ', '\t', '\n']).collect()
                } else if s.contains(',') {
                    s.split(',').collect()
                } else {
                    vec![s.as_str()]
                };
                out.extend(parts.into_iter().map(|p| unquote(p).to_string()));
            }
        }
        out.retain(|s| !s.trim().is_empty());
        out
    };
    let tags = get(&["tags", "tag"], true).iter().map(|t| clean_tag(t)).filter(|t| !t.is_empty()).collect();
    let aliases = get(&["aliases", "alias"], false).iter().map(|a| a.trim().to_string()).collect();
    Frontmatter { range, raw, tags, aliases, properties }
}
