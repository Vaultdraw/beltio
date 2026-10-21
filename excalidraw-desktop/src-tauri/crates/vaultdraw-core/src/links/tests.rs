//! Link grammar, resolution, incremental index and query tests.

use super::grammar::*;
use super::index::LinkIndex;
use super::query;
use super::resolve::*;
use super::testkit::*;
use super::types::*;
use crate::search::{DocEntry, ElementLink, Index};

// ---------------------------------------------------------------- grammar

#[test]
fn grammar_fixtures() {
    let fx: serde_json::Value = serde_json::from_str(include_str!("../../../../src/links/fixtures/grammar.json")).unwrap();
    for c in fx["text"].as_array().unwrap() {
        let input = c["input"].as_str().unwrap();
        let got: Vec<_> = text_links_vec(input)
            .iter()
            .map(|l| {
                serde_json::json!({
                    "start": utf16_len_of(input, l.start),
                    "end": utf16_len_of(input, l.end),
                    "target": l.target,
                    "label": l.label,
                })
            })
            .collect();
        assert_eq!(serde_json::Value::Array(got), c["links"], "text {input:?}");
    }
    for c in fx["linkField"].as_array().unwrap() {
        let input = c["input"].as_str().unwrap();
        let got = parse_link_field(input);
        match c["target"].as_str() {
            None => assert!(got.is_none(), "field {input:?} -> {got:?}"),
            Some(t) => {
                let g = got.unwrap_or_else(|| panic!("field {input:?}"));
                assert_eq!(g.target, t, "field {input:?}");
                assert_eq!(g.form == FieldForm::Rel, c["relative"].as_bool().unwrap_or(false), "field {input:?}");
            }
        }
    }
}

#[test]
fn percent_coding_round_trips_and_keeps_slashes() {
    for s in ["Graphs/BFS and DFS", "café ☕/x#1 (a)", "100%", "a+b&c=d?e"] {
        assert_eq!(pct_decode(&pct_encode(s)), s);
    }
    assert_eq!(pct_encode("Graphs/BFS and DFS"), "Graphs/BFS%20and%20DFS");
    assert_eq!(pct_decode("%zz%4"), "%zz%4");
}

#[test]
fn relative_path_helpers() {
    assert_eq!(join_rel("A/B", "../C/x"), "A/C/x");
    assert_eq!(join_rel("", "./x"), "x");
    assert_eq!(rel_path("A/B", "A/C/x"), "../C/x");
    assert_eq!(rel_path("", "x"), "./x");
    assert_eq!(rel_path("A", "A/x"), "./x");
    assert_eq!(rel_path("A", "B/x"), "../B/x");
    assert_eq!(key_of_target(" Café.excalidraw "), "cafe");
}

// ---------------------------------------------------------------- resolution

#[test]
fn resolution_order_case_accents_and_ambiguity() {
    let ix = index_of(vec![plain("Café.excalidraw"), plain("A/Plan.excalidraw"), plain("B/Deep/Plan.excalidraw"), plain("B/Notes.excalidraw"), plain("Plan.excalidraw")]);
    // exact path beats the basename candidates
    assert_eq!(resolved(&ix, "x.excalidraw", "Plan").as_deref(), Some("Plan.excalidraw"));
    // case and accents ignored
    assert_eq!(resolved(&ix, "x.excalidraw", "CAFE").as_deref(), Some("Café.excalidraw"));
    assert_eq!(resolved(&ix, "x.excalidraw", "[[cafe.excalidraw|shown]]").as_deref(), Some("Café.excalidraw"));
    // unique basename
    assert_eq!(resolved(&ix, "x.excalidraw", "Notes").as_deref(), Some("B/Notes.excalidraw"));
    // path suffix picks among duplicates
    assert_eq!(resolved(&ix, "x.excalidraw", "Deep/Plan").as_deref(), Some("B/Deep/Plan.excalidraw"));
    assert_eq!(resolved(&ix, "x.excalidraw", "b/deep/plan").as_deref(), Some("B/Deep/Plan.excalidraw"));
    // vaultdraw url
    assert_eq!(resolved(&ix, "x.excalidraw", "vaultdraw://open?file=A/Plan").as_deref(), Some("A/Plan.excalidraw"));
    assert_eq!(resolved(&ix, "x.excalidraw", "Missing"), None);
    assert_eq!(resolved(&ix, "x.excalidraw", "/Plan"), Some("Plan.excalidraw".into()));
}

