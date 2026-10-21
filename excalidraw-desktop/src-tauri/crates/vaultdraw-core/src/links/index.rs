//! Key-indirected link index (RESEARCH.md section 3, measured in `spikes/rust-bench`).
//!
//! ```text
//! doc --fwd--> (key, element)     key --refs--> [(doc, element)]     key --target--> doc | NONE
//! ```
//! A key is a normalised link target (or, for relative links, the normalised vault path they
//! point at). Resolution lives on the key, so a rename, move or create only re-resolves keys;
//! per-link data is never touched. Backlinks of a doc are the refs of the keys that resolve to
//! it. Unresolved links are keys with target `NONE`; creating a drawing re-resolves the keys
//! sharing its basename. The index is not persisted: it is built lazily from the search index
//! and then maintained by `search::Index::{upsert, remove, retain}`.

use super::grammar::{parse_link_field, text_links, FieldForm};
use super::resolve::{base_of, dir_of, key_of_path, key_of_rel, key_of_target};
use super::types::LinkKind;
use crate::search::{DocEntry, ItemKind};
use std::{
    collections::HashMap,
    hash::{BuildHasherDefault, Hasher},
    sync::Arc,
};

/// FxHash: the keys are short local strings, so a fast non-cryptographic hash is enough
/// (about 3x faster than SipHash on the build path).
#[derive(Default, Clone, Copy)]
pub struct Fx(u64);

const SEED: u64 = 0x517c_c1b7_2722_0a95;

impl Hasher for Fx {
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            self.0 = (self.0.rotate_left(5) ^ u64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])).wrapping_mul(SEED);
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut b = [0u8; 8];
            b[..rest.len()].copy_from_slice(rest);
            self.0 = (self.0.rotate_left(5) ^ u64::from_le_bytes(b)).wrapping_mul(SEED);
        }
    }
    fn write_u8(&mut self, i: u8) {
        self.0 = (self.0.rotate_left(5) ^ u64::from(i)).wrapping_mul(SEED);
    }
    fn finish(&self) -> u64 {
        self.0
    }
}

type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;

pub const NONE: u32 = u32::MAX;
const SHAPE: u32 = 1 << 31;
const REL: u32 = 1 << 30;
const OFFSET: u32 = REL - 1;

/// One link found in a drawing.
pub struct RawLink<'a> {
    pub elem: &'a str,
    pub kind: LinkKind,
    pub rel: bool,
    pub key: String,
}

/// Every drawing link of `doc` (text links first, in item order; then link fields).
pub fn raw_links<'a>(path: &str, doc: &'a DocEntry) -> Vec<RawLink<'a>> {
    let mut out = Vec::new();
    for item in doc.items.iter().filter(|i| i.kind == ItemKind::Text) {
        text_links(&item.text, |l| out.push(RawLink { elem: &item.element_id, kind: LinkKind::Text, rel: false, key: key_of_target(l.target) }));
    }
    let dir = dir_of(path);
    for e in &doc.elinks {
        let Some(f) = parse_link_field(&e.link) else { continue };
        let rel = f.form == FieldForm::Rel;
        let key = if rel { key_of_rel(dir, &f.target) } else { key_of_target(&f.target) };
        out.push(RawLink { elem: &e.element_id, kind: LinkKind::Shape, rel, key });
    }
    out
}

struct Doc {
    path: Box<str>,
    npath: Arc<str>,
    /// Element ids of this drawing's links: `[len u8][bytes]…`; link handles point into it.
    ids: Box<[u8]>,
    /// `(key, handle)`, sorted, deduplicated.
    fwd: Box<[(u32, u32)]>,
    /// Keys currently resolving to this doc.
    keys_of: Vec<u32>,
    /// This drawing's distinct `#tags` as `tag_variants` ids (for the graph export).
    tags: Box<[u32]>,
}

struct Key {
    s: Arc<str>,
    target: u32,
    refs: Vec<(u32, u32)>,
}

