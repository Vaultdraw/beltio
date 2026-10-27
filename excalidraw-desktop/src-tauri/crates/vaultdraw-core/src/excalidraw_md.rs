//! Reads the scene out of an Obsidian Excalidraw plugin file (`*.excalidraw.md`).
//!
//! The plugin stores the drawing in a fenced block under `## Drawing`, either as plain JSON
//! (```json) or as LZ-string base64 (```compressed-json, the default). Vaultdraw only reads these
//! files: the plugin keeps ownership of the format, so a save from here could not keep it intact.
//! Text that the plugin keeps only in `## Text Elements` is put back into empty text elements.

use crate::error::{err, Result};
use serde_json::Value;
use std::collections::HashMap;

const MAX_SCENE_CHARS: usize = 64 * 1024 * 1024;

/// The scene JSON of an `.excalidraw.md` file's text.
pub fn extract_scene(text: &str) -> Result<String> {
    extract_scene_with(text, |_, _| None)
}

/// Like [`extract_scene`], with the images the file embeds: `image(id, target)` returns the bytes
/// for an `## Embedded Files` entry (or `None`: the element then shows as a broken image).
pub fn extract_scene_with(text: &str, mut image: impl FnMut(&str, &str) -> Option<Vec<u8>>) -> Result<String> {
    let (compressed, body) = drawing_block(text).ok_or_else(|| {
        err("INVALID_FILE", "No Excalidraw drawing data found in this note (expected a ```json or ```compressed-json block under \"## Drawing\")")
    })?;
    let json = if compressed {
        let packed: String = body.chars().filter(|c| !c.is_whitespace()).collect();
        decompress_base64(&packed).ok_or_else(|| err("INVALID_FILE", "The compressed Excalidraw data is damaged"))?
    } else {
        body.to_string()
    };
    let mut scene: Value = serde_json::from_str(&json).map_err(|_| err("INVALID_FILE", "The Excalidraw data is not valid JSON"))?;
    if !scene.get("elements").is_some_and(Value::is_array) {
        return Err(err("INVALID_FILE", "The Excalidraw data has no elements"));
    }
    restore_text(&mut scene, &text_elements(text));
    for (id, target) in embedded_images(text) {
        if let Some(data) = image(&id, &target) {
            let ext = target.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
            insert_file(&mut scene, &id, &ext, &data);
        }
    }
    serde_json::to_string(&scene).map_err(|e| err("INTERNAL", e.to_string()))
}

/// `## Embedded Files`: `fileId: [[path/to/image.png|100%]]` lines -> (file id, image target).
/// Other kinds of entry (LaTeX, embedded notes) are left out.
pub fn embedded_images(text: &str) -> Vec<(String, String)> {
    let Some(i) = text.find("## Embedded Files") else { return Vec::new() };
    let rest = &text[i + "## Embedded Files".len()..];
    let end = rest.find("\n%%").or_else(|| rest.find("\n## ")).unwrap_or(rest.len());
    let mut out = Vec::new();
    for line in rest[..end].lines() {
        let Some((id, link)) = line.trim().split_once(": ") else { continue };
        let link = link.trim().trim_start_matches('!');
        let Some(inner) = link.strip_prefix("[[").and_then(|l| l.strip_suffix("]]")) else { continue };
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        let ext = target.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        if !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') && mime_of(&ext).is_some() {
            out.push((id.to_string(), target.to_string()));
        }
    }
    out
}