#[test]
fn ambiguous_basename_picks_the_shortest_path_and_lists_candidates() {
    let ix = index_of(vec![plain("A/Plan.excalidraw"), plain("B/Deep/Plan.excalidraw")]);
    let r = query::resolve_raw(&ix, "x.excalidraw", "Plan");
    assert_eq!(r.path.as_deref(), Some("A/Plan.excalidraw"));
    assert_eq!(r.candidates, vec!["A/Plan.excalidraw", "B/Deep/Plan.excalidraw"]);
    let one = query::resolve_raw(&ix, "x.excalidraw", "Deep/Plan");
    assert!(one.candidates.is_empty());
}

#[test]
fn relative_links_resolve_from_the_source_folder() {
    let ix = index_of(vec![plain("A/x.excalidraw"), plain("B/x.excalidraw"), plain("A/sub/y.excalidraw")]);
    assert_eq!(resolved(&ix, "A/src.excalidraw", "./x.excalidraw").as_deref(), Some("A/x.excalidraw"));
    assert_eq!(resolved(&ix, "B/src.excalidraw", "x.excalidraw").as_deref(), Some("B/x.excalidraw"));
    assert_eq!(resolved(&ix, "A/sub/src.excalidraw", "../x.excalidraw").as_deref(), Some("A/x.excalidraw"));
    assert_eq!(resolved(&ix, "A/src.excalidraw", "sub/y.excalidraw").as_deref(), Some("A/sub/y.excalidraw"));
}

#[test]
fn incremental_create_resolves_pending_and_delete_unresolves() {
    let mut ix = index_of(vec![("src.excalidraw", doc("src.excalidraw", &[("t", "see [[Later]] and [[Gone]]")], &[])), plain("Gone.excalidraw")]);
    let r = query::links_response(&ix, "src.excalidraw");
    assert_eq!(r.outgoing.len(), 1);
    assert_eq!(r.unresolved.len(), 1);
    assert_eq!(r.unresolved[0].target, "Later");
    ix.upsert("deep/Later.excalidraw".into(), DocEntry::name_only("deep/Later.excalidraw"));
    let r = query::links_response(&ix, "src.excalidraw");
    assert_eq!((r.outgoing.len(), r.unresolved.len()), (2, 0));
    assert_eq!(r.outgoing[0].resolved.as_deref(), Some("deep/Later.excalidraw"));
    assert_eq!(query::links_response(&ix, "deep/Later.excalidraw").backlinks.len(), 1);
    ix.remove("Gone.excalidraw");
    ix.remove("deep/Later.excalidraw");
    let r = query::links_response(&ix, "src.excalidraw");
    assert_eq!((r.outgoing.len(), r.unresolved.len()), (0, 2));
    // editing the source updates backlinks of the old and the new target
    ix.upsert("Gone.excalidraw".into(), DocEntry::name_only("Gone.excalidraw"));
    assert_eq!(query::links_response(&ix, "Gone.excalidraw").backlinks.len(), 1);
    ix.upsert("src.excalidraw".into(), doc("src.excalidraw", &[("t", "nothing")], &[]));
    assert_eq!(query::links_response(&ix, "Gone.excalidraw").backlinks.len(), 0);
    assert_eq!(ix.links().unwrap().n_keys(), 0, "orphan keys are freed");
}

