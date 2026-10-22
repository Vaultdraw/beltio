//! QA black-box tests for vault search: everything goes through `SearchService` (plus the pure
//! `extract_items`/`normalize` helpers) against real temp-dir vaults.

use super::*;
use serde_json::{json, Value};
use std::{fs, path::Path, time::Duration};

// ---------------------------------------------------------------- helpers

fn noop() -> Emitter {
    Arc::new(|_| {})
}

fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
    for _ in 0..600 {
        if cond() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("timed out waiting for {what}");
}

fn scene(elements: Vec<Value>) -> String {
    json!({"type": "excalidraw", "version": 2, "elements": elements, "appState": {}, "files": {}}).to_string()
}

fn text_el(id: &str, text: &str) -> Value {
    json!({"id": id, "type": "text", "text": text, "originalText": text, "isDeleted": false})
}

fn write_scene(root: &Path, rel: &str, elements: Vec<Value>) {
    write_raw(root, rel, &scene(elements));
}

fn write_raw(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn write_texts(root: &Path, rel: &str, texts: &[&str]) {
    write_scene(root, rel, texts.iter().enumerate().map(|(i, t)| text_el(&format!("e{i}"), t)).collect());
}

fn started_with(root: &Path, snapshot: Option<std::path::PathBuf>) -> SearchService {
    let svc = SearchService::default();
    svc.start_with("h", root.to_path_buf(), noop(), snapshot);
    wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
    svc
}

fn started(root: &Path) -> SearchService {
    started_with(root, None)
}

fn run(svc: &SearchService, q: &str, scope: Option<&str>) -> SearchResponse {
    svc.search("h", q, None, scope).unwrap()
}

fn paths(svc: &SearchService, q: &str) -> Vec<String> {
    run(svc, q, None).results.into_iter().map(|h| h.path).collect()
}

fn slice16(s: &str, r: [u32; 2]) -> String {
    let u: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16(&u[r[0] as usize..r[1] as usize]).unwrap()
}

/// Highlighted fragments of the first match of the first hit.
fn fragments(svc: &SearchService, q: &str) -> Vec<String> {
    let r = run(svc, q, None);
    let m = &r.results[0].matches[0];
    m.highlights.iter().map(|h| slice16(&m.snippet, *h)).collect()
}

/// One-drawing vault with `texts`; asserts that every query finds it and every `misses` doesn't.
fn assert_finds(texts: &[&str], hits: &[&str], misses: &[&str]) {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "doc.excalidraw", texts);
    let svc = started(dir.path());
    for q in hits {
        assert_eq!(paths(&svc, q), ["doc.excalidraw"], "query {q:?} should find {texts:?}");
    }
    for q in misses {
        assert!(paths(&svc, q).is_empty(), "query {q:?} should NOT find {texts:?}");
    }
}

fn set_mtime(path: &Path, t: std::time::SystemTime) {
    fs::OpenOptions::new().write(true).open(path).unwrap().set_modified(t).unwrap();
}

fn hours_ago(h: u64) -> std::time::SystemTime {
    std::time::SystemTime::now() - Duration::from_secs(h * 3600)
}

// ---------------------------------------------------------------- unicode

#[test]
fn cjk_chinese_substring() {
    assert_finds(&["数据库设计与服务认证流程"], &["数据库", "库设计", "认证", "数据库 流程"], &["数据表", "数据 mysql"]);
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["数据库设计"]);
    let svc = started(dir.path());
    assert_eq!(fragments(&svc, "数据库"), ["数据库"]);
}

#[test]
fn japanese_kana_katakana_and_hiragana_are_equivalent() {
    assert_finds(&["カフェ メニュー"], &["かふぇ", "カフェ", "めにゅー", "メニュー"], &[]);
    assert_finds(&["ひらがな"], &["ヒラガナ", "ひらがな"], &[]);
}

#[test]
fn japanese_voiced_and_unvoiced_kana_are_not_conflated() {
    assert_finds(&["がっこう"], &["が", "がっ"], &["か", "かっこう"]);
    assert_finds(&["かっこう"], &["か"], &["が", "がっこう"]);
    assert_finds(&["ガッコウ"], &["がっこう"], &["かっこう"]);
    assert_finds(&["ばなな"], &["ば"], &["は", "ぱ"]);
}

#[test]
fn korean_hangul() {
    assert_finds(&["한국어 문서 검색"], &["한국어", "국어", "문서 검색", "검색 한국"], &["한극어", "한국어 영어"]);
}

#[test]
fn accents_fold_both_ways() {
    assert_finds(&["Café au lait"], &["cafe", "CAFÉ", "café", "cafe au", "au lait"], &["cafes"]);
    assert_finds(&["cafe"], &["café", "CAFÉ"], &[]);
    // decomposed input (e + combining acute) on either side
    assert_finds(&["Cafe\u{301}"], &["cafe", "café"], &[]);
    assert_finds(&["résumé naïve"], &["resume", "naive", "RÉSUMÉ"], &[]);
}

#[test]
fn eszett_and_ligatures() {
    assert_finds(&["Straße"], &["strasse", "STRASSE", "straße"], &[]);
    assert_finds(&["STRASSE"], &["straße"], &[]);
    assert_finds(&["Ærø Łódź"], &["aero", "lodz"], &[]);
    // highlight the original ß for a query of "ss"
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["Straße"]);
    let svc = started(dir.path());
    assert_eq!(fragments(&svc, "ss"), ["ß"]);
}

