//! Whole-vault graph export for the graph view (P3). Command: `vault_graph(handle)` returns the
//! raw bytes below (no JSON). Every toolbar toggle (orphans, unresolved, tags) is a client-side
//! mask over this one export, so toggling never calls back into Rust.
//!
//! Binary format `VDG1` (little-endian; every column is u32 and 4-byte aligned, so the
//! renderer takes zero-copy `Uint32Array` views; the string blob comes last):
//!
//! ```text
//! header   8 x u32   magic "VDG1" (0x31474456), version 1, nodeCount, edgeCount,
//!                    folderCount, stringBytes, 0, 0
//! folder   u32[N]    top-level folder index per node (0 = vault root, also for ghosts and tags)
//! outDeg   u32[N]    outgoing edges (tag edges included)
//! inDeg    u32[N]    incoming edges (tag edges included)
//! flags    u32[N]    bit0 UNRESOLVED (ghost target), bit1 TAG, bit2 ORPHAN (drawing without
//!                    any link in or out, tag edges ignored)
//! edges    u32[2E]   (src, dst) pairs, directed, deduplicated, no self loops, grouped by src
//! nodeOff  u32[N+1]  label offsets into the blob
//! folderOff u32[F+1] folder-name offsets into the blob
//! blob     bytes     UTF-8: node labels, then folder names
//! ```
//! Node order: drawings sorted by vault path, then unresolved targets (first-seen order), then
//! tags (first-seen order). Labels: vault path without `.excalidraw` for drawings, the
//! normalised link target for ghosts, `#display` for tags. Folders: index 0 is the root
//! (name ""), then top-level folders in sorted order.

use super::grammar::strip_ext;
use super::index::{Fx, LinkIndex, NONE};
use std::{collections::HashMap, hash::BuildHasherDefault};

pub const MAGIC: u32 = 0x3147_4456;
pub const VERSION: u32 = 1;
pub const UNRESOLVED: u32 = 1;
pub const TAG: u32 = 2;
pub const ORPHAN: u32 = 4;
const TAG_BIT: u32 = 1 << 31;

type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;

/// Strings packed in one buffer (one allocation instead of one per node).
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Strs {
    blob: String,
    ends: Vec<u32>,
}

impl Strs {
    fn with_capacity(n: usize) -> Strs {
        Strs { blob: String::with_capacity(n * 16), ends: Vec::with_capacity(n) }
    }
    pub fn push(&mut self, s: &str) {
        self.blob.push_str(s);
        self.ends.push(self.blob.len() as u32);
    }
    fn push_tag(&mut self, display: &str) {
        self.blob.push('#');
        self.push(display);
    }
    pub fn len(&self) -> usize {
        self.ends.len()
    }
    pub fn get(&self, i: usize) -> &str {
        let start = if i == 0 { 0 } else { self.ends[i - 1] as usize };
        &self.blob[start..self.ends[i] as usize]
    }
    fn extend(&mut self, other: Strs) {
        let base = self.blob.len() as u32;
        self.blob.push_str(&other.blob);
        self.ends.extend(other.ends.iter().map(|e| e + base));
    }
    #[cfg(test)]
    pub fn to_vec(&self) -> Vec<&str> {
        (0..self.len()).map(|i| self.get(i)).collect()
    }
}

/// The decoded-in-memory graph (also what the encoder serialises).
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Graph {
    pub folder: Vec<u32>,
    pub out_deg: Vec<u32>,
    pub in_deg: Vec<u32>,
    pub flags: Vec<u32>,
    pub edges: Vec<u32>,
    pub labels: Strs,
    pub folders: Strs,
}

fn top_folder(path: &str) -> &str {
    path.find('/').map_or("", |i| &path[..i])
}

