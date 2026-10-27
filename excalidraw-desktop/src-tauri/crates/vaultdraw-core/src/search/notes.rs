//! Markdown notes as index entries: one `DocEntry` per `.md` file, built from the parser's
//! `NoteDoc`. A note's lines are the searchable items (`ItemKind::Note`, `Code` inside code
//! blocks); its `#tags` (frontmatter tags first, never from code) become one `Text` item; its
//! links become `ElementLink`s whose value is `\u{1}` plus the target as written (no heading,
//! no alias), resolved by the note rule in `links::resolve`.

use super::extract::{fingerprint8, ElementLink, ItemKind, TextItem};
use super::index::DocEntry;
use crate::markdown::{parse_markdown, Block, BlockKind, DocLinkKind, ParseOptions};

/// Marks an element link written in a note (drawing links never start with it).
pub const NOTE_LINK_MARK: char = '\u{1}';

/// True for `x.md` (any case) that is not an Obsidian-Excalidraw `x.excalidraw.md`.
pub fn is_note_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 3 && name.get(b.len() - 3..).is_some_and(|e| e.eq_ignore_ascii_case(".md")) && !(b.len() > 14 && name.get(b.len() - 14..).is_some_and(|e| e.eq_ignore_ascii_case(".excalidraw.md")))
}

fn code_ranges(blocks: &[Block], out: &mut Vec<[usize; 2]>) {
    for b in blocks {
        match &b.kind {
            BlockKind::Code { .. } => out.push(b.range),
            BlockKind::Blockquote { blocks } | BlockKind::Callout { blocks, .. } | BlockKind::FootnoteDef { blocks, .. } => code_ranges(blocks, out),
            _ => {}
        }
    }
}

/// Extensions that name an attachment (opened by the system, not indexed): `[[photo.png]]` is a
/// file, never `photo.png.md`.
pub fn is_attachment_ext(target: &str) -> bool {
    const EXT: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico", "tif", "tiff", "heic", "pdf", "mp3", "wav", "m4a", "ogg", "flac", "mp4", "mov", "webm", "mkv", "zip", "csv", "json", "txt", "docx", "xlsx", "pptx", "canvas", "base",
    ];
    let Some((_, ext)) = target.rsplit_once('.') else { return false };
    EXT.iter().any(|e| ext.eq_ignore_ascii_case(e))
}

pub struct NoteExtract {
    pub items: Vec<TextItem>,
    pub elinks: Vec<ElementLink>,
    pub hash8: [u8; 8],
}

/// Searchable lines, tags and links of one note.
pub fn extract_note(text: &str) -> NoteExtract {
    let doc = parse_markdown(text, &ParseOptions::default());
    let mut code = Vec::new();
    code_ranges(&doc.blocks, &mut code);
    // Start offset of every line, to place a link on its line.
    let mut starts: Vec<usize> = vec![0];
    starts.extend(memchr::memchr_iter(b'\n', text.as_bytes()).map(|i| i + 1));
    let line_of = |byte: usize| starts.partition_point(|&s| s <= byte).saturating_sub(1);

    let mut elinks: Vec<ElementLink> = Vec::new();
    let mut linked_lines: Vec<usize> = Vec::new();
    for l in &doc.links {
        let target = l.target.trim();
        let ok = match l.kind {
            DocLinkKind::Wikilink | DocLinkKind::Embed => !target.is_empty() && !is_attachment_ext(target),
            DocLinkKind::Link => {
                let t = target.to_ascii_lowercase();
                !target.contains("://") && !t.starts_with("mailto:") && !t.starts_with('#') && (t.ends_with(".md") || t.ends_with(".excalidraw"))
            }
        };
        if !ok {
            continue;
        }
        let line = line_of(l.range[0]);
        let written = if l.kind == DocLinkKind::Link { crate::links::grammar::pct_decode(target) } else { target.to_string() };
        elinks.push(ElementLink { element_id: format!("L{}", line + 1).into(), link: format!("{NOTE_LINK_MARK}{written}").into() });
        linked_lines.push(line);
    }
    linked_lines.sort_unstable();
    linked_lines.dedup();

    let mut items: Vec<TextItem> = Vec::new();
    let mut ci = 0;
    for (n, &s) in starts.iter().enumerate() {
        let e = starts.get(n + 1).copied().unwrap_or(text.len());
        let line = text[s..e].trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            continue;
        }
        while ci < code.len() && code[ci][1] <= s {
            ci += 1;
        }
        let in_code = ci < code.len() && code[ci][0] <= s;
        let id: Box<str> = format!("L{}", n + 1).into();
        let container = linked_lines.binary_search(&n).is_ok().then(|| id.clone());
        items.push(TextItem { element_id: id, container_id: container, kind: if in_code { ItemKind::Code } else { ItemKind::Note }, text: line.into() });
    }
    if !doc.tags.is_empty() {
        let t: Vec<String> = doc.tags.iter().map(|t| format!("#{t}")).collect();
        items.push(TextItem { element_id: "tags".into(), container_id: None, kind: ItemKind::Text, text: t.join(" ").into() });
    }
    NoteExtract { items, elinks, hash8: fingerprint8(text.as_bytes()) }
}

