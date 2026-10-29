//! What picture a download or paste holds, by its bytes (PNG, JPEG, GIF, WebP, SVG).
//! TypeScript twin: `sdk/api/shared/sceneRules.ts` (`pictureType`, `isSvgDocument`); both are
//! pinned by `contract/picture_bytes.json` (hunter B, 2026-10-30: a long comment before `<svg`
//! refused an SVG, and a web page with an inline `<svg>` icon passed as a picture).

/// How far into the bytes the SVG check looks for the root element.
const SVG_PROLOG_BYTES: usize = 64 * 1024;

/// The picture type of `b`, or `None`.
pub fn picture_type(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else if is_svg_document(b) {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// True when the first element is `<svg>` (after a byte order mark, an XML declaration,
/// comments, processing instructions and a doctype).
pub fn is_svg_document(b: &[u8]) -> bool {
    let t = String::from_utf8_lossy(&b[..b.len().min(SVG_PROLOG_BYTES)]);
    let mut s: &str = t.strip_prefix('\u{feff}').unwrap_or(&t);
    loop {
        s = s.trim_start();
        let skip = |s: &str, open: &str, close: &str| s[open.len()..].find(close).map(|e| open.len() + e + close.len());
        let next = if s.starts_with("<!--") {
            skip(s, "<!--", "-->")
        } else if s.starts_with("<?") {
            skip(s, "<?", "?>")
        } else if s.get(..9).is_some_and(|h| h.eq_ignore_ascii_case("<!doctype")) {
            let (gt, sub) = (s.find('>'), s.find('['));
            let close = if sub.is_some_and(|i| gt.is_none_or(|g| i < g)) { "]>" } else { ">" };
            s.find(close).map(|e| e + close.len())
        } else {
            return is_svg_tag(s);
        };
        match next {
            Some(n) => s = &s[n..],
            None => return false,
        }
    }
}

/// `<svg` or `<prefix:svg`, followed by whitespace, `>` or `/`.
fn is_svg_tag(s: &str) -> bool {
    let Some(rest) = s.strip_prefix('<') else { return false };
    let name_end = rest.find(|c: char| c.is_whitespace() || c == '>' || c == '/').unwrap_or(rest.len());
    if name_end == rest.len() {
        return false;
    }
    let name = &rest[..name_end];
    let local = match name.split_once(':') {
        Some((prefix, local)) => {
            let ok = prefix.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && prefix.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
            if !ok {
                return false;
            }
            local
        }
        None => name,
    };
    local == "svg"
}

#[cfg(test)]
mod tests {
    use super::picture_type;

    #[test]
    fn picture_bytes_contract() {
        let table: serde_json::Value = serde_json::from_str(include_str!("contract/picture_bytes.json")).unwrap();
        for c in table["cases"].as_array().unwrap() {
            let bytes: Vec<u8> = match c["hex"].as_str() {
                Some(h) => (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect(),
                None => c["text"].as_str().unwrap_or("").as_bytes().to_vec(),
            };
            assert_eq!(picture_type(&bytes), c["type"].as_str(), "{}", c["name"]);
        }
    }
}
