//! Links P1 tests: grammar fixtures, resolution, incremental index, plan, rewriter (fuzz),
//! journal replay, conflict handling and the full rename flow against temp vaults.

use super::grammar::*;
use super::index::{raw_links, NONE};
use super::journal::{self, Journal};
use super::plan::{plan_move, FilePlan};
use super::query;
use super::resolve::*;
use super::rewrite::{rewrite, FileRules, Replace};
use super::types::*;
use super::*;
use crate::search::{DocEntry, Index, IndexState, SearchService};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::atomic::AtomicUsize,
};

// ---------------------------------------------------------------- helpers

use vaultdraw_core::links::testkit::{doc, index_of, item, plain, resolved};

// ---------------------------------------------------------------- plan

fn plan_for(ix: &mut Index, from: &str, to: &str) -> super::plan::Plan {
    plan_move(ix, from, to)
}

fn reps(p: &super::plan::Plan, file: &str) -> Vec<(String, String, String)> {
    p.files
        .iter()
        .find(|f| f.from_path == file)
        .map(|f| f.elements.iter().flat_map(|(e, rs)| rs.iter().map(move |r| (e.clone(), r.old_key.clone(), r.new_target.clone()))).collect())
        .unwrap_or_default()
}

#[test]
fn rename_rewrites_only_links_that_stop_resolving_and_restores_the_index() {
    let mut ix = index_of(vec![
        plain("Old.excalidraw"),
        ("a.excalidraw", doc("a.excalidraw", &[("t", "[[Old]] and [[OLD|lbl]]")], &[("s", "vaultdraw://open?file=Old")])),
        ("b.excalidraw", doc("b.excalidraw", &[("t", "[[Other]]")], &[])),
        plain("Other.excalidraw"),
    ]);
    let before = serde_json::to_string(&query::links_response(&ix, "Old.excalidraw").backlinks).unwrap();
    let p = plan_for(&mut ix, "Old.excalidraw", "New.excalidraw");
    assert_eq!(p.files.len(), 1);
    assert_eq!(p.files[0].to_path, "a.excalidraw");
    let mut r = reps(&p, "a.excalidraw");
    r.sort();
    assert_eq!(r, vec![("s".into(), "old".into(), "New".into()), ("t".into(), "old".into(), "New".into())]);
    assert!(p.re_pointed.is_empty());
    // planning leaves the index untouched
    assert_eq!(serde_json::to_string(&query::links_response(&ix, "Old.excalidraw").backlinks).unwrap(), before);
    assert_eq!(resolved(&ix, "x.excalidraw", "Old").as_deref(), Some("Old.excalidraw"));
}

#[test]
fn bare_names_survive_folder_moves_and_path_links_are_rewritten() {
    let mut ix = index_of(vec![
        plain("F/Uniq.excalidraw"),
        plain("F/G/Deep.excalidraw"),
        ("a.excalidraw", doc("a.excalidraw", &[("t", "[[Uniq]] [[F/G/Deep]] [[G/Deep]]")], &[])),
    ]);
    let p = plan_for(&mut ix, "F", "Archive/F");
    assert_eq!(p.moves.len(), 2);
    // `[[F/G/Deep]]` still resolves as a path suffix; nothing needs rewriting
    assert!(p.files.is_empty(), "{:?}", p.files);
    let p = plan_for(&mut ix, "F/G", "H");
    let got = &p.files[0].elements["t"];
    assert_eq!(got.len(), 2, "both path-style spellings stop resolving: {:?}", p.files);
    assert!(got.iter().all(|r| r.new_target == "H/Deep"), "path style stays a path: {got:?}");
}

#[test]
fn path_style_links_keep_a_path_when_the_name_alone_would_do() {
    let mut ix = index_of(vec![plain("A/Plan.excalidraw"), ("s.excalidraw", doc("s.excalidraw", &[("t", "[[A/Plan]]")], &[]))]);
    let p = plan_for(&mut ix, "A/Plan.excalidraw", "B/Plan.excalidraw");
    assert_eq!(reps(&p, "s.excalidraw"), vec![("t".to_string(), "a/plan".to_string(), "B/Plan".to_string())]);
}

#[test]
fn renaming_onto_an_existing_basename_reports_re_pointed_links() {
    let mut ix = index_of(vec![
        plain("A/Plan.excalidraw"),
        plain("B/Draft.excalidraw"),
        ("s.excalidraw", doc("s.excalidraw", &[("t", "[[Plan]]")], &[])),
    ]);
    // After the move there are two `Plan`; `B/Plan` is no longer than `A/Plan`: tie goes lexicographic.
    let p = plan_for(&mut ix, "B/Draft.excalidraw", "Plan.excalidraw");
    assert_eq!(p.re_pointed.len(), 1);
    let r = &p.re_pointed[0];
    assert_eq!((r.path.as_str(), r.target.as_str()), ("s.excalidraw", "Plan"));
    assert_eq!(r.from.as_deref(), Some("A/Plan.excalidraw"));
    assert_eq!(r.to.as_deref(), Some("Plan.excalidraw"));
    assert!(p.files.is_empty());
}

#[test]
fn a_name_that_becomes_ambiguous_is_qualified() {
    let mut ix = index_of(vec![plain("A/Plan.excalidraw"), plain("Z/Other.excalidraw"), ("s.excalidraw", doc("s.excalidraw", &[("t", "[[Other]]")], &[]))]);
    let p = plan_for(&mut ix, "Z/Other.excalidraw", "Z/Plan.excalidraw");
    assert_eq!(reps(&p, "s.excalidraw"), vec![("t".to_string(), "other".to_string(), "Z/Plan".to_string())]);
}

#[test]
fn relative_links_follow_moved_sources_and_targets() {
    let mut ix = index_of(vec![
        plain("A/x.excalidraw"),
        ("A/src.excalidraw", doc("A/src.excalidraw", &[], &[("s", "./x.excalidraw")])),
        ("A/src2.excalidraw", doc("A/src2.excalidraw", &[], &[("s", "x.excalidraw")])),
    ]);
    // target renamed: both relative forms get new relative text
    let p = plan_for(&mut ix, "A/x.excalidraw", "A/y.excalidraw");
    assert_eq!(p.files.len(), 2);
    for f in &p.files {
        assert_eq!(f.elements["s"][0].new_path, "A/y");
    }
    // whole folder moved: relative links between its files stay valid, nothing to rewrite
    let p = plan_for(&mut ix, "A", "B/A");
    assert!(p.files.is_empty(), "{:?}", p.files);
    // only the source moves out: its relative link must change
    let p = plan_for(&mut ix, "A/src.excalidraw", "src.excalidraw");
    assert_eq!(p.files.len(), 1);
    assert_eq!((p.files[0].from_path.as_str(), p.files[0].to_path.as_str()), ("A/src.excalidraw", "src.excalidraw"));
    assert_eq!(p.files[0].elements["s"][0].new_path, "A/x");
}

// ---------------------------------------------------------------- rewriter

fn rules<'a>(elements: &'a BTreeMap<String, Vec<Replace>>) -> FileRules<'a> {
    FileRules { old_dir: "", new_dir: "", elements, tag: None, now_ms: 1_700_000_000_000 }
}

fn rep(old: &str, new: &str) -> Replace {
    Replace { old_key: old.into(), new_target: new.into(), new_path: new.into() }
}

fn one(id: &str, r: Replace) -> BTreeMap<String, Vec<Replace>> {
    BTreeMap::from([(id.to_string(), vec![r])])
}

