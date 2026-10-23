//! Drawing JSON to searchable text items. Typed serde structs: unknown fields
//! (appState, `files` image blobs, geometry) are skipped without allocation.

use super::normalize::normalize;
use crate::{err, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Text,
    Frame,
    /// An image element carrying `customData.latex.source` (a LaTeX formula).
    Formula,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextItem {
    pub element_id: Box<str>,
    /// The shape/arrow a bound label belongs to.
    pub container_id: Option<Box<str>>,
    pub kind: ItemKind,
    /// Original (un-normalised) text.
    pub text: Box<str>,
}

/// The `link` field of a live element (any non-empty value, as written).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementLink {
    pub element_id: Box<str>,
    pub link: Box<str>,
}

/// Everything the indexes need from one drawing file.
pub struct Extracted {
    pub items: Vec<TextItem>,
    pub elinks: Vec<ElementLink>,
    /// Content fingerprint, see [`fingerprint8`].
    pub hash8: [u8; 8],
}

#[derive(Deserialize)]
struct Scene<'a> {
    #[serde(default, borrow, rename = "type")]
    kind: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    elements: Vec<El<'a>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct El<'a> {
    #[serde(default, borrow)]
    id: Option<Cow<'a, str>>,
    #[serde(default, borrow, rename = "type")]
    ty: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    text: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    original_text: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    name: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    container_id: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    link: Option<Cow<'a, str>>,
    #[serde(default)]
    is_deleted: Option<bool>,
    /// Any JSON; only `latex.source` is read, other shapes are ignored.
    #[serde(default)]
    custom_data: Option<CustomData<'a>>,
}

/// Tolerant: a `customData` of any other shape deserialises to `Other`, never an error.
#[derive(Deserialize)]
#[serde(untagged)]
enum CustomData<'a> {
    Latex {
        #[serde(borrow)]
        latex: LatexData<'a>,
    },
    Other(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LatexData<'a> {
    Formula {
        #[serde(borrow)]
        source: Cow<'a, str>,
    },
    Other(serde::de::IgnoredAny),
}

/// The formula source of an image element, if it has a non-blank one.
fn formula_source<'a>(el: &'a El<'a>) -> Option<&'a str> {
    match &el.custom_data {
        Some(CustomData::Latex { latex: LatexData::Formula { source } }) => Some(&**source).filter(|t| !t.trim().is_empty()),
        _ => None,
    }
}

fn non_empty<'a>(s: &'a Option<Cow<'a, str>>) -> Option<&'a str> {
    s.as_deref().filter(|t| !t.trim().is_empty())
}

/// Extracts text elements (bound labels use `originalText`, which has no
/// auto-wrap newlines) and frame names. Items that normalise to nothing are dropped.
#[cfg_attr(not(test), allow(dead_code))] // production indexing uses `extract_doc`; tests and benches use this
pub fn extract_items(json: &[u8]) -> Result<Vec<TextItem>> {
    Ok(parse_scene(json)?.0)
}

/// Bytes hashed from each end of a file by [`fingerprint8`].
const FINGERPRINT_EDGE: usize = 4096;

/// First 8 bytes of SHA-256 over the file length and its first and last 4 KiB.
///
/// A full-file SHA-256 would cost +200% on the cold index build of a vault with image blobs
/// (measured: 262 ms vs 123 ms of parsing for 5000 files / 822 MB; far worse on Macs without
/// SHA hardware), against +3% for this. It identifies a file that moved unchanged (equal
/// length, head and tail); it is not a revision and never compared with one.
pub fn fingerprint8(bytes: &[u8]) -> [u8; 8] {
    fingerprint_parts(bytes.len() as u64, &bytes[..bytes.len().min(FINGERPRINT_EDGE)], &bytes[bytes.len().saturating_sub(FINGERPRINT_EDGE)..])
}

/// [`fingerprint8`] from a file's length, its first `min(len, 4096)` bytes and its last
/// `min(len, 4096)` bytes, so a reader that skips the middle gets the same value.
pub fn fingerprint_parts(len: u64, head: &[u8], tail: &[u8]) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(len.to_le_bytes());
    h.update(head);
    h.update(tail);
    let mut out = [0u8; 8];
    out.copy_from_slice(&h.finalize()[..8]);
    out
}

/// Bytes of each end that [`fingerprint_parts`] needs.
pub const FINGERPRINT_EDGE_BYTES: usize = FINGERPRINT_EDGE;

