//! Link grammar (shared fixtures: `fixtures/grammar.json`, asserted by Rust and TS).
//!
//! Text: `[[target]]` and `[[target|label]]` on one line, at most 256 chars between the
//! brackets, no `[` or lone `]` inside, non-blank target; a `.excalidraw` suffix is stripped.
//! Link field of an element: `[[x]]`, `vaultdraw://open?file=<percent-encoded>`, or a
//! relative `./x.excalidraw` / `x.excalidraw`. `http(s)://…` and `/abs` are not drawing links.

use memchr::{memchr3, memmem};
use std::sync::OnceLock;

pub const MAX_BODY_CHARS: usize = 256;
pub const EXT: &str = ".excalidraw";
pub const VAULT_URL: &str = "vaultdraw://open?";
/// Longest scanned body: 256 chars of up to 4 bytes, plus the closing brackets.
const SCAN_BYTES: usize = MAX_BODY_CHARS * 4 + 2;

pub fn strip_ext(s: &str) -> &str {
    let cut = s.len().saturating_sub(EXT.len());
    match s.get(cut..) {
        Some(e) if e.eq_ignore_ascii_case(EXT) => &s[..cut],
        _ => s,
    }
}

pub fn has_ext(s: &str) -> bool {
    strip_ext(s).len() != s.len()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextLink<'a> {
    /// Byte range of the whole `[[...]]` token.
    pub start: usize,
    pub end: usize,
    /// Byte range of the trimmed target as written (including a `.excalidraw` suffix).
    pub target_range: (usize, usize),
    /// Target without brackets, label or `.excalidraw`.
    pub target: &'a str,
    pub label: Option<&'a str>,
}

fn opener() -> &'static memmem::Finder<'static> {
    static F: OnceLock<memmem::Finder<'static>> = OnceLock::new();
    F.get_or_init(|| memmem::Finder::new("[["))
}

/// Calls `f` for every link in `text`, in order.
pub fn text_links<'a>(text: &'a str, mut f: impl FnMut(TextLink<'a>)) {
    let b = text.as_bytes();
    let mut pos = 0;
    while let Some(i) = opener().find(&b[pos..]) {
        let start = pos + i;
        let bs = start + 2;
        let lim = b.len().min(bs + SCAN_BYTES);
        let Some(j) = memchr3(b']', b'\n', b'[', &b[bs..lim]) else {
            pos = bs;
            continue;
        };
        match b[bs + j] {
            b'[' => pos = bs + j - 1,
            b']' if b.get(bs + j + 1) == Some(&b']') => {
                pos = bs;
                if let Some(link) = parse_body(text, start, bs, bs + j) {
                    pos = link.end;
                    f(link);
                }
            }
            _ => pos = bs + j,
        }
    }
}

fn parse_body(text: &str, start: usize, bs: usize, be: usize) -> Option<TextLink<'_>> {
    let body = &text[bs..be];
    if body.contains('\r') || (body.len() > MAX_BODY_CHARS && body.chars().count() > MAX_BODY_CHARS) {
        return None;
    }
    let (left, label) = match body.find('|') {
        Some(p) => (&body[..p], Some(body[p + 1..].trim()).filter(|l| !l.is_empty())),
        None => (body, None),
    };
    let lead = left.len() - left.trim_start().len();
    let written = left.trim();
    let target = strip_ext(written).trim_end();
    if target.is_empty() {
        return None;
    }
    let ts = bs + lead;
    Some(TextLink { start, end: be + 2, target_range: (ts, ts + written.len()), target, label })
}

pub fn text_links_vec(text: &str) -> Vec<TextLink<'_>> {
    let mut v = Vec::new();
    text_links(text, |l| v.push(l));
    v
}

/// UTF-16 length of `text[..byte]`.
pub fn utf16_len_of(text: &str, byte: usize) -> u32 {
    text[..byte].chars().map(|c| c.len_utf16() as u32).sum()
}

// ---- percent encoding (encodeURIComponent, `/` kept) ----

pub fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn pct_encode(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for &c in s.as_bytes() {
        if c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' | b'/') {
            o.push(c as char);
        } else {
            o.push_str(&format!("%{c:02X}"));
        }
    }
    o
}

// ---- element link field ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldForm {
    /// `[[x]]`
    Wiki,
    /// `vaultdraw://open?file=x`
    Url,
    /// `./x.excalidraw`, `x.excalidraw`
    Rel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldLink {
    /// Without `.excalidraw`; relative targets keep their `./` / `../` prefix.
    pub target: String,
    pub form: FieldForm,
    pub label: Option<String>,
}

fn has_scheme(s: &str) -> bool {
    let mut it = s.char_indices();
    match it.next() {
        Some((_, c)) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    for (_, c) in it {
        match c {
            ':' => return true,
            c if c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-') => {}
            _ => return false,
        }
    }
    false
}

/// The value of the `file` (or legacy `path`) parameter of a `vaultdraw://open?` URL.
pub fn url_file_param(query: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        matches!(k, "file" | "path").then(|| pct_decode(v))
    })
}

pub fn parse_link_field(s: &str) -> Option<FieldLink> {
    let s = s.trim();
    if let Some(q) = s.strip_prefix(VAULT_URL) {
        let file = url_file_param(q)?;
        let target = strip_ext(file.trim()).trim();
        return (!target.is_empty()).then(|| FieldLink { target: target.to_string(), form: FieldForm::Url, label: None });
    }
    if s.starts_with("[[") {
        let l = text_links_vec(s).into_iter().next().filter(|l| l.start == 0)?;
        return Some(FieldLink { target: l.target.to_string(), form: FieldForm::Wiki, label: l.label.map(str::to_string) });
    }
    if s.starts_with('/') || s.starts_with('\\') || has_scheme(s) || !has_ext(s) {
        return None;
    }
    let target = strip_ext(s);
    (!target.is_empty() && !target.ends_with('/')).then(|| FieldLink { target: target.to_string(), form: FieldForm::Rel, label: None })
}