#[test]
fn link_index_upsert_equals_a_fresh_build() {
    let docs = vec![
        ("a.excalidraw", doc("a.excalidraw", &[("1", "[[b]] [[C/c]]")], &[("s", "vaultdraw://open?file=b")])),
        ("b.excalidraw", doc("b.excalidraw", &[("1", "[[a|alias]]")], &[])),
        ("C/c.excalidraw", doc("C/c.excalidraw", &[("1", "[[a]] [[b]] [[zzz]]")], &[("s", "../a.excalidraw")])),
    ];
    let mut inc = Index::default();
    inc.install_links(LinkIndex::default());
    for (p, d) in &docs {
        inc.upsert(p.to_string(), doc(p, &d.items.iter().map(|i| (&*i.element_id, &*i.text)).collect::<Vec<_>>(), &d.elinks.iter().map(|l| (&*l.element_id, &*l.link)).collect::<Vec<_>>()));
    }
    let fresh = index_of(docs);
    for p in ["a.excalidraw", "b.excalidraw", "C/c.excalidraw"] {
        let (a, b) = (query::links_response(&inc, p), query::links_response(&fresh, p));
        assert_eq!(serde_json::to_string(&a.backlinks).unwrap(), serde_json::to_string(&b.backlinks).unwrap(), "{p}");
        assert_eq!(a.outgoing.len(), b.outgoing.len());
        assert_eq!(a.unresolved.len(), b.unresolved.len());
    }
}

#[test]
fn link_index_keeps_docs_in_path_order_through_updates_and_renames() {
    let paths = |li: &LinkIndex| li.sorted_docs().iter().map(|&i| li.path(i).to_string()).collect::<Vec<_>>();
    let sorted = |mut v: Vec<String>| {
        v.sort();
        v
    };
    let mut li = LinkIndex::default();
    let ids: Vec<u32> = ["m", "b", "z", "A/q", "c"].iter().map(|p| li.add_doc(&format!("{p}.excalidraw"))).collect();
    assert_eq!(paths(&li), sorted(paths(&li)));
    li.remove_doc(ids[1]);
    li.add_doc("d.excalidraw");
    assert_eq!(paths(&li), ["A/q.excalidraw", "c.excalidraw", "d.excalidraw", "m.excalidraw", "z.excalidraw"]);
    li.change_paths(&[(ids[0], "a.excalidraw".to_string()), (ids[2], "B/y.excalidraw".to_string())]);
    assert_eq!(paths(&li), ["A/q.excalidraw", "B/y.excalidraw", "a.excalidraw", "c.excalidraw", "d.excalidraw"]);
    // A bulk move (more than the patch limit) re-sorts.
    let many: Vec<(u32, String)> = (0..40).map(|i| (li.add_doc(&format!("n{i}.excalidraw")), format!("zz/{:02}.excalidraw", 40 - i))).collect();
    li.change_paths(&many);
    let all = paths(&li);
    assert_eq!(all.len(), 45);
    assert_eq!(all, sorted(all.clone()));
    let fresh = index_of(all.iter().map(|p| (p.as_str(), doc(p, &[], &[]))).collect()).build_links();
    assert_eq!(paths(&fresh), all);
}

#[test]
fn bulk_removal_prunes_path_order_once_and_matches_single_removals() {
    let paths = |li: &LinkIndex| li.sorted_docs().iter().map(|&i| li.path(i).to_string()).collect::<Vec<_>>();
    let make = || {
        let mut li = LinkIndex::default();
        for i in 0..100 {
            li.add_doc(&format!("{}/{i:03}.excalidraw", if i % 2 == 0 { "trash" } else { "keep" }));
        }
        li
    };
    let gone: Vec<String> = (0..100).step_by(2).map(|i| format!("trash/{i:03}.excalidraw")).collect();
    let mut bulk = make();
    bulk.remove_many(gone.iter().map(String::as_str));
    let mut single = make();
    gone.iter().for_each(|p| single.remove(p));
    assert_eq!(paths(&bulk).len(), 50);
    assert_eq!(paths(&bulk), paths(&single));
    assert!(paths(&bulk).iter().all(|p| p.starts_with("keep/")));
    // Freed slots are reused in order.
    bulk.add_doc("a.excalidraw");
    assert_eq!(paths(&bulk)[0], "a.excalidraw");
}

