//! Rename/move plan: which links stop resolving to a moved drawing (they get new text), and
//! which links would silently resolve to a different drawing afterwards (re-pointed).
//!
//! The plan applies the path change to the link index, reads the key changes, and reverts it,
//! so it costs microseconds regardless of vault size (RESEARCH.md section 3.2).

use super::grammar::{parse_link_field, strip_ext, text_links, EXT};
use super::index::{LinkIndex, NONE};
use super::resolve::{dir_of, key_of_target, rel_path};
use super::rewrite::Replace;
use super::types::RePointed;
use crate::search::{is_indexed_name, DocEntry, Index};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// One drawing to rewrite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePlan {
    /// Path before the move (the key of `openPath` comparisons).
    pub from_path: String,
    /// Path after the move (where the file is rewritten).
    pub to_path: String,
    /// Element id to its replacements.
    pub elements: BTreeMap<String, Vec<Replace>>,
}

impl FilePlan {
    pub(crate) fn links(&self) -> u32 {
        self.elements.values().map(|v| v.len() as u32).sum()
    }
}

#[derive(Debug, Default)]
pub(crate) struct Plan {
    /// `(old, new)` path of every drawing that moves.
    pub moves: Vec<(String, String)>,
    pub files: Vec<FilePlan>,
    pub re_pointed: Vec<RePointed>,
}

/// Link field text of `elem` in the drawing at `path`.
fn field_text<'a>(docs: &'a HashMap<String, DocEntry>, path: &str, elem: &str) -> Option<&'a str> {
    docs.get(path)?.elinks.iter().find(|l| &*l.element_id == elem).map(|l| super::resolve::note_link_target(&l.link).unwrap_or(&l.link))
}

/// The text of the link as written in `elem` that has `key`.
fn written_target(docs: &HashMap<String, DocEntry>, path: &str, elem: &str, key: &str) -> Option<String> {
    let d = docs.get(path)?;
    for item in d.items.iter().filter(|i| &*i.element_id == elem) {
        let mut found = None;
        text_links(&item.text, |l| {
            if found.is_none() && key_of_target(l.target) == key {
                found = Some(l.target.to_string());
            }
        });
        if found.is_some() {
            return found;
        }
    }
    let text = field_text(docs, path, elem)?;
    if super::resolve::is_note_path(path) {
        return Some(strip_ext(text.strip_suffix(".md").unwrap_or(text)).to_string());
    }
    let f = parse_link_field(text)?;
    Some(f.target)
}

/// New relative text for a relative link whose old text was `old`.
fn rel_text(old: &str, new_dir: &str, target_stem: &str) -> String {
    // A note's stem keeps its `.md`; a drawing's stem has no extension.
    let ext = if super::resolve::is_note_path(target_stem) { "" } else { EXT };
    let mut p = format!("{}{ext}", rel_path(new_dir, target_stem));
    if !old.starts_with("./") && !old.starts_with("../") {
        if let Some(rest) = p.strip_prefix("./") {
            p = rest.to_string();
        }
    }
    p
}

#[derive(Default)]
struct Builder {
    /// (source doc old path, element id) -> replacements.
    map: BTreeMap<(String, String), Vec<Replace>>,
}

impl Builder {
    fn add(&mut self, src: &str, elem: &str, r: Replace) {
        let v = self.map.entry((src.to_string(), elem.to_string())).or_default();
        if !v.iter().any(|x| x.old_key == r.old_key) {
            v.push(r);
        }
    }
}

struct RelSource {
    doc: u32,
    elem: String,
    key: u32,
    target: u32,
    old_text: String,
}

fn moves_of(index: &Index, from: &str, to: &str) -> Vec<(String, String)> {
    let docs = index.docs();
    if docs.contains_key(from) {
        return if is_indexed_name(to) { vec![(from.to_string(), to.to_string())] } else { Vec::new() };
    }
    let prefix = format!("{from}/");
    let mut v: Vec<(String, String)> = docs.keys().filter(|p| p.starts_with(&prefix)).map(|p| (p.clone(), format!("{to}/{}", &p[prefix.len()..]))).collect();
    v.sort();
    v
}

/// Plans moving the drawing or folder `from` to `to`. Needs the link index (`ensure_links`).
pub(crate) fn plan_move(index: &mut Index, from: &str, to: &str) -> Plan {
    let moves = moves_of(index, from, to);
    let Some((li, docs)) = index.links_and_docs_mut() else { return Plan::default() };
    plan_with(li, docs, moves)
}