#[test]
fn fullwidth_forms() {
    assert_finds(&["ＡＢＣ１２３ ｆｕｌｌ"], &["abc123", "FULL"], &[]);
    assert_finds(&["abc123"], &["ＡＢＣ１２３"], &[]);
}

#[test]
fn emoji_highlight_offsets_are_utf16() {
    let dir = tempfile::tempdir().unwrap();
    // 😀 is a surrogate pair (2 UTF-16 units), 🎉 too.
    write_texts(dir.path(), "a.excalidraw", &["😀 data 🎉 base 😀data"]);
    let svc = started(dir.path());
    let r = run(&svc, "data", None);
    let m = &r.results[0].matches[0];
    assert_eq!(m.highlights[0], [3, 7]);
    for h in &m.highlights {
        assert_eq!(slice16(&m.snippet, *h), "data");
    }
    assert_eq!(m.highlights.len(), 2);
    // Emoji can be searched too.
    assert_eq!(paths(&svc, "🎉"), ["a.excalidraw"]);
    // Astral CJK (Ext B) character survives.
    write_texts(dir.path(), "b.excalidraw", &["𠀀 数据"]);
    svc.notify("h", &["b.excalidraw".into()], false);
    wait_until("ext-b", || paths(&svc, "数据") == ["b.excalidraw"]);
    let r = run(&svc, "数据", None);
    let m = &r.results[0].matches[0];
    assert_eq!(slice16(&m.snippet, m.highlights[0]), "数据");
}

#[test]
fn rtl_arabic_and_hebrew_do_not_crash_and_match() {
    assert_finds(&["مرحبا بالعالم", "שלום עולם"], &["مرحبا", "العالم", "שלום"], &["xyz"]);
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["مرحبا بالعالم"]);
    let svc = started(dir.path());
    assert_eq!(fragments(&svc, "مرحبا"), ["مرحبا"]);
}

#[test]
fn unicode_file_names_are_searchable() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "文档/数据库笔记.excalidraw", &["x"]);
    write_texts(dir.path(), "Café Ideas.excalidraw", &["y"]);
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "数据库"), ["文档/数据库笔记.excalidraw"]);
    assert_eq!(paths(&svc, "cafe ideas"), ["Café Ideas.excalidraw"]);
    let h = &run(&svc, "cafe", None).results[0];
    assert_eq!(h.name_highlights, vec![[0, 4]]);
}

// ---------------------------------------------------------------- ranking

#[test]
fn file_name_match_ranks_above_content_match() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "notes.excalidraw", &["dijkstra"]);
    write_texts(dir.path(), "dijkstra.excalidraw", &["unrelated"]);
    write_texts(dir.path(), "dijkstra-notes/other.excalidraw", &["unrelated"]);
    let svc = started(dir.path());
    let r = paths(&svc, "dijkstra");
    assert_eq!(r[0], "dijkstra.excalidraw");
    assert_eq!(r.len(), 3);
    assert!(r[1..].contains(&"notes.excalidraw".to_string()));
    // File-name match beats a folder-name match.
    let pos = |p: &str| r.iter().position(|x| x == p).unwrap();
    assert!(pos("dijkstra.excalidraw") < pos("dijkstra-notes/other.excalidraw"));
}

#[test]
fn exact_word_ranks_above_prefix_above_mid_word() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["undijkstras"]); // mid-word
    write_texts(dir.path(), "b.excalidraw", &["dijkstras algorithm"]); // word prefix
    write_texts(dir.path(), "c.excalidraw", &["my dijkstra run"]); // whole word
    write_texts(dir.path(), "d.excalidraw", &["Dijkstra"]); // whole text
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "dijkstra"), ["d.excalidraw", "c.excalidraw", "b.excalidraw", "a.excalidraw"]);
    let scores: Vec<f32> = run(&svc, "dijkstra", None).results.iter().map(|h| h.score).collect();
    assert!(scores.windows(2).all(|w| w[0] > w[1]), "{scores:?}");
}

#[test]
fn name_exact_beats_name_mid_word() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "xdijkstrax.excalidraw", &["a"]);
    write_texts(dir.path(), "dijkstra.excalidraw", &["a"]);
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "dijkstra"), ["dijkstra.excalidraw", "xdijkstrax.excalidraw"]);
}

#[test]
fn more_hits_rank_higher() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "one.excalidraw", &["node a"]);
    write_texts(dir.path(), "three.excalidraw", &["node a", "node b", "node c"]);
    write_texts(dir.path(), "two.excalidraw", &["node a", "node b"]);
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "node"), ["three.excalidraw", "two.excalidraw", "one.excalidraw"]);
    let r = run(&svc, "node", None);
    assert_eq!(r.results[0].match_count, 3);
}

