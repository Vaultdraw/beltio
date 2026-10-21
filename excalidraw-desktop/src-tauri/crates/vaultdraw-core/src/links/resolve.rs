//! Path and key helpers shared by the index, the planner and the rewriter.

use crate::search::normalize;

use super::grammar::strip_ext;

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