/// Items, element links and the content fingerprint of one drawing file.
pub fn extract_doc(json: &[u8]) -> Result<Extracted> {
    let (items, elinks) = parse_scene(json)?;
    Ok(Extracted { items, elinks, hash8: fingerprint8(json) })
}

fn parse_scene(json: &[u8]) -> Result<(Vec<TextItem>, Vec<ElementLink>)> {
    match parse_scene_prefix(json, true) {
        Prefix::Done(v) => Ok(v),
        Prefix::Invalid(e) => Err(e),
        Prefix::NeedMore => Err(err("INVALID_FILE", "Invalid JSON: unexpected end of file")),
    }
}

/// Result of [`parse_scene_prefix`].
pub enum Prefix {
    Done((Vec<TextItem>, Vec<ElementLink>)),
    /// The prefix ended inside the scene before `type` and `elements` were both read.
    NeedMore,
    Invalid(crate::NativeError),
}

/// Marks the deliberate early exit of [`StopVisitor`].
const STOP: &str = "vaultdraw: scene read, rest skipped";

/// Reads `type` and `elements` and stops at once when both are known, without scanning the
/// rest (`appState`, and above all the `files` image blobs, which are most of a big drawing).
/// serde_json has no "stop here" return, so the visitor parks the scene and fails on purpose.
struct StopVisitor<'s, 'a>(&'s std::cell::RefCell<Option<Scene<'a>>>);

impl<'de, 's> serde::de::Visitor<'de> for StopVisitor<'s, 'de> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an Excalidraw scene object")
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        #[derive(Deserialize)]
        enum Key {
            #[serde(rename = "type")]
            Type,
            #[serde(rename = "elements")]
            Elements,
            #[serde(other)]
            Other,
        }
        let mut kind: Option<Option<Cow<'de, str>>> = None;
        let mut elements: Option<Option<Vec<El<'de>>>> = None;
        while let Some(key) = map.next_key::<Key>()? {
            match key {
                Key::Type => kind = Some(map.next_value()?),
                Key::Elements => elements = Some(map.next_value()?),
                Key::Other => {
                    map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
            if kind.is_some() && elements.is_some() {
                *self.0.borrow_mut() = Some(Scene { kind: kind.flatten(), elements: elements.flatten().unwrap_or_default() });
                return Err(serde::de::Error::custom(STOP));
            }
        }
        *self.0.borrow_mut() = Some(Scene { kind: kind.flatten(), elements: elements.flatten().unwrap_or_default() });
        Ok(())
    }
}

struct StopSeed<'s, 'a>(&'s std::cell::RefCell<Option<Scene<'a>>>);

impl<'de, 's> serde::de::DeserializeSeed<'de> for StopSeed<'s, 'de> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        d.deserialize_map(StopVisitor(self.0))
    }
}

/// Parses a drawing from its first bytes. `complete` says `json` is the whole file; otherwise a
/// parse that runs out of bytes is [`Prefix::NeedMore`] (the caller reads more and retries).
/// Same items as a full parse, because everything after `elements` (when `type` is already
/// known) is never looked at: a file whose tail is damaged still gets indexed.
pub fn parse_scene_prefix(json: &[u8], complete: bool) -> Prefix {
    use serde::de::DeserializeSeed;
    let cell = std::cell::RefCell::new(None);
    let mut de = serde_json::Deserializer::from_slice(json);
    let res = StopSeed(&cell).deserialize(&mut de);
    let stopped = match &res {
        Ok(()) => false,
        Err(e) => cell.borrow().is_some() && e.to_string().starts_with(STOP),
    };
    match res {
        Ok(()) if de.end().is_err() => return Prefix::Invalid(err("INVALID_FILE", "Invalid JSON: trailing characters")),
        Err(e) if !stopped => {
            if e.is_eof() && !complete {
                return Prefix::NeedMore;
            }
            return Prefix::Invalid(err("INVALID_FILE", format!("Invalid JSON: {e}")));
        }
        _ => {}
    }
    let Some(scene) = cell.into_inner() else { return Prefix::Invalid(err("INVALID_FILE", "Not an Excalidraw scene")) };
    if scene.kind.as_deref() != Some("excalidraw") {
        return Prefix::Invalid(err("INVALID_FILE", "Not an Excalidraw scene"));
    }
    Prefix::Done(collect_items(&scene))
}