#[test]
fn ties_break_by_shorter_path_then_alphabetically_and_are_deterministic() {
    let dir = tempfile::tempdir().unwrap();
    for n in ["bb", "aa", "cc", "a"] {
        write_texts(dir.path(), &format!("{n}.excalidraw"), &["same words here"]);
    }
    write_texts(dir.path(), "sub/a.excalidraw", &["same words here"]);
    let svc = started(dir.path());
    let expect = ["a.excalidraw", "aa.excalidraw", "bb.excalidraw", "cc.excalidraw", "sub/a.excalidraw"];
    for _ in 0..5 {
        assert_eq!(paths(&svc, "words"), expect);
    }
    // limit cut must keep the same prefix of the order
    let top2: Vec<String> = svc.search("h", "words", Some(2), None).unwrap().results.into_iter().map(|h| h.path).collect();
    assert_eq!(top2, expect[..2]);
}

#[test]
fn matches_within_a_drawing_prefer_more_terms_then_word_start() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["xxgraph", "graph", "graph shortest"]);
    let svc = started(dir.path());
    let r = run(&svc, "graph shortest", None);
    // item e2 matches both terms -> first
    assert_eq!(r.results[0].matches[0].element_id, "e2");
    let r = run(&svc, "graph", None);
    let ids: Vec<&str> = r.results[0].matches[0..].iter().map(|m| m.element_id.as_str()).collect();
    assert_eq!(ids[2], "e0", "mid-word hit must come last: {ids:?}");
}

#[test]
fn at_most_five_matches_but_full_match_count() {
    let dir = tempfile::tempdir().unwrap();
    let texts: Vec<String> = (0..12).map(|i| format!("node {i}")).collect();
    let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    write_texts(dir.path(), "a.excalidraw", &refs);
    let svc = started(dir.path());
    let h = &run(&svc, "node", None).results[0];
    assert_eq!(h.matches.len(), 5);
    assert_eq!(h.match_count, 12);
}

// ---------------------------------------------------------------- multi-term / scope / limit

#[test]
fn multi_term_is_and_across_different_elements() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "both.excalidraw", &["dijkstra", "unrelated", "graph"]);
    write_texts(dir.path(), "one.excalidraw", &["dijkstra only"]);
    write_texts(dir.path(), "other.excalidraw", &["graph only"]);
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "dijkstra graph"), ["both.excalidraw"]);
    assert_eq!(paths(&svc, "graph   dijkstra"), ["both.excalidraw"]);
    assert_eq!(paths(&svc, "dijkstra graph nonexistent"), Vec::<String>::new());
    // repeated terms don't change anything
    assert_eq!(paths(&svc, "graph graph").len(), 2);
    // one term in the file name, one in the content
    write_texts(dir.path(), "kruskal.excalidraw", &["mst"]);
    svc.notify("h", &["kruskal.excalidraw".into()], false);
    wait_until("kruskal", || paths(&svc, "kruskal mst") == ["kruskal.excalidraw"]);
}

#[test]
fn blank_and_whitespace_queries_return_nothing() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["x"]);
    let svc = started(dir.path());
    for q in ["", " ", "\n\t  "] {
        let r = run(&svc, q, None);
        assert!(r.results.is_empty() && r.total_matches == 0, "{q:?}");
    }
}

#[test]
fn scope_names_and_content() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "alpha.excalidraw", &["beta"]);
    write_texts(dir.path(), "gamma.excalidraw", &["alpha"]);
    let svc = started(dir.path());
    let sp = |q: &str, scope: &str| -> Vec<String> { run(&svc, q, Some(scope)).results.into_iter().map(|h| h.path).collect() };
    assert_eq!(sp("alpha", "names"), ["alpha.excalidraw"]);
    assert_eq!(sp("alpha", "content"), ["gamma.excalidraw"]);
    assert_eq!(sp("alpha", "all"), ["alpha.excalidraw", "gamma.excalidraw"]);
    assert_eq!(paths(&svc, "alpha"), sp("alpha", "all"));
    // names scope: no element matches; content scope: no name highlights
    let n = &run(&svc, "alpha", Some("names")).results[0];
    assert!(n.matches.is_empty());
    assert_eq!(n.name_highlights, vec![[0, 5]]);
    let c = &run(&svc, "alpha", Some("content")).results[0];
    assert!(c.name_highlights.is_empty());
    assert_eq!(c.matches.len(), 1);
    // content-only term in names scope finds nothing; and vice versa
    assert!(sp("beta", "names").is_empty());
    assert!(sp("gamma", "content").is_empty());
}

#[test]
fn limit_and_total_matches() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..215 {
        write_texts(dir.path(), &format!("d{i:03}.excalidraw"), &["common"]);
    }
    let svc = started(dir.path());
    let r = svc.search("h", "common", None, None).unwrap();
    assert_eq!((r.results.len(), r.total_matches), (50, 215));
    let r = svc.search("h", "common", Some(7), None).unwrap();
    assert_eq!((r.results.len(), r.total_matches), (7, 215));
    let r = svc.search("h", "common", Some(100_000), None).unwrap();
    assert_eq!((r.results.len(), r.total_matches), (200, 215));
    let r = svc.search("h", "common", Some(0), None).unwrap();
    assert_eq!((r.results.len(), r.total_matches), (1, 215));
}

// ---------------------------------------------------------------- snippets / element kinds