/// Builds the graph from the link index alone (it keeps the drawings' path order and tags).
pub fn build(li: &LinkIndex) -> Graph {
    let live: Vec<(u32, &str)> = li.sorted_docs().iter().map(|&id| (id, li.path(id))).collect();
    let n_docs = live.len();
    let mut node_of_doc = vec![NONE; live.iter().map(|d| d.0 as usize + 1).max().unwrap_or(0)];
    for (node, (id, _)) in live.iter().enumerate() {
        node_of_doc[*id as usize] = node as u32;
    }

    let mut g = Graph::default();
    g.folders.push("");
    g.labels = Strs::with_capacity(n_docs);
    g.folder.reserve(n_docs);
    let mut cur_folder = "";
    for (_, path) in &live {
        let top = top_folder(path);
        if !top.is_empty() && top != cur_folder {
            // Paths are sorted, so a top-level folder is one contiguous run.
            g.folders.push(top);
            cur_folder = top;
        }
        g.folder.push(if top.is_empty() { 0 } else { (g.folders.len() - 1) as u32 });
        g.labels.push(strip_ext(path));
    }

    // Edges per source, with ghosts and tags numbered as first seen (tag ids fixed up at the end).
    let mut ghost_of_key: FxMap<u32, u32> = FxMap::default();
    let mut tag_of_key = vec![NONE; li.n_tag_keys()];
    let mut ghost_labels = Strs::default();
    let mut tag_labels = Strs::default();
    let mut edges: Vec<u32> = Vec::with_capacity(n_docs * 6);
    let mut real_edges = vec![false; n_docs];
    let mut scratch: Vec<u32> = Vec::new();
    for (src, (id, _)) in live.iter().enumerate() {
        scratch.clear();
        for &(key, _) in li.out_links(*id) {
            let t = li.key_target(key);
            let dst = if t != NONE {
                node_of_doc[t as usize]
            } else {
                *ghost_of_key.entry(key).or_insert_with(|| {
                    ghost_labels.push(li.key_str(key));
                    (n_docs + ghost_labels.len() - 1) as u32
                })
            };
            if dst != src as u32 {
                scratch.push(dst);
            }
        }
        real_edges[src] = !scratch.is_empty();
        push_sorted(&mut edges, src as u32, &mut scratch);
        for &v in li.doc_tags(*id) {
            let (display, key) = li.tag_variant_of(v);
            let slot = &mut tag_of_key[key as usize];
            if *slot == NONE {
                tag_labels.push_tag(display);
                *slot = (tag_labels.len() - 1) as u32;
            }
            scratch.push(TAG_BIT | *slot);
        }
        push_sorted(&mut edges, src as u32, &mut scratch);
    }
    let n = n_docs + ghost_labels.len() + tag_labels.len();
    let tag_base = (n_docs + ghost_labels.len()) as u32;
    for d in edges.iter_mut().skip(1).step_by(2) {
        if *d & TAG_BIT != 0 {
            *d = tag_base + (*d & !TAG_BIT);
        }
    }

    g.out_deg = vec![0; n];
    g.in_deg = vec![0; n];
    for e in edges.chunks_exact(2) {
        g.out_deg[e[0] as usize] += 1;
        g.in_deg[e[1] as usize] += 1;
    }
    // Orphan: a drawing with no drawing/ghost link in either direction.
    let mut has_in = vec![false; n];
    for e in edges.chunks_exact(2) {
        if e[1] < tag_base {
            has_in[e[1] as usize] = true;
        }
    }
    g.flags = vec![0; n];
    for i in 0..n_docs {
        if !real_edges[i] && !has_in[i] {
            g.flags[i] = ORPHAN;
        }
    }
    for i in n_docs..tag_base as usize {
        g.flags[i] = UNRESOLVED;
    }
    for f in &mut g.flags[tag_base as usize..] {
        *f = TAG;
    }
    g.folder.resize(n, 0);
    g.labels.extend(ghost_labels);
    g.labels.extend(tag_labels);
    g.edges = edges;
    g
}

/// Appends `(src, dst)` for each distinct dst in `dsts` (sorted), then empties `dsts`.
fn push_sorted(edges: &mut Vec<u32>, src: u32, dsts: &mut Vec<u32>) {
    dsts.sort_unstable();
    dsts.dedup();
    for &d in dsts.iter() {
        edges.extend([src, d]);
    }
    dsts.clear();
}

