//! Text normalisation shared by the index and by queries (DECISIONS.md #4).
//!
//! Each run of a base character plus its combining marks / conjoining jamo is composed (NFC)
//! first, so decomposed kana (か + U+3099) and Hangul jamo match the composed form a query uses.
//! NFKD (NFKC for kana), drop combining marks for Latin/Greek/Cyrillic-style ranges (never
//! U+3099/U+309A, so `が` stays distinct from `か`), lowercase, a small fold map,
//! katakana to hiragana, Hangul syllables kept whole, whitespace collapsed.

use unicode_normalization::UnicodeNormalization;

/// Bump whenever the rules above change; a mismatch rebuilds persisted indexes.
pub const NORMALIZER_VERSION: u32 = 2;

fn is_strippable_mark(c: char) -> bool {
    matches!(c, '\u{300}'..='\u{36F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}' | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}')
}

fn fold_lowered(c: char, out: &mut impl FnMut(char)) {
    match c {
        _ if is_strippable_mark(c) => {}
        'ß' => {
            out('s');
            out('s');
        }
        'æ' => {
            out('a');
            out('e');
        }
        'œ' => {
            out('o');
            out('e');
        }
        'ø' => out('o'),
        'ł' => out('l'),
        'đ' => out('d'),
        'ı' => out('i'),
        // Katakana letters and iteration marks to hiragana.
        '\u{30A1}'..='\u{30F6}' | '\u{30FD}'..='\u{30FE}' => out(char::from_u32(c as u32 - 0x60).unwrap_or(c)),
        _ => out(c),
    }
}

/// Normalises one original (non-whitespace) char, calling `out` for each result char.
pub fn fold_char(c: char, out: &mut impl FnMut(char)) {
    if c.is_ascii() {
        out(c.to_ascii_lowercase());
    } else if ('\u{AC00}'..='\u{D7A3}').contains(&c) {
        out(c);
    } else if ('\u{3040}'..='\u{30FF}').contains(&c) {
        // Kana is composed (NFKC) so が stays one char and a query か does not match inside it.
        for d in std::iter::once(c).nfkc() {
            fold_lowered(d, out);
        }
    } else {
        for d in std::iter::once(c).nfkd() {
            for l in d.to_lowercase() {
                fold_lowered(l, out);
            }
        }
    }
}

/// True for a char that continues the cluster before it: a combining mark (kana voicing marks
/// included) or a conjoining Hangul vowel/final jamo.
fn continues_cluster(c: char) -> bool {
    !c.is_ascii()
        && (unicode_normalization::char::canonical_combining_class(c) != 0 || matches!(c, '\u{1160}'..='\u{11FF}' | '\u{D7B0}'..='\u{D7FF}'))
}

/// Folds one cluster (a char and the marks after it), composing it first when it has several chars.
fn fold_cluster(cluster: &[char], out: &mut impl FnMut(char)) {
    if let [c] = cluster {
        fold_char(*c, out);
    } else {
        for c in cluster.iter().copied().collect::<String>().nfc() {
            fold_char(c, out);
        }
    }
}

/// The exact normalisation used by the index. Whitespace runs (including
/// newlines) collapse to one space; leading/trailing whitespace is dropped.
pub fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    let mut it = s.chars().peekable();
    let mut cluster: Vec<char> = Vec::new();
    while let Some(c) = it.next() {
        if c.is_whitespace() {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        cluster.clear();
        cluster.push(c);
        while let Some(&n) = it.peek() {
            if n.is_whitespace() || !continues_cluster(n) {
                break;
            }
            cluster.push(n);
            it.next();
        }
        fold_cluster(&cluster, &mut |d| out.push(d));
    }
    out
}

/// A normalised string plus the mapping back to the (whitespace-collapsed)
/// original chars, used to place highlights on the original text.
pub struct Folded {
    pub norm: String,
    /// Original chars with whitespace runs collapsed to one space and trimmed.
    pub chars: Vec<char>,
    /// Normalised byte offset where each char's piece starts, plus a final sentinel.
    pub starts: Vec<u32>,
}

