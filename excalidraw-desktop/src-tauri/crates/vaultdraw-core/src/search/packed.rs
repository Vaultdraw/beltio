//! Compact storage for a drawing's text items.
//!
//! A `Vec<TextItem>` costs three heap blocks per item (id, container, text; each with
//! allocator rounding and a 16-byte header in the vector). `PackedItems` keeps one
//! `Box<str>` arena per drawing and a 16-byte record per item. The serialised form is
//! byte-identical to `Vec<TextItem>`, so existing snapshots stay valid.

use super::extract::{ItemKind, TextItem};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy)]
struct Rec {
    /// End offsets in the arena; an item is `id | container | text`, starting at the previous `text_end`.
    id_end: u32,
    container_end: u32,
    text_end: u32,
    kind: ItemKind,
    has_container: bool,
}

/// Borrowed view of one packed item; serialises exactly like `TextItem`.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ItemRef<'a> {
    pub element_id: &'a str,
    pub container_id: Option<&'a str>,
    pub kind: ItemKind,
    pub text: &'a str,
}

#[derive(Debug, Default)]
pub struct PackedItems {
    recs: Box<[Rec]>,
    arena: Box<str>,
}

impl PackedItems {
    pub fn pack(items: Vec<TextItem>) -> PackedItems {
        let bytes: usize = items.iter().map(|i| i.element_id.len() + i.container_id.as_ref().map_or(0, |c| c.len()) + i.text.len()).sum();
        let mut arena = String::with_capacity(bytes);
        let mut recs = Vec::with_capacity(items.len());
        for i in &items {
            arena.push_str(&i.element_id);
            let id_end = arena.len() as u32;
            arena.push_str(i.container_id.as_deref().unwrap_or(""));
            let container_end = arena.len() as u32;
            arena.push_str(&i.text);
            recs.push(Rec { id_end, container_end, text_end: arena.len() as u32, kind: i.kind, has_container: i.container_id.is_some() });
        }
        PackedItems { recs: recs.into_boxed_slice(), arena: arena.into_boxed_str() }
    }

    pub fn len(&self) -> usize {
        self.recs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.recs.is_empty()
    }

    pub fn get(&self, i: usize) -> ItemRef<'_> {
        let r = &self.recs[i];
        let start = if i == 0 { 0 } else { self.recs[i - 1].text_end as usize };
        let (id_end, container_end, text_end) = (r.id_end as usize, r.container_end as usize, r.text_end as usize);
        ItemRef {
            element_id: &self.arena[start..id_end],
            container_id: r.has_container.then(|| &self.arena[id_end..container_end]),
            kind: r.kind,
            text: &self.arena[container_end..text_end],
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = ItemRef<'_>> + '_ {
        (0..self.len()).map(|i| self.get(i))
    }

    /// Heap bytes held (exact: both blocks are shrunk to fit).
    pub fn heap_bytes(&self) -> usize {
        self.recs.len() * std::mem::size_of::<Rec>() + self.arena.len()
    }
}

impl Serialize for PackedItems {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.iter())
    }
}

impl<'de> Deserialize<'de> for PackedItems {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Vec::<TextItem>::deserialize(d).map(PackedItems::pack)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, container: Option<&str>, kind: ItemKind, text: &str) -> TextItem {
        TextItem { element_id: id.into(), container_id: container.map(Into::into), kind, text: text.into() }
    }

    fn sample() -> Vec<TextItem> {
        vec![
            item("a", None, ItemKind::Text, "Hello"),
            item("b", Some("a"), ItemKind::Frame, "Café ☕ 数据"),
            item("c", Some(""), ItemKind::Text, "empty container is not none"),
            item("", None, ItemKind::Text, ""),
        ]
    }

    #[test]
    fn views_match_the_source_items() {
        let src = sample();
        let p = PackedItems::pack(src.clone());
        assert_eq!(p.len(), src.len());
        for (i, s) in src.iter().enumerate() {
            let v = p.get(i);
            assert_eq!((v.element_id, v.container_id, v.kind, v.text), (&*s.element_id, s.container_id.as_deref(), s.kind, &*s.text));
        }
        assert!(PackedItems::pack(Vec::new()).is_empty());
    }

    #[test]
    fn serialised_bytes_equal_vec_of_text_items_and_roundtrip() {
        let src = sample();
        let want = postcard::to_allocvec(&src).unwrap();
        let p = PackedItems::pack(src.clone());
        assert_eq!(postcard::to_allocvec(&p).unwrap(), want);
        let back: PackedItems = postcard::from_bytes(&want).unwrap();
        assert_eq!(postcard::to_allocvec(&back).unwrap(), want);
    }

    #[test]
    fn packs_smaller_than_separate_boxes() {
        let src: Vec<TextItem> = (0..100).map(|i| item(&format!("id{i:018}"), Some("box0000000000000001"), ItemKind::Text, "some label")).collect();
        let boxed: usize = src.iter().map(|_| std::mem::size_of::<TextItem>() + 16 + 16 + 16).sum();
        assert!(PackedItems::pack(src).heap_bytes() < boxed * 2 / 3);
    }
}
