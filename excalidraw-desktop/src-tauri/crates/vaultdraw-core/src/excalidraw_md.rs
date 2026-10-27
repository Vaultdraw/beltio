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
    serde_json::to_string(&scene).map_err(|e| err("INTERNAL", e.to_string()))
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