#[test]
fn rewrite_changes_only_targeted_fields_and_bumps_version() {
    let src = r##"{
  "type": "excalidraw",
  "appState": {"name": "[[Old]]", "customData": {"note": "[[Old]]"}},
  "elements": [
    {"id":"t","type":"text","x":1.0,"text":"See [[Old|me]] and [[Other]]","originalText":"See [[Old|me]] and [[Other]]","version":7,"versionNonce":5,"updated":9,"link":"https://e.com/[[Old]]"},
    {"id":"u","type":"text","text":"[[Old]]","originalText":"[[Old]]","version":1,"versionNonce":1,"updated":1},
    {"id":"s","type":"rectangle","link":"[[Old]]","version":2,"versionNonce":3,"updated":4}
  ],
  "files": {"f": {"dataURL": "data:image/png;base64,[[Old]]"}}
}"##;
    let mut els = one("t", rep("old", "New Name"));
    els.insert("s".into(), vec![rep("old", "New Name")]);
    let out = rewrite(src.as_bytes(), &rules(&els)).unwrap().unwrap();
    let text = String::from_utf8(out.bytes.clone()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    let e = &v["elements"];
    assert_eq!(e[0]["text"], "See [[New Name|me]] and [[Other]]");
    assert_eq!(e[0]["originalText"], "See [[New Name|me]] and [[Other]]");
    assert_eq!(e[0]["version"], 8);
    assert_eq!(e[0]["updated"], 1_700_000_000_000u64);
    assert_ne!(e[0]["versionNonce"], 5);
    assert_eq!(e[0]["link"], "https://e.com/[[Old]]", "non-drawing link untouched");
    assert_eq!(e[1]["text"], "[[Old]]", "untargeted element untouched");
    assert_eq!(e[1]["version"], 1);
    assert_eq!(e[2]["link"], "[[New Name]]");
    assert_eq!(e[2]["version"], 3);
    assert_eq!(v["appState"]["name"], "[[Old]]");
    assert_eq!(v["appState"]["customData"]["note"], "[[Old]]");
    assert_eq!(v["files"]["f"]["dataURL"], "data:image/png;base64,[[Old]]");
    assert_eq!(out.links, 2);
    assert_eq!(out.text_elements, vec!["t"]);
    // bytes outside the touched values are identical
    assert!(text.contains(r#"{"id":"u","type":"text","text":"[[Old]]","originalText":"[[Old]]","version":1,"versionNonce":1,"updated":1}"#));
    assert!(text.starts_with("{\n  \"type\": \"excalidraw\",\n  \"appState\""));
    assert_eq!(out.edits.len(), 2);
}

#[test]
fn a_link_split_by_word_wrap_is_repaired_through_original_text() {
    let src = r#"{"type":"excalidraw","elements":[{"id":"t","type":"text","text":"see [[BFS and\nDFS]] now","originalText":"see [[BFS and DFS]] now","containerId":"r","version":1,"updated":1,"versionNonce":1}]}"#;
    let els = one("t", rep("bfs and dfs", "Graphs/BFS and DFS"));
    let out = rewrite(src.as_bytes(), &rules(&els)).unwrap().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.bytes).unwrap();
    assert_eq!(v["elements"][0]["originalText"], "see [[Graphs/BFS and DFS]] now");
    assert_eq!(v["elements"][0]["text"], "see [[Graphs/BFS and DFS]] now");
    assert_eq!(out.edits[0].value, "see [[Graphs/BFS and DFS]] now");
}

#[test]
fn text_without_original_text_and_url_and_relative_link_fields() {
    let src = r#"{"type":"excalidraw","elements":[
        {"id":"a","type":"text","text":"x [[Old]]","version":1,"updated":1,"versionNonce":1},
        {"id":"b","type":"rectangle","link":"vaultdraw://open?file=Old&anchor=%5Ex","version":1},
        {"id":"c","type":"rectangle","link":"./Old.excalidraw","version":1},
        {"id":"d","type":"rectangle","link":"Old.excalidraw","version":1}]}"#;
    let mut els = BTreeMap::new();
    for id in ["a", "b", "c", "d"] {
        els.insert(id.to_string(), vec![Replace { old_key: "old".into(), new_target: "Dir/New one".into(), new_path: "Dir/New one".into() }]);
    }
    let r = FileRules { old_dir: "", new_dir: "", elements: &els, tag: None, now_ms: 5 };
    let out = rewrite(src.as_bytes(), &r).unwrap().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.bytes).unwrap();
    let e = &v["elements"];
    assert_eq!(e[0]["text"], "x [[Dir/New one]]");
    assert_eq!(e[1]["link"], "vaultdraw://open?file=Dir/New%20one&anchor=%5Ex");
    assert_eq!(e[2]["link"], "./Dir/New one.excalidraw");
    assert_eq!(e[3]["link"], "Dir/New one.excalidraw");
    assert_eq!(e[1]["version"], 2);
    assert!(e[1].get("updated").is_none(), "no key is ever added");
}

#[test]
fn rewrite_returns_none_when_nothing_matches_and_rejects_truncated_json() {
    let src = r#"{"type":"excalidraw","elements":[{"id":"t","type":"text","text":"[[Other]]","originalText":"[[Other]]"}]}"#;
    assert!(rewrite(src.as_bytes(), &rules(&one("t", rep("old", "New")))).unwrap().is_none());
    assert!(rewrite(src.as_bytes(), &rules(&one("zzz", rep("other", "New")))).unwrap().is_none());
    assert!(rewrite(b"{\"elements\":[{\"id\":\"t\",\"text\":\"[[a", &rules(&one("t", rep("a", "b")))).is_err());
}

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
    fn chance(&mut self, pct: usize) -> bool {
        self.below(100) < pct
    }
}