fn push_u32s(out: &mut Vec<u8>, xs: &[u32]) {
    out.extend(xs.iter().flat_map(|x| x.to_le_bytes()));
}

impl Graph {
    pub fn node_count(&self) -> usize {
        self.flags.len()
    }

    /// Serialises into the `VDG1` layout.
    pub fn encode(&self) -> Vec<u8> {
        let (n, e, f) = (self.node_count(), self.edges.len() / 2, self.folders.len());
        let string_bytes = self.labels.blob.len() + self.folders.blob.len();
        let words = 8 + 4 * n + 2 * e + (n + 1) + (f + 1);
        let mut out = Vec::with_capacity(words * 4 + string_bytes);
        push_u32s(&mut out, &[MAGIC, VERSION, n as u32, e as u32, f as u32, string_bytes as u32, 0, 0]);
        for col in [&self.folder, &self.out_deg, &self.in_deg, &self.flags, &self.edges] {
            push_u32s(&mut out, col);
        }
        let offsets = |strs: &Strs, base: u32| -> Vec<u32> {
            std::iter::once(base).chain(strs.ends.iter().map(|e| e + base)).collect()
        };
        push_u32s(&mut out, &offsets(&self.labels, 0));
        push_u32s(&mut out, &offsets(&self.folders, self.labels.blob.len() as u32));
        out.extend_from_slice(self.labels.blob.as_bytes());
        out.extend_from_slice(self.folders.blob.as_bytes());
        out
    }
}

/// `vault_graph` payload for the vault's link index.
pub fn export(li: &LinkIndex) -> Vec<u8> {
    build(li).encode()
}

/// The encoded graph of one index generation. Held inside `Index`, which clears it on every
/// mutation, so a hit is always current; the generation check is a second guard.
#[derive(Default)]
pub struct GraphCache(std::sync::Mutex<Option<(u64, std::sync::Arc<Vec<u8>>)>>);