#[derive(Default)]
pub struct LinkIndex {
    docs: Vec<Doc>,
    /// Live doc ids in vault-path order, maintained on add/remove/rename (the graph export's
    /// node order, so the first export never sorts).
    sorted: Vec<u32>,
    free_docs: Vec<u32>,
    by_path: FxMap<Arc<str>, u32>,
    by_base: FxMap<Arc<str>, Vec<u32>>,
    keys: Vec<Key>,
    free_keys: Vec<u32>,
    key_ids: FxMap<Arc<str>, u32>,
    keys_by_base: FxMap<Arc<str>, Vec<u32>>,
    /// Tag interning for the graph export: normalised tag key -> id, and every distinct
    /// `(display, key id)` seen (append-only; a few entries per vault).
    tag_keys: FxMap<Box<str>, u32>,
    tag_variants: Vec<(Box<str>, u32)>,
    tag_variant_ids: FxMap<Box<str>, u32>,
}

/// One planned path change.
pub struct KeyChange {
    pub key: u32,
    pub old: u32,
    pub new: u32,
}

fn elem_at(ids: &[u8], handle: u32) -> &str {
    let o = (handle & OFFSET) as usize;
    let n = ids[o] as usize;
    std::str::from_utf8(&ids[o + 1..o + 1 + n]).unwrap_or("")
}

fn suffix_matches(p: &str, nk: &str) -> bool {
    p.len() > nk.len() && p.ends_with(nk) && p.as_bytes()[p.len() - nk.len() - 1] == b'/'
}

