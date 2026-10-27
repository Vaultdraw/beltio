//! The link rule by source kind (VERDICT-r2 item 13): a written extension wins; otherwise a link
//! resolves by the kind of file it is written in. In a note `[[X]]` means `X.md`, as in Obsidian;
//! in a drawing it keeps today's meaning.

use super::query;
use super::testkit::*;
use crate::search::notes::note_entry_from_bytes;
use crate::search::{DocEntry, Index};

fn note(path: &str, src: &str) -> (String, DocEntry) {
    (path.to_string(), note_entry_from_bytes(path, (1, 1), src.as_bytes()))
}

fn vault(notes: &[(&str, &str)], drawings: &[(&str, &[(&str, &str)])]) -> Index {
    let mut ix = Index::default();
    for (p, s) in notes {
        let (p, d) = note(p, s);
        ix.upsert(p, d);
    }
    for (p, texts) in drawings {
        ix.upsert(p.to_string(), doc(p, texts, &[]));
    }
    let li = ix.build_links();
    ix.install_links(li);
    ix
}

#[test]
fn a_note_link_means_a_note_even_when_a_drawing_has_the_name() {
    let ix = vault(&[("Notes/Plan.md", "# Plan\n"), ("Daily.md", "see [[Plan]] and [[Plan.excalidraw]]\n")], &[("Plan.excalidraw", &[("t", "x")])]);
    assert_eq!(resolved(&ix, "Daily.md", "[[Plan]]").as_deref(), Some("Notes/Plan.md"));
    assert_eq!(resolved(&ix, "Daily.md", "[[Plan.excalidraw]]").as_deref(), Some("Plan.excalidraw"));
    assert_eq!(resolved(&ix, "Daily.md", "[[Plan.md]]").as_deref(), Some("Notes/Plan.md"));
    let r = query::links_response(&ix, "Daily.md");
    let got: Vec<_> = r.outgoing.iter().map(|l| l.resolved.clone().unwrap()).collect();
    assert_eq!(got, vec!["Notes/Plan.md", "Plan.excalidraw"]);
}

#[test]
fn a_drawing_link_keeps_its_meaning() {
    let ix = vault(&[("Plan.md", "# Plan\n")], &[("Plan.excalidraw", &[("t", "x")]), ("Map.excalidraw", &[("t", "go [[Plan]]")])]);
    // `[[Plan]]` in a drawing is the drawing, never the note of the same name.
    assert_eq!(resolved(&ix, "Map.excalidraw", "[[Plan]]").as_deref(), Some("Plan.excalidraw"));
    let r = query::links_response(&ix, "Map.excalidraw");
    assert_eq!(r.outgoing[0].resolved.as_deref(), Some("Plan.excalidraw"));
    // A drawing without a drawing of that name does not fall through to a note.
    let ix = vault(&[("OnlyNote.md", "x")], &[("Map.excalidraw", &[("t", "[[OnlyNote]]")])]);
    assert_eq!(resolved(&ix, "Map.excalidraw", "[[OnlyNote]]"), None);
    // The written extension reaches the note.
    assert_eq!(resolved(&ix, "Map.excalidraw", "[[OnlyNote.md]]").as_deref(), Some("OnlyNote.md"));
}

#[test]
fn heading_alias_and_block_parts_are_not_part_of_the_name() {
    let ix = vault(&[("Target.md", "# H\n"), ("A.md", "[[Target#H|shown]] [[Target#^abc]] [[Target|alias]]\n")], &[]);
    let r = query::links_response(&ix, "A.md");
    assert_eq!(r.outgoing.len(), 3);
    assert!(r.outgoing.iter().all(|l| l.resolved.as_deref() == Some("Target.md") && l.target == "Target"));
    assert_eq!(resolved(&ix, "A.md", "[[Target#H|shown]]").as_deref(), Some("Target.md"));
}

#[test]
fn shortest_path_wins_and_folders_disambiguate() {
    let ix = vault(&[("a/b/Same.md", ""), ("Same.md", ""), ("x/Same.md", ""), ("Index.md", "[[Same]] [[x/Same]] [[b/Same]]")], &[]);
    assert_eq!(resolved(&ix, "Index.md", "[[Same]]").as_deref(), Some("Same.md"));
    assert_eq!(resolved(&ix, "Index.md", "[[x/Same]]").as_deref(), Some("x/Same.md"));
    assert_eq!(resolved(&ix, "Index.md", "[[b/Same]]").as_deref(), Some("a/b/Same.md"));
    // Without the exact path, several matches are reported.
    let res = query::resolve_raw(&ix, "Index.md", "[[Same]]");
    assert_eq!(res.path.as_deref(), Some("Same.md"));
    let ix2 = vault(&[("a/Same.md", ""), ("b/Same.md", ""), ("i.md", "")], &[]);
    assert_eq!(query::resolve_raw(&ix2, "i.md", "[[Same]]").candidates, vec!["a/Same.md", "b/Same.md"]);
}

#[test]
fn case_and_accents_do_not_matter() {
    let ix = vault(&[("Café Notes.md", ""), ("i.md", "[[cafe notes]]")], &[]);
    assert_eq!(resolved(&ix, "i.md", "[[CAFE NOTES]]").as_deref(), Some("Café Notes.md"));
}

#[test]
fn attachments_and_code_are_not_note_links() {
    let ix = vault(&[("N.md", "![[image.png]] [[doc.pdf]]\n```\n[[Code]]\n```\n`[[Inline]]`\n"), ("Code.md", ""), ("Inline.md", "")], &[]);
    let r = query::links_response(&ix, "N.md");
    assert!(r.outgoing.is_empty() && r.unresolved.is_empty(), "{r:?}");
}

#[test]
fn backlinks_include_notes_and_unresolved_links_are_listed() {
    let ix = vault(&[("Target.md", ""), ("From.md", "line one\nsee [[Target]] here and [[Missing Note]]\n")], &[("D.excalidraw", &[("t", "x")])]);
    let t = query::links_response(&ix, "Target.md");
    assert_eq!(t.backlinks.len(), 1);
    assert_eq!(t.backlinks[0].path, "From.md");
    assert!(t.backlinks[0].snippet.contains("[[Target]]"), "{:?}", t.backlinks[0].snippet);
    let f = query::links_response(&ix, "From.md");
    assert_eq!(f.unresolved.len(), 1);
    assert_eq!(f.unresolved[0].target, "Missing Note");
}

#[test]
fn relative_markdown_links_resolve_from_the_notes_folder() {
    let ix = vault(&[("a/One.md", "[two](../b/Two.md) [three](Three%20X.md)"), ("b/Two.md", ""), ("a/Three X.md", "")], &[]);
    let r = query::links_response(&ix, "a/One.md");
    let mut got: Vec<_> = r.outgoing.iter().map(|l| l.resolved.clone().unwrap()).collect();
    got.sort();
    assert_eq!(got, vec!["a/Three X.md", "b/Two.md"]);
}
