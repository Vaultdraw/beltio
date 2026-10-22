//! Pure-ASCII transport form of JSON text for the webview.
//!
//! JavaScriptCore keeps a string as 1 byte/char only when every char is Latin-1; a single
//! non-Latin-1 char makes the whole decoded drawing (and every string `JSON.parse` makes from it)
//! 2 bytes/char. Text crossing into the webview therefore has every non-ASCII char written as a
//! JSON `\uXXXX` escape (equivalent JSON), and the write path turns them back into raw UTF-8 so
//! files on disk are unchanged.

use std::borrow::Cow;

const HEX: &[u8; 16] = b"0123456789abcdef";

fn push_unit(out: &mut Vec<u8>, unit: u16) {
    out.extend_from_slice(&[
        b'\\', b'u',
        HEX[(unit >> 12) as usize & 0xf], HEX[(unit >> 8) as usize & 0xf],
        HEX[(unit >> 4) as usize & 0xf], HEX[unit as usize & 0xf],
    ]);
}

/// Replaces every non-ASCII char of valid UTF-8 JSON text by lowercase `\uXXXX` escapes (astral
/// chars as a surrogate pair). Borrowed (zero copy) when the input is already ASCII.
pub fn escape_non_ascii(json: &[u8]) -> Cow<'_, [u8]> {
    let Some(first) = json.iter().position(|b| *b >= 0x80) else { return Cow::Borrowed(json) };
    let lead = json[first..].iter().filter(|b| **b >= 0xC0).count();
    let mut out = Vec::with_capacity(json.len() + 5 * lead);
    out.extend_from_slice(&json[..first]);
    let mut i = first;
    while i < json.len() {
        let b = json[i];
        if b < 0x80 { out.push(b); i += 1; continue; }
        let (len, init) = match b {
            0xC0..=0xDF => (2, (b & 0x1F) as u32),
            0xE0..=0xEF => (3, (b & 0x0F) as u32),
            0xF0..=0xF7 => (4, (b & 0x07) as u32),
            _ => { out.push(b); i += 1; continue; } // stray continuation byte: invalid input, copy
        };
        if i + len > json.len() { out.extend_from_slice(&json[i..]); break; }
        let mut cp = init;
        for k in 1..len { cp = (cp << 6) | (json[i + k] & 0x3F) as u32; }
        if cp >= 0x10000 {
            let c = cp - 0x10000;
            push_unit(&mut out, 0xD800 | (c >> 10) as u16);
            push_unit(&mut out, 0xDC00 | (c & 0x3FF) as u16);
        } else {
            push_unit(&mut out, cp as u16);
        }
        i += len;
    }
    Cow::Owned(out)
}

fn hex4(s: &[u8]) -> Option<u16> {
    if s.len() < 4 { return None; }
    let mut v = 0u16;
    for &c in &s[..4] {
        v = (v << 4) | (c as char).to_digit(16)? as u16;
    }
    Some(v)
}

fn has_u_escape(json: &[u8]) -> bool { json.windows(2).any(|w| w == b"\\u") }