impl LinkIndex {
    /// Builds the index from every drawing (docs first, so each key resolves once).
    pub fn build<'a>(docs: impl Iterator<Item = (&'a String, &'a DocEntry)>) -> LinkIndex {
        let docs: Vec<_> = docs.collect();
        let mut ix = LinkIndex::default();
        ix.docs.reserve(docs.len());
        ix.by_path.reserve(docs.len());
        ix.by_base.reserve(docs.len());
        let ids: Vec<u32> = docs.iter().map(|(p, _)| ix.add_doc_unsorted(p)).collect();
        ix.sort_docs();
        for (id, (path, doc)) in ids.into_iter().zip(docs) {
            if doc.parsed {
                ix.set_links(id, raw_links(path, doc));
            }
            ix.set_tags(id, doc);
        }
        ix
    }

    pub fn n_keys(&self) -> usize {
        self.keys.len() - self.free_keys.len()
    }

    // ---- lookups ----

    pub fn find_doc(&self, path: &str) -> Option<u32> {
        let np = key_of_path(path);
        self.by_base.get(base_of(&np))?.iter().copied().find(|&d| &*self.docs[d as usize].path == path)
    }
    pub fn path(&self, d: u32) -> &str {
        &self.docs[d as usize].path
    }
    /// `(id, path)` of every live drawing (free slots have an empty path).
    pub fn live_docs(&self) -> impl Iterator<Item = (u32, &str)> + '_ {
        self.docs.iter().enumerate().filter(|(_, d)| !d.path.is_empty()).map(|(i, d)| (i as u32, &*d.path))
    }
    pub fn out_links(&self, d: u32) -> &[(u32, u32)] {
        &self.docs[d as usize].fwd
    }
    pub fn key_str(&self, k: u32) -> &str {
        &self.keys[k as usize].s
    }
    pub fn key_target(&self, k: u32) -> u32 {
        self.keys[k as usize].target
    }
    pub fn key_refs(&self, k: u32) -> &[(u32, u32)] {
        &self.keys[k as usize].refs
    }
    pub fn elem_id(&self, doc: u32, handle: u32) -> &str {
        elem_at(&self.docs[doc as usize].ids, handle)
    }
    pub fn handle_kind(handle: u32) -> LinkKind {
        if handle & SHAPE != 0 {
            LinkKind::Shape
        } else {
            LinkKind::Text
        }
    }
    pub fn handle_rel(handle: u32) -> bool {
        handle & REL != 0
    }
    /// `(source doc, handle)` of every link resolving to `d`.
    pub fn backlinks(&self, d: u32) -> impl Iterator<Item = (u32, u32)> + '_ {
        self.docs[d as usize].keys_of.iter().flat_map(move |&k| self.keys[k as usize].refs.iter().copied())
    }
    pub fn n_backlinks(&self, d: u32) -> usize {
        self.docs[d as usize].keys_of.iter().map(|&k| self.keys[k as usize].refs.len()).sum()
    }

    /// Drawings a key matches: the exact path, else every path ending in the key (by basename).
    pub fn candidates(&self, nk: &str) -> Vec<u32> {
        if let Some(&d) = self.by_path.get(nk) {
            return vec![d];
        }
        let Some(c) = self.by_base.get(base_of(nk)) else { return Vec::new() };
        let slash = nk.contains('/');
        c.iter().copied().filter(|&d| !slash || suffix_matches(&self.docs[d as usize].npath, nk)).collect()
    }

    /// Exact path, then unique basename, then the shortest path (ties lexicographic).
    pub fn resolve(&self, nk: &str) -> u32 {
        if let Some(&d) = self.by_path.get(nk) {
            return d;
        }
        let Some(c) = self.by_base.get(base_of(nk)) else { return NONE };
        let slash = nk.contains('/');
        let mut best = NONE;
        for &d in c {
            let p = &self.docs[d as usize].npath;
            if slash && !suffix_matches(p, nk) {
                continue;
            }
            if best == NONE || (p.len(), &**p) < (self.docs[best as usize].npath.len(), &*self.docs[best as usize].npath) {
                best = d;
            }
        }
        best
    }

    fn count_suffix(&self, nk: &str) -> usize {
        let Some(c) = self.by_base.get(base_of(nk)) else { return 0 };
        let slash = nk.contains('/');
        c.iter()
            .filter(|&&d| {
                let p = &self.docs[d as usize].npath;
                !slash || **p == *nk || suffix_matches(p, nk)
            })
            .count()
    }

    /// Shortest link text (at least `min_segments` path segments) that resolves to `d` alone.
    pub fn shortest_unique(&self, d: u32, min_segments: usize) -> String {
        let path = self.path(d);
        let stem = super::grammar::strip_ext(path);
        let segs: Vec<&str> = stem.split('/').collect();
        for take in min_segments.max(1)..segs.len() {
            let cand = segs[segs.len() - take..].join("/");
            if self.count_suffix(&key_of_target(&cand)) == 1 {
                return cand;
            }
        }
        stem.to_string()
    }

    // ---- maintenance ----

    fn base_add(&mut self, id: u32, np: &Arc<str>) {
        self.by_path.insert(np.clone(), id);
        let b = base_of(np);
        match self.by_base.get_mut(b) {
            Some(v) => v.push(id),
            None => {
                self.by_base.insert(Arc::from(b), vec![id]);
            }
        }
    }
    fn base_remove(&mut self, id: u32) {
        let np = self.docs[id as usize].npath.clone();
        if self.by_path.get(&*np) == Some(&id) {
            self.by_path.remove(&*np);
        }
        if let Some(v) = self.by_base.get_mut(base_of(&np)) {
            v.retain(|&x| x != id);
            if v.is_empty() {
                self.by_base.remove(base_of(&np));
            }
        }
    }
    fn keys_for_base(&self, b: &str) -> Vec<u32> {
        self.keys_by_base.get(b).cloned().unwrap_or_default()
    }

    /// Re-resolves `ks`; returns the keys whose target changed.
    fn re_resolve(&mut self, ks: &[u32]) -> Vec<KeyChange> {
        let mut out = Vec::new();
        for &k in ks {
            let nk = self.keys[k as usize].s.clone();
            let new = self.resolve(&nk);
            let old = self.keys[k as usize].target;
            if new != old {
                if old != NONE {
                    let v = &mut self.docs[old as usize].keys_of;
                    if let Some(p) = v.iter().position(|&x| x == k) {
                        v.swap_remove(p);
                    }
                }
                if new != NONE {
                    self.docs[new as usize].keys_of.push(k);
                }
                self.keys[k as usize].target = new;
                out.push(KeyChange { key: k, old, new });
            }
        }
        out
    }

    /// Registers a drawing and resolves pending links to it. Returns its id.
    pub fn add_doc(&mut self, path: &str) -> u32 {
        let id = self.add_doc_unsorted(path);
        self.order_insert(id);
        id
    }

    /// Doc ids in vault-path order.
    pub fn sorted_docs(&self) -> &[u32] {
        &self.sorted
    }

    fn sort_docs(&mut self) {
        let docs = &self.docs;
        self.sorted = (0..docs.len() as u32).filter(|&i| !docs[i as usize].path.is_empty()).collect();
        self.sorted.sort_unstable_by(|&a, &b| docs[a as usize].path.cmp(&docs[b as usize].path));
    }

    fn order_pos(&self, path: &str) -> usize {
        self.sorted.partition_point(|&i| &*self.docs[i as usize].path < path)
    }

    fn order_insert(&mut self, id: u32) {
        let at = self.order_pos(&self.docs[id as usize].path);
        self.sorted.insert(at, id);
    }

    fn order_remove(&mut self, id: u32) {
        let at = self.order_pos(&self.docs[id as usize].path);
        if self.sorted.get(at) == Some(&id) {
            self.sorted.remove(at);
        }
    }

    fn add_doc_unsorted(&mut self, path: &str) -> u32 {
        let np: Arc<str> = Arc::from(key_of_path(path));
        let doc = Doc { path: path.into(), npath: np.clone(), ids: Box::default(), fwd: Box::default(), keys_of: Vec::new(), tags: Box::default() };
        let id = match self.free_docs.pop() {
            Some(i) => {
                self.docs[i as usize] = doc;
                i
            }
            None => {
                self.docs.push(doc);
                (self.docs.len() - 1) as u32
            }
        };
        self.base_add(id, &np);
        let ks = self.keys_for_base(base_of(&np));
        self.re_resolve(&ks);
        id
    }

    pub fn remove_doc(&mut self, d: u32) {
        self.order_remove(d);
        self.remove_doc_unordered(d);
    }

    /// Removes many drawings; a bulk removal (e.g. trashing a folder) prunes the
    /// path order once instead of one O(n) shift per drawing.
    pub fn remove_many<'a>(&mut self, paths: impl IntoIterator<Item = &'a str>) {
        let ids: Vec<u32> = paths.into_iter().filter_map(|p| self.find_doc(p)).collect();
        if ids.len() <= 32 {
            ids.into_iter().for_each(|d| self.remove_doc(d));
            return;
        }
        for d in ids {
            self.remove_doc_unordered(d);
        }
        let docs = &self.docs;
        self.sorted.retain(|&i| !docs[i as usize].path.is_empty());
    }

    fn remove_doc_unordered(&mut self, d: u32) {
        self.set_links(d, Vec::new());
        let mut ks = self.docs[d as usize].keys_of.clone();
        let np = self.docs[d as usize].npath.clone();
        self.base_remove(d);
        self.docs[d as usize] = Doc { path: Box::default(), npath: Arc::from(""), ids: Box::default(), fwd: Box::default(), keys_of: Vec::new(), tags: Box::default() };
        self.free_docs.push(d);
        ks.extend(self.keys_for_base(base_of(&np)));
        ks.sort_unstable();
        ks.dedup();
        self.re_resolve(&ks);
    }

    fn intern_key(&mut self, t: &str) -> u32 {
        if let Some(&k) = self.key_ids.get(t) {
            return k;
        }
        let rc: Arc<str> = Arc::from(t);
        let target = self.resolve(&rc);
        let key = Key { s: rc.clone(), target, refs: Vec::new() };
        let k = match self.free_keys.pop() {
            Some(i) => {
                self.keys[i as usize] = key;
                i
            }
            None => {
                self.keys.push(key);
                (self.keys.len() - 1) as u32
            }
        };
        self.key_ids.insert(rc.clone(), k);
        if target != NONE {
            self.docs[target as usize].keys_of.push(k);
        }
        let b = base_of(&rc);
        match self.keys_by_base.get_mut(b) {
            Some(v) => v.push(k),
            None => {
                self.keys_by_base.insert(Arc::from(b), vec![k]);
            }
        }
        k
    }

    fn free_key(&mut self, k: u32) {
        let s = std::mem::replace(&mut self.keys[k as usize].s, Arc::from(""));
        self.key_ids.remove(&*s);
        let b = base_of(&s);
        if let Some(v) = self.keys_by_base.get_mut(b) {
            v.retain(|&x| x != k);
            if v.is_empty() {
                self.keys_by_base.remove(b);
            }
        }
        let t = self.keys[k as usize].target;
        if t != NONE {
            self.docs[t as usize].keys_of.retain(|&x| x != k);
        }
        self.keys[k as usize].target = NONE;
        self.keys[k as usize].refs = Vec::new();
        self.free_keys.push(k);
    }

    /// Replaces the forward links of `doc`. A no-op when nothing changed.
    pub fn set_links(&mut self, doc: u32, raw: Vec<RawLink<'_>>) {
        // New element-id blob and handles.
        let mut ids: Vec<u8> = Vec::new();
        let mut seen: Vec<(&str, u32)> = Vec::new();
        let mut new: Vec<(u32, u32)> = Vec::with_capacity(raw.len());
        for r in &raw {
            if r.elem.len() > 255 || r.key.is_empty() {
                continue;
            }
            let off = match seen.iter().find(|(e, _)| *e == r.elem) {
                Some(&(_, o)) => o,
                None => {
                    let o = ids.len() as u32;
                    ids.push(r.elem.len() as u8);
                    ids.extend_from_slice(r.elem.as_bytes());
                    seen.push((r.elem, o));
                    o
                }
            };
            let flags = if r.kind == LinkKind::Shape { SHAPE } else { 0 } | if r.rel { REL } else { 0 };
            let k = self.intern_key(&r.key);
            new.push((k, off | flags));
        }
        new.sort_unstable();
        new.dedup();
        let old = &self.docs[doc as usize].fwd;
        // Same keys and same element ids and flags: nothing to do (handles may differ).
        if old.len() == new.len() && old.iter().zip(&new).all(|(o, n)| o.0 == n.0 && (o.1 & !OFFSET) == (n.1 & !OFFSET) && elem_at(&self.docs[doc as usize].ids, o.1) == elem_at(&ids, n.1)) {
            // Interned keys that this call created but nobody references would leak.
            for &(k, _) in &new {
                self.drop_if_orphan(k);
            }
            return;
        }
        let old = std::mem::take(&mut self.docs[doc as usize].fwd);
        for &(k, h) in old.iter() {
            let refs = &mut self.keys[k as usize].refs;
            if let Some(p) = refs.iter().position(|&x| x == (doc, h)) {
                refs.swap_remove(p);
            }
        }
        let old_keys: Vec<u32> = old.iter().map(|o| o.0).collect();
        for &(k, h) in &new {
            self.keys[k as usize].refs.push((doc, h));
        }
        let d = &mut self.docs[doc as usize];
        d.ids = ids.into_boxed_slice();
        d.fwd = new.into_boxed_slice();
        for k in old_keys {
            self.drop_if_orphan(k);
        }
    }

    fn drop_if_orphan(&mut self, k: u32) {
        if self.keys[k as usize].refs.is_empty() && !self.keys[k as usize].s.is_empty() {
            self.free_key(k);
        }
    }

    /// Inserts or refreshes one drawing from its parsed entry.
    pub fn upsert(&mut self, path: &str, doc: &DocEntry) {
        let id = self.find_doc(path).unwrap_or_else(|| self.add_doc(path));
        self.set_tags(id, doc);
        self.set_links(id, if doc.parsed { raw_links(path, doc) } else { Vec::new() });
    }

    fn set_tags(&mut self, id: u32, doc: &DocEntry) {
        let ids: Box<[u32]> = doc.tag_pairs().map(|(key, display)| self.tag_variant(key, display)).collect();
        self.docs[id as usize].tags = ids;
    }

    fn tag_variant(&mut self, key: &str, display: &str) -> u32 {
        // A display always maps to the same key, so the display identifies the variant.
        if let Some(&v) = self.tag_variant_ids.get(display) {
            return v;
        }
        let next = self.tag_keys.len() as u32;
        let k = *self.tag_keys.entry(key.into()).or_insert(next);
        let v = self.tag_variants.len() as u32;
        self.tag_variants.push((display.into(), k));
        self.tag_variant_ids.insert(display.into(), v);
        v
    }

    /// Tag keys interned so far (an upper bound for the export's per-key scratch).
    pub fn n_tag_keys(&self) -> usize {
        self.tag_keys.len()
    }
    /// `(display, key id)` of a doc's tag variant.
    pub fn tag_variant_of(&self, v: u32) -> (&str, u32) {
        let (display, key) = &self.tag_variants[v as usize];
        (display, *key)
    }
    pub fn doc_tags(&self, d: u32) -> &[u32] {
        &self.docs[d as usize].tags
    }

    pub fn remove(&mut self, path: &str) {
        if let Some(id) = self.find_doc(path) {
            self.remove_doc(id);
        }
    }

    /// Applies path changes `(doc, new path)`, re-resolving the affected keys. Returns the keys
    /// whose target changed. Reverting is the same call with the old paths.
    pub fn change_paths(&mut self, ch: &[(u32, String)]) -> Vec<KeyChange> {
        let mut affected: Vec<u32> = Vec::new();
        // A few renames patch the order; a bulk move re-sorts once.
        let patch = ch.len() <= 32;
        for (d, _) in ch {
            if patch {
                self.order_remove(*d);
            }
            affected.extend(&self.docs[*d as usize].keys_of);
            let nb = base_of(&self.docs[*d as usize].npath).to_string();
            affected.extend(self.keys_for_base(&nb));
            self.base_remove(*d);
        }
        for (d, np) in ch {
            let k: Arc<str> = Arc::from(key_of_path(np));
            let doc = &mut self.docs[*d as usize];
            doc.path = np.as_str().into();
            doc.npath = k.clone();
            self.base_add(*d, &k);
            affected.extend(self.keys_for_base(base_of(&k)));
            if patch {
                self.order_insert(*d);
            }
        }
        if !patch {
            self.sort_docs();
        }
        affected.sort_unstable();
        affected.dedup();
        self.re_resolve(&affected)
    }

    /// Heap held by the index (capacities plus a 16-byte allocator header per allocation).
    pub fn approx_heap_bytes(&self) -> usize {
        const HDR: usize = 16;
        let arc = |s: &Arc<str>| s.len() + 16 + HDR;
        let vec = |cap: usize, sz: usize| if cap == 0 { 0 } else { cap * sz + HDR };
        let mut n = self.sorted.capacity() * 4 + self.docs.capacity() * std::mem::size_of::<Doc>() + self.keys.capacity() * std::mem::size_of::<Key>();
        for d in &self.docs {
            n += if d.path.is_empty() { 0 } else { d.path.len() + HDR };
            n += arc(&d.npath) + vec(d.ids.len(), 1) + vec(d.fwd.len(), 8) + vec(d.keys_of.capacity(), 4);
        }
        for k in &self.keys {
            n += arc(&k.s) + vec(k.refs.capacity(), 8);
        }
        let map = |cap: usize, entry: usize| cap * (entry + 1) * 8 / 7;
        n += map(self.by_path.capacity(), 16 + 4) + map(self.key_ids.capacity(), 16 + 4);
        n += map(self.by_base.capacity(), 16 + 24) + map(self.keys_by_base.capacity(), 16 + 24);
        n += self.by_base.iter().map(|(k, v)| arc(k) + vec(v.capacity(), 4)).sum::<usize>();
        n += self.keys_by_base.iter().map(|(k, v)| arc(k) + vec(v.capacity(), 4)).sum::<usize>();
        n
    }
}