#[test]
fn long_text_snippet_is_truncated_with_ellipses_and_keeps_highlight_valid() {
    let dir = tempfile::tempdir().unwrap();
    let long = format!("{} needle {}", "lorem ipsum ".repeat(20), "dolor sit ".repeat(20));
    write_texts(dir.path(), "a.excalidraw", &[&long]);
    let svc = started(dir.path());
    let m = &run(&svc, "needle", None).results[0].matches[0];
    assert!(m.snippet.starts_with('…') && m.snippet.ends_with('…'), "{}", m.snippet);
    assert!(m.snippet.chars().count() <= 122, "{}", m.snippet.chars().count());
    assert_eq!(slice16(&m.snippet, m.highlights[0]), "needle");
    // match near the start: only a trailing ellipsis
    let long = format!("needle {}", "x ".repeat(200));
    write_texts(dir.path(), "b.excalidraw", &[&long]);
    svc.notify("h", &["b.excalidraw".into()], false);
    wait_until("b", || paths(&svc, "needle").contains(&"b.excalidraw".into()));
    let r = run(&svc, "needle", None);
    let m = &r.results.iter().find(|h| h.path == "b.excalidraw").unwrap().matches[0];
    assert!(!m.snippet.starts_with('…') && m.snippet.ends_with('…'));
    assert_eq!(m.highlights[0], [0, 6]);
}

#[test]
fn short_text_has_no_ellipsis_and_snippets_are_single_line() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["first line\nsecond   line\n\nthird"]);
    let svc = started(dir.path());
    let m = &run(&svc, "second", None).results[0].matches[0];
    assert!(!m.snippet.contains('\n'));
    assert_eq!(m.snippet, "first line second line third");
    assert_eq!(slice16(&m.snippet, m.highlights[0]), "second");
}

#[test]
fn highlight_multiple_terms_and_case_preserved() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["Dijkstra Shortest PATH"]);
    let svc = started(dir.path());
    assert_eq!(fragments(&svc, "path dijk"), ["Dijk", "PATH"]);
    // overlapping terms merge into one range
    assert_eq!(fragments(&svc, "dijk dijkstra"), ["Dijkstra"]);
}

#[test]
fn bound_label_reports_container_id_and_uses_original_text() {
    let dir = tempfile::tempdir().unwrap();
    write_scene(
        dir.path(),
        "a.excalidraw",
        vec![
            json!({"id": "rect1", "type": "rectangle", "boundElements": [{"id": "lbl", "type": "text"}]}),
            json!({"id": "lbl", "type": "text", "containerId": "rect1", "text": "Dijkstra\nshortest\npath", "originalText": "Dijkstra shortest path"}),
            text_el("free", "free floating note"),
        ],
    );
    let svc = started(dir.path());
    let r = run(&svc, "shortest path", None);
    let m = &r.results[0].matches[0];
    assert_eq!((m.element_id.as_str(), m.container_id.as_deref()), ("lbl", Some("rect1")));
    assert_eq!(m.snippet, "Dijkstra shortest path");
    let f = &run(&svc, "floating", None).results[0].matches[0];
    assert_eq!(f.container_id, None);
    // text falls back to `text` when `originalText` is absent
    write_scene(dir.path(), "b.excalidraw", vec![json!({"id": "t", "type": "text", "text": "fallback text"})]);
    svc.notify("h", &["b.excalidraw".into()], false);
    wait_until("b", || paths(&svc, "fallback") == ["b.excalidraw"]);
}

#[test]
fn frame_names_are_matched_and_typed_as_frame() {
    let dir = tempfile::tempdir().unwrap();
    write_scene(
        dir.path(),
        "a.excalidraw",
        vec![
            json!({"id": "f1", "type": "frame", "name": "Graph algorithms", "isDeleted": false}),
            json!({"id": "f2", "type": "magicframe", "name": "Magic zone"}),
            json!({"id": "f3", "type": "frame", "name": null}),
            json!({"id": "r", "type": "rectangle", "name": "not a frame"}),
        ],
    );
    let svc = started(dir.path());
    let m = &run(&svc, "graph alg", None).results[0].matches[0];
    assert_eq!((m.element_id.as_str(), m.kind), ("f1", ItemKind::Frame));
    // each term is its own range: "graph" and "alg" are separated by a space
    let frags: Vec<String> = m.highlights.iter().map(|h| slice16(&m.snippet, *h)).collect();
    assert_eq!(frags, ["Graph", "alg"]);
    assert_eq!(serde_json::to_value(m).unwrap()["kind"], "frame");
    assert_eq!(run(&svc, "magic", None).results[0].matches[0].kind, ItemKind::Frame);
    assert!(paths(&svc, "not a frame").is_empty());
}

#[test]
fn deleted_elements_are_excluded() {
    let dir = tempfile::tempdir().unwrap();
    write_scene(
        dir.path(),
        "a.excalidraw",
        vec![
            json!({"id": "t1", "type": "text", "text": "ghost text", "originalText": "ghost text", "isDeleted": true}),
            json!({"id": "f1", "type": "frame", "name": "ghost frame", "isDeleted": true}),
            text_el("t2", "alive"),
        ],
    );
    let svc = started(dir.path());
    assert!(paths(&svc, "ghost").is_empty());
    assert_eq!(paths(&svc, "alive"), ["a.excalidraw"]);
}