pub fn fold_with_map(s: &str) -> Folded {
    let mut norm = String::with_capacity(s.len());
    let mut chars = Vec::with_capacity(s.len());
    let mut starts = Vec::with_capacity(s.len() + 1);
    let mut pending_space = false;
    let mut it = s.chars().peekable();
    let mut cluster: Vec<char> = Vec::new();
    while let Some(c) = it.next() {
        if c.is_whitespace() {
            pending_space = !chars.is_empty();
            continue;
        }
        if pending_space {
            chars.push(' ');
            starts.push(norm.len() as u32);
            norm.push(' ');
            pending_space = false;
        }
        cluster.clear();
        cluster.push(c);
        while let Some(&n) = it.peek() {
            if n.is_whitespace() || !continues_cluster(n) {
                break;
            }
            cluster.push(n);
            it.next();
        }
        // The folded cluster belongs to its first char; the marks after it have empty pieces.
        chars.push(c);
        starts.push(norm.len() as u32);
        fold_cluster(&cluster, &mut |d| norm.push(d));
        for &m in &cluster[1..] {
            chars.push(m);
            starts.push(norm.len() as u32);
        }
    }
    starts.push(norm.len() as u32);
    Folded { norm, chars, starts }
}

impl Folded {
    /// Maps normalised byte ranges to `[start, end)` ranges of `chars`.
    pub fn char_ranges(&self, byte_ranges: &[(usize, usize)]) -> Vec<(usize, usize)> {
        let n = self.chars.len();
        byte_ranges
            .iter()
            .filter_map(|&(a, b)| {
                let first = self.starts[..n].partition_point(|&s| (s as usize) <= a).saturating_sub(1);
                let mut end = self.starts.partition_point(|&s| (s as usize) < b).min(n);
                // Marks after the last char (empty pieces) are part of the highlight.
                while end < n && self.starts[end] == self.starts[end + 1] {
                    end += 1;
                }
                (end > first).then_some((first, end))
            })
            .collect()
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn decomposed_kana_and_hangul_match_the_composed_query() {
        // か + U+3099 (NFD が), ハ + U+309A (NFD パ), conjoining jamo for 한글.
        assert_eq!(normalize("か\u{3099}っこう"), normalize("がっこう"));
        assert_eq!(normalize("ガイド"), normalize("カ\u{3099}イド"));
        assert_eq!(normalize("ハ\u{309A}"), normalize("パ"));
        assert_eq!(normalize("\u{1112}\u{1161}\u{11AB}\u{1100}\u{1173}\u{11AF}"), normalize("한글"));
        assert_eq!(normalize("e\u{301}x A\u{30A}"), normalize("éx Å"));
        assert_ne!(normalize("が"), normalize("か"));
        // The map stays aligned: the mark belongs to its base char and the highlight covers both.
        let f = fold_with_map("x か\u{3099}っ");
        assert_eq!(f.chars.len(), 5);
        assert_eq!(f.norm, "x がっ");
        let at = f.norm.find('が').unwrap();
        assert_eq!(f.char_ranges(&[(at, at + 'が'.len_utf8())]), vec![(2, 4)]);
    }

    #[test]
    fn folds_accents_case_and_special_letters() {
        assert_eq!(normalize("Café Crème"), "cafe creme");
        assert_eq!(normalize("Straße"), "strasse");
        assert_eq!(normalize("Ærø Łódź Đ"), "aero lodz d");
        assert_eq!(normalize("Привет Йё"), "привет ие");
    }

    #[test]
    fn folds_width_and_ligatures() {
        assert_eq!(normalize("ＡＢＣ１２３"), "abc123");
        assert_eq!(normalize("ﬁnal"), "final");
    }

    #[test]
    fn leaves_cjk_alone_and_keeps_dakuten() {
        assert_eq!(normalize("数据库"), "数据库");
        assert_ne!(normalize("が"), normalize("か"));
        assert_eq!(normalize("한국어"), "한국어");
        assert_eq!(normalize("カフェ"), normalize("かふぇ"));
        assert_eq!(normalize("ガ"), normalize("が"));
    }

    #[test]
    fn collapses_whitespace() {
        assert_eq!(normalize("  a \n\t b\u{00A0}c  "), "a b c");
        assert_eq!(normalize("   "), "");
    }

    #[test]
    fn folded_matches_plain_normalisation() {
        for s in ["Hello  World", "Café\nau lait", "  ｆｕｌｌ  ", "ß ø 日本語", "e\u{301}x", "😀 ok"] {
            assert_eq!(fold_with_map(s).norm, normalize(s), "{s:?}");
        }
    }

    #[test]
    fn maps_ranges_back_to_original_chars() {
        let f = fold_with_map("Straße x");
        // "strasse x": bytes 4..6 are the "ss" that came from ß (char 4).
        let r = f.char_ranges(&[(4, 6)]);
        assert_eq!(r, vec![(4, 5)]);
        let f = fold_with_map("a  b");
        assert_eq!(f.chars.iter().collect::<String>(), "a b");
        assert_eq!(f.char_ranges(&[(2, 3)]), vec![(2, 3)]);
    }
}