/// The MIME type a drawing can hold for an image extension.
pub fn mime_of(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Standard base64 with padding.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(B64[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Puts `data` (an image's bytes) into the scene's `files` under `id`.
pub fn insert_file(scene: &mut Value, id: &str, ext: &str, data: &[u8]) {
    let Some(mime) = mime_of(ext) else { return };
    let Some(obj) = scene.as_object_mut() else { return };
    let files = obj.entry("files").or_insert_with(|| Value::Object(Default::default()));
    if let Some(files) = files.as_object_mut() {
        files.insert(
            id.to_string(),
            serde_json::json!({ "mimeType": mime, "id": id, "dataURL": format!("data:{mime};base64,{}", base64_encode(data)), "created": 0 }),
        );
    }
}

/// `(compressed, block body)` of the first json / compressed-json fence after `## Drawing`.
fn drawing_block(text: &str) -> Option<(bool, &str)> {
    let from = text.find("## Drawing").unwrap_or(0);
    let rest = &text[from..];
    let (compressed, start) = ["```compressed-json", "```json"]
        .iter()
        .filter_map(|tag| rest.find(tag).map(|i| (*tag == "```compressed-json", i + tag.len())))
        .min_by_key(|(_, i)| *i)?;
    let after = &rest[start..];
    let body_start = after.find('\n')? + 1;
    let body = &after[body_start..];
    let end = body.find("```")?;
    Some((compressed, body[..end].trim()))
}

/// `## Text Elements`: `text ^id` entries (the text may span lines) -> id to text.
fn text_elements(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(i) = text.find("## Text Elements") else { return out };
    let rest = &text[i + "## Text Elements".len()..];
    let end = rest.find("\n%%").or_else(|| rest.find("\n## ")).unwrap_or(rest.len());
    let mut acc = String::new();
    for line in rest[..end].lines() {
        match line.rsplit_once(" ^") {
            Some((t, id)) if !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') => {
                if !acc.is_empty() {
                    acc.push('\n');
                }
                acc.push_str(t);
                out.insert(id.to_string(), std::mem::take(&mut acc));
            }
            _ => {
                if !(acc.is_empty() && line.is_empty()) {
                    if !acc.is_empty() {
                        acc.push('\n');
                    }
                    acc.push_str(line);
                }
            }
        }
    }
    out
}

fn restore_text(scene: &mut Value, texts: &HashMap<String, String>) {
    if texts.is_empty() {
        return;
    }
    let Some(elements) = scene.get_mut("elements").and_then(Value::as_array_mut) else { return };
    for el in elements {
        if el["type"] != "text" || el["text"].as_str().is_some_and(|t| !t.is_empty()) {
            continue;
        }
        if let Some(t) = el["id"].as_str().and_then(|id| texts.get(id)) {
            el["text"] = Value::String(t.clone());
            if el.get("originalText").is_some_and(|o| o.as_str() == Some("")) || el.get("originalText").is_none() {
                el["originalText"] = Value::String(t.clone());
            }
        }
    }
}

const B64: &[u8; 65] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

/// LZ-string `decompressFromBase64`. `None` for damaged data or output past the size cap.
pub fn decompress_base64(input: &str) -> Option<String> {
    let vals: Vec<u8> = input.bytes().map(|b| B64.iter().position(|c| *c == b).map(|p| p as u8)).collect::<Option<_>>()?;
    let units = decompress(&vals)?;
    String::from_utf16(&units).ok()
}

struct Bits<'a> {
    vals: &'a [u8],
    val: u32,
    pos: u32,
    idx: usize,
}

impl Bits<'_> {
    fn next_val(&self, i: usize) -> u32 {
        self.vals.get(i).map_or(0, |v| u32::from(*v))
    }
    fn read(&mut self, n: u32) -> u32 {
        let mut bits = 0;
        for k in 0..n {
            let b = self.val & self.pos;
            self.pos >>= 1;
            if self.pos == 0 {
                self.pos = 32;
                self.val = self.next_val(self.idx);
                self.idx += 1;
            }
            if b > 0 {
                bits |= 1 << k;
            }
        }
        bits
    }
}

fn decompress(vals: &[u8]) -> Option<Vec<u16>> {
    if vals.is_empty() {
        return None;
    }
    let mut r = Bits { vals, val: u32::from(vals[0]), pos: 32, idx: 1 };
    let mut dict: Vec<Vec<u16>> = vec![vec![0], vec![1], vec![2]];
    let first = match r.read(2) {
        0 => r.read(8) as u16,
        1 => r.read(16) as u16,
        _ => return Some(Vec::new()),
    };
    dict.push(vec![first]);
    let mut w = vec![first];
    let mut out: Vec<u16> = vec![first];
    let mut enlarge_in: u32 = 4;
    let mut num_bits: u32 = 3;
    loop {
        if r.idx > vals.len() {
            return None;
        }
        let mut c = r.read(num_bits) as usize;
        match c {
            0 => {
                let ch = r.read(8) as u16;
                dict.push(vec![ch]);
                c = dict.len() - 1;
                enlarge_in -= 1;
            }
            1 => {
                let ch = r.read(16) as u16;
                dict.push(vec![ch]);
                c = dict.len() - 1;
                enlarge_in -= 1;
            }
            2 => return Some(out),
            _ => {}
        }
        if enlarge_in == 0 {
            enlarge_in = 1 << num_bits;
            num_bits += 1;
        }
        let entry = if c < dict.len() {
            dict[c].clone()
        } else if c == dict.len() {
            let mut e = w.clone();
            e.push(w[0]);
            e
        } else {
            return None;
        };
        out.extend_from_slice(&entry);
        if out.len() > MAX_SCENE_CHARS {
            return None;
        }
        let mut next = w;
        next.push(entry[0]);
        dict.push(next);
        enlarge_in -= 1;
        w = entry;
        if enlarge_in == 0 {
            enlarge_in = 1 << num_bits;
            num_bits += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPRESSED: &str = include_str!("../../../../src/vault/fixtures/obsidian-vault/Drawings/Compressed.excalidraw.md");
    const PLAIN: &str = include_str!("../../../../src/vault/fixtures/obsidian-vault/Drawings/Plain.excalidraw.md");

    #[test]
    fn compressed_and_plain_give_the_same_scene() {
        let a: Value = serde_json::from_str(&extract_scene(COMPRESSED).unwrap()).unwrap();
        let b: Value = serde_json::from_str(&extract_scene(PLAIN).unwrap()).unwrap();
        assert_eq!(a, b);
        assert_eq!(a["elements"].as_array().unwrap().len(), 2);
        assert_eq!(a["elements"][1]["text"], "Héllo ✓ wörld");
    }

    #[test]
    fn embedded_images_are_listed_and_put_into_files() {
        let md = "## Embedded Files\nab12: [[pics/a b.png|100%]]\ncd34: [[Other note]]\nef56: $$x^2$$\n\n%%\n## Drawing\n```json\n{\"elements\":[{\"id\":\"i\",\"type\":\"image\",\"fileId\":\"ab12\"}]}\n```\n%%\n";
        assert_eq!(embedded_images(md), vec![("ab12".to_string(), "pics/a b.png".to_string())]);
        let mut asked = Vec::new();
        let v: Value = serde_json::from_str(
            &extract_scene_with(md, |id, t| {
                asked.push((id.to_string(), t.to_string()));
                Some(vec![1, 2, 3, 4])
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(v["files"]["ab12"]["dataURL"], "data:image/png;base64,AQIDBA==");
        assert_eq!(v["files"]["ab12"]["mimeType"], "image/png");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn restores_empty_text_from_the_text_elements_section() {
        let md = "# Excalidraw Data\n\n## Text Elements\nfirst line\nsecond ^t1\n\n%%\n## Drawing\n```json\n{\"elements\":[{\"id\":\"t1\",\"type\":\"text\",\"text\":\"\"}]}\n```\n%%\n";
        let v: Value = serde_json::from_str(&extract_scene(md).unwrap()).unwrap();
        assert_eq!(v["elements"][0]["text"], "first line\nsecond");
    }

    #[test]
    fn unsupported_or_damaged_files_are_clear_errors() {
        assert_eq!(extract_scene("# just a note\n").unwrap_err().code, "INVALID_FILE");
        assert_eq!(extract_scene("## Drawing\n```compressed-json\n!!!\n```\n").unwrap_err().code, "INVALID_FILE");
        assert_eq!(extract_scene("## Drawing\n```compressed-json\nN4Ig\n```\n").unwrap_err().code, "INVALID_FILE");
        assert_eq!(extract_scene("## Drawing\n```json\n{\"a\":1}\n```\n").unwrap_err().code, "INVALID_FILE");
    }

    #[test]
    fn lz_string_matches_the_reference_implementation() {
        // Values from lz-string 1.x compressToBase64.
        assert_eq!(decompress_base64("BYUwNmD2AEoTcpA=").as_deref(), Some("hello hello hello"));
        assert_eq!(decompress_base64("BYS4NmD2AEjI5NB3AbwJzAEyA===").as_deref(), Some("héllo ✓ wörld"));
        assert_eq!(decompress_base64("Q===").as_deref(), Some(""));
    }
}