#[test]
fn extract_items_is_pure_and_skips_files_blob() {
    let body = json!({
        "type": "excalidraw", "elements": [text_el("a", "hello"), {"id": "x", "type": "text", "text": "   "}],
        "files": {"f": {"dataURL": "data:image/png;base64,hello hello hello"}}
    })
    .to_string();
    let items = extract_items(body.as_bytes()).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(&*items[0].text, "hello");
    assert!(extract_items(b"nope").is_err());
    assert!(extract_items(br#"{"type":"other","elements":[]}"#).is_err());
    assert_eq!(normalize("Café ＡＢＣ"), "cafe abc");
}

// ---------------------------------------------------------------- junk files

#[test]
fn malformed_and_non_excalidraw_json_are_name_only() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write_raw(root, "broken-json.excalidraw", "{ this is not json");
    write_raw(root, "other-json.excalidraw", r#"{"type":"something-else","elements":[{"id":"a","type":"text","text":"secret words"}]}"#);
    write_raw(root, "empty.excalidraw", "");
    write_raw(root, "array.excalidraw", "[1,2,3]");
    fs::write(root.join("binary.excalidraw"), [0xFFu8, 0xFE, 0x00, 0x80]).unwrap();
    write_raw(root, "weird.excalidraw", r#"{"type":"excalidraw","elements":[null, 5, {"type":"text"}, {"id":3,"type":"text","text":"x"}]}"#);
    write_texts(root, "good.excalidraw", &["good words"]);
    let svc = started(root);
    assert!(paths(&svc, "secret").is_empty());
    assert_eq!(paths(&svc, "good words"), ["good.excalidraw"]);
    for n in ["broken-json", "other-json", "empty", "array", "binary", "weird"] {
        assert_eq!(paths(&svc, n), [format!("{n}.excalidraw")], "{n}");
    }
    let st = svc.status("h").unwrap();
    assert_eq!(st.state, IndexState::Ready);
    assert_eq!((st.total, st.indexed), (7, 7));
}

#[test]
fn oversized_file_is_skipped_by_content_but_found_by_name() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut body = scene(vec![text_el("t", "hugecontent")]);
    body.truncate(body.len() - 1);
    body.push_str(&format!(r#","pad":"{}"}}"#, "x".repeat(33 * 1024 * 1024)));
    write_raw(root, "huge.excalidraw", &body);
    write_texts(root, "small.excalidraw", &["hugecontent"]);
    let svc = started(root);
    assert_eq!(paths(&svc, "hugecontent"), ["small.excalidraw"]);
    let by_name: Vec<String> = run(&svc, "huge", Some("names")).results.into_iter().map(|h| h.path).collect();
    assert_eq!(by_name, ["huge.excalidraw"]);
    // content search never sees the oversized file's text
    assert_eq!(run(&svc, "huge", Some("content")).results.len(), 1);
}

#[test]
fn huge_files_blob_is_not_indexed_and_content_still_is() {
    let dir = tempfile::tempdir().unwrap();
    let blob = "QUJDREVG".repeat(300_000); // ~2.4 MB
    let body = json!({"type": "excalidraw", "elements": [text_el("t", "caption")], "files": {"i": {"dataURL": format!("data:image/png;base64,{blob}")}}});
    write_raw(dir.path(), "img.excalidraw", &body.to_string());
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "caption"), ["img.excalidraw"]);
    assert!(paths(&svc, "qubdrevg").is_empty());
    assert!(paths(&svc, "data:image").is_empty());
    let heap = svc.with_index("h", |i| i.approx_heap_bytes()).unwrap();
    assert!(heap < 100_000, "heap {heap}");
}

// ---------------------------------------------------------------- incremental updates

#[test]
fn incremental_create_modify_delete_rename() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write_texts(root, "a.excalidraw", &["alpha"]);
    let svc = started(root);

    // create
    write_texts(root, "new/b.excalidraw", &["bravo"]);
    svc.notify("h", &["new".into(), "new/b.excalidraw".into()], false);
    wait_until("create", || paths(&svc, "bravo") == ["new/b.excalidraw"]);

    // modify (same size, within the racy window: still re-read)
    write_texts(root, "a.excalidraw", &["omega"]);
    svc.notify("h", &["a.excalidraw".into()], false);
    wait_until("modify", || paths(&svc, "omega") == ["a.excalidraw"]);
    assert!(paths(&svc, "alpha").is_empty());

    // rename file
    fs::rename(root.join("a.excalidraw"), root.join("renamed.excalidraw")).unwrap();
    svc.notify("h", &["a.excalidraw".into(), "renamed.excalidraw".into()], false);
    wait_until("rename", || paths(&svc, "omega") == ["renamed.excalidraw"]);
    assert!(paths(&svc, "renamed").contains(&"renamed.excalidraw".to_string()));
    assert!(!paths(&svc, "a.excalidraw").contains(&"a.excalidraw".to_string()));

    // rename / move folder
    fs::rename(root.join("new"), root.join("moved")).unwrap();
    svc.notify("h", &["new".into(), "moved".into()], false);
    wait_until("folder rename", || paths(&svc, "bravo") == ["moved/b.excalidraw"]);

    // nested folder move into another
    write_texts(root, "p/q/deep.excalidraw", &["deepword"]);
    svc.notify("h", &["p".into()], false);
    wait_until("deep", || paths(&svc, "deepword") == ["p/q/deep.excalidraw"]);
    fs::rename(root.join("p/q"), root.join("moved/q")).unwrap();
    svc.notify("h", &["p/q".into(), "moved/q".into()], false);
    wait_until("deep moved", || paths(&svc, "deepword") == ["moved/q/deep.excalidraw"]);

    // delete file
    fs::remove_file(root.join("renamed.excalidraw")).unwrap();
    svc.notify("h", &["renamed.excalidraw".into()], false);
    wait_until("delete", || paths(&svc, "omega").is_empty());

    // delete folder
    fs::remove_dir_all(root.join("moved")).unwrap();
    svc.notify("h", &["moved".into()], false);
    wait_until("folder delete", || paths(&svc, "bravo").is_empty() && paths(&svc, "deepword").is_empty());
    assert_eq!(svc.status("h").unwrap().total, 0);

    // rescan picks up changes made without any notification
    write_texts(root, "late.excalidraw", &["echo"]);
    write_texts(root, "late2/x.excalidraw", &["foxtrot"]);
    svc.notify("h", &[], true);
    wait_until("rescan", || paths(&svc, "echo") == ["late.excalidraw"] && paths(&svc, "foxtrot") == ["late2/x.excalidraw"]);
}

#[test]
fn notify_ignores_unknown_handles_and_non_drawings() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["alpha"]);
    fs::write(dir.path().join("readme.txt"), "alpha").unwrap();
    let svc = started(dir.path());
    svc.notify("nope", &["a.excalidraw".into()], true);
    svc.notify("h", &["readme.txt".into(), "missing.excalidraw".into(), "../escape.excalidraw".into()], false);
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(paths(&svc, "alpha"), ["a.excalidraw"]);
    assert_eq!(svc.status("h").unwrap().total, 1);
}

