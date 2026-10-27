//! Read-side link queries: outgoing links, backlinks with snippets, unlinked mentions, resolution.

use super::grammar::{parse_link_field, strip_ext, text_links, text_links_vec, FieldForm, TextLink};
use super::index::{LinkIndex, NONE};
use super::resolve::{dir_of, is_note_path, key_of_note_target, key_of_rel, key_of_target, name_of, note_link_target};
use super::types::{BackLink, LinkKind, LinksResponse, MentionsResponse, OutLink, Resolution};
use crate::search::{normalize, word_snippet, DocEntry, Index, ItemKind};
use std::collections::HashMap;
use std::time::Instant;

const SNIPPET_CHARS: usize = 120;
const MAX_MENTION_CANDIDATES: usize = 2000;

fn took(started: Instant) -> f64 {
    (started.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

fn path_of(li: &LinkIndex, d: u32) -> Option<String> {
    (d != NONE).then(|| li.path(d).to_string())
}

/// A one-line snippet of at most 120 chars centred on the first link accepted by `hit`,
/// with every accepted link on that line highlighted (UTF-16 offsets into the snippet).
pub fn link_snippet(text: &str, hit: impl Fn(&TextLink) -> bool) -> Option<(String, Vec<[u32; 2]>)> {
    let links: Vec<TextLink> = text_links_vec(text).into_iter().filter(|l| hit(l)).collect();
    let first = links.first()?;
    let line_start = text[..first.start].rfind('\n').map_or(0, |i| i + 1);
    let line_end = text[first.end..].find('\n').map_or(text.len(), |i| first.end + i);
    let line = text[line_start..line_end].trim_end_matches('\r');
    let offs: Vec<usize> = line.char_indices().map(|(i, _)| i).collect();
    let chars: Vec<char> = line.chars().collect();
    let at = |byte: usize| offs.partition_point(|&o| o < byte);
    let ranges: Vec<(usize, usize)> = links
        .iter()
        .filter(|l| l.start >= line_start && l.end <= line_start + line.len())
        .map(|l| (at(l.start - line_start), at(l.end - line_start)))
        .collect();
    let n = chars.len();
    let (mut start, mut end) = (0, n);
    if n > SNIPPET_CHARS {
        let window = SNIPPET_CHARS - 2;
        let (cs, ce) = ranges[0];
        start = cs.saturating_sub(window.saturating_sub(ce - cs) / 2);
        end = (start + window).min(n);
        start = end.saturating_sub(window);
    }
    let base = u32::from(start > 0);
    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.extend(&chars[start..end]);
    if end < n {
        snippet.push('…');
    }
    let mut pos = vec![base; end - start + 1];
    for (i, c) in chars[start..end].iter().enumerate() {
        pos[i + 1] = pos[i] + c.len_utf16() as u32;
    }
    let highlights = ranges
        .into_iter()
        .filter_map(|(a, b)| {
            let (a, b) = (a.max(start), b.min(end));
            (a < b).then(|| [pos[a - start], pos[b - start]])
        })
        .collect();
    Some((snippet, highlights))
}

/// First line of `text`, at most 120 chars.
fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() > SNIPPET_CHARS {
        let mut s: String = line.chars().take(SNIPPET_CHARS - 1).collect();
        s.push('…');
        s
    } else {
        line.to_string()
    }
}

fn outgoing_of(li: &LinkIndex, path: &str, doc: &DocEntry) -> Vec<OutLink> {
    let mut out = Vec::new();
    if is_note_path(path) {
        let dir = dir_of(path);
        for e in &doc.elinks {
            let Some(t) = note_link_target(&e.link) else { continue };
            let (key, _) = key_of_note_target(dir, t);
            out.push(OutLink {
                element_id: e.element_id.to_string(),
                container_id: None,
                kind: LinkKind::Shape,
                target: strip_ext(t.strip_suffix(".md").unwrap_or(t)).to_string(),
                label: None,
                resolved: path_of(li, li.resolve(&key)),
            });
        }
        return out;
    }
    for item in doc.items.iter().filter(|i| i.kind == ItemKind::Text) {
        text_links(&item.text, |l| {
            let d = li.resolve(&key_of_target(l.target));
            out.push(OutLink {
                element_id: item.element_id.to_string(),
                container_id: item.container_id.as_deref().map(str::to_string),
                kind: LinkKind::Text,
                target: l.target.to_string(),
                label: l.label.map(str::to_string),
                resolved: path_of(li, d),
            });
        });
    }
    let dir = dir_of(path);
    for e in &doc.elinks {
        let Some(f) = parse_link_field(&e.link) else { continue };
        let key = if f.form == FieldForm::Rel { key_of_rel(dir, &f.target) } else { key_of_target(&f.target) };
        out.push(OutLink {
            element_id: e.element_id.to_string(),
            container_id: None,
            kind: LinkKind::Shape,
            target: f.target,
            label: f.label,
            resolved: path_of(li, li.resolve(&key)),
        });
    }
    out
}

fn backlinks_of(li: &LinkIndex, docs: &HashMap<String, DocEntry>, d: u32) -> Vec<BackLink> {
    // (source path, order in source, link)
    let mut rows: Vec<(String, usize, BackLink)> = Vec::new();
    let mut seen: Vec<(u32, String, bool)> = Vec::new();
    for (s, h) in li.backlinks(d) {
        if s == d {
            continue;
        }
        let kind = LinkIndex::handle_kind(h);
        let elem = li.elem_id(s, h);
        if seen.iter().any(|(ss, e, k)| *ss == s && e == elem && *k == (kind == LinkKind::Shape)) {
            continue;
        }
        seen.push((s, elem.to_string(), kind == LinkKind::Shape));
        let src = li.path(s);
        let Some(doc) = docs.get(src) else { continue };
        let row = match kind {
            LinkKind::Text => {
                let Some((order, item)) = doc.items.iter().enumerate().find(|(_, i)| &*i.element_id == elem && i.kind == ItemKind::Text) else { continue };
                let Some((snippet, highlights)) = link_snippet(&item.text, |l| li.resolve(&key_of_target(l.target)) == d) else { continue };
                (order, BackLink { path: src.to_string(), element_id: elem.to_string(), container_id: item.container_id.as_deref().map(str::to_string), kind, snippet, highlights })
            }
            LinkKind::Shape => {
                let order = doc.items.len() + doc.elinks.iter().position(|l| &*l.element_id == elem).unwrap_or(0);
                let snippet = doc.items.iter().find(|i| i.container_id.as_deref() == Some(elem)).map(|i| first_line(&i.text)).unwrap_or_default();
                (order, BackLink { path: src.to_string(), element_id: elem.to_string(), container_id: None, kind, snippet, highlights: Vec::new() })
            }
        };
        rows.push((src.to_string(), row.0, row.1));
    }
    rows.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
    rows.into_iter().map(|r| r.2).collect()
}

/// Outgoing, unresolved and backlinks of `path`. The link index must be built.
pub fn links_response(index: &Index, path: &str) -> LinksResponse {
    let started = Instant::now();
    let mut resp = LinksResponse { path: path.to_string(), outgoing: Vec::new(), unresolved: Vec::new(), backlinks: Vec::new(), took_ms: 0.0 };
    if let Some((li, docs)) = index.links_and_docs() {
        if let Some(doc) = docs.get(path) {
            for l in outgoing_of(li, path, doc) {
                if l.resolved.is_some() {
                    resp.outgoing.push(l);
                } else {
                    resp.unresolved.push(l);
                }
            }
        }
        if let Some(d) = li.find_doc(path) {
            resp.backlinks = backlinks_of(li, docs, d);
        }
    }
    resp.took_ms = took(started);
    resp
}

/// Text that mentions the drawing's name without linking to it.
pub fn mentions_response(index: &Index, path: &str, limit: usize) -> MentionsResponse {
    let started = Instant::now();
    let mut resp = MentionsResponse { path: path.to_string(), mentions: Vec::new(), took_ms: 0.0 };
    let needle = normalize(strip_ext(name_of(path)));
    if let Some((li, docs)) = index.links_and_docs() {
        if let Some(d) = li.find_doc(path).filter(|_| !needle.is_empty()) {
            let mut cands: Vec<(String, usize)> = Vec::new();
            index.for_each_word_match(&needle, |p, doc, idx| {
                if p != path && !text_links_vec(doc.items.get(idx).text).iter().any(|l| li.resolve(&if is_note_path(p) { key_of_note_target(dir_of(p), l.target).0 } else { key_of_target(l.target) }) == d) {
                    cands.push((p.to_string(), idx));
                }
                cands.len() < MAX_MENTION_CANDIDATES
            });
            cands.sort();
            for (p, idx) in cands {
                if resp.mentions.len() >= limit {
                    break;
                }
                let item = docs[&p].items.get(idx);
                if let Some((snippet, highlights)) = word_snippet(&item.text, &needle) {
                    resp.mentions.push(BackLink { path: p, element_id: item.element_id.to_string(), container_id: item.container_id.as_deref().map(str::to_string), kind: LinkKind::Text, snippet, highlights });
                }
            }
        }
    }
    resp.took_ms = took(started);
    resp
}

/// Resolves a link as written (`[[x|y]]`, `x`, `vaultdraw://open?file=x`, `./x.excalidraw`)
/// from the drawing `from_path`.
pub fn resolve_raw(index: &Index, from_path: &str, raw: &str) -> Resolution {
    let none = Resolution { path: None, candidates: Vec::new() };
    let Some(li) = index.links() else { return none };
    let raw = raw.trim();
    if is_note_path(from_path) || raw.to_ascii_lowercase().ends_with(".md") {
        // Written in a note, or naming a note: `[[x]]`, `[[x#Heading|alias]]`, `x.md`.
        let body = raw.strip_prefix("![[").or_else(|| raw.strip_prefix("[[")).map(|r| r.trim_end_matches("]]")).unwrap_or(raw);
        let body = body.split('|').next().unwrap_or(body);
        let body = body.split('#').next().unwrap_or(body).trim();
        if !body.is_empty() && (is_note_path(from_path) || !body.starts_with("vaultdraw:")) {
            let (key, _) = key_of_note_target(dir_of(from_path), body);
            let d = li.resolve(&key);
            let mut candidates: Vec<String> = li.candidates(&key).into_iter().map(|c| li.path(c).to_string()).collect();
            candidates.sort();
            if candidates.len() < 2 {
                candidates.clear();
            }
            return Resolution { path: path_of(li, d), candidates };
        }
    }
    let key = match parse_link_field(raw) {
        Some(f) if f.form == FieldForm::Rel => key_of_rel(dir_of(from_path), &f.target),
        Some(f) => key_of_target(&f.target),
        None => key_of_target(raw.split('|').next().unwrap_or(raw)),
    };
    if key.is_empty() {
        return none;
    }
    let d = li.resolve(&key);
    let mut candidates: Vec<String> = li.candidates(&key).into_iter().map(|c| li.path(c).to_string()).collect();
    candidates.sort();
    if candidates.len() < 2 {
        candidates.clear();
    }
    Resolution { path: path_of(li, d), candidates }
}
