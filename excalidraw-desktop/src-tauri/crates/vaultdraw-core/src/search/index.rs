//! In-memory vault index: normalised text per drawing + linear substring scan.

use super::extract::{ElementLink, TextItem};
use super::packed::{ItemRef, PackedItems};
use crate::links::LinkIndex;
use super::normalize::{fold_with_map, normalize, Folded};
use super::tags::{doc_tags, key_under, split_tag_filters, DocTag};
use super::types::{ElementMatch, Scope, SearchHit, TagCount, TagSummary};
use memchr::memmem::Finder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_TERMS: usize = 8;
/// Occurrences examined per term when scoring a drawing.
const SCORE_HIT_CAP: usize = 16;
/// Occurrences examined per term when picking snippets of a returned drawing.
const SNIPPET_HIT_CAP: usize = 256;
const MAX_MATCHES: usize = 5;
const SNIPPET_CHARS: usize = 120;
const SNIPPET_LEAD: usize = 40;
const DRAWING_EXT: &str = ".excalidraw";

fn split_path(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        Some(i) => path.split_at(i + 1),
        None => ("", path),
    }
}

fn file_stem(name: &str) -> &str {
    let cut = name.len().saturating_sub(DRAWING_EXT.len());
    match name.get(cut..) {
        Some(ext) if ext.eq_ignore_ascii_case(DRAWING_EXT) => &name[..cut],
        _ => name,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocEntry {
    /// `(size, mtime_ms)` of the file the content was parsed from.
    pub stat: (u64, u64),
    /// False for name-only entries (content not read yet).
    pub parsed: bool,
    pub items: PackedItems,
    /// `link` fields of live elements (any non-empty value).
    pub elinks: Vec<ElementLink>,
    /// Content fingerprint of the file (`extract::fingerprint8`; all zero for name-only entries).
    pub hash8: [u8; 8],
    /// Normalised items joined with `\n`.
    buf: String,
    // Derived, rebuilt on load.
    #[serde(skip)]
    name_norm: String,
    #[serde(skip)]
    stem_off: u32,
    #[serde(skip)]
    bounds: Vec<u32>,
    /// Distinct `#tags` of the drawing, derived from `items`.
    #[serde(skip)]
    tags: Vec<DocTag>,
}

impl DocEntry {
    /// Name-only entry: searchable by path immediately, content fills in later.
    pub fn name_only(path: &str) -> DocEntry {
        let mut d = DocEntry { stat: (0, 0), parsed: false, items: PackedItems::default(), elinks: Vec::new(), hash8: [0; 8], buf: String::new(), name_norm: String::new(), stem_off: 0, bounds: Vec::new(), tags: Vec::new() };
        d.derive_name(path);
        d
    }

    /// Parsed entry. Items that normalise to nothing are dropped so items and buffer lines align.
    pub fn new(path: &str, stat: (u64, u64), items: Vec<TextItem>) -> DocEntry {
        let mut buf = String::new();
        let mut kept = Vec::with_capacity(items.len());
        let mut bounds = Vec::with_capacity(items.len());
        for item in items {
            let n = normalize(&item.text);
            if n.is_empty() {
                continue;
            }
            if !kept.is_empty() {
                buf.push('\n');
            }
            bounds.push(buf.len() as u32);
            buf.push_str(&n);
            kept.push(item);
        }
        buf.shrink_to_fit();
        let tags = doc_tags(kept.iter().map(|i| &*i.text));
        let mut d = DocEntry { stat, parsed: true, items: PackedItems::pack(kept), elinks: Vec::new(), hash8: [0; 8], buf, name_norm: String::new(), stem_off: 0, bounds, tags };
        d.derive_name(path);
        d
    }

    /// Attaches the element links and content hash of the parsed file.
    pub fn with_links(mut self, elinks: Vec<ElementLink>, hash8: [u8; 8]) -> DocEntry {
        self.elinks = elinks;
        self.hash8 = hash8;
        self
    }

    /// Re-derives the path-based fields after the drawing moved.
    /// `(key, display)` of each distinct `#tag` of the drawing.
    pub fn tag_pairs(&self) -> impl Iterator<Item = (&str, &str)> {
        self.tags.iter().map(|t| (&*t.key, &*t.display))
    }
    pub fn set_path(&mut self, path: &str) {
        self.derive_name(path);
    }

    fn derive_name(&mut self, path: &str) {
        let (dir, name) = split_path(path);
        let mut n = normalize(dir);
        self.stem_off = n.len() as u32;
        n.push_str(&normalize(file_stem(name)));
        n.shrink_to_fit();
        self.name_norm = n;
    }

    /// Rebuilds derived fields after deserialisation; false if the entry is inconsistent.
    pub fn rebuild(&mut self, path: &str) -> bool {
        self.derive_name(path);
        self.tags = doc_tags(self.items.iter().map(|i| i.text));
        self.bounds.clear();
        if !self.buf.is_empty() {
            self.bounds.push(0);
            self.bounds.extend(memchr::memchr_iter(b'\n', self.buf.as_bytes()).map(|i| i as u32 + 1));
        }
        self.bounds.shrink_to_fit();
        self.bounds.len() == self.items.len() && (self.parsed || self.items.is_empty())
    }

    fn item_text(&self, i: usize) -> &str {
        let start = self.bounds[i] as usize;
        let end = self.bounds.get(i + 1).map_or(self.buf.len(), |&b| b as usize - 1);
        &self.buf[start..end]
    }

    #[allow(dead_code)] // reached via `Index::approx_heap_bytes`
    fn heap_bytes(&self) -> usize {
        let items = self.items.heap_bytes();
        let elinks: usize = self.elinks.iter().map(|l| std::mem::size_of::<ElementLink>() + l.element_id.len() + l.link.len()).sum();
        items + elinks + self.buf.capacity() + self.name_norm.capacity() + self.bounds.capacity() * 4 + 48
    }
}

struct Term {
    text: String,
    finder: Finder<'static>,
}

fn parse_terms(query: &str) -> Vec<Term> {
    let mut out: Vec<Term> = Vec::new();
    for raw in normalize(query).split(' ').filter(|t| !t.is_empty()) {
        if out.len() == MAX_TERMS {
            break;
        }
        if !out.iter().any(|t| t.text == raw) {
            out.push(Term { text: raw.to_string(), finder: Finder::new(raw).into_owned() });
        }
    }
    out
}

fn is_boundary(c: Option<char>) -> bool {
    c.map_or(true, |c| !c.is_alphanumeric() || c as u32 >= 0x2E80)
}

fn word_start(hay: &str, s: usize) -> bool {
    is_boundary(hay[..s].chars().next_back())
}

/// Match quality: exact 10, whole word 8, word prefix 6, mid-word 3.
fn tier(hay: &str, s: usize, e: usize, exact: bool) -> f32 {
    if exact {
        10.0
    } else {
        match (word_start(hay, s), is_boundary(hay[e..].chars().next())) {
            (true, true) => 8.0,
            (true, false) => 6.0,
            _ => 3.0,
        }
    }
}

fn utf16_len(c: char) -> u32 {
    c.len_utf16() as u32
}

/// Sorted, merged char ranges to UTF-16 `[start, end)` pairs relative to `chars[window_start..]`.
fn to_utf16(chars: &[char], window: (usize, usize), base: u32, mut ranges: Vec<(usize, usize)>) -> Vec<[u32; 2]> {
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, b) in ranges {
        let (a, b) = (a.max(window.0), b.min(window.1));
        if a >= b {
            continue;
        }
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    let mut pos = vec![base; window.1 - window.0 + 1];
    for (i, &c) in chars[window.0..window.1].iter().enumerate() {
        pos[i + 1] = pos[i] + utf16_len(c);
    }
    merged.into_iter().map(|(a, b)| [pos[a - window.0], pos[b - window.0]]).collect()
}

fn term_ranges(folded: &Folded, terms: &[Term], cap: usize) -> Vec<(usize, usize)> {
    let bytes: Vec<(usize, usize)> = terms
        .iter()
        .flat_map(|t| t.finder.find_iter(folded.norm.as_bytes()).take(cap).map(move |s| (s, s + t.text.len())))
        .collect();
    folded.char_ranges(&bytes)
}

fn build_snippet(text: &str, terms: &[Term]) -> Option<(String, Vec<[u32; 2]>)> {
    let folded = fold_with_map(text);
    let ranges = term_ranges(&folded, terms, 64);
    let first = ranges.iter().map(|r| r.0).min()?;
    let n = folded.chars.len();
    let (mut start, mut end) = (0, n);
    if n > SNIPPET_CHARS {
        start = first.saturating_sub(SNIPPET_LEAD);
        end = (start + SNIPPET_CHARS).min(n);
        start = end.saturating_sub(SNIPPET_CHARS);
    }
    let mut snippet = String::new();
    let base = if start > 0 {
        snippet.push('…');
        1
    } else {
        0
    };
    snippet.extend(&folded.chars[start..end]);
    if end < n {
        snippet.push('…');
    }
    Some((snippet, to_utf16(&folded.chars, (start, end), base, ranges)))
}

/// One-line search-style snippet of `text` around the words of `needle` (UTF-16 highlights).
pub fn word_snippet(text: &str, needle: &str) -> Option<(String, Vec<[u32; 2]>)> {
    build_snippet(text, &parse_terms(needle))
}

/// UTF-16 `[start, end)` ranges of the matched terms in the stem of `name`, relative to the
/// original (uncollapsed) file name: a run of whitespace in the name counts as it is written.
fn name_highlights(name: &str, terms: &[Term]) -> Vec<[u32; 2]> {
    let stem_src = file_stem(name);
    let stem = fold_with_map(stem_src);
    let mut ranges = term_ranges(&stem, terms, 64);
    if ranges.is_empty() {
        return Vec::new();
    }
    // Original UTF-16 span of every folded char (a whitespace run folds to one space).
    let mut spans: Vec<(u32, u32)> = Vec::with_capacity(stem.chars.len());
    let (mut pos, mut run_start) = (0u32, None::<u32>);
    for c in stem_src.chars() {
        let w = c.len_utf16() as u32;
        if c.is_whitespace() {
            run_start.get_or_insert(pos);
        } else {
            if let Some(start) = run_start.take() {
                if !spans.is_empty() {
                    spans.push((start, pos));
                }
            }
            spans.push((pos, pos + w));
        }
        pos += w;
    }
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, b) in ranges {
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    merged.into_iter().filter_map(|(a, b)| Some([spans.get(a)?.0, spans.get(b.checked_sub(1)?)?.1])).collect()
}

struct ItemHit {
    idx: usize,
    mask: u8,
    word_start: bool,
}

/// Items of `d` containing any term, one entry per item, sorted by item index.
fn collect_item_hits(d: &DocEntry, terms: &[Term]) -> Vec<ItemHit> {
    let mut raw: Vec<(usize, usize, bool)> = Vec::new();
    for (ti, t) in terms.iter().enumerate() {
        for m in t.finder.find_iter(d.buf.as_bytes()).take(SNIPPET_HIT_CAP) {
            let idx = d.bounds.partition_point(|&b| b as usize <= m).saturating_sub(1);
            raw.push((idx, ti, word_start(&d.buf, m)));
        }
    }
    raw.sort_unstable();
    let mut hits: Vec<ItemHit> = Vec::new();
    for (idx, ti, ws) in raw {
        match hits.last_mut() {
            Some(h) if h.idx == idx => {
                h.mask |= 1 << ti;
                h.word_start |= ws;
            }
            _ => hits.push(ItemHit { idx, mask: 1 << ti, word_start: ws }),
        }
    }
    hits
}

struct Scored<'a> {
    path: &'a str,
    doc: &'a DocEntry,
    score: f32,
}

#[derive(Default)]
pub struct Index {
    docs: HashMap<String, DocEntry>,
    /// Built lazily on first use, then kept current by every mutation below.
    links: Option<Box<LinkIndex>>,
    /// Bumped by every mutation (lets the lazy link build detect concurrent changes).
    generation: u64,
    /// Encoded `vault_graph` bytes for one generation; dropped by every mutation.
    graph_cache: crate::links::GraphCache,
}

impl Index {
    pub fn from_docs(mut docs: HashMap<String, DocEntry>) -> Option<Index> {
        docs.iter_mut().all(|(p, d)| d.rebuild(p)).then_some(Index { docs, links: None, generation: 0, graph_cache: Default::default() })
    }
    pub fn links(&self) -> Option<&LinkIndex> {
        self.links.as_deref()
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    fn bump(&mut self) {
        self.generation += 1;
        self.graph_cache.clear();
    }
    /// The encoded vault graph, rebuilt only when a mutation happened since the last call
    /// (the encode walks the whole link index: ~20 ms at 50k drawings). None without a link index.
    pub fn graph_bytes(&self, encode: impl FnOnce(&LinkIndex) -> Vec<u8>) -> Option<std::sync::Arc<Vec<u8>>> {
        let li = self.links()?;
        Some(self.graph_cache.get_or_build(self.generation, || encode(li)))
    }
    /// Builds a link index from the current docs (read-only; install it with `install_links`).
    pub fn build_links(&self) -> LinkIndex {
        LinkIndex::build(self.docs.iter())
    }
    pub fn install_links(&mut self, links: LinkIndex) {
        self.links = Some(Box::new(links));
    }
    /// Both the link index and the docs, for queries that read text while resolving.
    pub fn links_and_docs(&self) -> Option<(&LinkIndex, &HashMap<String, DocEntry>)> {
        self.links.as_deref().map(|l| (l, &self.docs))
    }
    /// Mutable link index with read access to the docs (rename planning).
    pub fn links_and_docs_mut(&mut self) -> Option<(&mut LinkIndex, &HashMap<String, DocEntry>)> {
        self.bump(); // the caller may change the link index
        let Index { docs, links, .. } = self;
        links.as_deref_mut().map(|l| (l, &*docs))
    }

    pub fn docs(&self) -> &HashMap<String, DocEntry> {
        &self.docs
    }
    pub fn get(&self, path: &str) -> Option<&DocEntry> {
        self.docs.get(path)
    }
    pub fn contains(&self, path: &str) -> bool {
        self.docs.contains_key(path)
    }
    pub fn upsert(&mut self, path: String, entry: DocEntry) {
        self.bump();
        if let Some(l) = self.links.as_deref_mut() {
            l.upsert(&path, &entry);
        }
        self.docs.insert(path, entry);
    }
    pub fn remove(&mut self, path: &str) -> bool {
        self.bump();
        if let Some(l) = self.links.as_deref_mut() {
            l.remove(path);
        }
        self.docs.remove(path).is_some()
    }
    /// Removes everything under `prefix` (pass a directory path ending in `/`).
    pub fn remove_prefix(&mut self, prefix: &str) -> usize {
        self.retain(|p| !p.starts_with(prefix))
    }
    pub fn retain(&mut self, mut keep: impl FnMut(&str) -> bool) -> usize {
        self.bump();
        let before = self.docs.len();
        let mut removed: Vec<String> = Vec::new();
        self.docs.retain(|p, _| {
            let k = keep(p);
            if !k {
                removed.push(p.clone());
            }
            k
        });
        if let Some(l) = self.links.as_deref_mut() {
            l.remove_many(removed.iter().map(String::as_str));
        }
        before - self.docs.len()
    }
    /// Moves a drawing (`from` is a drawing path) or every drawing under a folder to `to`,
    /// keeping parsed content. Returns the `(old, new)` paths of the drawings that moved.
    pub fn move_docs(&mut self, from: &str, to: &str) -> Vec<(String, String)> {
        let prefix = format!("{from}/");
        let olds: Vec<String> = self.docs.keys().filter(|p| *p == from || p.starts_with(&prefix)).cloned().collect();
        let mut moved = Vec::with_capacity(olds.len());
        for old in olds {
            let new = if old == from { to.to_string() } else { format!("{to}/{}", &old[prefix.len()..]) };
            moved.push((old, new));
        }
        let entries: Vec<_> = moved.iter().filter_map(|(old, new)| self.docs.get(old).map(|_| (old.clone(), new.clone()))).collect();
        let mut taken = Vec::with_capacity(entries.len());
        for (old, new) in &entries {
            if let Some(d) = self.take(old) {
                taken.push((new.clone(), d));
            }
        }
        for (new, mut d) in taken {
            if !super::scan::is_drawing_name(&new) {
                continue;
            }
            d.set_path(&new);
            self.upsert(new, d);
        }
        moved
    }
    fn take(&mut self, path: &str) -> Option<DocEntry> {
        self.bump();
        if let Some(l) = self.links.as_deref_mut() {
            l.remove(path);
        }
        self.docs.remove(path)
    }
    /// `(drawings with content indexed, drawings known)`.
    pub fn counts(&self) -> (usize, usize) {
        (self.docs.values().filter(|d| d.parsed).count(), self.docs.len())
    }
    /// Calls `f(path, doc, item index)` for the first whole-word occurrence of the normalised
    /// `needle` in each text item (frame names excluded), until `f` returns false.
    pub fn for_each_word_match(&self, needle: &str, mut f: impl FnMut(&str, &DocEntry, usize) -> bool) {
        if needle.is_empty() {
            return;
        }
        let finder = Finder::new(needle);
        for (path, d) in &self.docs {
            let mut last = usize::MAX;
            for m in finder.find_iter(d.buf.as_bytes()) {
                let e = m + needle.len();
                if !word_start(&d.buf, m) || !is_boundary(d.buf[e..].chars().next()) {
                    continue;
                }
                let idx = d.bounds.partition_point(|&b| b as usize <= m).saturating_sub(1);
                if idx == last || d.items.get(idx).kind != super::extract::ItemKind::Text {
                    continue;
                }
                last = idx;
                if !f(path, d, idx) {
                    return;
                }
            }
        }
    }

    /// Drawings that carry tags, with their distinct tags (no item scan).
    pub fn tag_docs(&self) -> impl Iterator<Item = (&str, &[DocTag])> {
        self.docs.iter().filter(|(_, d)| !d.tags.is_empty()).map(|(p, d)| (p.as_str(), &d.tags[..]))
    }

    #[allow(dead_code)] // API for the tags feature
    /// Visits every text item of every drawing (for tag extraction without re-reading files).
    pub fn for_each_item(&self, mut f: impl FnMut(&str, ItemRef<'_>)) {
        for (path, d) in &self.docs {
            for item in d.items.iter() {
                f(path, item);
            }
        }
    }
    #[allow(dead_code)] // memory reporting (used by the perf test)
    pub fn approx_heap_bytes(&self) -> usize {
        let table = self.docs.capacity() * (std::mem::size_of::<String>() + std::mem::size_of::<DocEntry>() + 1);
        table + self.docs.iter().map(|(p, d)| p.capacity() + d.heap_bytes()).sum::<usize>()
    }

    /// Best score of `term` in `d` plus its content occurrence count; `None` when absent.
    fn score_term(&self, d: &DocEntry, t: &Term, scope: Scope) -> Option<(f32, usize)> {
        let mut best = 0.0f32;
        let mut count = 0;
        let mut found = false;
        if scope != Scope::Content {
            let name = d.name_norm.as_str();
            for s in t.finder.find_iter(name.as_bytes()) {
                found = true;
                let e = s + t.text.len();
                let exact = s == d.stem_off as usize && e == name.len();
                let weight = if s >= d.stem_off as usize { 10.0 } else { 2.0 };
                best = best.max(weight * tier(name, s, e, exact));
            }
        }
        if scope != Scope::Names {
            let buf = d.buf.as_str();
            let b = buf.as_bytes();
            for s in t.finder.find_iter(b).take(SCORE_HIT_CAP) {
                found = true;
                count += 1;
                let e = s + t.text.len();
                let exact = (s == 0 || b[s - 1] == b'\n') && (e == b.len() || b[e] == b'\n');
                best = best.max(tier(buf, s, e, exact));
            }
        }
        found.then_some((best, count))
    }

    fn score_doc(&self, d: &DocEntry, terms: &[Term], scope: Scope) -> Option<f32> {
        let mut total = 0.0;
        let mut extra = 0usize;
        for t in terms {
            let (best, count) = self.score_term(d, t, scope)?;
            total += best;
            extra += count.saturating_sub(1);
        }
        Some(((total + 8.0 * (1.0 + extra as f32).ln()) * 100.0).round() / 100.0)
    }

    fn build_hit(&self, path: &str, d: &DocEntry, score: f32, terms: &[Term], scope: Scope) -> SearchHit {
        let name = split_path(path).1.to_string();
        let name_highlights = if scope == Scope::Content { Vec::new() } else { name_highlights(&name, terms) };
        let mut matches = Vec::new();
        let mut match_count = 0;
        if scope != Scope::Names && !d.items.is_empty() {
            let mut hits = collect_item_hits(d, terms);
            match_count = hits.len() as u32;
            hits.sort_by_key(|h| (std::cmp::Reverse(h.mask.count_ones()), !h.word_start, h.idx));
            for h in hits.iter().take(MAX_MATCHES) {
                let item = d.items.get(h.idx);
                debug_assert_eq!(d.item_text(h.idx), normalize(item.text));
                if let Some((snippet, highlights)) = build_snippet(item.text, terms) {
                    matches.push(ElementMatch {
                        element_id: item.element_id.to_string(),
                        container_id: item.container_id.map(str::to_string),
                        kind: item.kind,
                        snippet,
                        highlights,
                    });
                }
            }
        }
        SearchHit { path: path.to_string(), name, score, name_highlights, matches, match_count }
    }

    /// Drawings whose name/path or text contains every whitespace-separated term and that carry
    /// every `tag:#word` filter (a parent tag matches its children), best first, at most
    /// `limit`; also the total number of matching drawings. Tag-only queries list by path.
    pub fn query(&self, q: &str, scope: Scope, limit: usize) -> (Vec<SearchHit>, usize) {
        let (text, filters) = split_tag_filters(q);
        let mut terms = parse_terms(&text);
        if (terms.is_empty() && filters.is_empty()) || limit == 0 {
            return (Vec::new(), 0);
        }
        let text_terms = terms.len();
        // Filters also act as highlight terms so tag-only results show the lines carrying the tag.
        for f in filters.iter().take(MAX_TERMS) {
            let t = format!("#{f}");
            terms.push(Term { finder: Finder::new(&t).into_owned(), text: t });
        }
        let has_filters = |d: &DocEntry| filters.iter().all(|f| d.tags.iter().any(|t| key_under(&t.key, f)));
        let mut scored: Vec<Scored> = self
            .docs
            .iter()
            .filter(|(_, doc)| has_filters(doc))
            .filter_map(|(path, doc)| {
                let score = if text_terms == 0 { Some(0.0) } else { self.score_doc(doc, &terms[..text_terms], scope) };
                score.map(|score| Scored { path, doc, score })
            })
            .collect();
        let total = scored.len();
        let cmp = |a: &Scored, b: &Scored| b.score.total_cmp(&a.score).then(a.path.len().cmp(&b.path.len())).then_with(|| a.path.cmp(b.path));
        if total > limit {
            scored.select_nth_unstable_by(limit, cmp);
            scored.truncate(limit);
        }
        scored.sort_by(cmp);
        let hits = scored.iter().map(|s| self.build_hit(s.path, s.doc, s.score, &terms, scope)).collect();
        (hits, total)
    }

    /// Every tag with the number of drawings carrying it or a child tag, plus each drawing's tags.
    pub fn tag_summary(&self) -> TagSummary {
        let mut counts: HashMap<String, (String, u32)> = HashMap::new();
        let mut by_path = HashMap::new();
        for (path, d) in &self.docs {
            if d.tags.is_empty() {
                continue;
            }
            let mut seen: Vec<&str> = Vec::new();
            for t in &d.tags {
                // Self and every ancestor (`a/b/c` -> `a`, `a/b`, `a/b/c`).
                let ends = t.key.match_indices('/').map(|(i, _)| i).chain(std::iter::once(t.key.len()));
                let dends = t.display.match_indices('/').map(|(i, _)| i).chain(std::iter::once(t.display.len()));
                for (ke, de) in ends.zip(dends) {
                    let key = &t.key[..ke];
                    if seen.contains(&key) {
                        continue;
                    }
                    seen.push(key);
                    let display = &t.display[..de];
                    let e = counts.entry(key.to_string()).or_insert_with(|| (display.to_string(), 0));
                    e.1 += 1;
                    if display < e.0.as_str() {
                        e.0 = display.to_string();
                    }
                }
            }
            by_path.insert(path.clone(), d.tags.iter().map(|t| t.display.to_string()).collect());
        }
        let mut tags: Vec<TagCount> = counts.into_iter().map(|(tag, (display, count))| TagCount { tag, display, count }).collect();
        tags.sort_by(|a, b| a.tag.cmp(&b.tag));
        TagSummary { tags, by_path }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use crate::search::extract::ItemKind;

    fn text(id: &str, container: Option<&str>, t: &str) -> TextItem {
        TextItem { element_id: id.into(), container_id: container.map(Into::into), kind: ItemKind::Text, text: t.into() }
    }

    fn index(docs: &[(&str, &[&str])]) -> Index {
        let mut idx = Index::default();
        for (path, texts) in docs {
            let items = texts.iter().enumerate().map(|(i, t)| text(&format!("e{i}"), None, t)).collect();
            idx.upsert(path.to_string(), DocEntry::new(path, (1, 1), items));
        }
        idx
    }

    fn paths(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter().map(|h| h.path.as_str()).collect()
    }

    #[test]
    fn and_semantics_across_name_and_content() {
        let idx = index(&[("auth.excalidraw", &["Login flow", "Token"]), ("other.excalidraw", &["login"]), ("misc/notes.excalidraw", &["token", "login"])]);
        let (hits, total) = idx.query("login token", Scope::All, 10);
        assert_eq!(total, 2);
        assert_eq!(paths(&hits).len(), 2);
        assert!(!paths(&hits).contains(&"other.excalidraw"));
        // name + content split across fields still matches
        let (hits, _) = idx.query("auth token", Scope::All, 10);
        assert_eq!(paths(&hits), vec!["auth.excalidraw"]);
    }

    #[test]
    fn prefix_midword_and_accent_insensitive() {
        let idx = index(&[("a.excalidraw", &["Dijkstra algorithm", "Café"])]);
        assert_eq!(idx.query("dijk", Scope::All, 5).1, 1);
        assert_eq!(idx.query("kstra", Scope::All, 5).1, 1);
        assert_eq!(idx.query("CAFE", Scope::All, 5).1, 1);
        assert_eq!(idx.query("zzz", Scope::All, 5).1, 0);
        assert_eq!(idx.query("   ", Scope::All, 5).1, 0);
    }

    #[test]
    fn cjk_substring_and_dakuten() {
        let idx = index(&[("a.excalidraw", &["数据库设计", "がっこう"])]);
        assert_eq!(idx.query("据库", Scope::Content, 5).1, 1);
        assert_eq!(idx.query("が", Scope::Content, 5).1, 1);
        assert_eq!(idx.query("か", Scope::Content, 5).1, 0);
    }

    #[test]
    fn scope_names_and_content() {
        let idx = index(&[("planning.excalidraw", &["budget"]), ("budget.excalidraw", &["x"])]);
        assert_eq!(paths(&idx.query("budget", Scope::Names, 5).0), vec!["budget.excalidraw"]);
        assert_eq!(paths(&idx.query("budget", Scope::Content, 5).0), vec!["planning.excalidraw"]);
        assert_eq!(idx.query("budget", Scope::All, 5).1, 2);
        // extension and nothing else never matches names
        assert_eq!(idx.query("excalidraw", Scope::Names, 5).1, 0);
    }

    #[test]
    fn ranking_name_beats_content_and_ties_prefer_short_paths() {
        let idx = index(&[
            ("notes.excalidraw", &["roadmap"]),
            ("roadmap.excalidraw", &["nothing"]),
            ("a/b/c/same.excalidraw", &["roadmap"]),
            ("same2.excalidraw", &["roadmap"]),
        ]);
        let (hits, _) = idx.query("roadmap", Scope::All, 10);
        assert_eq!(hits[0].path, "roadmap.excalidraw");
        assert_eq!(hits[1].path, "notes.excalidraw");
        assert_eq!(hits[2].path, "same2.excalidraw");
        assert_eq!(hits[3].path, "a/b/c/same.excalidraw");
        // exact whole-item beats mid-word
        let idx = index(&[("x.excalidraw", &["subtree"]), ("y.excalidraw", &["tree"])]);
        assert_eq!(idx.query("tree", Scope::Content, 5).0[0].path, "y.excalidraw");
    }

    #[test]
    fn limit_truncates_but_total_counts_all() {
        let docs: Vec<(String, Vec<&str>)> = (0..30).map(|i| (format!("d{i}.excalidraw"), vec!["hello"])).collect();
        let refs: Vec<(&str, &[&str])> = docs.iter().map(|(p, t)| (p.as_str(), t.as_slice())).collect();
        let (hits, total) = index(&refs).query("hello", Scope::All, 7);
        assert_eq!((hits.len(), total), (7, 30));
    }

    #[test]
    fn snippet_highlights_are_utf16_with_emoji_and_accents() {
        let idx = index(&[("a.excalidraw", &["😀 Café au lait"])]);
        let (hits, _) = idx.query("cafe", Scope::Content, 5);
        let m = &hits[0].matches[0];
        assert_eq!(m.snippet, "😀 Café au lait");
        // 😀 = 2 UTF-16 units, space = 1, so "Café" spans [3, 7).
        assert_eq!(m.highlights, vec![[3, 7]]);
        let units: Vec<u16> = m.snippet.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[3..7]).unwrap(), "Café");
    }

    #[test]
    fn long_snippets_are_cut_with_ellipses_around_the_match() {
        let long = format!("{} needle {}", "word ".repeat(60), "tail ".repeat(60));
        let idx = index(&[("a.excalidraw", &[long.as_str()])]);
        let m = &idx.query("needle", Scope::Content, 5).0[0].matches[0];
        assert!(m.snippet.starts_with('…') && m.snippet.ends_with('…'));
        assert!(m.snippet.chars().count() <= SNIPPET_CHARS + 2);
        let units: Vec<u16> = m.snippet.encode_utf16().collect();
        let [a, b] = m.highlights[0];
        assert_eq!(String::from_utf16(&units[a as usize..b as usize]).unwrap(), "needle");
    }

    #[test]
    fn matches_prefer_items_with_more_terms_and_report_count() {
        let idx = index(&[("a.excalidraw", &["alpha", "beta", "alpha beta", "alpha again", "alpha more", "alpha last", "alpha x"])]);
        let hit = &idx.query("alpha beta", Scope::Content, 5).0[0];
        assert_eq!(hit.matches[0].snippet, "alpha beta");
        assert_eq!(hit.matches.len(), MAX_MATCHES);
        assert_eq!(hit.match_count, 7);
        assert_eq!(hit.matches[0].element_id, "e2");
    }

    #[test]
    fn name_highlights_index_into_the_file_name() {
        let idx = index(&[("dir/Über Plan.excalidraw", &[])]);
        let hit = &idx.query("plan", Scope::Names, 5).0[0];
        assert_eq!(hit.name, "Über Plan.excalidraw");
        assert_eq!(hit.name_highlights, vec![[5, 9]]);
    }

    #[test]
    fn name_only_entries_match_and_remove_prefix_works() {
        let mut idx = Index::default();
        idx.upsert("f/a.excalidraw".into(), DocEntry::name_only("f/a.excalidraw"));
        idx.upsert("fx/b.excalidraw".into(), DocEntry::name_only("fx/b.excalidraw"));
        assert_eq!(idx.query("f", Scope::Names, 5).1, 2); // folder part of the path matches too
        assert_eq!(idx.counts(), (0, 2));
        assert_eq!(idx.remove_prefix("f/"), 1);
        assert!(idx.contains("fx/b.excalidraw"));
    }

    #[test]
    fn tag_filter_alone_lists_drawings_with_tagged_lines() {
        let idx = index(&[("a.excalidraw", &["#DSA notes", "plain"]), ("b/c.excalidraw", &["x #dsa/graphs y"]), ("d.excalidraw", &["#dsabc", "url http://x/#dsa"])]);
        let (hits, total) = idx.query("tag:#dsa", Scope::All, 10);
        assert_eq!(total, 2);
        assert_eq!(paths(&hits), vec!["a.excalidraw", "b/c.excalidraw"]);
        assert_eq!(hits[0].matches.len(), 1);
        assert_eq!(hits[0].matches[0].snippet, "#DSA notes");
        assert_eq!(hits[0].matches[0].highlights, vec![[0, 4]]);
        // child filter only matches the child
        assert_eq!(paths(&idx.query("tag:#dsa/graphs", Scope::All, 10).0), vec!["b/c.excalidraw"]);
        assert_eq!(idx.query("TAG:dsa", Scope::All, 10).1, 2);
        assert_eq!(idx.query("tag:#nope", Scope::All, 10).1, 0);
    }

    #[test]
    fn tag_filter_combines_with_text_and_other_tags() {
        let idx = index(&[("a.excalidraw", &["#dsa graph", "#todo"]), ("b.excalidraw", &["#dsa tree"]), ("c.excalidraw", &["graph only"])]);
        assert_eq!(paths(&idx.query("graph tag:#dsa", Scope::All, 10).0), vec!["a.excalidraw"]);
        assert_eq!(paths(&idx.query("tag:#dsa tag:#todo", Scope::All, 10).0), vec!["a.excalidraw"]);
        assert_eq!(idx.query("tree tag:#todo", Scope::All, 10).1, 0);
        assert_eq!(idx.query("tag:#", Scope::All, 10).1, 0);
    }

    #[test]
    fn tag_summary_counts_ancestors_once_and_lists_paths() {
        let idx = index(&[("a.excalidraw", &["#DSA/Graphs #dsa/trees"]), ("b.excalidraw", &["#dsa", "#Café"]), ("c.excalidraw", &["none"])]);
        let s = idx.tag_summary();
        let got: Vec<_> = s.tags.iter().map(|t| (t.tag.as_str(), t.display.as_str(), t.count)).collect();
        assert_eq!(got, vec![("cafe", "Café", 1), ("dsa", "DSA", 2), ("dsa/graphs", "DSA/Graphs", 1), ("dsa/trees", "dsa/trees", 1)]);
        assert_eq!(s.by_path["a.excalidraw"], vec!["DSA/Graphs", "dsa/trees"]);
        assert!(!s.by_path.contains_key("c.excalidraw"));
    }

    #[test]
    fn tags_survive_snapshot_rebuild() {
        let mut idx = index(&[("a.excalidraw", &["#x"])]);
        let mut d = idx.docs.remove("a.excalidraw").unwrap();
        d.tags.clear();
        assert!(d.rebuild("a.excalidraw"));
        assert_eq!(d.tags.len(), 1);
    }

    #[test]
    fn for_each_item_visits_everything() {
        let idx = index(&[("a.excalidraw", &["one", "two"]), ("b.excalidraw", &["three"])]);
        let mut n = 0;
        idx.for_each_item(|_, _| n += 1);
        assert_eq!(n, 3);
    }

    #[test]
    fn rebuild_detects_inconsistency() {
        let mut d = DocEntry::new("a.excalidraw", (1, 1), vec![text("a", None, "x"), text("b", None, "y")]);
        assert!(d.rebuild("a.excalidraw"));
        d.items = PackedItems::pack(vec![text("a", None, "x")]);
        assert!(!d.rebuild("a.excalidraw"));
    }
}
