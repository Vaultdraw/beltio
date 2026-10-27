//! Rewrites the links of a note when a drawing or note they point at moves (or the note itself
//! moves and a link was relative). Works on the note's current text, by link key, so a stale
//! plan or a replayed journal changes nothing twice. The file is written through
//! `write_note_file` (revision check, history copy, atomic rename).

use super::plan::FilePlan;
use super::rewrite::Replace;
use vaultdraw_core::links::grammar::{pct_encode, strip_ext};
use vaultdraw_core::links::resolve::{key_of_note_target, rel_path};
use vaultdraw_core::markdown::{parse_markdown, DocLinkKind, ParseOptions};
use vaultdraw_core::search::notes::is_attachment_ext;

/// A new written target that keeps how the old one was spelled: `.md` and `.excalidraw`
/// suffixes are written only if the old text had them.
fn fit(old: &str, new_path: &str) -> String {
    let lo = old.to_ascii_lowercase();
    let new_note = new_path.to_ascii_lowercase().ends_with(".md");
    if new_note {
        return if lo.ends_with(".md") { new_path.to_string() } else { new_path[..new_path.len() - 3].to_string() };
    }
    let stem = strip_ext(new_path);
    if lo.ends_with(".excalidraw") {
        format!("{stem}.excalidraw")
    } else {
        stem.to_string()
    }
}

/// The text of the link target `old` (as written in a note in `old_dir`) after the change `r`;
/// `new_dir` is where the note will be.
fn new_text(old: &str, r: &Replace, new_dir: &str) -> String {
    if old.starts_with("./") || old.starts_with("../") {
        let rel = rel_path(new_dir, &r.new_path);
        let mut s = fit(old, &rel);
        if !s.starts_with("./") && !s.starts_with("../") {
            s = format!("./{s}");
        }
        return s;
    }
    if r.new_target.is_empty() {
        return fit(old, &r.new_path);
    }
    // `new_target` is the shortest unique text from the plan; `Folder/Note` keeps its folders.
    fit(old, &r.new_target)
}

pub(crate) struct Rewritten {
    pub text: String,
    pub links: u32,
}

/// Applies the plan of one note to its current text; `None` when no link needed changing.
pub(crate) fn rewrite_note(text: &str, plan: &FilePlan) -> Option<Rewritten> {
    let reps: Vec<&Replace> = plan.elements.values().flatten().collect();
    if reps.is_empty() {
        return None;
    }
    let (old_dir, new_dir) = (super::resolve::dir_of(&plan.from_path), super::resolve::dir_of(&plan.to_path));
    let doc = parse_markdown(text, &ParseOptions::default());
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for l in &doc.links {
        let region = &text[l.range[0]..l.range[1]];
        let (span, written): ((usize, usize), String) = match l.kind {
            DocLinkKind::Wikilink | DocLinkKind::Embed => {
                let Some(open) = region.find("[[") else { continue };
                let body_start = open + 2;
                let body_end = region.len().saturating_sub(2);
                if body_end < body_start {
                    continue;
                }
                let body = &region[body_start..body_end];
                let cut = body.find(['#', '|']).unwrap_or(body.len());
                let target = &body[..cut];
                let lead = target.len() - target.trim_start().len();
                let t = target.trim();
                (( l.range[0] + body_start + lead, l.range[0] + body_start + lead + t.len()), t.to_string())
            }
            DocLinkKind::Link => {
                let Some(open) = region.rfind("](") else { continue };
                if !region.ends_with(')') {
                    continue;
                }
                let inner = &region[open + 2..region.len() - 1];
                if inner.starts_with('<') || inner.contains(' ') || inner.contains("://") {
                    continue;
                }
                ((l.range[0] + open + 2, l.range[1] - 1), vaultdraw_core::links::grammar::pct_decode(inner))
            }
        };
        if written.is_empty() || is_attachment_ext(&written) {
            continue;
        }
        let (key, _) = key_of_note_target(old_dir, &written);
        let Some(r) = reps.iter().find(|r| r.old_key == key) else { continue };
        let mut new = new_text(&written, r, new_dir);
        if l.kind == DocLinkKind::Link {
            if !new.to_ascii_lowercase().ends_with(".md") && !new.to_ascii_lowercase().ends_with(".excalidraw") {
                new.push_str(".md");
            }
            new = pct_encode(&new);
        }
        if new != text[span.0..span.1] {
            edits.push((span.0, span.1, new));
        }
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|e| e.0);
    let mut out = String::with_capacity(text.len() + 32);
    let mut at = 0;
    for (s, e, n) in &edits {
        if *s < at {
            continue;
        }
        out.push_str(&text[at..*s]);
        out.push_str(n);
        at = *e;
    }
    out.push_str(&text[at..]);
    Some(Rewritten { text: out, links: edits.len() as u32 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn plan(from: &str, to: &str, reps: &[(&str, &str, &str)]) -> FilePlan {
        let mut elements = BTreeMap::new();
        elements.insert("L1".to_string(), reps.iter().map(|(k, t, p)| Replace { old_key: (*k).into(), new_target: (*t).into(), new_path: (*p).into() }).collect());
        FilePlan { from_path: from.into(), to_path: to.into(), elements }
    }

    #[test]
    fn wikilinks_keep_heading_alias_embed_and_the_spelling() {
        let src = "[[Old]] [[Old#H|shown]] ![[Old]] [[Old.md]] [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n";
        let p = plan("n.md", "n.md", &[("old.md", "New.md", "New.md")]);
        let r = rewrite_note(src, &p).unwrap();
        assert_eq!(r.text, "[[New]] [[New#H|shown]] ![[New]] [[New.md]] [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n");
        assert_eq!(r.links, 4);
    }

    #[test]
    fn a_renamed_drawing_keeps_its_extension_style() {
        // `[[Map]]` in a note is the note Map.md; only the written `.excalidraw` names the drawing.
        let src = "[[Map]] and [[Map.excalidraw]]\n";
        let p = plan("n.md", "n.md", &[("map", "Atlas", "Atlas")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "[[Map]] and [[Atlas.excalidraw]]\n");
    }

    #[test]
    fn markdown_links_are_percent_encoded() {
        let src = "[x](Old%20One.md) [y](https://a.b/Old.md)\n";
        let p = plan("n.md", "n.md", &[("old one.md", "New Name.md", "New Name.md")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "[x](New%20Name.md) [y](https://a.b/Old.md)\n");
    }

    #[test]
    fn relative_links_follow_a_moved_note_and_replays_change_nothing() {
        let src = "[[./Two]] [[../Top]]\n";
        // The note moves from a/ to a/b/: its targets are now one folder deeper.
        let p = plan("a/One.md", "a/b/One.md", &[("a/two.md", "", "a/Two.md"), ("top.md", "", "Top.md")]);
        let r = rewrite_note(src, &p).unwrap();
        assert_eq!(r.text, "[[../Two]] [[../../Top]]\n");
        // Unrelated links and an already rewritten note: nothing to do.
        assert!(rewrite_note("[[Other]]\n", &plan("n.md", "n.md", &[("old.md", "New.md", "New.md")])).is_none());
    }

    #[test]
    fn crlf_and_frontmatter_bytes_survive() {
        let src = "---\r\ntitle: x\r\n---\r\nsee [[Old]]\r\n";
        let p = plan("n.md", "n.md", &[("old.md", "New.md", "New.md")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "---\r\ntitle: x\r\n---\r\nsee [[New]]\r\n");
    }
}