fn plan_with(li: &mut LinkIndex, docs: &HashMap<String, DocEntry>, moves: Vec<(String, String)>) -> Plan {
    let mut ch: Vec<(u32, String)> = Vec::with_capacity(moves.len());
    let mut revert: Vec<(u32, String)> = Vec::with_capacity(moves.len());
    let mut new_of: HashMap<u32, String> = HashMap::new();
    let mut old_of: HashMap<u32, String> = HashMap::new();
    for (old, new) in &moves {
        if let Some(d) = li.find_doc(old) {
            ch.push((d, new.clone()));
            revert.push((d, old.clone()));
            new_of.insert(d, new.clone());
            old_of.insert(d, old.clone());
        }
    }
    if ch.is_empty() {
        return Plan { moves, ..Plan::default() };
    }
    // Relative links of moved sources change meaning with the source's folder.
    let mut rel_src: Vec<RelSource> = Vec::new();
    for &(s, _) in &ch {
        for &(k, h) in li.out_links(s) {
            if LinkIndex::handle_rel(h) {
                let elem = li.elem_id(s, h).to_string();
                let old_text = field_text(docs, &old_of[&s], &elem).unwrap_or("").to_string();
                rel_src.push(RelSource { doc: s, elem, key: k, target: li.key_target(k), old_text });
            }
        }
    }
    let changes = li.change_paths(&ch);
    let mut b = Builder::default();
    let mut re_pointed = Vec::new();
    let src_old = |li: &LinkIndex, s: u32| old_of.get(&s).cloned().unwrap_or_else(|| li.path(s).to_string());
    let src_new_dir = |li: &LinkIndex, s: u32| dir_of(new_of.get(&s).map_or_else(|| li.path(s), |p| p.as_str())).to_string();
    for c in &changes {
        let key = li.key_str(c.key).to_string();
        let refs = li.key_refs(c.key).to_vec();
        if c.old != NONE && new_of.contains_key(&c.old) && c.new != c.old {
            let d = c.old;
            let stem = strip_ext(li.path(d)).to_string();
            let min_segments = if key.contains('/') { 2 } else { 1 };
            let new_target = li.shortest_unique(d, min_segments);
            for (s, h) in refs {
                let elem = li.elem_id(s, h).to_string();
                let src = src_old(li, s);
                if LinkIndex::handle_rel(h) {
                    let old_text = field_text(docs, &src, &elem).unwrap_or("");
                    if rel_text(old_text, &src_new_dir(li, s), &stem) == old_text {
                        continue;
                    }
                }
                b.add(&src, &elem, Replace { old_key: key.clone(), new_target: new_target.clone(), new_path: stem.clone() });
            }
        } else if c.old != NONE && !new_of.contains_key(&c.old) && c.new != NONE && c.new != c.old {
            for (s, h) in refs {
                let src = src_old(li, s);
                let elem = li.elem_id(s, h);
                re_pointed.push(RePointed {
                    target: written_target(docs, &src, elem, &key).unwrap_or_else(|| key.clone()),
                    path: src,
                    from: Some(li.path(c.old).to_string()),
                    to: Some(li.path(c.new).to_string()),
                });
            }
        }
    }
    for r in rel_src {
        if r.target == NONE || r.old_text.is_empty() {
            continue;
        }
        let stem = strip_ext(li.path(r.target)).to_string();
        if rel_text(&r.old_text, &src_new_dir(li, r.doc), &stem) != r.old_text {
            b.add(&old_of[&r.doc], &r.elem, Replace { old_key: li.key_str(r.key).to_string(), new_target: String::new(), new_path: stem });
        }
    }
    li.change_paths(&revert);
    re_pointed.sort_by(|a, b| (&a.path, &a.target).cmp(&(&b.path, &b.target)));
    let to_of: HashMap<&str, &str> = moves.iter().map(|(o, n)| (o.as_str(), n.as_str())).collect();
    let mut files: BTreeMap<String, FilePlan> = BTreeMap::new();
    for ((src, elem), reps) in b.map {
        let to_path = to_of.get(src.as_str()).map_or_else(|| src.clone(), |n| n.to_string());
        files.entry(src.clone()).or_insert_with(|| FilePlan { from_path: src.clone(), to_path, elements: BTreeMap::new() }).elements.insert(elem, reps);
    }
    Plan { moves, files: files.into_values().collect(), re_pointed }
}
