//! Family "cost is linear in note size" (toimprove 288, 294 for the reading view), here for the
//! native Markdown parser that feeds the import, the plugin API and the properties panel: every
//! construct written as many blocks and as one block, at a base size and 4 times that. Parsing 4
//! times the text must cost under 8 times the time (linear is 4, quadratic is 16).

use std::time::Instant;
use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

type Unit = fn(usize) -> String;

fn constructs() -> Vec<(&'static str, Unit)> {
    vec![
        ("paragraph", |i| format!("Plain paragraph {i} lorem ipsum dolor sit amet.")),
        ("heading", |i| format!("## Heading {i}")),
        ("bullet", |i| format!("- item {i}")),
        ("numbered", |i| format!("{}. item {i}", i + 1)),
        ("task", |i| format!("- [{}] task {i}", if i % 2 == 1 { "x" } else { " " })),
        ("nested list", |i| format!("- a {i}\n  - b\n    - c")),
        ("quote", |i| format!("> quote {i}")),
        ("callout", |i| format!("> [!note] Title {i}\n> body {i}")),
        ("code fence", |i| format!("```js\nconst a{i} = 1;\n```")),
        ("table", |i| format!("| a | b |\n|---|---|\n| {i} | x |")),
        ("wikilink", |i| format!("see [[Note {i}]] and [[Note {i}|alias]] and [[Note#Head]]")),
        ("embed", |i| format!("![[Note {i}]] ![[pic{i}.png|100]]")),
        ("tag", |i| format!("#tag{i} #nested/tag{i}")),
        ("emphasis", |i| format!("==mark {i}== and **bold** and *it* and ~~del~~ and `code`")),
        ("math", |i| format!("inline $a_{i}$ math")),
        ("comment", |i| format!("a %%hidden {i}%% b <!-- c {i} -->")),
        ("footnote", |i| format!("Claim[^{i}]\n\n[^{i}]: Note {i}.")),
        ("link", |i| format!("[text {i}](https://example.com/{i}) <https://a.b/{i}>")),
        ("image", |i| format!("![alt {i}|50](pic{i}.png)")),
        ("unclosed wikilink", |i| format!("open [[Note {i} never closed")),
        ("unclosed math", |i| format!("cost ${i} then more")),
        ("unclosed emphasis", |i| format!("a **open {i} and _x and *y")),
        ("unclosed code", |i| format!("a `open {i}")),
        ("unclosed link", |i| format!("a [open {i} and (paren")),
        ("unclosed html", |i| format!("a <open {i} and 1 < 2")),
        ("hard break", |i| format!("line {i}  \nnext")),
    ]
}

fn build(f: Unit, n: usize, sep: &str) -> String {
    (0..n).map(f).collect::<Vec<_>>().join(sep)
}

fn best(text: &str) -> f64 {
    (0..2)
        .map(|_| {
            let t = Instant::now();
            let _ = parse_markdown(text, &ParseOptions::default());
            t.elapsed().as_secs_f64() * 1000.0
        })
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn parse_time_grows_linearly_for_every_construct() {
    let mut slow = Vec::new();
    for (layout, sep) in [("blocks", "\n\n"), ("one block", "\n")] {
        for (name, f) in constructs() {
            let _ = parse_markdown(&build(f, 100, sep), &ParseOptions::default());
            let a = best(&build(f, 1500, sep));
            let b = best(&build(f, 6000, sep));
            if b / a.max(3.0) >= 8.0 {
                slow.push(format!("{name} ({layout}): {a:.1} ms -> {b:.1} ms"));
            }
        }
    }
    assert!(slow.is_empty(), "not linear: {slow:?}");
}