#[test]
fn restarting_a_handle_replaces_the_old_index() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["alpha"]);
    let svc = started(dir.path());
    let other = tempfile::tempdir().unwrap();
    write_texts(other.path(), "z.excalidraw", &["zulu"]);
    svc.start_with("h", other.path().to_path_buf(), noop(), None);
    wait_until("swap", || paths(&svc, "zulu") == ["z.excalidraw"]);
    assert!(paths(&svc, "alpha").is_empty());
    svc.stop("h");
    assert_eq!(svc.search("h", "x", None, None).unwrap_err().code, "NOT_FOUND");
}

// ---------------------------------------------------------------- persistence

fn snap_in(dir: &Path) -> std::path::PathBuf {
    dir.join("state").join("index.bin")
}

#[test]
fn snapshot_is_reused_without_reparsing_unchanged_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = snap_in(dir.path());
    write_texts(&root, "a.excalidraw", &["alpha one"]);
    write_texts(&root, "b.excalidraw", &["bravo one"]);
    write_texts(&root, "c.excalidraw", &["charlie one"]);
    let t5 = hours_ago(5);
    for f in ["a", "b", "c"] {
        set_mtime(&root.join(format!("{f}.excalidraw")), t5);
    }
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot written", || snap.exists());
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(200));

    // Same-size content swap with the mtime restored: only a reparse could notice.
    let a = root.join("a.excalidraw");
    let orig = fs::read_to_string(&a).unwrap();
    fs::write(&a, orig.replace("alpha", "gamma")).unwrap();
    set_mtime(&a, t5);
    assert_eq!(orig.len(), fs::read_to_string(&a).unwrap().len());
    // Size change => stat differs => reparsed.
    write_texts(&root, "b.excalidraw", &["bravo one extended"]);
    set_mtime(&root.join("b.excalidraw"), t5);
    // Same size, different mtime => reparsed.
    let c = root.join("c.excalidraw");
    fs::write(&c, fs::read_to_string(&c).unwrap().replace("charlie", "delta0")).unwrap();
    set_mtime(&c, hours_ago(4));

    let svc2 = started_with(&root, Some(snap));
    assert_eq!(paths(&svc2, "alpha"), ["a.excalidraw"], "unchanged stat must reuse the snapshot (no reparse)");
    assert!(paths(&svc2, "gamma").is_empty());
    assert_eq!(paths(&svc2, "extended"), ["b.excalidraw"]);
    assert_eq!(paths(&svc2, "delta0"), ["c.excalidraw"]);
    assert!(paths(&svc2, "charlie").is_empty());
}

#[test]
fn racy_recent_files_are_reparsed_even_if_stat_matches() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = snap_in(dir.path());
    write_texts(&root, "a.excalidraw", &["alpha one"]); // fresh mtime: within racy window
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot", || snap.exists());
    svc.stop("h");
    let a = root.join("a.excalidraw");
    let m = fs::metadata(&a).unwrap().modified().unwrap();
    fs::write(&a, fs::read_to_string(&a).unwrap().replace("alpha", "gamma")).unwrap();
    set_mtime(&a, m);
    let svc2 = started_with(&root, Some(snap));
    assert_eq!(paths(&svc2, "gamma"), ["a.excalidraw"]);
}

