//! A small line parser for the YAML frontmatter Obsidian writes: `key: value`, flow lists
//! `[a, b]` and block lists (`- a`). Not a YAML parser: anchors, nested maps and the like are
//! kept as plain text.

use super::model::{Frontmatter, Properties, Range};
use std::collections::BTreeMap;

/// The value without a trailing YAML comment: a `#` that starts the text or follows a space or tab,
/// outside quotes and outside a `[[wikilink]]` (`[[Home #Part]]` keeps its text).
fn strip_comment(s: &str) -> &str {
    let b = s.as_bytes();
    let mut quote: Option<u8> = None;
    let mut links = 0usize;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) => {
                if c == b'\\' && q == b'"' {
                    i += 1;
                } else if c == q {
                    quote = None;
                }
            }
            None => {
                if (c == b'"' || c == b'\'') && (i == 0 || b[i - 1] == b' ' || b[i - 1] == b'\t' || b[i - 1] == b'[' || b[i - 1] == b',') {
                    quote = Some(c);
                } else if c == b'[' && b.get(i + 1) == Some(&b'[') {
                    links += 1;
                    i += 1;
                } else if c == b']' && b.get(i + 1) == Some(&b']') && links > 0 {
                    links -= 1;
                    i += 1;
                } else if c == b'#' && links == 0 && (i == 0 || b[i - 1] == b' ' || b[i - 1] == b'\t') {
                    return s[..i].trim_end();
                }
            }
        }
        i += 1;
    }
    s
}

/// A scalar as YAML reads it: quotes removed, `''` inside single quotes and `\"` and `\\` inside
/// double quotes unescaped.
fn unquote(s: &str) -> String {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() >= 2 && b[0] == b'\'' && b[b.len() - 1] == b'\'' {
        s[1..s.len() - 1].replace("''", "'")
    } else if b.len() >= 2 && b[0] == b'"' && b[b.len() - 1] == b'"' {
        s[1..s.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        s.to_string()
    }
}

/// Splits `key: value` at the colon after the key; a quoted key may hold colons.
fn split_key(line: &str) -> Option<(String, &str)> {
    let t = line.trim_start();
    let q = t.as_bytes().first().copied().filter(|c| *c == b'"' || *c == b'\'');
    if let Some(q) = q {
        if let Some(end) = t[1..].find(q as char) {
            let rest = t[end + 2..].trim_start();
            if let Some(after) = rest.strip_prefix(':') {
                return Some((t[1..end + 1].to_string(), after));
            }
        }
    }
    let i = line.find(':')?;
    Some((line[..i].trim().to_string(), &line[i + 1..]))
}

fn split_flow(inner: &str) -> Vec<String> {
    inner.split(',').map(unquote).filter(|p| !p.is_empty()).collect()
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
                lists.entry(key.clone()).or_default().push(unquote(strip_comment(item.trim())));
            } else {
                let v = scalars.entry(key.clone()).or_default();
                if !v.is_empty() {
                    v.push('\n');
                }
                v.push_str(t);
            }
            continue;
        }
        let Some((key, rest)) = split_key(line) else { continue };
        if key.is_empty() {
            continue;
        }
        let val = strip_comment(rest.trim());
        if !order.contains(&key) {
            order.push(key.clone());
        }
        if val.len() >= 2 && val.starts_with('[') && !val.starts_with("[[") && val.ends_with(']') {
            lists.insert(key.clone(), split_flow(&val[1..val.len() - 1]));
        } else if val.is_empty() || val == "|" || val == ">" || val == "|-" || val == ">-" {
            // A block list or block scalar follows (or the value is empty).
            scalars.entry(key.clone()).or_default();
        } else {
            scalars.insert(key.clone(), unquote(val));
        }
        cur = Some(key);
    }
    let mut properties: Vec<(String, String)> = Vec::new();
    for k in &order {
        let v = match lists.get(k) {
            Some(l) => l.join(", "),
            None => scalars.get(k).cloned().unwrap_or_default(),
        };
        // a repeated key keeps its first place and its last value, as a map would
        match properties.iter_mut().find(|(pk, _)| pk == k) {
            Some(slot) => slot.1 = v,
            None => properties.push((k.clone(), v)),
        }
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
                out.extend(parts.into_iter().map(unquote));
            }
        }
        out.retain(|s| !s.trim().is_empty());
        out
    };
    let tags = get(&["tags", "tag"], true).iter().map(|t| clean_tag(t)).filter(|t| !t.is_empty()).collect();
    let aliases = get(&["aliases", "alias"], false).iter().map(|a| a.trim().to_string()).collect();
    Frontmatter { range, raw, tags, aliases, properties: Properties(properties) }
}
