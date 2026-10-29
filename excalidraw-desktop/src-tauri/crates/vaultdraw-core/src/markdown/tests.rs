use super::*;
use std::path::PathBuf;

fn goldens_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/markdown/goldens")
}

fn parse(text: &str) -> NoteDoc {
    parse_markdown(text, &ParseOptions::default())
}

/// Every `goldens/*.md` is parsed and compared with its `.json`; `UPDATE_GOLDENS=1` rewrites them.
/// Fixtures named `crlf*.md` are stored with `\n` and parsed with `\r\n` line ends.
#[test]
fn goldens_match() {
    let update = std::env::var("UPDATE_GOLDENS").is_ok_and(|v| v == "1");
    let mut names: Vec<_> = std::fs::read_dir(goldens_dir())
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .collect();
    names.sort();
    assert!(names.len() >= 12, "expected at least 12 golden inputs, found {}", names.len());
    let mut failures = Vec::new();
    for md in names {
        let mut src = std::fs::read_to_string(&md).unwrap();
        if md.file_name().unwrap().to_string_lossy().starts_with("crlf") {
            src = src.replace("\r\n", "\n").replace('\n', "\r\n");
        }
        let got = serde_json::to_string_pretty(&parse(&src)).unwrap() + "\n";
        let json = md.with_extension("json");
        if update {
            std::fs::write(&json, &got).unwrap();
            continue;
        }
        match std::fs::read_to_string(&json) {
            Ok(want) if want == got => {}
            Ok(_) => failures.push(format!("{} differs (UPDATE_GOLDENS=1 to regenerate)", json.display())),
            Err(_) => failures.push(format!("{} is missing (UPDATE_GOLDENS=1 to create)", json.display())),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Every block's byte range slices the source on a character boundary and starts with the
/// block's own text for the simple kinds.
fn check_ranges(src: &str, blocks: &[Block]) {
    for b in blocks {
        let [s, e] = b.range;
        assert!(s <= e && e <= src.len(), "range {s}..{e} outside the source");
        let slice = src.get(s..e).unwrap_or_else(|| panic!("range {s}..{e} is not on a char boundary"));
        match &b.kind {
            BlockKind::Code { text, .. } if !text.is_empty() => {
                let first = text.lines().next().unwrap();
                assert!(slice.contains(first), "code range {slice:?} lacks {first:?}");
            }
            BlockKind::Blockquote { blocks } | BlockKind::Callout { blocks, .. } | BlockKind::FootnoteDef { blocks, .. } => check_ranges(src, blocks),
            BlockKind::Image { target, .. } | BlockKind::Embed { target, .. } if !target.contains(['%', ' ']) => {
                let name = target.rsplit('/').next().unwrap();
                assert!(slice.contains(name), "embed range {slice:?} lacks {name:?}");
            }
            BlockKind::Math { latex } => assert!(slice.contains(latex.lines().next().unwrap_or(""))),
            _ => {}
        }
    }
}

#[test]
fn ranges_slice_back_to_the_source() {
    for entry in std::fs::read_dir(goldens_dir()).unwrap() {
        let p = entry.unwrap().path();
        if p.extension().is_some_and(|e| e == "md") {
            let src = std::fs::read_to_string(&p).unwrap();
            let doc = parse(&src);
            check_ranges(&src, &doc.blocks);
            for l in &doc.links {
                let slice = &src[l.range[0]..l.range[1]];
                assert!(slice.contains(&l.target) || l.target.contains('%') || slice.contains("%20"), "{slice:?} vs {:?}", l.target);
            }
        }
    }
}

#[test]
fn heading_levels_and_block_ids() {
    let doc = parse("# One ^a1\n\n## Two\n\nPara\n\n^later\n");
    let kinds: Vec<_> = doc.blocks.iter().map(|b| (&b.kind, b.block_id.clone())).collect();
    assert!(matches!(kinds[0].0, BlockKind::Heading { level: 1, text, .. } if text == "One"));
    assert_eq!(kinds[0].1.as_deref(), Some("a1"));
    assert!(matches!(kinds[1].0, BlockKind::Heading { level: 2, .. }));
    assert_eq!(kinds[2].1.as_deref(), Some("later"), "a bare ^id line names the block before it: {kinds:?}");
    assert_eq!(doc.blocks.len(), 3);
}

#[test]
fn tags_never_come_from_code() {
    let doc = parse("```c\n#include <x>\n#define A\n```\n\nUse `#nope` but #yes\n\n    #indented\n");
    assert_eq!(doc.tags, vec!["yes"]);
}

#[test]
fn wikilink_variants_and_offsets() {
    let doc = parse("a [[N#H|al]] b [[M#^blk]] 😀 #t");
    let BlockKind::Paragraph { text, inline } = &doc.blocks[0].kind else { panic!() };
    assert_eq!(text, "a [[N#H|al]] b [[M#^blk]] 😀 #t");
    let w = &inline[0];
    assert_eq!((w.kind, w.target.as_str(), w.heading.as_deref(), w.alias.as_deref()), (InlineKind::Wikilink, "N", Some("H"), Some("al")));
    let utf16: Vec<u16> = text.encode_utf16().collect();
    assert_eq!(String::from_utf16(&utf16[w.start..w.end]).unwrap(), "[[N#H|al]]");
    assert_eq!(inline[1].block_ref.as_deref(), Some("blk"));
    let t = inline.last().unwrap();
    assert_eq!((t.kind, String::from_utf16(&utf16[t.start..t.end]).unwrap()), (InlineKind::Tag, "#t".to_string()));
    assert_eq!(doc.links.len(), 2);
}

#[test]
fn embed_sizes() {
    let doc = parse("![[a.png|100]]\n\n![[a.png|200x50]]\n\n![[n#h]]\n");
    let sizes: Vec<_> = doc
        .blocks
        .iter()
        .map(|b| match &b.kind {
            BlockKind::Image { width, height, .. } => (*width, *height),
            BlockKind::Embed { heading, .. } => {
                assert_eq!(heading.as_deref(), Some("h"));
                (None, None)
            }
            k => panic!("{k:?}"),
        })
        .collect();
    assert_eq!(sizes, vec![(Some(100), None), (Some(200), Some(50)), (None, None)]);
}

#[test]
fn callout_fold_and_default_title() {
    let doc = parse("> [!tip]- Fold\n> body\n\n> [!NOTE]\n> x\n\n> [!bug]+\n");
    let c: Vec<_> = doc
        .blocks
        .iter()
        .map(|b| match &b.kind {
            BlockKind::Callout { callout_type, title, fold_state, blocks } => (callout_type.clone(), title.clone(), *fold_state, blocks.len()),
            k => panic!("{k:?}"),
        })
        .collect();
    assert_eq!(
        c,
        vec![
            ("tip".into(), "Fold".into(), FoldState::Closed, 1),
            ("note".into(), "Note".into(), FoldState::None, 1),
            ("bug".into(), "Bug".into(), FoldState::Open, 0),
        ]
    );
}

#[test]
fn frontmatter_forms() {
    let a = parse("---\ntags: [a, '#b']\naliases: [X, \"Y Z\"]\n---\nbody #c");
    let f = a.frontmatter.unwrap();
    assert_eq!(f.tags, vec!["a", "b"]);
    assert_eq!(f.aliases, vec!["X", "Y Z"]);
    assert_eq!(a.tags, vec!["a", "b", "c"]);
    let b = parse("---\ntags: a, b\n---\n");
    assert_eq!(b.frontmatter.unwrap().tags, vec!["a", "b"]);
    let c = parse("---\ntags:\n  - one\n  - two\n---\n");
    assert_eq!(c.frontmatter.unwrap().tags, vec!["one", "two"]);
}

#[test]
fn comments_and_html() {
    let doc = parse("keep %%drop%% this <!-- gone --> and<br>break\n\n<!-- only -->\n");
    let BlockKind::Paragraph { text, .. } = &doc.blocks[0].kind else { panic!("{:?}", doc.blocks) };
    assert_eq!(text, "keep  this  and\nbreak");
    assert_eq!(doc.blocks.len(), 1);
    assert_eq!(doc.stats.dropped_html, 2);
}

#[test]
fn stats_count_words_and_dropped_emphasis() {
    let doc = parse("one **two** *three* ~~four~~ ==five== six\n");
    assert_eq!(doc.stats.words, 6);
    assert_eq!(doc.stats.dropped_emphasis, 4);
    assert_eq!(doc.stats.blocks, 1);
}

#[test]
fn empty_and_whitespace_input() {
    for s in ["", "\n\n", "   \n"] {
        let d = parse(s);
        assert!(d.blocks.is_empty() && d.links.is_empty() && d.tags.is_empty(), "{s:?}");
        assert_eq!(d.schema_version, 1);
    }
}

#[test]
fn crlf_matches_lf_content() {
    let lf = "# T\n\n- [ ] a\n- [x] b\n\n```\n#define X\n```\n\n> [!note] N\n> body\n";
    let a = parse(lf);
    let b = parse(&lf.replace('\n', "\r\n"));
    let strip = |d: &NoteDoc| {
        let mut v = serde_json::to_value(d).unwrap();
        fn clear(v: &mut serde_json::Value) {
            match v {
                serde_json::Value::Object(m) => {
                    m.remove("range");
                    m.values_mut().for_each(clear);
                }
                serde_json::Value::Array(a) => a.iter_mut().for_each(clear),
                _ => {}
            }
        }
        clear(&mut v);
        v
    };
    assert_eq!(strip(&a), strip(&b));
}

#[test]
fn byte_order_mark_is_skipped_with_ranges_kept() {
    let src = "\u{feff}# H\n";
    let doc = parse(src);
    assert!(matches!(&doc.blocks[0].kind, BlockKind::Heading { text, .. } if text == "H"));
    assert_eq!(&src[doc.blocks[0].range[0]..doc.blocks[0].range[1]], "# H\n");
}

#[test]
fn json_shape_is_camel_case_with_schema_version() {
    let v = serde_json::to_value(parse("- [ ] t\n")).unwrap();
    assert_eq!(v["schemaVersion"], 1);
    assert_eq!(v["blocks"][0]["kind"], "listItem");
    assert_eq!(v["blocks"][0]["task"], "open");
    assert_eq!(v["stats"]["droppedEmphasis"], 0);
}

#[test]
fn file_reader_caps_and_lossy_decode() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("bad.md"), b"# ok \xff\xfe end\n").unwrap();
    let text = read_markdown_file(root, "bad.md").unwrap();
    assert!(text.contains('\u{fffd}') && text.starts_with("# ok"));
    std::fs::write(root.join("big.md"), vec![b'a'; MAX_MARKDOWN_BYTES as usize + 1]).unwrap();
    let e = read_markdown_file(root, "big.md").unwrap_err();
    assert_eq!(e.code, "INVALID_FILE");
    assert!(e.message.contains("16 MiB"));
    std::fs::write(root.join("edge.md"), vec![b'a'; MAX_MARKDOWN_BYTES as usize]).unwrap();
    assert!(read_markdown_file(root, "edge.md").is_ok());
}

#[test]
fn file_reader_path_rules() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("a.md"), "x").unwrap();
    std::fs::write(root.join("a.txt"), "x").unwrap();
    for bad in ["../a.md", "/etc/a.md", "sub/../a.md", "a\\b.md", "a.txt", ""] {
        assert_eq!(read_markdown_file(root, bad).unwrap_err().code, "INVALID_PATH", "{bad:?}");
    }
    assert_eq!(read_markdown_file(root, "missing.md").unwrap_err().code, "NOT_FOUND");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("a.md"), root.join("link.md")).unwrap();
        assert_eq!(read_markdown_file(root, "link.md").unwrap_err().code, "INVALID_PATH");
    }
    assert_eq!(parse_markdown_file(root, "a.md", &ParseOptions::default()).unwrap().stats.words, 1);
}