#[test]
fn warm_start_applies_offline_adds_and_removes() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = snap_in(dir.path());
    write_texts(&root, "keep.excalidraw", &["keepword"]);
    write_texts(&root, "gone.excalidraw", &["goneword"]);
    write_texts(&root, "dir/x.excalidraw", &["dirword"]);
    for p in ["keep", "gone", "dir/x"] {
        set_mtime(&root.join(format!("{p}.excalidraw")), hours_ago(3));
    }
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot", || snap.exists());
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(200));
    fs::remove_file(root.join("gone.excalidraw")).unwrap();
    fs::remove_dir_all(root.join("dir")).unwrap();
    write_texts(&root, "added.excalidraw", &["addedword"]);
    let svc2 = started_with(&root, Some(snap));
    assert!(paths(&svc2, "goneword").is_empty());
    assert!(paths(&svc2, "dirword").is_empty());
    assert_eq!(paths(&svc2, "addedword"), ["added.excalidraw"]);
    assert_eq!(paths(&svc2, "keepword"), ["keep.excalidraw"]);
    assert_eq!(svc2.status("h").unwrap().total, 2);
}

#[test]
fn corrupt_truncated_or_mismatched_snapshots_trigger_a_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = snap_in(dir.path());
    write_texts(&root, "a.excalidraw", &["alpha"]);
    set_mtime(&root.join("a.excalidraw"), hours_ago(3));
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot", || snap.exists());
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(200));
    let good = fs::read(&snap).unwrap();

    let mut cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("garbage", b"definitely not a snapshot".to_vec()),
        ("truncated payload", good[..good.len() - 4].to_vec()),
        ("truncated header", good[..9].to_vec()),
    ];
    let mut flipped = good.clone();
    let last = flipped.len() - 1;
    flipped[last] ^= 0xFF;
    cases.push(("crc mismatch", flipped));
    for (name, off) in [("magic", 0usize), ("format version", 4), ("normaliser version", 8)] {
        let mut b = good.clone();
        b[off] = b[off].wrapping_add(7);
        cases.push((name, b));
    }
    let mut nonsense = good[..16].to_vec();
    nonsense.extend_from_slice(&[0xFF; 40]);
    cases.push(("nonsense payload", nonsense));
    for (name, bytes) in cases {
        fs::write(&snap, &bytes).unwrap();
        let svc = started_with(&root, Some(snap.clone()));
        assert_eq!(paths(&svc, "alpha"), ["a.excalidraw"], "case {name}");
        // The bad snapshot is replaced by a valid one.
        wait_until(&format!("rewrite after {name}"), || fs::read(&snap).map(|b| b != bytes && b.starts_with(b"VDSI")).unwrap_or(false));
        svc.stop("h");
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn snapshot_dir_is_created_and_an_unwritable_snapshot_path_does_not_break_search() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    write_texts(&root, "a.excalidraw", &["alpha"]);
    let snap = dir.path().join("deep/er/state/index.bin");
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot", || snap.exists());
    svc.stop("h");
    // Snapshot path occupied by a directory: saving fails silently, search still works.
    let blocked = dir.path().join("blocked");
    fs::create_dir_all(blocked.join("index.bin")).unwrap();
    let svc = started_with(&root, Some(blocked.join("index.bin")));
    assert_eq!(paths(&svc, "alpha"), ["a.excalidraw"]);
}

#[test]
fn snapshot_lives_outside_the_vault_and_nothing_is_written_in_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    write_texts(&root, "a.excalidraw", &["alpha"]);
    let mut before: Vec<_> = fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name()).collect();
    let snap = super::store::snapshot_path(&dir.path().join("state"), &root);
    let svc = started_with(&root, Some(snap.clone()));
    wait_until("snapshot", || snap.exists());
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(200));
    let mut after: Vec<_> = fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name()).collect();
    before.sort();
    after.sort();
    assert_eq!(before, after);
    let id = snap.parent().unwrap().file_name().unwrap().to_str().unwrap();
    assert_eq!(id.len(), 16);
    assert!(id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
}

// ---------------------------------------------------------------- validation & status

#[test]
fn query_validation_errors() {
    let dir = tempfile::tempdir().unwrap();
    let svc = started(dir.path());
    assert!(svc.search("h", &"x".repeat(256), None, None).is_ok());
    assert_eq!(svc.search("h", &"x".repeat(257), None, None).unwrap_err().code, "INVALID_QUERY");
    // the limit counts characters, not bytes
    assert!(svc.search("h", &"数".repeat(256), None, None).is_ok());
    assert_eq!(svc.search("h", &"数".repeat(257), None, None).unwrap_err().code, "INVALID_QUERY");
    for bad in ["bogus", "ALL", "", "names "] {
        assert_eq!(svc.search("h", "x", None, Some(bad)).unwrap_err().code, "INVALID_SCOPE", "{bad:?}");
    }
    for ok in ["all", "names", "content"] {
        assert!(svc.search("h", "x", None, Some(ok)).is_ok());
    }
    assert_eq!(svc.search("unknown", "x", None, None).unwrap_err().code, "NOT_FOUND");
    assert_eq!(svc.status("unknown").unwrap_err().code, "NOT_FOUND");
}

#[test]
fn many_terms_are_capped_not_rejected() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["a b c d e f g h i j"]);
    let svc = started(dir.path());
    assert_eq!(paths(&svc, "a b c d e f g h i j"), ["a.excalidraw"]);
}

