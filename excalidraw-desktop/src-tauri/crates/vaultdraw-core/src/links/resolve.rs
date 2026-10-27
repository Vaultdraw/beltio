//! Path and key helpers shared by the index, the planner and the rewriter.

use crate::search::normalize;

use super::grammar::{has_ext, strip_ext};

pub fn dir_of(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

pub fn name_of(path: &str) -> &str {
    path.rfind('/').map_or(path, |i| &path[i + 1..])
}

/// Normalised basename of a normalised key or path.
pub fn base_of(nk: &str) -> &str {
    nk.rsplit('/').next().unwrap_or(nk)
}

/// Key of a link target as written in a text or `[[x]]`/URL link: leading `/` dropped, normalised.
pub fn key_of_target(t: &str) -> String {
    normalize(strip_ext(t.trim()).trim_start_matches('/'))
}

/// True for a note (`x.md`): its links follow the note rule, a drawing's keep their meaning.
pub fn is_note_path(path: &str) -> bool {
    crate::search::notes::is_note_name(path)
}

/// The target of an element link written in a note (`\u{1}` + target as written).
pub fn note_link_target(link: &str) -> Option<&str> {
    link.strip_prefix(crate::search::notes::NOTE_LINK_MARK)
}

/// Key of a link target written in a note. A written extension wins: `x.md` is a note,
/// `x.excalidraw` a drawing, `x.png` an attachment (never in the index, so it stays
/// unresolved here); a name with no known extension means `x.md`, as in Obsidian.
/// `rel` is true for `./x` and `../x`, resolved from the note's folder `dir`.
pub fn key_of_note_target(dir: &str, t: &str) -> (String, bool) {
    let t = t.trim();
    let rel = t.starts_with("./") || t.starts_with("../");
    let t = if rel { join_rel(dir, t) } else { t.trim_start_matches('/').to_string() };
    if has_ext(&t) {
        return (normalize(strip_ext(&t)), rel);
    }
    let n = normalize(&t);
    if n.ends_with(".md") || crate::search::notes::is_attachment_ext(&n) {
        (n, rel)
    } else {
        (n + ".md", rel)
    }
}

/// Normalised vault path without extension.
pub fn key_of_path(path: &str) -> String {
    normalize(strip_ext(path))
}

/// `rel` (with `./`, `../`) joined onto the folder `dir`; the result is a vault path.
pub fn join_rel(dir: &str, rel: &str) -> String {
    let mut segs: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for s in rel.split('/') {
        match s {
            "" | "." => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    segs.join("/")
}

/// Key of a relative link target written in the drawing folder `dir`.
pub fn key_of_rel(dir: &str, target: &str) -> String {
    normalize(&join_rel(dir, target))
}

/// Relative link from the folder `dir` to the vault path `to` (no extension).
pub fn rel_path(dir: &str, to: &str) -> String {
    let from: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    let t: Vec<&str> = to.split('/').collect();
    let mut c = 0;
    while c < from.len() && c + 1 < t.len() && from[c] == t[c] {
        c += 1;
    }
    let mut s = if from.len() == c { "./".to_string() } else { "../".repeat(from.len() - c) };
    s.push_str(&t[c..].join("/"));
    s
}