// ---------------------------------------------------------------- queries

#[test]
fn backlinks_have_one_line_snippets_with_utf16_highlights() {
    let text = "first line\nsee 😀 [[Target|x]] and [[target]]\nlast";
    let ix = index_of(vec![plain("Target.excalidraw"), ("S/src.excalidraw", doc("S/src.excalidraw", &[("t1", text), ("t2", "no link")], &[("shape", "[[Target]]")]))]);
    let r = query::links_response(&ix, "Target.excalidraw");
    assert_eq!(r.backlinks.len(), 2);
    let b = &r.backlinks[0];
    assert_eq!((b.path.as_str(), b.element_id.as_str(), b.kind), ("S/src.excalidraw", "t1", LinkKind::Text));
    assert_eq!(b.snippet, "see 😀 [[Target|x]] and [[target]]");
    // "see " = 4, emoji = 2 units, space = 1 -> link starts at 7
    assert_eq!(b.highlights, vec![[7, 19], [24, 34]]);
    assert_eq!(r.backlinks[1].kind, LinkKind::Shape);
}

#[test]
fn long_lines_are_centred_and_capped_at_120_chars() {
    let text = format!("{} [[Target]] {}", "w".repeat(300), "z".repeat(300));
    let (s, h) = query::link_snippet(&text, |_| true).unwrap();
    assert!(s.chars().count() <= 120, "{}", s.chars().count());
    assert!(s.starts_with('…') && s.ends_with('…'));
    let chars: Vec<char> = s.chars().collect();
    let (a, b) = (h[0][0] as usize, h[0][1] as usize);
    assert_eq!(chars[a..b].iter().collect::<String>(), "[[Target]]");
    assert!((a as i32 - (chars.len() - b) as i32).abs() <= 3, "centred");
}

#[test]
fn self_links_are_not_backlinks_and_shape_labels_become_snippets() {
    let items = vec![item("t", None, "self [[T]] and [[s]]"), item("lbl", Some("box"), "Box label\nsecond line")];
    let elinks = vec![ElementLink { element_id: "box".into(), link: "[[T]]".into() }];
    let labelled = DocEntry::new("s.excalidraw", (1, 1), items).with_links(elinks, [0; 8]);
    let ix = index_of(vec![plain("T.excalidraw"), ("s.excalidraw", labelled)]);
    let r = query::links_response(&ix, "s.excalidraw");
    assert!(r.backlinks.is_empty());
    let t = query::links_response(&ix, "T.excalidraw");
    let shape = t.backlinks.iter().find(|b| b.kind == LinkKind::Shape).unwrap();
    assert_eq!(shape.snippet, "Box label");
    assert!(shape.highlights.is_empty());
}

#[test]
fn unlinked_mentions_exclude_linking_items_and_respect_words() {
    let ix = index_of(vec![
        ("Plan.excalidraw", doc("Plan.excalidraw", &[("t", "the plan is here")], &[])),
        ("a.excalidraw", doc("a.excalidraw", &[("1", "Our plan for Q3"), ("2", "see [[Plan]] plan")], &[])),
        ("b.excalidraw", doc("b.excalidraw", &[("1", "planning ahead, airplane"), ("2", "PLAN, again")], &[])),
    ]);
    let m = query::mentions_response(&ix, "Plan.excalidraw", 50);
    let got: Vec<_> = m.mentions.iter().map(|x| (x.path.as_str(), x.element_id.as_str())).collect();
    assert_eq!(got, vec![("a.excalidraw", "1"), ("b.excalidraw", "2")]);
    assert_eq!(m.mentions[0].snippet, "Our plan for Q3");
    assert_eq!(m.mentions[0].highlights, vec![[4, 8]]);
    assert_eq!(query::mentions_response(&ix, "Plan.excalidraw", 1).mentions.len(), 1);
}