#[test]
fn status_counts_and_response_carries_status() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a.excalidraw", &["alpha"]);
    write_texts(dir.path(), "s/b.excalidraw", &["beta"]);
    let svc = started(dir.path());
    let r = run(&svc, "alpha", None);
    assert_eq!((r.status.state, r.status.indexed, r.status.total, r.status.handle.as_str()), (IndexState::Ready, 2, 2, "h"));
    assert_eq!(r.query, "alpha");
    assert!(r.took_ms >= 0.0);
    let h = &run(&svc, "beta", None).results[0];
    assert_eq!((h.path.as_str(), h.name.as_str()), ("s/b.excalidraw", "b.excalidraw"));
}

#[test]
fn queries_during_the_build_never_error() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..300 {
        write_texts(dir.path(), &format!("f{}/d{i}.excalidraw", i % 7), &["word"]);
    }
    let svc = SearchService::default();
    svc.start_with("h", dir.path().to_path_buf(), noop(), None);
    for _ in 0..2000 {
        if svc.search("h", "d1", None, None).unwrap().status.state == IndexState::Ready {
            break;
        }
    }
    wait_until("ready", || svc.status("h").is_ok_and(|s| s.state == IndexState::Ready));
    assert_eq!(svc.search("h", "word", Some(200), None).unwrap().total_matches, 300);
}

#[test]
fn symlinks_temp_files_and_metadata_folder_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    write_texts(&root, "real.excalidraw", &["realword"]);
    write_texts(&root, ".excalidraw-vault/hidden.excalidraw", &["hiddenword"]);
    write_raw(&root, ".excalidraw-tmp-123.excalidraw", &scene(vec![text_el("t", "tmpword")]));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("real.excalidraw"), root.join("link.excalidraw")).unwrap();
        let outside = tempfile::tempdir().unwrap();
        write_texts(outside.path(), "o.excalidraw", &["outsideword"]);
        std::os::unix::fs::symlink(outside.path(), root.join("linkdir")).unwrap();
    }
    let svc = started(&root);
    assert!(paths(&svc, "outsideword").is_empty());
    assert!(paths(&svc, "link").is_empty());
    assert!(paths(&svc, "hiddenword").is_empty());
    assert!(paths(&svc, "tmpword").is_empty());
    assert_eq!(paths(&svc, "realword"), ["real.excalidraw"]);
}

#[test]
fn json_contract_shape() {
    let dir = tempfile::tempdir().unwrap();
    write_scene(
        dir.path(),
        "Shortest Paths.excalidraw",
        vec![
            json!({"id": "r", "type": "rectangle"}),
            json!({"id": "l", "type": "text", "containerId": "r", "text": "Dijkstra", "originalText": "Dijkstra"}),
            json!({"id": "f", "type": "frame", "name": "Graph algorithms"}),
        ],
    );
    let svc = started(dir.path());
    let v = serde_json::to_value(run(&svc, "dijk", None)).unwrap();
    let hit = &v["results"][0];
    assert_eq!(hit["name"], "Shortest Paths.excalidraw");
    assert_eq!(hit["matchCount"], 1);
    assert!(hit["score"].is_number());
    assert_eq!(hit["matches"][0]["containerId"], "r");
    assert_eq!(hit["matches"][0]["elementId"], "l");
    assert_eq!(hit["matches"][0]["highlights"], json!([[0, 4]]));
    let v = serde_json::to_value(run(&svc, "graph alg", None)).unwrap();
    assert_eq!(v["results"][0]["matches"][0]["kind"], "frame");
}

#[test]
fn name_highlights_index_the_original_file_name_even_with_repeated_spaces() {
    let dir = tempfile::tempdir().unwrap();
    write_texts(dir.path(), "a  b  Paths.excalidraw", &["x"]);
    let svc = started(dir.path());
    let h = &run(&svc, "paths", None).results[0];
    assert!(!h.name_highlights.is_empty());
    let frags: Vec<String> = h.name_highlights.iter().map(|r| slice16(&h.name, *r)).collect();
    assert_eq!(frags, ["Paths"], "name_highlights must be UTF-16 offsets into the original name");
}

#[test]
fn headless_load_or_build_equals_the_worker_index() {
    use vaultdraw_core::search::{load_or_build, testgen};
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("vault");
    fs::create_dir_all(&root).unwrap();
    testgen::generate(&root, 30);
    let worker_snap = store::snapshot_path(&t.path().join("worker-state"), &root);
    let svc = started_with(&root, Some(worker_snap.clone()));
    wait_until("worker snapshot", || worker_snap.is_file());
    let headless = load_or_build(&root, &store::snapshot_path(&t.path().join("cli-state"), &root)).unwrap();
    let shared = svc.vault("h").unwrap();
    let worker = shared.read();
    assert_eq!(headless.counts(), worker.counts());
    for q in ["service", "dijkstra", "database", "queue", "caf\u{e9}", "#dsa", "#interview/prep", "nosuchword"] {
        for scope in [Scope::All, Scope::Names, Scope::Content] {
            let a = serde_json::to_value(headless.query(q, scope, 100).0).unwrap();
            let b = serde_json::to_value(worker.query(q, scope, 100).0).unwrap();
            assert_eq!(a, b, "query {q} {scope:?}");
        }
    }
    assert_eq!(serde_json::to_value(headless.tag_summary()).unwrap(), serde_json::to_value(worker.tag_summary()).unwrap());
}
