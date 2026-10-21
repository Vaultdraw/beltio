//! Tag grammar and extraction (F6). A tag is `#word` inside a text element or frame name.
//!
//! Grammar (documented for users in the README):
//! - `#` starts a tag only at the start of the text or after whitespace or an opening
//!   quote/bracket (`( [ { " ' <`) or `, ; :`; so `a#b`, `https://x/#frag`, `&#123;` and `##x` are not tags.
//! - Body: Unicode letters/digits/combining marks, `_`, `-`, and `/` as the nesting separator.
//!   It must start with a letter, digit or `_`; trailing `-`, `/` are trimmed and the tag ends
//!   at an empty segment (`a//b` is `a`).
//! - Rejected: no letter at all (`#123`, `#2024/10`), hex colours containing a digit
//!   (`#ff00aa`, `#1e1e1e`, `#a1b`; all-letter words like `#bad` stay tags), over 64 chars.
//! - Case/accent-insensitive key (`normalize`), the first spelling is kept for display.

use super::normalize::normalize;

pub const MAX_TAG_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagMatch<'a> {
    /// Byte range of `#tag` in the source text.
    pub range: (usize, usize),
    /// The tag as written, without `#`.
    pub display: &'a str,
}

fn opens_tag(prev: Option<char>) -> bool {
    match prev {
        None => true,
        Some(c) => c.is_whitespace() || matches!(c, '(' | '[' | '{' | '"' | '\'' | '<' | ',' | ';' | ':'),
    }
}

fn is_body(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/' | '\u{300}'..='\u{36F}')
}

fn is_hex_colour(body: &str) -> bool {
    matches!(body.len(), 3 | 4 | 6 | 8) && body.bytes().all(|b| b.is_ascii_hexdigit()) && body.bytes().any(|b| b.is_ascii_digit())
}

/// Validates and trims a raw run; returns the accepted tag body.
fn accept(raw: &str) -> Option<&str> {
    let mut end = raw.len();
    // Cut at the first empty segment, then trim trailing separators.
    if let Some(i) = raw.find("//") {
        end = i;
    }
    let body = raw[..end].trim_end_matches(['-', '/']);
    let first = body.chars().next()?;
    if !(first.is_alphanumeric() || first == '_') || body.chars().count() > MAX_TAG_CHARS {
        return None;
    }
    if !body.chars().any(char::is_alphabetic) || is_hex_colour(body) {
        return None;
    }
    Some(body)
}

/// All tags in `text`, in order (duplicates kept).
pub fn find_tags(text: &str) -> Vec<TagMatch<'_>> {
    let mut out = Vec::new();
    if !text.contains('#') {
        return out;
    }
    for i in memchr::memchr_iter(b'#', text.as_bytes()) {
        if !opens_tag(text[..i].chars().next_back()) {
            continue;
        }
        let rest = &text[i + 1..];
        let run = rest.find(|c: char| !is_body(c)).unwrap_or(rest.len());
        if let Some(body) = accept(&rest[..run]) {
            out.push(TagMatch { range: (i, i + 1 + body.len()), display: body });
        }
    }
    out
}

/// Case/accent-folded tag key (what is compared and stored).
pub fn tag_key(display: &str) -> String {
    normalize(display)
}

