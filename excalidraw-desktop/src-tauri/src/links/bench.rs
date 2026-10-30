//! Benchmarks for the P1 budgets (PLAN.md). Ignored by default:
//! `cargo test --release --lib links::bench -- --ignored --nocapture --test-threads=1`
//! (1k / 10k / 50k synthetic drawings; the generator mirrors `spikes/rust-bench/src/gen.rs`).

use super::grammar::pct_encode;
use super::plan::{plan_move, FilePlan};
use super::query;
use super::resolve::rel_path;
use super::rewrite::{rewrite, FileRules, Replace};
use super::*;
use vaultdraw_core::links::LinkIndex;
use crate::search::{DocEntry, ElementLink, Index, ItemKind, TextItem};
use crate::test_alloc::live;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
};


struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, p: f64) -> bool {
        (self.next() % 1_000_000) as f64 / 1e6 < p
    }
}

const W: &[&str] = &[
    "Café", "Überblick", "設計", "Résumé", "naïve", "Zoë", "Ångström", "Plan", "Roadmap", "Sketch", "Diagram", "Architecture", "Notes", "Ideas", "Wireframe", "Flow", "Mind map", "Brainstorm", "Señor", "Straße",
    "Kanban board", "Q3 review", "Données", "München",
];
const FILL: &[&str] = &["Some notes about the thing we discussed", "TODO ship the prototype #wip next week", "Login flow, see the other board for details", "Remember to ask about the budget (approx 1200)"];

fn id21(r: &mut Rng) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    (0..21).map(|_| A[r.below(64)] as char).collect()
}

type Pairs = Vec<(String, String)>;

struct Synth {
    docs: Vec<(String, Pairs, Pairs)>,
}

/// Synthetic vault: top/sub folders, ~5% duplicate basenames, ~2.9 links per drawing, ~15% of
/// links to a few hubs, ~10% unresolved, ~10% of links in the element `link` field.
fn generate(n: usize, seed: u64) -> Synth {
    let mut r = Rng(seed);
    let tops = (n / 500).max(2);
    let folders: Vec<String> = (0..tops * 10)
        .map(|f| {
            let (a, b) = (f / 10, f % 10);
            format!("{} {}/{} {}", W[a % W.len()], a, W[(b * 7 + a) % W.len()], b)
        })
        .collect();
    let mut paths: Vec<String> = Vec::with_capacity(n);
    let mut by_folder: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut folder_of = vec![usize::MAX; n];
    let mut seen = HashSet::new();
    for i in 0..n {
        loop {
            let name = if i > 0 && r.chance(0.05) {
                paths[r.below(i)].rsplit('/').next().unwrap().to_string()
            } else if r.chance(0.1) {
                format!("{} {}.excalidraw", W[r.below(W.len())], i)
            } else {
                format!("{} {} {}.excalidraw", W[r.below(W.len())], W[r.below(W.len())], i)
            };
            let (path, f) = if r.chance(0.02) {
                (name, usize::MAX)
            } else {
                let f = r.below(folders.len());
                (format!("{}/{}", folders[f], name), f)
            };
            if seen.insert(path.clone()) {
                folder_of[i] = f;
                by_folder.entry(f).or_default().push(i);
                paths.push(path);
                break;
            }
        }
    }
    let mut base_count: HashMap<&str, usize> = HashMap::new();
    for p in &paths {
        *base_count.entry(p.rsplit('/').next().unwrap()).or_default() += 1;
    }
    let hubs: Vec<usize> = (0..n / 2500 + 3).map(|_| r.below(n)).collect();
    let stem = |p: &str| p.strip_suffix(".excalidraw").unwrap().to_string();
    let mut docs = Vec::with_capacity(n);
    for d in 0..n {
        let dir = paths[d].rsplit_once('/').map(|x| x.0).unwrap_or("").to_string();
        let mut texts: Vec<String> = (0..10).map(|_| FILL[r.below(FILL.len())].to_string()).collect();
        let mut field: Option<String> = None;
        for _ in 0..r.below(7) {
            let (t, ok): (usize, bool) = if r.chance(0.10) {
                (0, false)
            } else if r.chance(0.15) {
                (hubs[r.below(hubs.len())], true)
            } else if r.chance(0.5) && by_folder.get(&folder_of[d]).is_some_and(|v| v.len() > 1) {
                let v = &by_folder[&folder_of[d]];
                (v[r.below(v.len())], true)
            } else {
                (r.below(n), true)
            };
            let target = if !ok {
                format!("Missing {}", r.below(n / 10 + 1))
            } else {
                let p = stem(&paths[t]);
                let base = p.rsplit('/').next().unwrap().to_string();
                let mut s = if base_count[format!("{base}.excalidraw").as_str()] > 1 && r.chance(0.7) { p.clone() } else { base };
                if r.chance(0.1) {
                    s = s.to_lowercase();
                }
                s
            };
            if field.is_none() && r.chance(0.10) {
                field = Some(match (ok, r.below(3)) {
                    (true, 1) => format!("{}.excalidraw", rel_path(&dir, &stem(&paths[t]))),
                    (true, 2) => format!("vaultdraw://open?file={}", pct_encode(&stem(&paths[t]))),
                    _ => format!("[[{target}]]"),
                });
                continue;
            }
            let s = match r.below(10) {
                0 | 1 => format!("[[{target}|see this]]"),
                _ => format!("[[{target}]]"),
            };
            let k = r.below(texts.len());
            texts[k].push(' ');
            texts[k].push_str(&s);
        }
        let items: Vec<(String, String)> = texts.into_iter().map(|t| (id21(&mut r), t)).collect();
        let elinks = field.map(|l| vec![(id21(&mut r), l)]).unwrap_or_default();
        docs.push((paths[d].clone(), items, elinks));
    }
    Synth { docs }
}

