//! Attachments (`![[image.png]]`, `[[paper.pdf]]`): files of the vault that are not drawings or
//! notes. They are not in the search index, so this small name map is built on the first
//! attachment link that needs it and dropped whenever the vault changes.

use crate::search::normalize;
use crate::search::scan::{is_indexed_name, is_skipped_dir};
use std::{collections::HashMap, fs, path::Path};

/// The attachment a link names (`![[pic.png|200]]`, `[[doc.pdf#page=2]]`, `pic.png`), if its
/// extension says it is one. Anything else is a note or drawing link.
pub fn attachment_target(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let body = raw.strip_prefix("![[").or_else(|| raw.strip_prefix("[[")).map_or(raw, |r| r.trim_end_matches("]]"));
    let body = body.split('|').next().unwrap_or(body);
    let body = body.split('#').next().unwrap_or(body).trim();
    (!body.is_empty() && crate::search::notes::is_attachment_ext(body)).then(|| body.to_string())
}

const MAX_DEPTH: usize = 64;
const MAX_FILES: usize = 500_000;

#[derive(Default)]
pub struct AttachmentIndex {
    /// Folded file name (with extension) to the vault paths that have it.
    by_name: HashMap<String, Vec<String>>,
    /// Folded full path to the real path.
    by_path: HashMap<String, String>,
}

impl AttachmentIndex {
    pub fn build(root: &Path) -> AttachmentIndex {
        let mut ix = AttachmentIndex::default();
        let mut stack = vec![(String::new(), 0usize)];
        let mut count = 0;
        while let Some((dir, depth)) = stack.pop() {
            let Ok(rd) = fs::read_dir(root.join(&dir)) else { continue };
            for e in rd.flatten() {
                let Ok(name) = e.file_name().into_string() else { continue };
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_symlink() || name.starts_with(".excalidraw-tmp-") || (dir.is_empty() && name.eq_ignore_ascii_case(crate::paths::META_DIR)) {
                    continue;
                }
                let rel = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
                if ft.is_dir() {
                    if depth < MAX_DEPTH && !is_skipped_dir(&name) {
                        stack.push((rel, depth + 1));
                    }
                } else if ft.is_file() && !is_indexed_name(&name) && !name.starts_with('.') {
                    count += 1;
                    if count > MAX_FILES {
                        return ix;
                    }
                    ix.by_name.entry(normalize(&name)).or_default().push(rel.clone());
                    ix.by_path.insert(normalize(&rel), rel);
                }
            }
        }
        ix
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }

    /// The file a link written in `from` names: an exact vault path, then a path ending in the
    /// written folders, then by name (same folder first, then the shortest path).
    pub fn resolve(&self, from: &str, target: &str) -> Option<String> {
        let t = normalize(target.trim().trim_start_matches('/'));
        if t.is_empty() {
            return None;
        }
        if let Some(p) = self.by_path.get(&t) {
            return Some(p.clone());
        }
        let name = t.rsplit('/').next().unwrap_or(&t);
        let cands = self.by_name.get(name)?;
        let slash = t.contains('/');
        let dir = from.rfind('/').map_or("", |i| &from[..i]);
        cands
            .iter()
            .filter(|p| !slash || normalize(p).ends_with(&format!("/{t}")))
            .min_by(|a, b| {
                let in_dir = |p: &&String| p.rfind('/').map_or("", |i| &p[..i]) == dir;
                (!in_dir(a), a.len(), a.as_str()).cmp(&(!in_dir(b), b.len(), b.as_str()))
            })
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_targets_are_told_from_note_links() {
        assert_eq!(attachment_target("![[pic.png|200]]").as_deref(), Some("pic.png"));
        assert_eq!(attachment_target("[[a/doc.PDF#page=2]]").as_deref(), Some("a/doc.PDF"));
        assert_eq!(attachment_target("pic.jpg").as_deref(), Some("pic.jpg"));
        assert_eq!(attachment_target("[[Note]]"), None);
        assert_eq!(attachment_target("[[Note.v2]]"), None);
        assert_eq!(attachment_target("[[x.md]]"), None);
    }

    #[test]
    fn resolves_by_path_folder_and_name() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        for p in ["a/pic.png", "b/c/pic.png", "Top.PDF", "Notes/n.md", "x/d.excalidraw", ".obsidian/p.png", ".trash/t.png", "deep/x/y/z.png"] {
            fs::create_dir_all(r.join(p).parent().unwrap()).unwrap();
            fs::write(r.join(p), "x").unwrap();
        }
        let ix = AttachmentIndex::build(r);
        assert_eq!(ix.len(), 4, "notes, drawings and dot-folders are not attachments");
        assert_eq!(ix.resolve("a/note.md", "pic.png").as_deref(), Some("a/pic.png"), "same folder first");
        assert_eq!(ix.resolve("z.md", "pic.png").as_deref(), Some("a/pic.png"), "then the shortest path");
        assert_eq!(ix.resolve("z.md", "c/pic.png").as_deref(), Some("b/c/pic.png"));
        assert_eq!(ix.resolve("z.md", "b/c/pic.png").as_deref(), Some("b/c/pic.png"));
        assert_eq!(ix.resolve("q/n.md", "top.pdf").as_deref(), Some("Top.PDF"));
        assert_eq!(ix.resolve("z.md", "missing.png"), None);
        assert_eq!(ix.resolve("z.md", "y/pic.png"), None);
        assert_eq!(ix.resolve("z.md", "p.png"), None);
    }
}