/// A JSON string literal for `s` with randomly chosen escape styles (raw UTF-8, `\uXXXX`,
/// escaped surrogate pairs, `\/`).
fn json_string(r: &mut Rng, s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\t' => o.push_str("\\t"),
            '/' if r.chance(30) => o.push_str("\\/"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c if !c.is_ascii() && r.chance(50) => {
                let mut b = [0u16; 2];
                for u in c.encode_utf16(&mut b) {
                    o.push_str(&format!("\\u{:04X}", u));
                }
            }
            c if c.is_ascii_alphabetic() && r.chance(3) => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

const PIECES: &[&str] = &[
    "word ", "[[Old]]", "[[old|label]]", "[[Other]]", " [[ Old ]] ", "\"quoted\"", "back\\slash", "line\nbreak", "é", "😀", "日本", "[[", "]]", "[[Old.excalidraw]]", "tab\t", "[x]", "/slash/", "[[Old|a|b]]",
];

fn random_text(r: &mut Rng) -> String {
    (0..r.below(8)).map(|_| PIECES[r.below(PIECES.len())]).collect()
}

#[test]
fn fuzz_rewrite_is_byte_preserving_and_only_targeted_fields_differ() {
    let new_target = "Brand \"New\" é😀\\x";
    let mut rng = Rng(0x9E3779B97F4A7C15);
    for round in 0..400 {
        let n = rng.below(14);
        let mut raws: Vec<String> = Vec::new();
        let mut targeted: Vec<String> = Vec::new();
        for i in 0..n {
            let id = format!("id{i}");
            let ty = ["text", "rectangle", "arrow"][rng.below(3)];
            let mut fields: Vec<String> = vec![format!("\"id\":\"{id}\""), format!("\"type\":\"{ty}\"")];
            fields.push(format!("\"x\":{}", rng.below(1000) as f64 / 7.0));
            fields.push("\"isDeleted\":false".into());
            fields.push("\"boundElements\":[{\"id\":\"a\",\"type\":\"text\"}]".into());
            let decoy = random_text(&mut rng);
            fields.push(format!("\"customData\":{{\"text\":{}}}", json_string(&mut rng, &decoy)));
            if ty == "text" {
                let orig = random_text(&mut rng);
                let wrapped = if rng.chance(30) { orig.replace(' ', "\n") } else { orig.clone() };
                fields.push(format!("\"text\":{}", json_string(&mut rng, &wrapped)));
                if rng.chance(85) {
                    fields.push(format!("\"originalText\":{}", json_string(&mut rng, &orig)));
                }
            }
            match rng.below(6) {
                0 => fields.push(format!("\"link\":{}", json_string(&mut rng, "[[Old]]"))),
                1 => fields.push("\"link\":\"vaultdraw://open?file=Old\"".into()),
                2 => fields.push("\"link\":\"./Old.excalidraw\"".into()),
                3 => fields.push("\"link\":null".into()),
                4 => fields.push("\"link\":\"https://example.com/[[Old]]\"".into()),
                _ => {}
            }
            fields.push(format!("\"version\":{}", rng.below(100)));
            fields.push(format!("\"versionNonce\":{}", rng.below(1 << 30)));
            fields.push(format!("\"updated\":{}", 1_600_000_000_000u64 + rng.below(1000) as u64));
            // shuffle field order
            for k in (1..fields.len()).rev() {
                fields.swap(k, rng.below(k + 1));
            }
            let ws = if rng.chance(30) { "\n    " } else { "" };
            raws.push(format!("{{{ws}{}{ws}}}", fields.join(&format!(",{ws}"))));
            if rng.chance(55) {
                targeted.push(id);
            }
        }
        let blob = "A".repeat(rng.below(5000));
        let src = format!(
            "{{\"type\":\"excalidraw\",\"version\":2,\"appState\":{{\"name\":{}}},\"elements\":[{}],\"files\":{{\"f\":{{\"dataURL\":\"data:image/png;base64,{blob}\"}}}}}}",
            json_string(&mut rng, "[[Old]] \u{1F600}"),
            raws.join(",")
        );
        let els: BTreeMap<String, Vec<Replace>> = targeted.iter().map(|id| (id.clone(), vec![Replace { old_key: "old".into(), new_target: new_target.into(), new_path: "New".into() }])).collect();
        let r = FileRules { old_dir: "", new_dir: "", elements: &els, tag: None, now_ms: 1_700_000_000_123 };
        let out = rewrite(src.as_bytes(), &r).unwrap_or_else(|e| panic!("round {round}: {}", e.message));

        let before: serde_json::Value = serde_json::from_str(&src).unwrap();
        let Some(out) = out else {
            // no change claimed: the oracle must agree
            for id in &targeted {
                let el = before["elements"].as_array().unwrap().iter().find(|e| e["id"] == id.as_str()).unwrap();
                assert!(oracle(el, &els[id], &r).is_none(), "round {round}: missed an edit in {id}");
            }
            continue;
        };
        let after: serde_json::Value = serde_json::from_slice(&out.bytes).unwrap_or_else(|e| panic!("round {round}: output must parse: {e}"));
        let mut expected = before.clone();
        let mut changed_ids = Vec::new();
        for el in expected["elements"].as_array_mut().unwrap() {
            let id = el["id"].as_str().unwrap().to_string();
            if let Some(reps) = els.get(&id) {
                if let Some(new_el) = oracle(el, reps, &r) {
                    *el = new_el;
                    changed_ids.push(id);
                }
            }
        }
        // versionNonce is random: only check its range, then align it.
        for (a, e) in after["elements"].as_array().unwrap().iter().zip(expected["elements"].as_array_mut().unwrap()) {
            if changed_ids.contains(&a["id"].as_str().unwrap().to_string()) && a.get("versionNonce").is_some_and(|n| n.is_number()) {
                assert!(a["versionNonce"].as_u64().unwrap() < (1 << 31));
                e["versionNonce"] = a["versionNonce"].clone();
            }
        }
        assert_eq!(after, expected, "round {round}\n{src}");
        // Untouched elements keep their exact bytes.
        let out_text = String::from_utf8(out.bytes).unwrap();
        for (i, raw) in raws.iter().enumerate() {
            if !changed_ids.contains(&format!("id{i}")) {
                assert!(out_text.contains(raw.as_str()), "round {round}: element {i} bytes changed");
            }
        }
        assert!(out_text.contains(&blob));
    }
}

/// Independent model of the rewrite of one element (decoded values).
fn oracle(el: &serde_json::Value, reps: &[Replace], r: &FileRules) -> Option<serde_json::Value> {
    let mut el = el.clone();
    let mut changed = false;
    let text_edit = |s: &str| -> Option<String> {
        let mut out = String::new();
        let (mut at, mut any) = (0, false);
        text_links(s, |l| {
            if reps.iter().any(|x| x.old_key == key_of_target(l.target)) {
                out.push_str(&s[at..l.target_range.0]);
                out.push_str(&reps[0].new_target);
                at = l.target_range.1;
                any = true;
            }
        });
        out.push_str(&s[at..]);
        any.then_some(out)
    };
    let orig = el.get("originalText").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
    let source = orig.clone().or_else(|| el.get("text").and_then(|v| v.as_str()).map(str::to_string));
    if let Some(new) = source.and_then(|s| text_edit(&s)) {
        el["text"] = new.clone().into();
        if orig.is_some() {
            el["originalText"] = new.into();
        }
        changed = true;
    }
    if let Some(link) = el.get("link").and_then(|v| v.as_str()).map(str::to_string) {
        if let Some(new) = super::rewrite::link_field_edit(&link, reps, r) {
            el["link"] = new.into();
            changed = true;
        }
    }
    if !changed {
        return None;
    }
    if let Some(v) = el.get("version").and_then(|v| v.as_u64()) {
        el["version"] = (v + 1).into();
    }
    if el.get("updated").is_some_and(|v| v.is_number()) {
        el["updated"] = r.now_ms.into();
    }
    Some(el)
}

// ---------------------------------------------------------------- vault flow

fn scene(elements: &[String]) -> String {
    format!(r##"{{"type":"excalidraw","version":2,"elements":[{}],"appState":{{"viewBackgroundColor":"#ffffff"}},"files":{{}}}}"##, elements.join(","))
}

fn text_el(id: &str, text: &str) -> String {
    format!(r#"{{"id":"{id}","type":"text","text":{t},"originalText":{t},"isDeleted":false,"version":3,"versionNonce":1,"updated":1}}"#, t = serde_json::to_string(text).unwrap())
}

fn link_el(id: &str, link: &str) -> String {
    format!(r#"{{"id":"{id}","type":"rectangle","link":{},"isDeleted":false,"version":3,"versionNonce":1,"updated":1}}"#, serde_json::to_string(link).unwrap())
}

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).unwrap()
}

fn test_vault(root: &Path) -> Arc<Vault> {
    Arc::new(Vault::for_tests(root.canonicalize().unwrap(), "h", false))
}

struct Env {
    _dir: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    v: Arc<Vault>,
    search: SearchService,
    links: LinksState,
    done: Arc<Mutex<Vec<RewriteDone>>>,
    indexed: Arc<AtomicUsize>,
}

fn env(files: &[(&str, String)]) -> Env {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    for (p, b) in files {
        write(&root, p, b);
    }
    let v = test_vault(&root);
    let search = SearchService::default();
    search.start_with("h", v.root.clone(), Arc::new(|_| {}), None);
    for _ in 0..400 {
        if search.status("h").is_ok_and(|s| s.state == IndexState::Ready) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let state = dir.path().join("state");
    Env { root: v.root.clone(), _dir: dir, state, v, search, links: LinksState::default(), done: Arc::default(), indexed: Arc::default() }
}

impl Env {
    fn links_dir(&self) -> PathBuf {
        journal::links_dir(&self.state, &self.root)
    }
    fn hooks(&self, before: impl Fn(&str) + Send + Sync + 'static) -> Hooks {
        let (done, indexed) = (self.done.clone(), self.indexed.clone());
        let (search, handle) = (self.search_clone(), self.v.handle.clone());
        Hooks {
            indexed: Box::new(move |path, stat, bytes| {
                indexed.fetch_add(1, Ordering::SeqCst);
                search.upsert_bytes(&handle, path, stat, bytes);
            }),
            done: Box::new(move |d| done.lock().unwrap().push(d)),
            before_write: Box::new(before),
            dir: Some(self.links_dir()),
        }
    }
    fn search_clone(&self) -> Arc<SearchService> {
        // SearchService is not Clone; tests share the one instance through a raw pointer-free trick:
        // hand the hooks a service that forwards to the same vault index.
        let shared = SearchService::default();
        shared.adopt(&self.search, "h");
        Arc::new(shared)
    }
    fn mv(&self, from: &str, to: &str, open: Option<&str>, before: impl Fn(&str) + Send + Sync + 'static) -> (MoveResult, Option<std::thread::JoinHandle<()>>) {
        let hooks = self.hooks(before);
        let root = self.root.clone();
        move_with_links(&self.v, &MoveRequest { from, to, open_path: open }, (&self.search, &self.links), hooks, || crate::move_entry_paths(&root, from, to)).unwrap()
    }
    fn mv_wait(&self, from: &str, to: &str, open: Option<&str>) -> MoveResult {
        let (r, h) = self.mv(from, to, open, |_| {});
        if let Some(h) = h {
            h.join().unwrap();
        }
        r
    }
}

#[test]
fn rename_rewrites_closed_drawings_on_a_background_thread() {
    let a = scene(&[text_el("t1", "see [[Old]] and [[Other]]"), link_el("s1", "[[Old]]"), text_el("t2", "plain")]);
    let b = scene(&[link_el("s", "vaultdraw://open?file=Old"), link_el("r", "../Old.excalidraw")]);
    let e = env(&[("Old.excalidraw", scene(&[text_el("o", "old")])), ("a.excalidraw", a.clone()), ("sub/b.excalidraw", b), ("Other.excalidraw", scene(&[]))]);
    let started = Instant::now();
    let (r, h) = e.mv("Old.excalidraw", "New.excalidraw", None, |_| {});
    assert!(started.elapsed() < Duration::from_millis(500));
    assert_eq!((r.planned_files, r.planned_links), (2, 4));
    assert!(r.job_id.is_some() && r.open_drawing_edits.is_empty());
    h.unwrap().join().unwrap();
    assert!(!e.root.join("Old.excalidraw").exists() && e.root.join("New.excalidraw").exists());
    let expected_a = a.replace("[[Old]]", "[[New]]");
    let got_a = read(&e.root, "a.excalidraw");
    let (ja, jx): (serde_json::Value, serde_json::Value) = (serde_json::from_str(&got_a).unwrap(), serde_json::from_str(&expected_a).unwrap());
    assert_eq!(ja["elements"][0]["text"], jx["elements"][0]["text"]);
    assert_eq!(ja["elements"][0]["originalText"], "see [[New]] and [[Other]]");
    assert_eq!(ja["elements"][1]["link"], "[[New]]");
    assert_eq!(ja["elements"][2], jx["elements"][2]);
    assert_eq!(ja["elements"][0]["version"], 4);
    assert!(got_a.contains(r#"{"id":"t2","type":"text""#));
    // `sub/b` links by URL and by relative path from `sub/`: the relative link needs `../`
    let b2: serde_json::Value = serde_json::from_str(&read(&e.root, "sub/b.excalidraw")).unwrap();
    assert_eq!(b2["elements"][0]["link"], "vaultdraw://open?file=New");
    assert_eq!(b2["elements"][1]["link"], "../New.excalidraw");
    // done event, journal gone, indexes and re-measure set updated
    let done = e.done.lock().unwrap().clone();
    assert_eq!(done.len(), 1);
    assert_eq!((done[0].job_id, done[0].rewritten, done[0].links, done[0].failed.len()), (r.job_id.unwrap(), 2, 4, 0));
    assert!(!journal::journal_exists(&e.links_dir()));
    let set = journal::load_remeasure(&e.links_dir());
    assert_eq!(set.paths.get("a.excalidraw"), Some(&vec!["t1".to_string()]));
    assert!(!set.paths.contains_key("sub/b.excalidraw"), "shape links need no re-measure");
    assert_eq!(e.indexed.load(Ordering::SeqCst), 2);
    let vi = e.search.vault("h").unwrap();
    let resp = query::links_response(&vi.read(), "New.excalidraw");
    assert_eq!(resp.backlinks.len(), 4);
    assert!(resp.backlinks.iter().all(|b| b.path != "Old.excalidraw"));
}

#[test]
fn the_open_drawing_is_never_written_and_its_edits_are_returned() {
    let a = scene(&[text_el("t1", "see [[Old]]"), link_el("s1", "[[Old]]")]);
    let e = env(&[("Old.excalidraw", scene(&[])), ("a.excalidraw", a.clone()), ("c.excalidraw", scene(&[text_el("t", "[[Old]]")]))]);
    let r = e.mv_wait("Old.excalidraw", "New.excalidraw", Some("a.excalidraw"));
    assert_eq!(read(&e.root, "a.excalidraw"), a, "open drawing untouched on disk");
    let mut edits = r.open_drawing_edits.clone();
    edits.sort_by(|x, y| x.element_id.cmp(&y.element_id));
    assert_eq!(
        edits,
        vec![
            ElementEdit { element_id: "s1".into(), field: EditField::Link, value: "[[New]]".into() },
            ElementEdit { element_id: "t1".into(), field: EditField::Text, value: "see [[New]]".into() },
        ]
    );
    assert_eq!((r.planned_files, r.planned_links), (1, 1));
    assert!(read(&e.root, "c.excalidraw").contains("[[New]]"));
}

#[test]
fn open_drawing_inside_a_moved_folder_is_matched_by_its_pre_move_path() {
    let e = env(&[
        ("F/Old.excalidraw", scene(&[])),
        ("F/note.excalidraw", scene(&[link_el("s", "Old.excalidraw")])),
        ("x.excalidraw", scene(&[text_el("t", "[[F/Old]]")])),
    ]);
    // `F/note` (open) links to `Old.excalidraw` relative to F/; moving F/Old to the root breaks it.
    let r = e.mv_wait("F/Old.excalidraw", "Zed.excalidraw", Some("F/note.excalidraw"));
    assert_eq!(r.open_drawing_edits, vec![ElementEdit { element_id: "s".into(), field: EditField::Link, value: "../Zed.excalidraw".into() }]);
    assert_eq!(r.planned_files, 1);
    assert!(read(&e.root, "x.excalidraw").contains("[[Zed]]"));
    assert!(read(&e.root, "F/note.excalidraw").contains("\"Old.excalidraw\""), "open drawing untouched");
}

#[test]
fn a_file_changed_underneath_is_skipped_and_reported_never_overwritten() {
    let e = env(&[("Old.excalidraw", scene(&[])), ("a.excalidraw", scene(&[text_el("t", "[[Old]]")])), ("b.excalidraw", scene(&[text_el("t", "[[Old]]")]))]);
    let root = e.root.clone();
    let theirs = scene(&[text_el("t", "[[Old]] edited elsewhere")]);
    let theirs2 = theirs.clone();
    let (_, h) = e.mv("Old.excalidraw", "New.excalidraw", None, move |p| {
        if p == "a.excalidraw" {
            fs::write(root.join("a.excalidraw"), &theirs2).unwrap();
        }
    });
    h.unwrap().join().unwrap();
    assert_eq!(read(&e.root, "a.excalidraw"), theirs, "conflicting file is left as the other writer saved it");
    assert!(read(&e.root, "b.excalidraw").contains("[[New]]"));
    let done = e.done.lock().unwrap()[0].clone();
    assert_eq!(done.rewritten, 1);
    assert_eq!(done.failed.len(), 1);
    assert_eq!((done.failed[0].path.as_str(), done.failed[0].code.as_str()), ("a.excalidraw", "CONFLICT"));
    assert!(!journal::journal_exists(&e.links_dir()), "journal removed even with failures");
    // The rewrite path makes no recovery copy and leaves no temp file behind.
    let meta = e.root.join(".excalidraw-vault");
    let files = |d: &Path| -> usize { fs::read_dir(d).map(|r| r.flatten().filter(|x| x.path().is_file()).count()).unwrap_or(0) };
    assert_eq!(files(&meta.join("recovery")), 0);
    assert!(fs::read_dir(&e.root).unwrap().flatten().all(|x| !x.file_name().to_string_lossy().starts_with(".excalidraw-tmp-")));
}

#[test]
fn journal_replay_is_idempotent_and_removes_the_journal() {
    let e = env(&[("New.excalidraw", scene(&[])), ("a.excalidraw", scene(&[text_el("t", "[[Old]] [[Old]]")]))]);
    let plan = FilePlan {
        from_path: "a.excalidraw".into(),
        to_path: "a.excalidraw".into(),
        elements: BTreeMap::from([("t".to_string(), vec![Replace { old_key: "old".into(), new_target: "New".into(), new_path: "New".into() }])]),
    };
    let dir = e.links_dir();
    journal::write_journal(&dir, &Journal::new(7, vec![plan.clone()])).unwrap();
    let hooks = e.hooks(|_| {});
    let first = replay_journal(&e.v, &hooks, &e.links).unwrap();
    assert_eq!((first.rewritten, first.links), (1, 2));
    let once = read(&e.root, "a.excalidraw");
    assert_eq!(once.matches("[[New]]").count(), 4, "text and originalText");
    assert!(!journal::journal_exists(&dir));
    assert!(replay_journal(&e.v, &hooks, &e.links).is_none());
    // replaying a stale journal again changes nothing
    journal::write_journal(&dir, &Journal::new(7, vec![plan])).unwrap();
    let second = replay_journal(&e.v, &hooks, &e.links).unwrap();
    assert_eq!((second.rewritten, second.links), (0, 0));
    assert_eq!(read(&e.root, "a.excalidraw"), once);
    // an unreadable journal is dropped
    fs::write(dir.join("pending.json"), "{garbage").unwrap();
    assert!(replay_journal(&e.v, &hooks, &e.links).is_none());
    assert!(!journal::journal_exists(&dir));
}

#[test]
fn remeasure_set_round_trips_and_follows_moves() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    journal::add_remeasure(d, vec![("a.excalidraw".into(), vec!["t1".into()]), ("b.excalidraw".into(), vec!["x".into()])]).unwrap();
    journal::add_remeasure(d, vec![("a.excalidraw".into(), vec!["t1".into(), "t2".into()])]).unwrap();
    assert_eq!(journal::load_remeasure(d).paths["a.excalidraw"], vec!["t1", "t2"]);
    journal::remap_remeasure(d, &[("a.excalidraw".into(), "z/a.excalidraw".into())]).unwrap();
    assert!(journal::load_remeasure(d).paths.contains_key("z/a.excalidraw"));
    journal::remeasure_done(d, "z/a.excalidraw").unwrap();
    journal::remeasure_done(d, "b.excalidraw").unwrap();
    assert!(journal::load_remeasure(d).paths.is_empty());
    assert!(!d.join("remeasure.json").exists());
}

#[test]
fn folder_move_with_unique_bare_names_needs_no_rewrite() {
    let e = env(&[("F/One.excalidraw", scene(&[])), ("F/Two.excalidraw", scene(&[])), ("a.excalidraw", scene(&[text_el("t", "[[One]] [[Two]]")]))]);
    let r = e.mv_wait("F", "G", None);
    assert_eq!((r.job_id, r.planned_files), (None, 0));
    assert!(e.root.join("G/One.excalidraw").exists());
    assert!(e.done.lock().unwrap().is_empty());
    // the live indexes already follow the move
    let vi = e.search.vault("h").unwrap();
    assert_eq!(query::links_response(&vi.read(), "G/One.excalidraw").backlinks.len(), 1);
}

#[test]
fn rename_failure_leaves_no_journal() {
    let e = env(&[("Old.excalidraw", scene(&[])), ("a.excalidraw", scene(&[text_el("t", "[[Old]]")])), ("Taken.excalidraw", scene(&[]))]);
    let hooks = e.hooks(|_| {});
    let root = e.root.clone();
    let res = move_with_links(&e.v, &MoveRequest { from: "Old.excalidraw", to: "Taken.excalidraw", open_path: None }, (&e.search, &e.links), hooks, || crate::move_entry_paths(&root, "Old.excalidraw", "Taken.excalidraw"));
    assert!(res.is_err());
    assert!(!journal::journal_exists(&e.links_dir()));
    assert!(e.root.join("Old.excalidraw").exists());
    assert!(read(&e.root, "a.excalidraw").contains("[[Old]]"));
}

#[test]
fn extract_feeds_links_from_real_file_bytes() {
    let e = env(&[("T.excalidraw", scene(&[])), ("a.excalidraw", scene(&[text_el("t", "[[T]]"), link_el("s", "vaultdraw://open?file=T")]))]);
    let vi = e.search.vault("h").unwrap();
    let r = with_links(&vi, |i| query::links_response(i, "T.excalidraw"));
    assert_eq!(r.backlinks.len(), 2);
    let g = vi.read();
    assert_ne!(g.get("a.excalidraw").unwrap().hash8, [0; 8]);
    let raw = raw_links("a.excalidraw", g.get("a.excalidraw").unwrap());
    assert_eq!(raw.len(), 2);
    assert!(g.links().unwrap().find_doc("T.excalidraw").is_some_and(|d| d != NONE));
}

#[test]
fn move_docs_keeps_content_and_updates_names() {
    let mut ix = index_of(vec![("F/a.excalidraw", doc("F/a.excalidraw", &[("t", "hello [[b]]")], &[])), plain("b.excalidraw")]);
    let moved = ix.move_docs("F", "G/F");
    assert_eq!(moved, vec![("F/a.excalidraw".to_string(), "G/F/a.excalidraw".to_string())]);
    assert!(ix.get("F/a.excalidraw").is_none());
    assert!(ix.get("G/F/a.excalidraw").unwrap().parsed);
    assert_eq!(query::links_response(&ix, "b.excalidraw").backlinks[0].path, "G/F/a.excalidraw");
    let (hits, _) = ix.query("g f a", crate::search::Scope::Names, 5);
    assert_eq!(hits.len(), 1);
    // renaming a drawing to a non-drawing name drops it from the index
    ix.move_docs("b.excalidraw", "b.txt");
    assert!(ix.get("b.txt").is_none() && ix.get("b.excalidraw").is_none());
}

// ---------------------------------------------------------------- tag rename (F6 P2)

mod tag_rename_tests {
    use super::super::rewrite::TagRule;
    use super::super::tag_rename::{plan, rename_tag_with};
    use super::*;

    fn rule(from: &str, to: &str) -> TagRule {
        TagRule { from_key: from.into(), to: to.into(), skip_under: None }
    }

    /// Renames the tags in one text element through the real rewriter; None when unchanged.
    fn rt(text: &str, from: &str, to: &str) -> Option<String> {
        let src = scene(&[text_el("t", text)]);
        let none = BTreeMap::new();
        let rl = rule(from, to);
        let r = FileRules { old_dir: "", new_dir: "", elements: &none, tag: Some(&rl), now_ms: 9 };
        let out = rewrite(src.as_bytes(), &r).unwrap()?;
        let v: serde_json::Value = serde_json::from_slice(&out.bytes).unwrap();
        assert_eq!(v["elements"][0]["text"], v["elements"][0]["originalText"]);
        Some(v["elements"][0]["originalText"].as_str().unwrap().to_string())
    }

    #[test]
    fn matches_whole_tag_tokens_only() {
        let src = "#dsa #DSA #dsa2 #dsa-x #dsa/graphs http://x.com/#dsa #ff00aa &#123; # heading [[Note#dsa]] a#dsa (#dsa) #dsa.";
        let want = "#Algo #Algo #dsa2 #dsa-x #Algo/graphs http://x.com/#dsa #ff00aa &#123; # heading [[Note#dsa]] a#dsa (#Algo) #Algo.";
        assert_eq!(rt(src, "dsa", "Algo").as_deref(), Some(want));
        assert_eq!(rt("nothing #dsa2 here", "dsa", "Algo"), None);
        assert_eq!(rt("#café/x #CAFE", "cafe", "Kaffee").as_deref(), Some("#Kaffee/x #Kaffee"));
    }

    #[test]
    fn children_keep_their_spelling_and_nesting_works_in_one_pass() {
        assert_eq!(rt("#Dsa/Graphs/BFS #dsa/trees #other", "dsa", "Algo").as_deref(), Some("#Algo/Graphs/BFS #Algo/trees #other"));
        assert_eq!(rt("#dsa/graphs/bfs #dsa/graphs #dsa", "dsa/graphs", "g").as_deref(), Some("#g/bfs #g #dsa"));
        assert_eq!(rt("#a #a/c #A/d", "a", "a/b").as_deref(), Some("#a/b #a/b/c #a/b/d"));
        assert_eq!(rt("#a/b #a/b/c", "a/b", "a").as_deref(), Some("#a #a/c"));
        // already spelled that way: nothing to do
        assert_eq!(rt("#Algo", "algo", "Algo"), None);
        assert_eq!(rt("#algo", "algo", "Algo").as_deref(), Some("#Algo"));
    }

    #[test]
    fn frame_names_and_deleted_elements() {
        let src = format!(
            r##"{{"type":"excalidraw","elements":[{{"id":"f","type":"frame","name":"Plan #dsa","version":1,"versionNonce":1,"updated":1}},{{"id":"d","type":"text","text":"#dsa","originalText":"#dsa","isDeleted":true,"version":1}},{}]}}"##,
            link_el("r", "[[#dsa]]")
        );
        let none = BTreeMap::new();
        let rl = rule("dsa", "Algo");
        let r = FileRules { old_dir: "", new_dir: "", elements: &none, tag: Some(&rl), now_ms: 9 };
        let out = rewrite(src.as_bytes(), &r).unwrap().unwrap();
        let s = String::from_utf8(out.bytes).unwrap();
        assert!(s.contains(r#""name":"Plan #Algo","version":2"#), "{s}");
        assert!(s.contains(r##""text":"#dsa","originalText":"#dsa","isDeleted":true"##), "deleted element untouched");
        assert!(s.contains("[[#dsa]]"), "link fields are not touched in tag mode");
        assert_eq!(out.edits, vec![ElementEdit { element_id: "f".into(), field: EditField::Name, value: "Plan #Algo".into() }]);
        assert!(out.text_elements.is_empty());
    }

    // ---- fuzz: only target tokens change, everything else byte for byte ----

    const TOKENS: &[(&str, &str, bool)] = &[
        ("#dsa ", "#Algo ", true),
        ("#DSA/x ", "#Algo/x ", true),
        ("\"#dsa\" ", "\"#Algo\" ", true),
        ("#dsa2 ", "#dsa2 ", false),
        ("#dsa-x ", "#dsa-x ", false),
        ("http://x.com/#dsa ", "http://x.com/#dsa ", false),
        ("#ff00aa ", "#ff00aa ", false),
        ("&#123; ", "&#123; ", false),
        ("# head ", "# head ", false),
        ("word ", "word ", false),
        ("é😀日本\n", "é😀日本\n", false),
        ("back\\slash\t ", "back\\slash\t ", false),
        ("[[Note#dsa]] ", "[[Note#dsa]] ", false),
    ];

    fn random_tokens(r: &mut Rng) -> (String, String, u32) {
        let (mut a, mut b, mut n) = (String::new(), String::new(), 0);
        for _ in 0..r.below(8) {
            let (x, y, hit) = TOKENS[r.below(TOKENS.len())];
            a.push_str(x);
            b.push_str(y);
            n += hit as u32;
        }
        (a, b, n)
    }

    #[test]
    fn fuzz_tag_mode_is_byte_preserving_and_changes_only_targeted_tokens() {
        let mut rng = Rng(0xA5A5_1234_DEAD_BEEF);
        for round in 0..400 {
            let mut raws = Vec::new();
            let mut expect: Vec<serde_json::Value> = Vec::new();
            let mut changed = Vec::new();
            let mut hits = 0u32;
            let src_for = |raws: &[String], blob: &str, r: &mut Rng| {
                format!(
                    "{{\"type\":\"excalidraw\",\"version\":2,\"appState\":{{\"name\":{}}},\"elements\":[{}],\"files\":{{\"f\":{{\"dataURL\":\"data:image/png;base64,{blob}\"}}}}}}",
                    json_string(r, "#dsa app name"),
                    raws.join(",")
                )
            };
            for i in 0..rng.below(14) {
                let (old, new, n) = random_tokens(&mut rng);
                let kind = rng.below(6);
                let ver = rng.below(100);
                let ws = if rng.chance(30) { "\n  " } else { "" };
                let (raw, exp, did) = match kind {
                    // wrapped text with originalText
                    0 | 1 => {
                        let wrapped = old.replace(' ', "\n");
                        let raw = format!("{{{ws}\"id\":\"e{i}\",\"type\":\"text\",\"text\":{},\"originalText\":{},\"isDeleted\":false,\"version\":{ver},\"versionNonce\":5,\"updated\":7{ws}}}", json_string(&mut rng, &wrapped), json_string(&mut rng, &old));
                        let exp = serde_json::json!({"id":format!("e{i}"),"type":"text","text":if n>0 {&new} else {&wrapped},"originalText":&new,"isDeleted":false,"version":if n>0 {ver+1} else {ver},"versionNonce":5,"updated":if n>0 {1_700_000_000_123u64} else {7}});
                        (raw, exp, n > 0)
                    }
                    // text without originalText
                    2 => {
                        let raw = format!("{{\"id\":\"e{i}\",\"type\":\"text\",\"text\":{},\"version\":{ver}}}", json_string(&mut rng, &old));
                        let exp = serde_json::json!({"id":format!("e{i}"),"type":"text","text":&new,"version":if n>0 {ver+1} else {ver}});
                        (raw, exp, n > 0)
                    }
                    3 => {
                        let raw = format!("{{\"id\":\"e{i}\",\"type\":\"frame\",\"name\":{},\"version\":{ver}}}", json_string(&mut rng, &old));
                        let exp = serde_json::json!({"id":format!("e{i}"),"type":"frame","name":&new,"version":if n>0 {ver+1} else {ver}});
                        (raw, exp, n > 0)
                    }
                    // deleted text and a shape whose customData looks like text: never touched
                    4 => {
                        let raw = format!("{{\"id\":\"e{i}\",\"type\":\"text\",\"text\":{o},\"originalText\":{o},\"isDeleted\":true,\"version\":{ver}}}", o = json_string(&mut rng, &old));
                        let exp: serde_json::Value = serde_json::from_str(&raw).unwrap();
                        (raw, exp, false)
                    }
                    _ => {
                        let raw = format!("{{\"id\":\"e{i}\",\"type\":\"rectangle\",\"text\":{o},\"name\":{o},\"customData\":{{\"text\":{o}}},\"version\":{ver}}}", o = json_string(&mut rng, &old));
                        let exp: serde_json::Value = serde_json::from_str(&raw).unwrap();
                        (raw, exp, false)
                    }
                };
                if did {
                    hits += n;
                    changed.push(format!("e{i}"));
                }
                raws.push(raw);
                expect.push(exp);
            }
            let blob = "A".repeat(rng.below(5000));
            let src = src_for(&raws, &blob, &mut rng);
            let none = BTreeMap::new();
            let rl = rule("dsa", "Algo");
            let r = FileRules { old_dir: "", new_dir: "", elements: &none, tag: Some(&rl), now_ms: 1_700_000_000_123 };
            let out = rewrite(src.as_bytes(), &r).unwrap_or_else(|e| panic!("round {round}: {}", e.message));
            let Some(out) = out else {
                assert!(changed.is_empty(), "round {round}: missed edits {changed:?}\n{src}");
                continue;
            };
            let mut after: serde_json::Value = serde_json::from_slice(&out.bytes).unwrap_or_else(|e| panic!("round {round}: output must parse: {e}"));
            assert_eq!(out.links, hits, "round {round}");
            for (a, e) in after["elements"].as_array_mut().unwrap().iter_mut().zip(&expect) {
                if e.get("versionNonce").is_some() && changed.contains(&a["id"].as_str().unwrap().to_string()) {
                    assert!(a["versionNonce"].as_u64().unwrap() < (1 << 31));
                    a["versionNonce"] = e["versionNonce"].clone();
                }
            }
            assert_eq!(after["elements"], serde_json::Value::Array(expect.clone()), "round {round}\n{src}");
            let before: serde_json::Value = serde_json::from_str(&src).unwrap();
            assert_eq!(after["appState"], before["appState"]);
            let out_text = String::from_utf8(out.bytes).unwrap();
            for (i, raw) in raws.iter().enumerate() {
                if !changed.contains(&format!("e{i}")) {
                    assert!(out_text.contains(raw.as_str()), "round {round}: element {i} bytes changed");
                }
            }
            assert!(out_text.contains(&blob));
        }
    }

    // ---- plan ----

    fn tag_index(docs: &[(&str, &[&str])]) -> Index {
        let mut ix = Index::default();
        for (p, texts) in docs {
            let t: Vec<(String, &str)> = texts.iter().enumerate().map(|(i, t)| (format!("t{i}"), *t)).collect();
            let items = t.iter().map(|(id, t)| item(id, None, t)).collect();
            ix.upsert(p.to_string(), DocEntry::new(p, (1, 1), items));
        }
        ix
    }

    #[test]
    fn plan_counts_files_tokens_keys_and_merges() {
        let ix = tag_index(&[
            ("a.excalidraw", &["#dsa and #DSA/graphs", "#dsa again"]),
            ("b.excalidraw", &["#dsa/graphs/bfs only"]),
            ("c.excalidraw", &["#dsa2 and #other"]),
            ("d.excalidraw", &["#Algo exists"]),
        ]);
        let p = plan(&ix, "#dsa", "#Algo").unwrap().response;
        assert_eq!((p.from.as_str(), p.to.as_str(), p.files, p.occurrences, p.merges), ("dsa", "Algo", 2, 4, true));
        let keys: Vec<_> = p.keys.iter().map(|k| (k.from.as_str(), k.to.as_str())).collect();
        assert_eq!(keys, vec![("dsa", "algo"), ("dsa/graphs", "algo/graphs"), ("dsa/graphs/bfs", "algo/graphs/bfs")]);
        let fresh = plan(&ix, "DSA", "Fresh").unwrap().response;
        assert!(!fresh.merges);
        assert_eq!(serde_json::to_value(&fresh).unwrap()["keys"][0], serde_json::json!({"from":"dsa","to":"fresh"}));
        // same spelling: nothing to do; spelling-only change is a rename without a merge
        assert_eq!(plan(&ix, "dsa", "#dsa").unwrap().response.files, 0);
        let case = plan(&ix, "algo", "ALGO").unwrap().response;
        assert_eq!((case.files, case.merges, case.keys.len()), (1, false, 0));
        // `to` nested under `from` is not a merge
        assert!(!plan(&ix, "dsa", "dsa/new").unwrap().response.merges);
    }

    #[test]
    fn plan_rejects_invalid_tags() {
        let ix = tag_index(&[("a.excalidraw", &["#dsa"])]);
        for bad in ["", "#", "two words", "a-", "#a//b", "123", "#ff00aa", "a b#c", "x/", &"a".repeat(65)] {
            assert_eq!(plan(&ix, "dsa", bad).err().map(|e| e.code).as_deref(), Some("INVALID_TAG"), "to={bad:?}");
        }
        assert_eq!(plan(&ix, "no way", "ok").err().map(|e| e.code).as_deref(), Some("INVALID_TAG"));
        assert!(plan(&ix, "dsa", "#ok/fine_2").is_ok());
    }

    // ---- job ----

    fn run(e: &Env, from: &str, to: &str, open: Option<&str>, before: impl Fn(&str) + Send + Sync + 'static) -> Result<(MoveResult, Option<std::thread::JoinHandle<()>>)> {
        rename_tag_with(&e.v, (from, to), open, (&e.search, &e.links), e.hooks(before))
    }

    fn run_wait(e: &Env, from: &str, to: &str, open: Option<&str>) -> MoveResult {
        let (r, h) = run(e, from, to, open, |_| {}).unwrap();
        if let Some(h) = h {
            h.join().unwrap();
        }
        r
    }

    fn tag_keys(e: &Env) -> Vec<String> {
        e.search.tags("h").unwrap().summary.tags.into_iter().map(|t| t.tag).collect()
    }

    #[test]
    fn rename_rewrites_closed_drawings_and_the_tag_index_follows() {
        let a = scene(&[text_el("t1", "#dsa notes #dsa2"), text_el("t2", "plain")]);
        let e = env(&[("a.excalidraw", a.clone()), ("sub/b.excalidraw", scene(&[text_el("t", "#DSA/graphs")])), ("c.excalidraw", scene(&[text_el("t", "#other")]))]);
        let (r, h) = run(&e, "dsa", "Algo", None, |_| {}).unwrap();
        assert_eq!((r.planned_files, r.planned_links), (2, 2));
        assert!(r.job_id.is_some() && r.open_drawing_edits.is_empty());
        assert!(journal::journal_exists(&e.links_dir()) || h.is_none());
        h.unwrap().join().unwrap();
        let got: serde_json::Value = serde_json::from_str(&read(&e.root, "a.excalidraw")).unwrap();
        assert_eq!(got["elements"][0]["originalText"], "#Algo notes #dsa2");
        assert_eq!(got["elements"][0]["text"], "#Algo notes #dsa2");
        assert_eq!(got["elements"][0]["version"], 4);
        assert!(read(&e.root, "a.excalidraw").contains(r#"{"id":"t2","type":"text""#));
        assert!(read(&e.root, "sub/b.excalidraw").contains("#Algo/graphs"));
        assert_eq!(read(&e.root, "c.excalidraw"), scene(&[text_el("t", "#other")]));
        let done = e.done.lock().unwrap().clone();
        assert_eq!((done.len(), done[0].rewritten, done[0].links, done[0].failed.len()), (1, 2, 2, 0));
        assert!(!journal::journal_exists(&e.links_dir()));
        let set = journal::load_remeasure(&e.links_dir());
        assert_eq!(set.paths.get("a.excalidraw"), Some(&vec!["t1".to_string()]));
        assert_eq!(e.indexed.load(Ordering::SeqCst), 2);
        let keys = tag_keys(&e);
        assert!(keys.contains(&"algo".to_string()) && keys.contains(&"algo/graphs".to_string()) && !keys.contains(&"dsa".to_string()), "{keys:?}");
        assert!(keys.contains(&"dsa2".to_string()));
        // nothing left to do now
        let again = run_wait(&e, "dsa", "Algo", None);
        assert_eq!((again.job_id, again.planned_files, again.planned_links), (None, 0, 0));
    }

    #[test]
    fn nesting_a_tag_under_itself_works() {
        let e = env(&[("a.excalidraw", scene(&[text_el("t", "#a #a/c")]))]);
        let r = run_wait(&e, "a", "a/b", None);
        assert_eq!(r.planned_links, 2);
        assert!(read(&e.root, "a.excalidraw").contains("#a/b #a/b/c"));
    }

    #[test]
    fn same_spelling_is_no_job_and_invalid_tags_error() {
        let e = env(&[("a.excalidraw", scene(&[text_el("t", "#dsa")]))]);
        let r = run_wait(&e, "#dsa", "dsa", None);
        assert_eq!((r.job_id, r.planned_files, r.planned_links), (None, 0, 0));
        assert!(!journal::journal_exists(&e.links_dir()));
        assert_eq!(run(&e, "dsa", "no good", None, |_| {}).err().map(|e| e.code).as_deref(), Some("INVALID_TAG"));
    }

    #[test]
    fn the_open_drawing_gets_edits_not_a_disk_write() {
        let a = scene(&[text_el("t1", "#dsa here"), format!(r##"{{"id":"f","type":"frame","name":"#dsa frame","isDeleted":false,"version":1,"versionNonce":1,"updated":1}}"##)]);
        let e = env(&[("a.excalidraw", a.clone()), ("b.excalidraw", scene(&[text_el("t", "#dsa")]))]);
        let r = run_wait(&e, "dsa", "Algo", Some("a.excalidraw"));
        assert_eq!(read(&e.root, "a.excalidraw"), a, "open drawing untouched on disk");
        let mut edits = r.open_drawing_edits.clone();
        edits.sort_by(|x, y| x.element_id.cmp(&y.element_id));
        assert_eq!(
            edits,
            vec![
                ElementEdit { element_id: "f".into(), field: EditField::Name, value: "#Algo frame".into() },
                ElementEdit { element_id: "t1".into(), field: EditField::Text, value: "#Algo here".into() },
            ]
        );
        assert_eq!((r.planned_files, r.planned_links), (1, 1));
        assert!(read(&e.root, "b.excalidraw").contains("#Algo"));
        // only the open drawing carries the tag: edits, but no job
        let e2 = env(&[("a.excalidraw", scene(&[text_el("t1", "#dsa")]))]);
        let r2 = run_wait(&e2, "dsa", "Algo", Some("a.excalidraw"));
        assert_eq!((r2.job_id, r2.planned_files, r2.open_drawing_edits.len()), (None, 0, 1));
    }

    #[test]
    fn a_file_changed_underneath_is_skipped_and_reported() {
        let e = env(&[("a.excalidraw", scene(&[text_el("t", "#dsa")])), ("b.excalidraw", scene(&[text_el("t", "#dsa")]))]);
        let root = e.root.clone();
        let theirs = scene(&[text_el("t", "#dsa edited elsewhere")]);
        let theirs2 = theirs.clone();
        let (_, h) = run(&e, "dsa", "Algo", None, move |p| {
            if p == "a.excalidraw" {
                fs::write(root.join("a.excalidraw"), &theirs2).unwrap();
            }
        })
        .unwrap();
        h.unwrap().join().unwrap();
        assert_eq!(read(&e.root, "a.excalidraw"), theirs);
        assert!(read(&e.root, "b.excalidraw").contains("#Algo"));
        let done = e.done.lock().unwrap()[0].clone();
        assert_eq!((done.rewritten, done.failed.len(), done.failed[0].code.as_str(), done.failed[0].path.as_str()), (1, 1, "CONFLICT", "a.excalidraw"));
        assert!(!journal::journal_exists(&e.links_dir()));
    }

    fn tag_journal(e: &Env, paths: &[&str], from: &str, to: &str) {
        let files = paths.iter().map(|p| FilePlan { from_path: (*p).into(), to_path: (*p).into(), elements: BTreeMap::new() }).collect();
        journal::write_journal(&e.links_dir(), &Journal::new(3, files).with_tag(rule(from, to))).unwrap();
    }

    #[test]
    fn journal_replay_is_idempotent() {
        let e = env(&[("a.excalidraw", scene(&[text_el("t", "#dsa #dsa/x")]))]);
        tag_journal(&e, &["a.excalidraw"], "dsa", "Algo");
        let hooks = e.hooks(|_| {});
        let first = replay_journal(&e.v, &hooks, &e.links).unwrap();
        assert_eq!((first.rewritten, first.links), (1, 2));
        let once = read(&e.root, "a.excalidraw");
        assert!(once.contains("#Algo #Algo/x") && !journal::journal_exists(&e.links_dir()));
        tag_journal(&e, &["a.excalidraw"], "dsa", "Algo");
        let second = replay_journal(&e.v, &hooks, &e.links).unwrap();
        assert_eq!((second.rewritten, second.links), (0, 0));
        assert_eq!(read(&e.root, "a.excalidraw"), once);
    }

    #[test]
    fn replay_of_a_nested_rename_does_not_nest_twice() {
        let e = env(&[("done.excalidraw", scene(&[text_el("t", "#a/b #a/b/c")])), ("todo.excalidraw", scene(&[text_el("t", "#a #a/c")]))]);
        tag_journal(&e, &["done.excalidraw", "todo.excalidraw"], "a", "a/b");
        let hooks = e.hooks(|_| {});
        replay_journal(&e.v, &hooks, &e.links).unwrap();
        assert!(read(&e.root, "done.excalidraw").contains("#a/b #a/b/c"));
        assert!(read(&e.root, "todo.excalidraw").contains("#a/b #a/b/c"));
    }

    #[test]
    fn old_link_journals_without_a_tag_rule_still_read() {
        let j: Journal = serde_json::from_str(r#"{"version":1,"jobId":2,"files":[]}"#).unwrap();
        assert!(j.tag.is_none());
        let s = serde_json::to_string(&Journal::new(1, vec![])).unwrap();
        assert!(!s.contains("tag"));
    }
}

// ---------------------------------------------------------------- notes

#[test]
fn renaming_a_note_or_a_drawing_rewrites_the_links_in_notes_with_history() {
    let day = "---\ntags: [daily]\n---\nSee [[Old]] and [[Old#Part|shown]] and ![[Old]] and [[Map.excalidraw]].\r\nAlso [md](Old.md) and `[[Old]]`\n";
    let e = env(&[
        ("Old.md", "# Part\n".to_string()),
        ("Daily.md", day.to_string()),
        ("sub/Deep.md", "[[Old]] [[Map]]\n".to_string()),
        ("Map.excalidraw", scene(&[text_el("m", "x")])),
        ("draw.excalidraw", scene(&[text_el("t", "to [[Old]] and [[Old.md]]")])),
    ]);
    let (r, h) = e.mv("Old.md", "New Name.md", None, |_| {});
    assert_eq!(r.planned_files, 3, "two notes by `Old` and the drawing that wrote `[[Old.md]]`; its plain `[[Old]]` is not a note link");
    h.unwrap().join().unwrap();
    assert!(e.root.join("New Name.md").exists() && !e.root.join("Old.md").exists());
    assert_eq!(read(&e.root, "Daily.md"), "---\ntags: [daily]\n---\nSee [[New Name]] and [[New Name#Part|shown]] and ![[New Name]] and [[Map.excalidraw]].\r\nAlso [md](New%20Name.md) and `[[Old]]`\n");
    assert_eq!(read(&e.root, "sub/Deep.md"), "[[New Name]] [[Map]]\n");
    // The drawing's `[[Old]]` kept its meaning (no drawing Old exists: unresolved before and after);
    // its written `[[Old.md]]` named the note and followed the rename.
    let d: serde_json::Value = serde_json::from_str(&read(&e.root, "draw.excalidraw")).unwrap();
    assert_eq!(d["elements"][0]["originalText"], "to [[Old]] and [[New Name.md]]");
    // History copies hold the notes as they were; nothing else was created in the vault.
    let hist = e.root.join(".excalidraw-vault/note-history");
    let copies: usize = fs::read_dir(&hist).unwrap().flatten().map(|d| fs::read_dir(d.path()).unwrap().count()).sum();
    assert_eq!(copies, 2);
    let done = e.done.lock().unwrap().clone();
    assert_eq!((done[0].failed.len(), done[0].rewritten), (0, 3));
    // The index follows: backlinks of the renamed note.
    let vi = e.search.vault("h").unwrap();
    let resp = query::links_response(&vi.read(), "New Name.md");
    let mut from: Vec<_> = resp.backlinks.iter().map(|b| b.path.as_str()).collect();
    from.sort();
    from.dedup();
    assert_eq!(from, vec!["Daily.md", "draw.excalidraw", "sub/Deep.md"]);
}

#[test]
fn a_note_edited_elsewhere_keeps_the_edit_and_gets_the_new_link() {
    // The rewrite reads the note as it is when it writes (never the plan's copy), so an edit made
    // in Obsidian meanwhile is kept; the revision check inside the write covers the last instant.
    let e = env(&[("Old.md", "x".into()), ("A.md", "[[Old]]\n".into())]);
    let root = e.root.clone();
    let (_, h) = e.mv("Old.md", "New.md", None, |_| {});
    fs::write(root.join("A.md"), "[[Old]] edited in Obsidian\n").unwrap();
    h.unwrap().join().unwrap();
    let a = read(&e.root, "A.md");
    assert!(a == "[[Old]] edited in Obsidian\n" || a == "[[New]] edited in Obsidian\n" || a == "[[New]]\n", "never a blend: {a:?}");
}

#[test]
fn moving_a_folder_of_notes_keeps_relative_links_working() {
    let e = env(&[("a/One.md", "[[./Two]] [[../Top]]\n".into()), ("a/Two.md", "".into()), ("Top.md", "".into())]);
    fs::create_dir_all(e.root.join("a/b")).unwrap();
    e.mv_wait("a/One.md", "a/b/One.md", None);
    // Two.md stayed in a/, so from a/b/ it is one folder up.
    assert_eq!(read(&e.root, "a/b/One.md"), "[[../Two]] [[../../Top]]\n");
}