/// True when `key` equals `filter` or lives under it (`dsa/graphs` under `dsa`).
pub fn key_under(key: &str, filter: &str) -> bool {
    key == filter || (key.len() > filter.len() && key.starts_with(filter) && key.as_bytes()[filter.len()] == b'/')
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocTag {
    pub key: Box<str>,
    pub display: Box<str>,
}

/// Distinct tags of a drawing (first spelling wins), from the original item texts.
pub fn doc_tags<'a>(texts: impl Iterator<Item = &'a str>) -> Vec<DocTag> {
    let mut out: Vec<DocTag> = Vec::new();
    for t in texts {
        for m in find_tags(t) {
            let key = tag_key(m.display);
            if !out.iter().any(|d| *d.key == *key) {
                out.push(DocTag { key: key.into(), display: m.display.into() });
            }
        }
    }
    out.shrink_to_fit();
    out
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn tags(s: &str) -> Vec<&str> {
        find_tags(s).into_iter().map(|m| m.display).collect()
    }

    #[test]
    fn basic_and_nested() {
        assert_eq!(tags("#dsa and #dsa/graphs, #Interview_prep-2024"), vec!["dsa", "dsa/graphs", "Interview_prep-2024"]);
        assert_eq!(tags("(#a) \"#b\" 'c' [#d] x:#e"), vec!["a", "b", "d", "e"]);
        assert_eq!(tags("line1\n#todo"), vec!["todo"]);
    }

    #[test]
    fn unicode_letters() {
        assert_eq!(tags("#café #数据库 #привет #über/größe"), vec!["café", "数据库", "привет", "über/größe"]);
        assert_eq!(tags("#e\u{301}te"), vec!["e\u{301}te"]);
    }

    #[test]
    fn not_inside_words_urls_or_entities() {
        assert!(tags("abc#def").is_empty());
        assert!(tags("https://example.com/page#section").is_empty());
        assert!(tags("&#123; &#x1F;").is_empty());
        assert!(tags("##double").is_empty());
        assert!(tags("# heading and # alone").is_empty());
        assert!(tags("a/#b").is_empty());
    }

    #[test]
    fn numbers_and_hex_colours_are_not_tags() {
        assert!(tags("#123 #2024 #1/2 #2024/10").is_empty());
        assert!(tags("colour #ff00aa and #1e1e1e and #a1b and #ABCDEF12").is_empty());
        assert_eq!(tags("#bad #add #face #2024q3 #3d"), vec!["bad", "add", "face", "2024q3", "3d"]);
    }

    #[test]
    fn trimming_and_segments() {
        assert_eq!(tags("#todo. #done! #x, #y? #z)"), vec!["todo", "done", "x", "y", "z"]);
        assert_eq!(tags("#a/ #b- #c// #d//e #/f #-g"), vec!["a", "b", "c", "d"]);
        assert_eq!(tags("#a/b/c/"), vec!["a/b/c"]);
        assert_eq!(tags("#_x"), vec!["_x"]);
    }

    #[test]
    fn length_limit() {
        let ok = format!("#{}", "a".repeat(64));
        let long = format!("#{}", "a".repeat(65));
        assert_eq!(tags(&ok).len(), 1);
        assert!(tags(&long).is_empty());
    }

    #[test]
    fn ranges_are_byte_offsets_of_hash_tag() {
        let s = "é #Ab/c!";
        let m = &find_tags(s)[0];
        assert_eq!(&s[m.range.0..m.range.1], "#Ab/c");
    }

    #[test]
    fn keys_fold_case_and_accents_and_nesting() {
        assert_eq!(tag_key("DSA/Café"), "dsa/cafe");
        assert!(key_under("dsa/graphs", "dsa"));
        assert!(key_under("dsa", "dsa"));
        assert!(!key_under("dsabc", "dsa"));
        assert!(!key_under("ds", "dsa"));
    }

    #[test]
    fn splits_tag_filters_from_text() {
        let (t, f) = split_tag_filters("graph TAG:#DSA/Graphs tag:todo  tag:# tag: dijkstra #x");
        assert_eq!(t, "graph dijkstra #x");
        assert_eq!(f, vec!["dsa/graphs", "todo"]);
    }

    #[test]
    fn doc_tags_dedupe_keeping_first_spelling() {
        let t = doc_tags(["#DSA one", "#dsa two #Other", "none"].into_iter());
        let got: Vec<_> = t.iter().map(|d| (&*d.key, &*d.display)).collect();
        assert_eq!(got, vec![("dsa", "DSA"), ("other", "Other")]);
    }
}

/// Splits `tag:#word` filters (case-insensitive prefix) from the free-text part of a query.
pub fn split_tag_filters(q: &str) -> (String, Vec<String>) {
    let mut text = Vec::new();
    let mut filters: Vec<String> = Vec::new();
    for tok in q.split_whitespace() {
        let is_filter = tok.get(..4).is_some_and(|p| p.eq_ignore_ascii_case("tag:"));
        if !is_filter {
            text.push(tok);
            continue;
        }
        let key = tag_key(tok[4..].trim_start_matches('#')).trim_end_matches(['/', '-']).to_string();
        if !key.is_empty() && !filters.contains(&key) {
            filters.push(key);
        }
    }
    (text.join(" "), filters)
}