/// Inverse of [`escape_non_ascii`] for the write path: `\uXXXX` escapes (and surrogate pairs) that
/// decode to a scalar >= U+0080 become raw UTF-8; everything else (including `\u001f`, lone
/// surrogates, and `\\u2014`) is kept as is. Borrowed when nothing converts.
pub fn unescape_non_ascii(json: &[u8]) -> Cow<'_, [u8]> {
    if !has_u_escape(json) { return Cow::Borrowed(json); }
    let mut out: Option<Vec<u8>> = None;
    let mut copied = 0; // json[..copied] already in `out`
    let mut i = 0;
    while i < json.len() {
        if json[i] != b'\\' { i += 1; continue; }
        if json.get(i + 1) != Some(&b'u') { i += 2; continue; }
        let Some(unit) = hex4(&json[i + 2..]) else { i += 2; continue };
        let mut end = i + 6;
        let scalar = if (0xD800..0xDC00).contains(&unit) {
            match (json.get(end..end + 2), hex4(json.get(end + 2..).unwrap_or(&[]))) {
                (Some(b"\\u"), Some(lo)) if (0xDC00..0xE000).contains(&lo) => {
                    end += 6;
                    Some(0x10000 + (((unit as u32) - 0xD800) << 10) + (lo as u32 - 0xDC00))
                }
                _ => None,
            }
        } else if (0xDC00..0xE000).contains(&unit) { None } else { Some(unit as u32) };
        match scalar.and_then(char::from_u32).filter(|c| *c as u32 >= 0x80) {
            Some(c) => {
                let o = out.get_or_insert_with(|| Vec::with_capacity(json.len()));
                o.extend_from_slice(&json[copied..i]);
                let mut buf = [0u8; 4];
                o.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                copied = end;
                i = end;
            }
            None => i += 6,
        }
    }
    match out {
        None => Cow::Borrowed(json),
        Some(mut o) => { o.extend_from_slice(&json[copied..]); Cow::Owned(o) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn esc(s: &str) -> Vec<u8> { escape_non_ascii(s.as_bytes()).into_owned() }

    #[test]
    fn ascii_is_borrowed() {
        assert!(matches!(escape_non_ascii(br#"{"a":"b\u00e9"}"#), Cow::Borrowed(_)));
        assert!(matches!(unescape_non_ascii(br#"{"a":"b"}"#), Cow::Borrowed(_)));
        assert!(matches!(unescape_non_ascii(br#"{"a":"\u001f\"\\"}"#), Cow::Borrowed(_)));
    }

    #[test]
    fn em_dash_round_trips_with_lowercase_hex() {
        let s = "\"a \u{2014} b \u{00E9}\"";
        assert_eq!(esc(s), br#""a \u2014 b \u00e9""#);
        assert_eq!(&*unescape_non_ascii(&esc(s)), s.as_bytes());
        assert!(esc("\"\u{ABCD}\"").windows(6).any(|w| w == b"\\uabcd"));
    }

    #[test]
    fn astral_uses_surrogate_pair() {
        let s = "\"x \u{1F600} y\"";
        assert_eq!(esc(s), br#""x \ud83d\ude00 y""#);
        assert_eq!(&*unescape_non_ascii(&esc(s)), s.as_bytes());
    }

    #[test]
    fn escaped_backslash_is_untouched() {
        let s = br#""\\u2014 and \\\\u00e9""#;
        assert!(matches!(unescape_non_ascii(s), Cow::Borrowed(_)));
        assert_eq!(&*unescape_non_ascii(br#""\\u2014 \u2014""#), "\"\\\\u2014 \u{2014}\"".as_bytes());
    }

    #[test]
    fn lone_surrogates_and_control_stay_escaped() {
        for s in [&br#""\udc00""#[..], br#""\ud800""#, br#""\ud800x""#, br#""\ud800\u0041""#, br#""\u0041""#, br#""\u001f""#, br#""\u007f""#] {
            assert_eq!(&*unescape_non_ascii(s), s);
        }
        // High surrogate followed by a convertible escape: only the second converts.
        assert_eq!(&*unescape_non_ascii(br#""\ud800\u00e9""#), "\"\\ud800\u{e9}\"".as_bytes());
    }

    #[test]
    fn uppercase_hex_unescapes() {
        assert_eq!(&*unescape_non_ascii(br#""\u00C9\uD83D\uDE00""#), "\"\u{c9}\u{1F600}\"".as_bytes());
    }

    #[test]
    fn malformed_input_does_not_panic() {
        for s in [&b"\\"[..], b"\\u", b"\\u12", b"\\u12g4", b"\\ud83d\\u", b"\\ud83d\\ude0", b"\"\\ud83d\\ude00", b"abc\\u00e", b"\\\\u"] {
            let _ = unescape_non_ascii(s);
        }
        // Truncated / invalid UTF-8 handed to escape must not panic either.
        for s in [&b"\xE2\x80"[..], b"\xF0\x9F", b"\x80\x80", b"a\xFF", b"\xC3"] {
            let _ = escape_non_ascii(s);
        }
        assert_eq!(&*unescape_non_ascii(b"\"\\u00e"), b"\"\\u00e");
    }

    const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[
        {"id":"a","type":"text","text":"日本語 — café 😀 \"q\" \\u2014 tab\t","x":1},
        {"id":"b","type":"text","text":"Ünïcödé 𝔘 \u0001 end","x":2}],
        "files":{"f":{"dataURL":"data:image/png;base64,AAAA"}}}"#;

    #[test]
    fn escaped_scene_is_ascii_and_equivalent() {
        let e = escape_non_ascii(SCENE.as_bytes());
        assert!(e.is_ascii());
        let a: serde_json::Value = serde_json::from_str(SCENE).unwrap();
        let b: serde_json::Value = serde_json::from_slice(&e).unwrap();
        assert_eq!(a, b);
        assert_eq!(&*unescape_non_ascii(&e), SCENE.as_bytes());
    }

    #[test]
    fn matches_js_escaping_per_utf16_unit() {
        let s = "\"\u{80}\u{7ff}\u{800}\u{ffff}\u{10000}\u{10ffff}\"";
        let js: String = s.chars().map(|c| {
            let mut b = [0u16; 2];
            c.encode_utf16(&mut b).iter().map(|u| if *u >= 0x80 { format!("\\u{u:04x}") } else { (*u as u8 as char).to_string() }).collect::<String>()
        }).collect();
        assert_eq!(esc(s), js.as_bytes());
    }

    #[test]
    fn random_strings_round_trip() {
        let mut seed = 0x9E3779B97F4A7C15u64;
        let mut next = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
        for _ in 0..500 {
            let n = (next() % 40) as usize;
            let s: String = (0..n).map(|_| {
                let r = next();
                let cp = match r % 6 {
                    0 => (r >> 8) as u32 % 0x80,
                    1 => 0x80 + (r >> 8) as u32 % 0x780,
                    2 => 0x800 + (r >> 8) as u32 % 0xF800,
                    3 => 0x10000 + (r >> 8) as u32 % 0x100000,
                    4 => [0x22, 0x5c, 0x75, 0x2f][(r >> 8) as usize % 4],
                    _ => 0x2014,
                };
                char::from_u32(cp).unwrap_or('?')
            }).collect();
            let json = serde_json::to_string(&s).unwrap();
            let e = escape_non_ascii(json.as_bytes());
            assert!(e.is_ascii());
            assert_eq!(serde_json::from_slice::<String>(&e).unwrap(), s);
            assert_eq!(&*unescape_non_ascii(&e), json.as_bytes(), "{json}");
        }
    }
}
