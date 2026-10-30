//! Launch hunter 2: no panic (a crash of the app) on odd text: Markdown parse, links, tags, folding.
use std::panic::{catch_unwind, AssertUnwindSafe};
use vaultdraw_core::links::attach::attachment_target;
use vaultdraw_core::links::grammar::{parse_link_field, pct_decode, pct_encode, text_links_vec, url_file_param};
use vaultdraw_core::markdown::{parse_markdown, ParseOptions};
use vaultdraw_core::search::{find_tags, normalize};

const TOKENS: &[&str] = &[
    "#", "##", "# ", "- [ ] ", "- [x] ", "> ", "> [!note] ", "```", "~~~", "`", "``", "$$", "$", "|", "| --- |", "---", "...", "***", "**", "*", "_", "[[", "]]", "![[", "[", "](", ")", "<!--", "-->", "%%", "==", "~~", "^", "[^1]", "[^1]: ", "\n", "\r\n", "\r", "\t", " ", "é", "e\u{301}", "日本語", "😀", "\u{202e}", "\u{200b}", "\u{feff}", "\u{0}", "ß", "İ", "ǆ", "﷽", "a", "tag", "#tag/sub", "title: ", "tags: [", "]", "- ", "  - ", "key: value", "\"", "'", "|alias", "#heading", "^block", "<div>", "</div>", "<script>", "&amp;", "&#x1F600;", "\\", "{", "}", "1. ", "10) ",
];

fn rng(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *seed >> 33
}

fn gen(seed: &mut u64) -> String {
    let n = (rng(seed) % 40) as usize + 1;
    let mut s = String::new();
    if rng(seed) % 4 == 0 {
        s.push_str("---\n");
    }
    for _ in 0..n {
        s.push_str(TOKENS[(rng(seed) % TOKENS.len() as u64) as usize]);
    }
    s
}

#[test]
fn odd_text_never_panics() {
    let mut seed = 0x5eed_1234_u64;
    let mut failures = Vec::new();
    for _ in 0..60_000 {
        let s = gen(&mut seed);
        let r = catch_unwind(AssertUnwindSafe(|| {
            let _ = parse_markdown(&s, &ParseOptions::default());
            let _ = find_tags(&s);
            let _ = normalize(&s);
            let _ = text_links_vec(&s);
            let _ = pct_decode(&s);
            let _ = pct_encode(&s);
            let _ = parse_link_field(&s);
            let _ = url_file_param(&s);
            let _ = attachment_target(&s);
        }));
        if r.is_err() && failures.len() < 5 {
            failures.push(s);
        }
    }
    assert!(failures.is_empty(), "panicked on: {failures:?}");
}

use vaultdraw_core::excalidraw_md::{decompress_base64, embedded_images, extract_scene};
use vaultdraw_core::paths::{component_problem, validate_relative};
use vaultdraw_core::search::extract::{extract_doc, extract_items, parse_scene_prefix};
use vaultdraw_core::sync_names::{conflict_original, numbered_copy_original, placeholder_real_name, is_sync_temp_name};
use vaultdraw_core::uri;

const SCENE: &str = r##"{"type":"excalidraw","version":2,"elements":[{"id":"a","type":"text","x":1,"y":2,"width":50,"height":20,"text":"hello #tag [[Note]]","originalText":"hello #tag [[Note]]","isDeleted":false,"link":"https://x.y/z","groupIds":[],"boundElements":null},{"id":"b","type":"frame","name":"Frame é","x":0,"y":0,"width":10,"height":10},{"id":"c","type":"rectangle","x":0,"y":0,"width":10,"height":10,"customData":{"role":"h1"}}],"appState":{"viewBackgroundColor":"#fff"},"files":{}}"##;

#[test]
fn odd_scene_bytes_never_panic() {
    let mut seed = 0xabc_u64;
    let base = SCENE.as_bytes();
    let mut failures = Vec::new();
    for i in 0..30_000 {
        let mut b = base.to_vec();
        match rng(&mut seed) % 5 {
            0 => b.truncate((rng(&mut seed) as usize) % b.len()),
            1 => {
                for _ in 0..(rng(&mut seed) % 4 + 1) {
                    let p = (rng(&mut seed) as usize) % b.len();
                    b[p] = (rng(&mut seed) & 0xff) as u8;
                }
            }
            2 => {
                let p = (rng(&mut seed) as usize) % b.len();
                b.splice(p..p, TOKENS[(rng(&mut seed) % TOKENS.len() as u64) as usize].bytes());
            }
            3 => {
                let p = (rng(&mut seed) as usize) % b.len();
                let q = (p + (rng(&mut seed) as usize) % 30).min(b.len());
                b.drain(p..q);
            }
            _ => {
                let s = String::from_utf8_lossy(&b).replace("\"text\"", ["\"text\":1,\"x\"", "\"text\":null,\"y\"", "\"textt\""][(i % 3) as usize]);
                b = s.into_bytes();
            }
        }
        let r = catch_unwind(AssertUnwindSafe(|| {
            let _ = extract_items(&b);
            let _ = extract_doc(&b);
            let _ = parse_scene_prefix(&b, false);
            let _ = parse_scene_prefix(&b, true);
            let s = String::from_utf8_lossy(&b).to_string();
            let _ = extract_scene(&s);
            let _ = embedded_images(&s);
            let _ = decompress_base64(&s);
        }));
        if r.is_err() && failures.len() < 3 {
            failures.push(String::from_utf8_lossy(&b).to_string());
        }
    }
    assert!(failures.is_empty(), "panicked on: {failures:?}");
}

#[test]
fn odd_names_and_links_never_panic() {
    let mut seed = 0x77_u64;
    let mut failures = Vec::new();
    for _ in 0..60_000 {
        let s = gen(&mut seed);
        let r = catch_unwind(AssertUnwindSafe(|| {
            let _ = component_problem(&s);
            let _ = validate_relative(&s);
            let _ = is_sync_temp_name(&s);
            let _ = placeholder_real_name(&s);
            let _ = conflict_original(&s);
            let _ = numbered_copy_original(&s);
            let _ = uri::parse(&format!("vaultdraw://open?file={s}"));
            let _ = uri::parse(&s);
            let _ = uri::printable(&s, 20);
        }));
        if r.is_err() && failures.len() < 5 {
            failures.push(s);
        }
    }
    assert!(failures.is_empty(), "panicked on: {failures:?}");
}