fn collect_items(scene: &Scene) -> (Vec<TextItem>, Vec<ElementLink>) {
    let mut out = Vec::new();
    let mut elinks = Vec::new();
    for el in &scene.elements {
        if el.is_deleted == Some(true) {
            continue;
        }
        if let (Some(link), Some(id)) = (non_empty(&el.link), el.id.as_deref().filter(|i| !i.is_empty())) {
            elinks.push(ElementLink { element_id: id.into(), link: link.trim().into() });
        }
        let (kind, text) = match el.ty.as_deref() {
            Some("text") => (ItemKind::Text, non_empty(&el.original_text).or_else(|| non_empty(&el.text))),
            Some("frame" | "magicframe") => (ItemKind::Frame, non_empty(&el.name)),
            Some("image") => (ItemKind::Formula, formula_source(el)),
            _ => continue,
        };
        let (Some(text), Some(id)) = (text, el.id.as_deref().filter(|i| !i.is_empty())) else { continue };
        if normalize(text).is_empty() {
            continue;
        }
        out.push(TextItem {
            element_id: id.into(),
            container_id: el.container_id.as_deref().filter(|c| !c.is_empty()).map(Into::into),
            kind,
            text: text.into(),
        });
    }
    (out, elinks)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn items(json: &str) -> Vec<TextItem> {
        extract_items(json.as_bytes()).unwrap()
    }

    #[test]
    fn bound_text_prefers_original_text_and_keeps_container() {
        let v = items(
            r#"{"type":"excalidraw","elements":[
            {"id":"t1","type":"text","text":"Hello\nWorld","originalText":"Hello World","containerId":"r1"},
            {"id":"t2","type":"text","text":"Free","originalText":""},
            {"id":"r1","type":"rectangle"}]}"#,
        );
        assert_eq!(v.len(), 2);
        assert_eq!(&*v[0].text, "Hello World");
        assert_eq!(v[0].container_id.as_deref(), Some("r1"));
        assert_eq!(&*v[1].text, "Free");
        assert_eq!(v[1].container_id, None);
        assert_eq!(v[1].kind, ItemKind::Text);
    }

    #[test]
    fn frames_named_deleted_skipped_and_blank_dropped() {
        let v = items(
            r#"{"type":"excalidraw","elements":[
            {"id":"f1","type":"frame","name":"Backend"},
            {"id":"f2","type":"magicframe","name":"AI"},
            {"id":"f3","type":"frame","name":null},
            {"id":"f4","type":"frame","name":""},
            {"id":"d1","type":"text","text":"gone","isDeleted":true},
            {"id":"b1","type":"text","text":"   "}]}"#,
        );
        let got: Vec<_> = v.iter().map(|i| (&*i.element_id, i.kind)).collect();
        assert_eq!(got, vec![("f1", ItemKind::Frame), ("f2", ItemKind::Frame)]);
    }

    #[test]
    fn formula_images_are_indexed_by_latex_source_and_junk_custom_data_is_ignored() {
        let v = items(
            r#"{"type":"excalidraw","elements":[
            {"id":"m1","type":"image","customData":{"latex":{"v":1,"source":"E=mc^2","display":true}}},
            {"id":"i0","type":"image"},
            {"id":"i1","type":"image","customData":null},
            {"id":"i2","type":"image","customData":"str"},
            {"id":"i3","type":"image","customData":[1,2]},
            {"id":"i4","type":"image","customData":{"latex":5}},
            {"id":"i5","type":"image","customData":{"latex":{"source":42}}},
            {"id":"i6","type":"image","customData":{"latex":{"source":"  "}}},
            {"id":"i7","type":"image","isDeleted":true,"customData":{"latex":{"source":"gone"}}},
            {"id":"r","type":"rectangle","customData":{"latex":{"source":"x"}}}]}"#,
        );
        let got: Vec<_> = v.iter().map(|i| (&*i.element_id, i.kind, &*i.text)).collect();
        assert_eq!(got, vec![("m1", ItemKind::Formula, "E=mc^2")]);
    }

    #[test]
    fn files_blob_and_unknown_fields_are_ignored() {
        let v = items(
            r#"{"type":"excalidraw","version":2,"appState":{"x":1},"files":{"a":{"dataURL":"data:image/png;base64,AAAA"}},
            "elements":[{"id":"t","type":"text","text":"ok","x":1.5,"points":[[0,0]]}]}"#,
        );
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn element_links_and_hash_are_extracted_for_live_elements_only() {
        let json = br#"{"type":"excalidraw","elements":[
            {"id":"a","type":"rectangle","link":"[[Plan]]"},
            {"id":"b","type":"text","text":"x","link":"https://e.com"},
            {"id":"c","type":"rectangle","link":"","isDeleted":false},
            {"id":"d","type":"rectangle","link":"[[Gone]]","isDeleted":true},
            {"id":"e","type":"rectangle","link":null}]}"#;
        let x = extract_doc(json).unwrap();
        let got: Vec<_> = x.elinks.iter().map(|l| (&*l.element_id, &*l.link)).collect();
        assert_eq!(got, vec![("a", "[[Plan]]"), ("b", "https://e.com")]);
        assert_eq!(x.items.len(), 1);
        assert_eq!(x.hash8, fingerprint8(json));
        assert_ne!(x.hash8, [0; 8]);
    }

    #[test]
    fn fingerprint_depends_on_length_head_and_tail_only() {
        let mut a = vec![b'a'; 100_000];
        let b = a.clone();
        assert_eq!(fingerprint8(&a), fingerprint8(&b));
        a[50_000] = b'z';
        assert_eq!(fingerprint8(&a), fingerprint8(&b), "the middle is not sampled");
        a[10] = b'z';
        assert_ne!(fingerprint8(&a), fingerprint8(&b));
        assert_ne!(fingerprint8(&b), fingerprint8(&b[..99_999]));
        assert_ne!(fingerprint8(b""), fingerprint8(b"x"));
        assert_eq!(fingerprint8(b"short"), fingerprint8(b"short"));
    }

    #[test]
    fn rejects_non_excalidraw_json() {
        assert!(extract_items(b"{\"type\":\"other\",\"elements\":[]}").is_err());
        assert!(extract_items(b"[1,2]").is_err());
        assert!(extract_items(b"not json").is_err());
    }

    fn same(a: &(Vec<TextItem>, Vec<ElementLink>), b: &(Vec<TextItem>, Vec<ElementLink>)) -> bool {
        a.0 == b.0 && a.1 == b.1
    }

    #[test]
    fn a_prefix_ending_after_elements_parses_like_the_whole_file() {
        let head = br#"{"type":"excalidraw","version":2,"elements":[{"id":"t","type":"text","text":"hello","link":"[[A]]"}],"#;
        let full = [&head[..], br#""appState":{},"files":{"f":{"dataURL":"data:image/png;base64,AAAA"}}}"#].concat();
        let whole = parse_scene(&full).unwrap();
        let Prefix::Done(got) = parse_scene_prefix(head, false) else { panic!("prefix should be enough") };
        assert!(same(&got, &whole));
        assert_eq!(got.0.len(), 1);
        assert_eq!(got.1.len(), 1);
    }

    #[test]
    fn a_prefix_cut_inside_elements_needs_more_bytes() {
        let full = br#"{"type":"excalidraw","elements":[{"id":"a","type":"text","text":"one"},{"id":"b","type":"text","text":"two"}],"files":{}}"#;
        for cut in [1, 10, 40, 75, 100] {
            assert!(matches!(parse_scene_prefix(&full[..cut], false), Prefix::NeedMore), "cut {cut}");
        }
        // The same cut of a whole file is an error, not a request for more.
        assert!(matches!(parse_scene_prefix(&full[..40], true), Prefix::Invalid(_)));
    }

    #[test]
    fn key_order_does_not_matter_only_what_is_read() {
        // `files` first: it is skipped, and the scan continues until both keys are known.
        let json = br#"{"files":{"f":{"dataURL":"AAAA"}},"elements":[{"id":"t","type":"text","text":"late"}],"type":"excalidraw"}"#;
        let got = parse_scene(json).unwrap();
        assert_eq!(&*got.0[0].text, "late");
        // No `type` at all: not a scene, whatever follows.
        assert!(parse_scene(br#"{"elements":[{"id":"t","type":"text","text":"x"}]}"#).is_err());
        // Elements before type.
        assert_eq!(parse_scene(br#"{"elements":[{"id":"t","type":"text","text":"x"}],"type":"excalidraw"}"#).unwrap().0.len(), 1);
        assert!(parse_scene(br#"{"elements":[],"type":"other"}"#).is_err());
        // Everything after `type` and `elements` is not looked at, so a damaged tail is not an error.
        assert!(parse_scene(br#"{"type":"excalidraw","elements":[],"files":{"a":"#).is_ok());
    }

    #[test]
    fn fingerprint_parts_equals_fingerprint8() {
        for len in [0usize, 1, 100, 4096, 5000, 8192, 8193, 100_000] {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 31 % 251) as u8).collect();
            let head = &bytes[..len.min(FINGERPRINT_EDGE)];
            let tail = &bytes[len.saturating_sub(FINGERPRINT_EDGE)..];
            assert_eq!(fingerprint_parts(len as u64, head, tail), fingerprint8(&bytes), "len {len}");
        }
    }
}