fn entry(path: &str, items: &[(String, String)], elinks: &[(String, String)]) -> DocEntry {
    let items = items.iter().map(|(id, t)| TextItem { element_id: id.as_str().into(), container_id: None, kind: ItemKind::Text, text: t.as_str().into() }).collect();
    let elinks = elinks.iter().map(|(id, l)| ElementLink { element_id: id.as_str().into(), link: l.as_str().into() }).collect();
    DocEntry::new(path, (1, 1), items).with_links(elinks, [0; 8])
}

fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    v[((v.len() as f64 * p).ceil() as usize).saturating_sub(1).min(v.len() - 1)]
}

fn timed(iters: usize, mut f: impl FnMut(usize)) -> (f64, f64) {
    let mut v: Vec<f64> = (0..iters)
        .map(|i| {
            let t = Instant::now();
            f(i);
            t.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    (pct(&mut v, 0.5), pct(&mut v, 0.95))
}

struct Row {
    n: usize,
    build_ms: f64,
    b_per_doc: f64,
    approx_per_doc: f64,
    bl_p50: f64,
    bl_p95: f64,
    hub_bl: usize,
    resp_ms: f64,
    upd: (f64, f64),
    plan_rand: (f64, f64),
    plan_hub: (f64, f64),
    plan_folder: (f64, usize, usize),
}

fn run_size(n: usize) -> Row {
    let s = generate(n, 0xC0FFEE ^ n as u64);
    let mut ix = Index::default();
    for (p, items, el) in &s.docs {
        ix.upsert(p.clone(), entry(p, items, el));
    }
    // lazy first build (median of 5), heap measured with a counting allocator
    let mut builds: Vec<f64> = Vec::new();
    for _ in 0..5 {
        let t = Instant::now();
        let li = ix.build_links();
        builds.push(t.elapsed().as_secs_f64() * 1e3);
        drop(li);
    }
    let before = live();
    let li = ix.build_links();
    let measured = live() - before;
    let approx = li.approx_heap_bytes();
    ix.install_links(li);
    let build_ms = pct(&mut builds, 0.5);

    // hub and random backlinks (core query: resolve (source path, element id) pairs)
    let (hub_path, hub_bl) = {
        let li = ix.links().unwrap();
        s.docs.iter().map(|(p, _, _)| (p, li.n_backlinks(li.find_doc(p).unwrap()))).max_by_key(|x| x.1).map(|(p, b)| (p.clone(), b)).unwrap()
    };
    let backlinks = |ix: &Index, path: &str| -> usize {
        let li = ix.links().unwrap();
        let d = li.find_doc(path).unwrap();
        let rows: Vec<(&str, &str)> = li.backlinks(d).map(|(s, h)| (li.path(s), li.elem_id(s, h))).collect();
        std::hint::black_box(rows.len())
    };
    let (bl50, bl95) = timed(2000, |_| {
        backlinks(&ix, &hub_path);
    });
    let resp_ms = timed(20, |_| {
        std::hint::black_box(query::links_response(&ix, &hub_path));
    })
    .0;
    // incremental one-drawing update
    let upd = timed(2000, |i| {
        let (p, items, el) = &s.docs[(i * 7919) % n];
        let mut items = items.clone();
        items[0].1.push_str(" [[Plan]]");
        ix.upsert(p.clone(), entry(p, &items, el));
    });
    // restore originals so later numbers are about the generated vault
    for (p, items, el) in &s.docs {
        ix.upsert(p.clone(), entry(p, items, el));
    }
    // rename plans
    let plan_rand = timed(300, |i| {
        let p = &s.docs[(i * 104_729) % n].0;
        let to = format!("{}-renamed.excalidraw", p.trim_end_matches(".excalidraw"));
        std::hint::black_box(plan_move(&mut ix, p, &to));
    });
    let plan_hub = timed(100, |_| {
        let to = format!("{}-renamed.excalidraw", hub_path.trim_end_matches(".excalidraw"));
        std::hint::black_box(plan_move(&mut ix, &hub_path, &to));
    });
    let top = s.docs[0].0.split('/').next().unwrap().to_string();
    let in_top = s.docs.iter().filter(|(p, _, _)| p.starts_with(&format!("{top}/"))).count();
    let mut files = 0;
    let t = timed(20, |_| {
        let plan = plan_move(&mut ix, &top, "Archive/moved");
        files = plan.files.len();
    });
    // the plan must leave the index exactly as it was
    assert_eq!(!query::links_response(&ix, &hub_path).backlinks.is_empty(), hub_bl > 0);
    Row {
        n,
        build_ms,
        b_per_doc: measured as f64 / n as f64,
        approx_per_doc: approx as f64 / n as f64,
        bl_p50: bl50,
        bl_p95: bl95,
        hub_bl,
        resp_ms,
        upd,
        plan_rand,
        plan_hub,
        plan_folder: (t.0, in_top, files),
    }
}

fn big_drawing(elements: usize, image_bytes: usize) -> String {
    let mut els = Vec::new();
    for i in 0..elements {
        els.push(format!(
            r#"{{"id":"el{i:04}","type":"text","x":{}.5,"y":20.25,"width":100,"height":25,"text":"Link to [[Old Name]] and #{i}","originalText":"Link to [[Old Name]] and #{i}","version":3,"versionNonce":{i},"updated":1700000000000,"isDeleted":false}}"#,
            i * 10
        ));
    }
    let blob = "iVBORw0KGgo".repeat(image_bytes / 11 + 1);
    format!(r##"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{"viewBackgroundColor":"#ffffff"}},"files":{{"f":{{"mimeType":"image/png","id":"f","dataURL":"data:image/png;base64,{blob}"}}}}}}"##, els.join(","))
}

fn plan_for(elements: usize) -> FilePlan {
    let els: BTreeMap<String, Vec<Replace>> = (0..elements).map(|i| (format!("el{i:04}"), vec![Replace { old_key: "old name".into(), new_target: "Brand New Name".into(), new_path: "Brand New Name".into() }])).collect();
    FilePlan { from_path: String::new(), to_path: String::new(), elements: els }
}

fn job_files(count: usize, elements: usize, image_bytes: usize, tag: &str) -> (tempfile::TempDir, Arc<Vault>, Vec<FilePlan>) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    let body = big_drawing(elements, image_bytes);
    let mut plans = Vec::new();
    for i in 0..count {
        let rel = format!("{tag}/f{i}.excalidraw");
        fs::create_dir_all(root.join(tag)).unwrap();
        fs::write(root.join(&rel), &body).unwrap();
        let mut p = plan_for(elements);
        p.from_path = rel.clone();
        p.to_path = rel;
        plans.push(p);
    }
    let v = Arc::new(Vault::for_tests(dunce::canonicalize(root).unwrap(), "b", false));
    (dir, v, plans)
}

fn noop_hooks() -> Hooks {
    Hooks { indexed: Box::new(|_, _, _| {}), done: Box::new(|_| {}), before_write: Box::new(|_| {}), dir: None }
}

/// Cost of `hash8` on the F1 bench's file mix (90% small drawings, 10% with 1-2 MB images).
#[test]
#[ignore]
fn bench_hash8_cost() {
    use sha2::{Digest, Sha256};
    let small = big_drawing(40, 0);
    let med = big_drawing(40, 1_100_000);
    let big = big_drawing(40, 2_000_000);
    let files: Vec<&str> = (0..5000).map(|i| if i % 10 != 3 { small.as_str() } else if i % 20 == 3 { big.as_str() } else { med.as_str() }).collect();
    let total: usize = files.iter().map(|f| f.len()).sum();
    let mut best = [f64::MAX; 4];
    for _ in 0..5 {
        let t = Instant::now();
        let n: usize = files.iter().map(|f| crate::search::extract_items(f.as_bytes()).unwrap().len()).sum();
        best[0] = best[0].min(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now();
        let h: u8 = files.iter().map(|f| Sha256::digest(f.as_bytes())[0]).fold(0, |a, b| a ^ b);
        best[1] = best[1].min(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now();
        let h2: u8 = files
            .iter()
            .map(|f| {
                let b = f.as_bytes();
                let mut s = Sha256::new();
                s.update((b.len() as u64).to_le_bytes());
                s.update(&b[..b.len().min(4096)]);
                s.update(&b[b.len().saturating_sub(4096)..]);
                s.finalize()[0]
            })
            .fold(0, |a, b| a ^ b);
        best[2] = best[2].min(t.elapsed().as_secs_f64() * 1e3);
        std::hint::black_box((n, h, h2));
    }
    println!("{} files, {:.0} MB: parse {:.0} ms, full sha256 {:.0} ms ({:+.0}%), head+tail 4 KB sha256 {:.1} ms ({:+.1}%)", files.len(), total as f64 / 1e6, best[0], best[1], best[1] / best[0] * 100.0, best[2], best[2] / best[0] * 100.0);
}

#[test]
#[ignore]
fn bench_build_breakdown() {
    let s = generate(50_000, 0xC0FFEE ^ 50_000);
    let docs: Vec<(String, DocEntry)> = s.docs.iter().map(|(p, i, e)| (p.clone(), entry(p, i, e))).collect();
    let mut ix = Index::default();
    for (p, d) in &docs {
        ix.upsert(p.clone(), entry(p, &[], &[]));
        let _ = d;
    }
    let mut ix = Index::default();
    for (p, items, el) in &s.docs {
        ix.upsert(p.clone(), entry(p, items, el));
    }
    for _ in 0..3 {
        let t = Instant::now();
        let li = ix.build_links();
        println!("Index::build_links x50k: {:.1} ms ({} keys)", t.elapsed().as_secs_f64() * 1e3, li.n_keys());
    }
    let t = Instant::now();
    let keys: usize = docs.iter().map(|(p, _)| super::resolve::key_of_path(p).len()).sum();
    println!("key_of_path x50k: {:.1} ms ({keys})", t.elapsed().as_secs_f64() * 1e3);
    let t = Instant::now();
    let n: usize = docs.iter().map(|(p, d)| super::index::raw_links(p, d).len()).sum();
    println!("raw_links x50k: {:.1} ms ({n} links)", t.elapsed().as_secs_f64() * 1e3);
    let t = Instant::now();
    let mut li = LinkIndex::default();
    let ids: Vec<u32> = docs.iter().map(|(p, _)| li.add_doc(p)).collect();
    println!("add_doc x50k: {:.1} ms", t.elapsed().as_secs_f64() * 1e3);
    let raws: Vec<_> = docs.iter().map(|(p, d)| super::index::raw_links(p, d)).collect();
    let t = Instant::now();
    for (id, r) in ids.into_iter().zip(raws) {
        li.set_links(id, r);
    }
    println!("set_links x50k: {:.1} ms", t.elapsed().as_secs_f64() * 1e3);
}

/// Rename a hub linked from `n` drawings: how long until the command returns (target <= 50 ms),
/// including the lazy first link-index build, the journal write and the rename.
#[test]
#[ignore]
fn bench_rename_return() {
    for n in [300usize, 3000] {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path().join("vault")).unwrap_or_else(|_| {
            fs::create_dir_all(dir.path().join("vault")).unwrap();
            dunce::canonicalize(dir.path().join("vault")).unwrap()
        });
        fs::write(root.join("Hub.excalidraw"), r#"{"type":"excalidraw","elements":[]}"#).unwrap();
        for i in 0..n {
            let body = format!(r#"{{"type":"excalidraw","elements":[{{"id":"t","type":"text","text":"see [[Hub]] {i}","originalText":"see [[Hub]] {i}","version":1,"versionNonce":1,"updated":1}}]}}"#);
            fs::create_dir_all(root.join(format!("d{}", i % 20))).unwrap();
            fs::write(root.join(format!("d{}/n{i}.excalidraw", i % 20)), body).unwrap();
        }
        let v = Arc::new(Vault::for_tests(root.clone(), "b", false));
        let search = SearchService::default();
        search.start_with("b", root.clone(), Arc::new(|_| {}), None);
        while !search.status("b").is_ok_and(|s| s.state == crate::search::IndexState::Ready) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let hooks = Hooks { indexed: Box::new(|_, _, _| {}), done: Box::new(|_| {}), before_write: Box::new(|_| {}), dir: Some(dir.path().join("state")) };
        let t = Instant::now();
        let (res, job) = move_with_links(&v, &MoveRequest { from: "Hub.excalidraw", to: "Renamed Hub.excalidraw", open_path: None }, (&search, &LinksState::default()), hooks, || crate::move_entry_paths(&root, "Hub.excalidraw", "Renamed Hub.excalidraw")).unwrap();
        let ret = t.elapsed().as_secs_f64() * 1e3;
        let t = Instant::now();
        job.unwrap().join().unwrap();
        println!("rename hub linked from {n} drawings: returns in {ret:.1} ms (first call: lazy link build + plan + journal + rename), planned {} files / {} links; background rewrite {:.0} ms", res.planned_files, res.planned_links, t.elapsed().as_secs_f64() * 1e3);
    }
}

#[test]
#[ignore]
fn bench_links_p1() {
    let rows: Vec<Row> = [1_000, 10_000, 50_000].into_iter().map(run_size).collect();
    println!("\n=== link index (lazy build, queries, plans) ===");
    println!("{:>7} {:>10} {:>9} {:>9} {:>11} {:>11} {:>8} {:>10} {:>16}", "docs", "build ms", "B/doc", "approx", "backlinks50", "backlinks95", "hub n", "resp ms", "upsert p50/p95");
    for r in &rows {
        println!(
            "{:>7} {:>10.2} {:>9.0} {:>9.0} {:>8.4} ms {:>8.4} ms {:>8} {:>10.3} {:>8.4}/{:.4}",
            r.n, r.build_ms, r.b_per_doc, r.approx_per_doc, r.bl_p50, r.bl_p95, r.hub_bl, r.resp_ms, r.upd.0, r.upd.1
        );
    }
    println!("\n{:>7} {:>20} {:>20} {:>34}", "docs", "plan random p50/p95", "plan hub p50/p95", "plan folder move (docs, files, p50)");
    for r in &rows {
        println!("{:>7} {:>9.4}/{:<9.4} ms {:>9.4}/{:<9.4} ms {:>14} docs {:>5} files {:>9.3} ms", r.n, r.plan_rand.0, r.plan_rand.1, r.plan_hub.0, r.plan_hub.1, r.plan_folder.1, r.plan_folder.2, r.plan_folder.0);
    }

    // rewriter: one 2 MB drawing, 200 elements, 160 targeted
    let src = big_drawing(200, 2_000_000);
    let plan = plan_for(160);
    let rules = FileRules { old_dir: "", new_dir: "", elements: &plan.elements, tag: None, now_ms: 1_700_000_000_000 };
    let (w50, w95) = timed(200, |_| {
        std::hint::black_box(rewrite(src.as_bytes(), &rules).unwrap().unwrap());
    });
    let (_keep, v, many) = job_files(100, 200, 2_000_000, "cpu");
    let t = Instant::now();
    for f in &many {
        let b = fs::read(v.root.join(&f.to_path)).unwrap();
        let r = FileRules { old_dir: "", new_dir: "", elements: &f.elements, tag: None, now_ms: 1 };
        std::hint::black_box(rewrite(&b, &r).unwrap());
    }
    let cpu100 = t.elapsed().as_secs_f64() * 1e3;
    println!("\n=== rewriter ===");
    println!("rewrite 2.0 MB drawing (200 elements, 160 edited): p50 {w50:.3} ms  p95 {w95:.3} ms  ({} bytes)", src.len());
    println!("100 x 2 MB read + rewrite (no write): {cpu100:.0} ms");
    drop(v);
    // end-to-end job: read, rewrite, revision-checked atomic write with recovery copy, index hook
    for (label, elements, image) in [("100 files, ~35 KB (typical)", 160, 0usize), ("100 files, 2 MB each (worst case)", 200, 2_000_000)] {
        let (_d, v, files) = job_files(100, elements, image, "job");
        let state = LinksState::default();
        let t = Instant::now();
        let done = run_job(&v, &files, None, 1, &noop_hooks(), &state);
        let ms = t.elapsed().as_secs_f64() * 1e3;
        assert_eq!((done.rewritten, done.failed.len()), (100, 0), "{:?}", done.failed.first());
        println!("job {label}: {ms:.0} ms ({:.2} ms/file)", ms / 100.0);
    }
    {
        // The durability floor of this machine: the app's own atomic write (two fsyncs per file),
        // which `write_drawing_file` performs twice per file (recovery copy and commit).
        let dir = tempfile::tempdir().unwrap();
        let body = vec![b'x'; 35_000];
        let t = Instant::now();
        for i in 0..100 {
            crate::write_atomic(&dir.path().join(format!("f{i}.excalidraw")), &body).unwrap();
        }
        println!("floor: 100 x write_atomic (35 KB): {:.0} ms ({:.2} ms per atomic write)", t.elapsed().as_secs_f64() * 1e3, t.elapsed().as_secs_f64() * 10.0);
    }
    let r50 = rows.last().unwrap();
    let r10 = &rows[1];
    println!("\nbudgets: build<=30ms@10k [{:.1}], <=150ms@50k [{:.1}]; backlinks p95<=0.1ms@50k [{:.4}]; rewrite<=1ms/2MB [{w50:.3}]; <=1KB/doc [{:.0}]", r10.build_ms, r50.build_ms, r50.bl_p95, rows.iter().map(|r| r.b_per_doc).fold(0.0, f64::max));
    assert!(r10.build_ms <= 30.0, "lazy build at 10k: {}", r10.build_ms);
    assert!(r50.build_ms <= 150.0, "lazy build at 50k: {}", r50.build_ms);
    assert!(r50.bl_p95 <= 0.1, "backlinks p95 at 50k: {}", r50.bl_p95);
    assert!(w50 <= 1.0, "rewrite 2MB: {w50}");
    assert!(rows.iter().all(|r| r.b_per_doc <= 1024.0), "memory per drawing");
}

// ---- tag rename (F6 P2) ----
// `cargo test --release --lib links::bench::bench_tag_rename -- --ignored --nocapture --test-threads=1`
// Budgets: plan <= 50 ms (aim < 5), job over 100 x 35 KB <= 500 ms incl. fsync, rewrite of a 2 MB file <= 1 ms.

fn tag_drawing(elements: usize, image_bytes: usize) -> String {
    let mut els = Vec::new();
    for i in 0..elements {
        let t = format!("item {i} #dsa/graphs and #dsa2 about the thing, see #dsa. Some filler text to look real");
        els.push(format!(r#"{{"id":"el{i:04}","type":"text","x":{}.5,"y":20.25,"width":100,"height":25,"text":"{t}","originalText":"{t}","version":3,"versionNonce":{i},"updated":1700000000000,"isDeleted":false}}"#, i * 10));
    }
    let blob = "iVBORw0KGgo".repeat(image_bytes / 11 + 1);
    format!(r##"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{"viewBackgroundColor":"#ffffff"}},"files":{{"f":{{"mimeType":"image/png","id":"f","dataURL":"data:image/png;base64,{blob}"}}}}}}"##, els.join(","))
}

fn tag_rule(from: &str, to: &str) -> super::rewrite::TagRule {
    super::rewrite::TagRule { from_key: from.into(), to: to.into(), skip_under: None }
}

#[test]
#[ignore]
fn bench_tag_rename() {
    println!("load: {}", std::process::Command::new("uptime").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default());
    // plan on the in-memory index: 3 items per drawing, a pool of 300 tags, ~5% carry #dsa (or a child)
    for n in [5_000usize, 50_000] {
        let mut r = Rng(0xFEED ^ n as u64);
        let mut ix = Index::default();
        for i in 0..n {
            let path = format!("folder {}/drawing {i}.excalidraw", i % 50);
            let mut texts = vec![format!("{} #tag{} and #tag{}/sub notes", W[r.below(W.len())], r.below(300), r.below(300)), "plain text without tags".to_string(), format!("{} #wip", FILL[r.below(FILL.len())])];
            if r.chance(0.05) {
                texts.push(["#dsa and more", "#DSA/graphs item", "see #dsa/trees/avl"][r.below(3)].to_string());
            }
            let items: Vec<TextItem> = texts.iter().enumerate().map(|(k, t)| TextItem { element_id: format!("t{k}").into(), container_id: None, kind: ItemKind::Text, text: t.as_str().into() }).collect();
            ix.upsert(path.clone(), DocEntry::new(&path, (1, 1), items));
        }
        let mut times = Vec::new();
        let mut last = None;
        for _ in 0..200 {
            let t = Instant::now();
            let p = super::tag_rename::plan(&ix, "dsa", "Algorithms").unwrap();
            times.push(t.elapsed().as_secs_f64() * 1e3);
            last = Some(p.response);
        }
        let p = last.unwrap();
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("plan @ {n} docs: min {:.3} ms  p50 {:.3} ms  p95 {:.3} ms  ({} files, {} tokens, {} keys, merges {})", times[0], times[100], times[190], p.files, p.occurrences, p.keys.len(), p.merges);
    }
    // rewriter CPU on a 2 MB drawing (200 elements, every one has 3 tokens, one changes spelling each)
    let src = tag_drawing(200, 2_000_000);
    let none = BTreeMap::new();
    let rl = tag_rule("dsa", "Algorithms");
    let rules = FileRules { old_dir: "", new_dir: "", elements: &none, tag: Some(&rl), now_ms: 1_700_000_000_000 };
    let (w50, w95) = timed(200, |_| {
        std::hint::black_box(rewrite(src.as_bytes(), &rules).unwrap().unwrap());
    });
    let mut one = Vec::new();
    for _ in 0..200 {
        let t = Instant::now();
        std::hint::black_box(rewrite(src.as_bytes(), &rules).unwrap().unwrap());
        one.push(t.elapsed().as_secs_f64() * 1e3);
    }
    one.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("tag rewrite of a {:.1} MB drawing (200 elements, 400 tokens): min {:.3} ms  p50 {w50:.3} ms  p95 {w95:.3} ms", src.len() as f64 / 1e6, one[0]);
    // end-to-end job: 100 x ~35 KB (two passes alternate dsa -> Algo -> dsa so every run rewrites)
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    fs::create_dir_all(root.join("tags")).unwrap();
    let body = tag_drawing(100, 0);
    let plans: Vec<FilePlan> = (0..100)
        .map(|i| {
            let rel = format!("tags/f{i}.excalidraw");
            fs::write(root.join(&rel), &body).unwrap();
            FilePlan { from_path: rel.clone(), to_path: rel, elements: BTreeMap::new() }
        })
        .collect();
    let v = Arc::new(Vault::for_tests(dunce::canonicalize(root).unwrap(), "b", false));
    let state = LinksState::default();
    let mut runs = Vec::new();
    for k in 0..7 {
        let rl = if k % 2 == 0 { tag_rule("dsa", "Algo") } else { tag_rule("algo", "dsa") };
        let t = Instant::now();
        let done = run_job(&v, &plans, Some(&rl), k + 1, &noop_hooks(), &state);
        runs.push(t.elapsed().as_secs_f64() * 1e3);
        assert_eq!((done.rewritten, done.failed.len()), (100, 0), "{:?}", done.failed.first());
    }
    runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("tag job over 100 x {:.0} KB files incl. fsync: min {:.0} ms  p50 {:.0} ms  max {:.0} ms ({:.2} ms/file)", body.len() as f64 / 1e3, runs[0], runs[3], runs[6], runs[3] / 100.0);
    println!("budgets: plan <= 50 ms; job <= 500 ms; 2 MB rewrite <= 1 ms [min {:.3}, p50 {w50:.3}]", one[0]);
}

/// P3 graph export: `cargo test --release --lib links::bench::bench_graph_export -- --ignored --nocapture`
/// Budgets: encode (warm link index) 10k <= 2 ms, 50k <= 10 ms. Report-only.
#[test]
#[ignore]
fn bench_graph_export() {
    println!("\n{:>7} {:>10} {:>10} {:>10} {:>9} {:>7} {:>9} {:>9}", "n", "cold ms", "warm p50", "warm p95", "bytes", "B/node", "nodes", "edges");
    for n in [1_000usize, 10_000, 50_000] {
        let s = generate(n, 0xC0FFEE ^ n as u64);
        let mut ix = Index::default();
        for (p, items, el) in &s.docs {
            ix.upsert(p.clone(), entry(p, items, el));
        }
        let t = Instant::now();
        let li = ix.build_links();
        ix.install_links(li);
        let (li, _) = ix.links_and_docs().unwrap();
        let bytes = super::graph::export(li);
        let cold = t.elapsed().as_secs_f64() * 1e3 + 0.0;
        let (p50, p95) = timed(20, |_| {
            std::hint::black_box(super::graph::export(li));
        });
        let g = super::graph::build(li);
        // Quiet-machine figure: the fastest of 40 exports (wall-clock p50 swings with other load).
        let mut runs: Vec<f64> = (0..40)
            .map(|_| {
                let t = Instant::now();
                std::hint::black_box(super::graph::export(li));
                t.elapsed().as_secs_f64() * 1e3
            })
            .collect();
        println!("first export (cache miss) {n} drawings: min {:.3} ms", pct(&mut runs, 0.0));
        let (hit50, hit95) = timed(20, |_| {
            std::hint::black_box(ix.graph_bytes(super::graph::export).unwrap().to_vec());
        });
        println!("cache: {n} drawings -> {} bytes held while cached; repeat open (hit + copy) p50 {hit50:.3} ms p95 {hit95:.3} ms", bytes.len());
        println!("{n:>7} {cold:>10.2} {p50:>10.3} {p95:>10.3} {:>9} {:>7.1} {:>9} {:>9}", bytes.len(), bytes.len() as f64 / g.node_count() as f64, g.node_count(), g.edges.len() / 2);
    }
}