fn big_note(words: usize) -> String {
    let cycle = "# Heading with words\n\nA paragraph with **bold**, *italic*, `code`, [[Vault note]] and #tag/x plus plenty of ordinary words to make it long enough to matter.\n\n- [ ] task one\n  - nested item here\n- [x] task two\n\n```rust\nlet x = 1; // #notag\n```\n\n| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n\n> [!note] Title\n> callout body text\n\n$$x^2$$\n\n";
    let per = cycle.split_whitespace().count();
    cycle.repeat(words / per + 1)
}

/// `cargo test -p vaultdraw-core --release markdown_speed -- --ignored --nocapture`
#[test]
#[ignore]
fn markdown_speed_50k_words() {
    let text = big_note(50_000);
    let opts = ParseOptions::default();
    let mut best = f64::MAX;
    for _ in 0..15 {
        let t = std::time::Instant::now();
        let d = parse_markdown(&text, &opts);
        best = best.min(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(d);
    }
    println!("markdown_speed_50k_words: {} KB, best of 15 = {best:.2} ms", text.len() / 1024);
}

/// Every image block of a note, wherever it nests (callouts, lists, tables, quotes): `target`s in document order.
fn image_targets(doc: &NoteDoc) -> Vec<(String, Option<u32>)> {
    fn walk(v: &serde_json::Value, out: &mut Vec<(String, Option<u32>)>) {
        match v {
            serde_json::Value::Object(m) => {
                if m.get("kind").and_then(|k| k.as_str()) == Some("image") {
                    out.push((m["target"].as_str().unwrap().to_string(), m.get("width").and_then(|w| w.as_u64()).map(|w| w as u32)));
                }
                for x in m.values() {
                    walk(x, out);
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(&serde_json::to_value(doc).unwrap(), &mut out);
    out
}

#[test]
fn image_forms_everywhere() {
    let src = "![[a.png]]\n\n![[b.png|300]]\n\n![alt](pics/c.png)\n\n![](./d.gif)\n\n![](../e.webp)\n\n![](my%20folder/f%20g.svg)\n\n![](<my folder/h.png>)\n\n![[Ünï/i.png|alt|20x10]]\n\n\
> [!note] T\n> ![[j.png]]\n> ![k](k.png)\n\n- item\n  ![[l.png]]\n- ![](m.png)\n\n1. ![[n.png|50]]\n\n| a | b |\n|---|---|\n| ![[o.png\\|40]] | ![p](p.png) |\n";
    let got = image_targets(&parse(src));
    let names: Vec<&str> = got.iter().map(|(t, _)| t.as_str()).collect();
    println!("{got:?}");
    assert_eq!(
        names,
        ["a.png", "b.png", "pics/c.png", "./d.gif", "../e.webp", "my folder/f g.svg", "my folder/h.png", "Ünï/i.png", "j.png", "k.png", "l.png", "m.png", "n.png", "o.png", "p.png"]
    );
    assert_eq!(got[1].1, Some(300));
}

#[test]
fn escaped_pipe_in_a_table_cell_keeps_the_target_clean() {
    let doc = parse("| a |\n|---|\n| [[Note\\|the note]] ![[o.png\\|40]] |\n");
    assert_eq!(image_targets(&doc), vec![("o.png".to_string(), Some(40))]);
    assert!(doc.links.iter().any(|l| l.target == "Note"), "{:?}", doc.links.iter().map(|l| &l.target).collect::<Vec<_>>());
}

/// One table for the Rust parser and the browser stand-in (`fakeParseMarkdown`): line breaks and
/// the order of text and pictures inside a paragraph. The TypeScript test reads the same file.
#[test]
fn paragraph_cases_match_the_shared_table() {
    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        input: String,
        #[serde(rename = "softBreakNewline")]
        soft: bool,
        blocks: Vec<(String, String)>,
    }
    let cases: Vec<Case> = serde_json::from_str(include_str!("paragraph_cases.json")).unwrap();
    for c in cases {
        let doc = parse_markdown(&c.input, &ParseOptions { soft_break_newline: c.soft });
        let got: Vec<(String, String)> = doc
            .blocks
            .iter()
            .map(|b| match &b.kind {
                BlockKind::Paragraph { text, .. } => ("paragraph".to_string(), text.clone()),
                BlockKind::Image { target, .. } => ("image".to_string(), target.clone()),
                BlockKind::Embed { target, .. } => ("embed".to_string(), target.clone()),
                other => panic!("{}: unexpected block {other:?}", c.name),
            })
            .collect();
        assert_eq!(got, c.blocks, "{}", c.name);
    }
}

#[test]
fn a_picture_inside_a_list_item_keeps_its_place() {
    let doc = parse("- one ![[a.png]] two\n- ![[b.png]]\n- [ ] task\n");
    let kinds: Vec<String> = doc
        .blocks
        .iter()
        .map(|b| match &b.kind {
            BlockKind::ListItem { text, .. } => format!("item:{text}"),
            BlockKind::Paragraph { text, .. } => format!("p:{text}"),
            BlockKind::Image { target, .. } => format!("img:{target}"),
            _ => "other".to_string(),
        })
        .collect();
    assert_eq!(kinds, vec!["item:one", "img:a.png", "p:two", "item:", "img:b.png", "item:task"]);
}