/// Lossy UTF-8 decode, the same as the parser's reader.
pub fn lossy(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(bytes)
}

/// Index entry for a note's bytes (a note that is not readable stays findable by name).
pub fn note_entry_from_bytes(path: &str, stat: (u64, u64), bytes: &[u8]) -> DocEntry {
    let x = extract_note(&lossy(bytes));
    DocEntry::new(path, stat, x.items).with_links(x.elinks, x.hash8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags_of(src: &str) -> Vec<String> {
        let e = note_entry_from_bytes("n.md", (0, 0), src.as_bytes());
        e.tag_pairs().map(|(_, d)| d.to_string()).collect()
    }

    #[test]
    fn tags_from_body_and_frontmatter_never_code() {
        let src = "---\ntags: [alpha, beta/sub]\n---\n# Title\nText #body-tag and `#inline-code` here\n\n```\n#fenced\n[[Not A Link]]\n```\n";
        assert_eq!(tags_of(src), vec!["alpha", "beta/sub", "body-tag"]);
    }

    #[test]
    fn links_on_their_lines_not_in_code() {
        let src = "see [[A#Heading|alias]] and ![[pic.png]]\n```\n[[Code]]\n```\n`[[Inline]]` and [md](Other%20Note.md) and [web](https://x.y/z.md)\n";
        let x = extract_note(src);
        let got: Vec<_> = x.elinks.iter().map(|l| (&*l.element_id, l.link.trim_start_matches(NOTE_LINK_MARK).to_string())).collect();
        assert_eq!(got, vec![("L1", "A".to_string()), ("L5", "Other Note.md".to_string())]);
        assert_eq!(x.items.iter().filter(|i| i.kind == ItemKind::Code).count(), 3);
    }

    #[test]
    fn note_names() {
        assert!(is_note_name("a.md") && is_note_name("A.MD") && is_note_name("x y.md"));
        assert!(!is_note_name("a.excalidraw.md") && !is_note_name(".md") && !is_note_name("a.txt") && !is_note_name("a.markdown"));
    }
}

/// The search-scale spike (TRACKER Phase 8): one run each at 5k and 20k notes.
/// `cargo test -p vaultdraw-core --release -j 4 notes_scale_spike -- --ignored --nocapture`
#[cfg(test)]
mod spike {
    use super::*;
    use crate::search::testgen::{sentence, Rng, CJK, FOLDERS, TAGS, WORDS};
    use crate::search::{Index, Scope};
    use std::{collections::HashMap, fs, path::Path, time::Instant};

    fn make_note(r: &mut Rng, d: usize, names: usize) -> String {
        let mut s = String::new();
        if r.below(10) < 4 {
            s.push_str(&format!("---\ntags: [{}]\naliases: [{}]\n---\n", TAGS[r.below(TAGS.len())], sentence(r, 2)));
        }
        // 3 KB on average, a few big ones (20-60 KB)
        let paras = if d % 50 == 7 { r.range(80, 200) } else { r.range(4, 14) };
        for p in 0..paras {
            if p % 4 == 0 {
                s.push_str(&format!("## {}\n\n", sentence(r, 3)));
            }
            let nw = r.range(12, 40);
            let mut line = sentence(r, nw);
            if r.below(6) == 0 {
                line.push_str(&format!(" see [[{} {}]]", sentence(r, 2), r.below(names)));
            }
            if r.below(8) == 0 {
                line.push_str(&format!(" #{}", TAGS[r.below(TAGS.len())]));
            }
            if r.below(15) == 0 {
                line.push_str(" ![[diagram.png]]");
            }
            s.push_str(&line);
            s.push_str("\n\n");
            if r.below(12) == 0 {
                s.push_str(&format!("- [ ] {}\n- [x] {}\n\n", sentence(r, 6), sentence(r, 5)));
            }
            if r.below(20) == 0 {
                s.push_str(&format!("```rust\nfn {}() {{ let x = {}; }}\n```\n\n", WORDS[r.below(WORDS.len())], r.below(100)));
            }
        }
        s
    }

    fn pct(v: &mut [f64], p: f64) -> f64 {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[((v.len() as f64 - 1.0) * p).round() as usize]
    }

    fn rss_mb() -> f64 {
        let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().unwrap_or(0.0) / 1024.0
    }

    fn run(count: usize, root: &Path) {
        let mut r = Rng(0xA11CE5);
        let mut total = 0usize;
        for d in 0..count {
            let text = make_note(&mut r, d, count / 4);
            total += text.len();
            let title = if d % 40 == 0 { CJK[r.below(CJK.len())].to_string() } else { sentence(&mut r, 2) };
            let p = root.join(format!("{}/sub{}/{} {d}.md", FOLDERS[r.below(FOLDERS.len())], r.below(20), title));
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, text).unwrap();
        }
        println!("\n== {count} notes, {:.1} MB of Markdown ==", total as f64 / 1e6);
        let files: Vec<String> = {
            let mut v = Vec::new();
            fn walk(base: &Path, dir: &Path, v: &mut Vec<String>) {
                for e in fs::read_dir(dir).unwrap().flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        walk(base, &p, v);
                    } else {
                        v.push(p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/"));
                    }
                }
            }
            walk(root, root, &mut v);
            v
        };
        let rss0 = rss_mb();
        // T1: read, parse and index every note (one thread).
        let t = Instant::now();
        let mut docs = HashMap::new();
        for f in &files {
            let bytes = fs::read(root.join(f)).unwrap();
            docs.insert(f.clone(), note_entry_from_bytes(f, (bytes.len() as u64, 0), &bytes));
        }
        let build_ms = t.elapsed().as_secs_f64() * 1000.0;
        let index = Index::from_docs(docs).unwrap();
        let heap = index.approx_heap_bytes() as f64 / 1e6;
        let rss1 = rss_mb();
        let queries: Vec<String> = (0..24).map(|i| WORDS[(i * 7) % WORDS.len()].to_string()).chain((0..12).map(|i| format!("{} {}", WORDS[(i * 5) % WORDS.len()], WORDS[(i * 11 + 3) % WORDS.len()]))).chain(["zzqx".into(), "dsa/graphs".into(), "tag:#todo".into()]).collect();
        let mut times = Vec::new();
        for q in &queries {
            let t = Instant::now();
            let (hits, _) = index.query(q, Scope::All, 50);
            std::hint::black_box(hits.len());
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        println!("T1 in-memory: build {build_ms:.0} ms (1 thread), heap {heap:.1} MB, rss +{:.0} MB, query p50 {:.1} ms p95 {:.1} ms max {:.1} ms", rss1 - rss0, pct(&mut times.clone(), 0.5), pct(&mut times.clone(), 0.95), times.iter().cloned().fold(0.0, f64::max));
        // T2: no bodies in memory; every query reads the files again (4 threads, warm file cache).
        let mut t2 = Vec::new();
        for q in queries.iter().take(12) {
            let needle = q.to_lowercase();
            let t = Instant::now();
            let found: usize = std::thread::scope(|s| {
                let hs: Vec<_> = (0..4)
                    .map(|k| {
                        let (files, needle) = (&files, &needle);
                        s.spawn(move || {
                            let mut n = 0;
                            for f in files.iter().skip(k).step_by(4) {
                                let b = fs::read(root.join(f)).unwrap();
                                let hay = String::from_utf8_lossy(&b).to_lowercase();
                                if hay.contains(needle.as_str()) {
                                    n += 1;
                                }
                            }
                            n
                        })
                    })
                    .collect();
                hs.into_iter().map(|h| h.join().unwrap()).sum()
            });
            std::hint::black_box(found);
            t2.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        println!("T2 stream from disk (4 threads, warm cache): query p50 {:.0} ms p95 {:.0} ms", pct(&mut t2.clone(), 0.5), pct(&mut t2.clone(), 0.95));
        drop(index);
    }

    #[test]
    #[ignore]
    fn notes_scale_spike() {
        for count in [5_000, 20_000] {
            let d = tempfile::tempdir().unwrap();
            run(count, d.path());
        }
    }
}

#[cfg(test)]
mod index_tests {
    use super::*;
    use crate::search::{walk, Index, Scope};
    use std::fs;

    #[test]
    fn walk_reads_notes_and_skips_other_tools_folders() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        for (p, s) in [
            ("A.md", "alpha line\n#todo\n"),
            ("sub/B.md", "---\ntags: [project/x]\n---\nbravo `#notatag`\n"),
            (".obsidian/plugins/README.md", "obsidian settings"),
            (".trash/Old.md", "trashed"),
            (".git/x.md", "git"),
            ("C.excalidraw.md", "obsidian excalidraw file"),
            ("D.txt", "text"),
        ] {
            fs::create_dir_all(r.join(p).parent().unwrap()).unwrap();
            fs::write(r.join(p), s).unwrap();
        }
        let mut found: Vec<String> = walk(r, "").into_iter().map(|f| f.path).collect();
        found.sort();
        assert_eq!(found, vec!["A.md", "sub/B.md"]);
        let mut ix = Index::default();
        let mut buf = Vec::new();
        for f in walk(r, "") {
            let (p, e) = crate::search::scan::parse(r, &f, &mut buf).unwrap();
            ix.upsert(p, e);
        }
        let paths = |q: &str| -> Vec<String> { ix.query(q, Scope::All, 10).0.into_iter().map(|h| h.path).collect() };
        assert_eq!(paths("alpha"), vec!["A.md"]);
        assert_eq!(paths("bravo"), vec!["sub/B.md"]);
        assert_eq!(paths("tag:#todo"), vec!["A.md"]);
        assert_eq!(paths("tag:#project/x"), vec!["sub/B.md"]);
        assert!(paths("tag:#notatag").is_empty(), "a tag inside code is not a tag");
        let by_name: Vec<String> = ix.query("A", Scope::Names, 10).0.into_iter().map(|h| h.path).collect();
        assert_eq!(by_name, vec!["A.md"], "a note is found by its name, not its extension");
        assert!(ix.query("md", Scope::Names, 10).0.is_empty());
        let t = ix.tag_summary();
        assert_eq!(t.by_path["sub/B.md"], vec!["project/x"]);
    }

    #[test]
    fn over_budget_notes_keep_name_headings_tags_and_links() {
        let mut ix = Index::default();
        ix.set_note_budget(200);
        let body = |w: &str| format!("# Heading {w}\n{}\n#tag{w} [[Other]]\n", format!("{w} filler text here. ").repeat(20));
        for w in ["one", "two", "three"] {
            let p = format!("{w}.md");
            ix.upsert(p.clone(), note_entry_from_bytes(&p, (1, 1), body(w).as_bytes()));
        }
        assert!(ix.note_bytes() < 200 + 300, "kept bytes: {}", ix.note_bytes());
        let hits = |q: &str| -> Vec<String> { ix.query(q, Scope::All, 10).0.into_iter().map(|h| h.path).collect() };
        assert_eq!(hits("heading three"), vec!["three.md"], "headings stay searchable");
        assert!(hits("filler text").len() < 3, "bodies past the budget are not searchable");
        assert_eq!(hits("tag:#tagthree"), vec!["three.md"]);
        ix.remove("one.md");
        ix.remove("two.md");
        ix.remove("three.md");
        assert_eq!(ix.note_bytes(), 0, "removal returns the bytes");
    }
}
