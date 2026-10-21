//! Test helpers for building small link indexes by hand (shared by the core and app tests).

use super::query;
use crate::search::{DocEntry, ElementLink, Index, ItemKind, TextItem};

pub fn item(id: &str, container: Option<&str>, text: &str) -> TextItem {
    TextItem { element_id: id.into(), container_id: container.map(Into::into), kind: ItemKind::Text, text: text.into() }
}

pub fn doc(path: &str, texts: &[(&str, &str)], links: &[(&str, &str)]) -> DocEntry {
    let items = texts.iter().map(|(id, t)| item(id, None, t)).collect();
    let elinks = links.iter().map(|(id, l)| ElementLink { element_id: (*id).into(), link: (*l).into() }).collect();
    DocEntry::new(path, (1, 1), items).with_links(elinks, [0; 8])
}

pub fn index_of(docs: Vec<(&str, DocEntry)>) -> Index {
    let mut ix = Index::default();
    for (p, d) in docs {
        ix.upsert(p.to_string(), d);
    }
    let li = ix.build_links();
    ix.install_links(li);
    ix
}

pub fn plain(path: &str) -> (&str, DocEntry) {
    (path, DocEntry::new(path, (1, 1), vec![item("t", None, "x")]))
}

pub fn resolved(ix: &Index, from: &str, raw: &str) -> Option<String> {
    query::resolve_raw(ix, from, raw).path
}