impl GraphCache {
    pub fn get_or_build(&self, generation: u64, build: impl FnOnce() -> Vec<u8>) -> std::sync::Arc<Vec<u8>> {
        let mut slot = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((g, bytes)) = slot.as_ref() {
            if *g == generation {
                return bytes.clone();
            }
        }
        let bytes = std::sync::Arc::new(build());
        *slot = Some((generation, bytes.clone()));
        bytes
    }
    pub fn clear(&mut self) {
        *self.0.get_mut().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::search::{DocEntry, Index, ItemKind, TextItem};

    pub fn drawing(path: &str, text: &str) -> (String, DocEntry) {
        let items = vec![TextItem { element_id: "t".into(), container_id: None, kind: ItemKind::Text, text: text.into() }];
        (path.to_string(), DocEntry::new(path, (1, 1), items).with_links(Vec::new(), [0; 8]))
    }

    pub fn graph_of(docs: Vec<(String, DocEntry)>) -> Graph {
        let mut ix = Index::default();
        for (p, d) in docs {
            ix.upsert(p, d);
        }
        let li = ix.build_links();
        ix.install_links(li);
        let (li, _) = ix.links_and_docs().unwrap();
        build(li)
    }

    fn small() -> Graph {
        graph_of(vec![
            drawing("A/x.excalidraw", "[[y]] again [[y]] self [[x]] ghost [[Missing Thing]] #t1 #t2"),
            drawing("A/y.excalidraw", "back to [[root]] and [[x]]"),
            drawing("root.excalidraw", "nothing"),
            drawing("B/lone.excalidraw", "alone #t1"),
            drawing("B/z.excalidraw", "see [[Missing Thing]]"),
        ])
    }

    fn describe(g: &Graph) -> serde_json::Value {
        let nodes: Vec<_> = (0..g.node_count())
            .map(|i| serde_json::json!({"label": g.labels.get(i), "folder": g.folder[i], "out": g.out_deg[i], "in": g.in_deg[i], "flags": g.flags[i]}))
            .collect();
        let edges: Vec<_> = g.edges.chunks_exact(2).map(|e| serde_json::json!([e[0], e[1]])).collect();
        serde_json::json!({
            "_doc": "Golden description of fixtures/graph_small.bin (links/graph.rs test small_vault_fixture); the TS decoder test checks the same bytes. Regenerate: VD_UPDATE_FIXTURES=1 cargo test --lib links::graph",
            "nodeCount": g.node_count(), "edgeCount": g.edges.len() / 2, "folders": g.folders.to_vec(), "nodes": nodes, "edges": edges,
        })
    }

    #[test]
    fn cached_graph_bytes_hit_until_a_mutation_invalidates() {
        let mut ix = Index::default();
        assert!(ix.graph_bytes(export).is_none(), "no link index yet");
        for (p, d) in [drawing("a.excalidraw", "[[b]]"), drawing("b.excalidraw", "x")] {
            ix.upsert(p, d);
        }
        let li = ix.build_links();
        ix.install_links(li);
        let builds = std::cell::Cell::new(0);
        let encode = |li: &LinkIndex| {
            builds.set(builds.get() + 1);
            export(li)
        };
        let first = ix.graph_bytes(encode).unwrap();
        let second = ix.graph_bytes(encode).unwrap();
        assert_eq!(builds.get(), 1, "second call is a cache hit");
        assert!(std::sync::Arc::ptr_eq(&first, &second));

        let (p, d) = drawing("c.excalidraw", "[[a]] [[b]]");
        ix.upsert(p, d);
        let third = ix.graph_bytes(encode).unwrap();
        assert_eq!(builds.get(), 2, "an edit rebuilds");
        assert_ne!(*first, *third);
        let again = ix.graph_bytes(encode).unwrap();
        assert!(std::sync::Arc::ptr_eq(&third, &again));

        ix.remove("c.excalidraw");
        let fourth = ix.graph_bytes(encode).unwrap();
        assert_eq!(builds.get(), 3, "a removal rebuilds");
        assert_eq!(*fourth, *first, "back to the original content, same bytes");
        let _ = ix.links_and_docs_mut();
        ix.graph_bytes(encode).unwrap();
        assert_eq!(builds.get(), 4, "possible link-index mutation invalidates");
    }

    #[test]
    fn incrementally_maintained_index_exports_the_same_bytes_as_a_fresh_build() {
        let first = [
            ("b/two.excalidraw", "[[one]] #Rust #rust/x"),
            ("a/one.excalidraw", "[[two]] [[nowhere]] #rust"),
            ("z.excalidraw", "[[a/one]] #other"),
            ("m/gone.excalidraw", "[[z]] #gone"),
        ];
        let last = [("b/two.excalidraw", "[[one]] #Rust #rust/x"), ("a/one.excalidraw", "[[two]] [[nowhere]] #rust"), ("z.excalidraw", "[[b/two]] #Rust"), ("c.excalidraw", "#fresh [[z]]")];
        let mut inc = Index::default();
        inc.install_links(LinkIndex::default());
        for (p, t) in first {
            let (p, d) = drawing(p, t);
            inc.upsert(p, d);
        }
        inc.remove("m/gone.excalidraw");
        for (p, t) in &last[2..] {
            let (p, d) = drawing(p, t);
            inc.upsert(p, d);
        }
        let mut fresh = Index::default();
        for (p, t) in last {
            let (p, d) = drawing(p, t);
            fresh.upsert(p, d);
        }
        let li = fresh.build_links();
        fresh.install_links(li);
        let bytes = |ix: &Index| export(ix.links().unwrap());
        assert_eq!(bytes(&inc), bytes(&fresh));
    }

    #[test]
    fn small_vault_is_encoded_deduplicated_and_flagged() {
        let g = small();
        // drawings by path: A/x, A/y, B/lone, B/z, root; ghost; tags t1, t2
        assert_eq!(g.labels.to_vec(), ["A/x", "A/y", "B/lone", "B/z", "root", "missing thing", "#t1", "#t2"]);
        assert_eq!(g.folders.to_vec(), ["", "A", "B"]);
        assert_eq!(g.folder, [1, 1, 2, 2, 0, 0, 0, 0]);
        let edges: Vec<(u32, u32)> = g.edges.chunks_exact(2).map(|e| (e[0], e[1])).collect();
        // x->y once (dup dropped), x->x dropped, x->ghost, x->tags; y->root, y->x; z->ghost; lone->t1
        assert_eq!(edges, [(0, 1), (0, 5), (0, 6), (0, 7), (1, 0), (1, 4), (2, 6), (3, 5)]);
        assert_eq!(g.out_deg, [4, 2, 1, 1, 0, 0, 0, 0]);
        assert_eq!(g.in_deg, [1, 1, 0, 0, 1, 2, 2, 1]);
        assert_eq!(g.flags, [0, 0, ORPHAN, 0, 0, UNRESOLVED, TAG, TAG]);
    }

    #[test]
    fn encoding_has_the_documented_layout() {
        let g = small();
        let b = g.encode();
        let u = |i: usize| u32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        let (n, e, f) = (u(2) as usize, u(3) as usize, u(4) as usize);
        assert_eq!((u(0), u(1), n, e, f, u(6), u(7)), (MAGIC, 1, 8, 8, 3, 0, 0));
        let blob_at = (8 + 4 * n + 2 * e + n + 1 + f + 1) * 4;
        assert_eq!(b.len(), blob_at + u(5) as usize);
        assert_eq!(&b[0..4], b"VDG1");
        let off_at = 8 + 4 * n + 2 * e;
        let (o0, o1) = (u(off_at + 1) as usize, u(off_at + 2) as usize);
        assert_eq!(&b[blob_at + o0..blob_at + o1], b"A/y");
        let folder_off = off_at + n + 1;
        assert_eq!(u(folder_off + 3) as usize, u(5) as usize, "last folder offset ends the blob");
    }

    #[test]
    fn an_empty_vault_encodes_a_header_and_the_root_folder() {
        let g = graph_of(Vec::new());
        assert_eq!((g.node_count(), g.folders.len()), (0, 1));
        let b = g.encode();
        assert_eq!(b.len(), 32 + 4 + 8);
    }

    #[test]
    fn small_vault_fixture() {
        let g = small();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/links/fixtures");
        let (bin, json) = (dir.join("graph_small.bin"), dir.join("graph_small.json"));
        let want_json = serde_json::to_string_pretty(&describe(&g)).unwrap() + "\n";
        if std::env::var_os("VD_UPDATE_FIXTURES").is_some() {
            std::fs::write(&bin, g.encode()).unwrap();
            std::fs::write(&json, &want_json).unwrap();
        }
        assert_eq!(std::fs::read(&bin).unwrap(), g.encode(), "graph_small.bin is stale");
        assert_eq!(std::fs::read_to_string(&json).unwrap(), want_json, "graph_small.json is stale");
    }

    #[test]
    fn nodes_and_edges_stay_valid_for_a_larger_vault() {
        let docs: Vec<_> = (0..300).map(|i| drawing(&format!("F{}/d{i}.excalidraw", i % 7), &format!("[[d{}]] [[d{}]] [[ghost{}]] #tag{}", (i * 7) % 300, (i + 1) % 300, i % 5, i % 3))).collect();
        let g = graph_of(docs);
        let n = g.node_count() as u32;
        assert!(g.edges.iter().all(|&x| x < n));
        assert!(g.edges.chunks_exact(2).all(|e| e[0] != e[1]));
        let mut pairs: Vec<_> = g.edges.chunks_exact(2).map(|e| (e[0], e[1])).collect();
        let len = pairs.len();
        pairs.sort_unstable();
        pairs.dedup();
        assert_eq!(pairs.len(), len);
        assert_eq!(g.out_deg.iter().sum::<u32>() as usize, len);
        assert_eq!(g.in_deg.iter().sum::<u32>() as usize, len);
    }
}
