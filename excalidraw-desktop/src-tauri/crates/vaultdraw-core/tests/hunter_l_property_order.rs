//! Bug hunter L, 2026-10-30 night [notes], L-13: a note's properties are listed in alphabetical
//! order, not the order the note writes them. `Frontmatter.properties` is a `BTreeMap`
//! (markdown/model.rs), so the JSON the reading view gets (NoteView `Object.keys(props)`) is
//! sorted: `title, date, author` shows as `author, date, title`. The parser keeps the file order
//! in `order` (frontmatter.rs) and loses it when it builds the map. Obsidian's properties panel
//! keeps the file's order. Fixed (toimprove 281): `Properties` serializes in file order.

use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

fn keys_as_sent(text: &str) -> Vec<String> {
    let doc = parse_markdown(text, &ParseOptions::default());
    // the string the app sends: a Value would sort the keys, the string keeps them
    let whole = serde_json::to_string(&doc).unwrap();
    let at = whole.find("\"properties\":{").unwrap() + "\"properties\":".len();
    let end = at + whole[at..].find('}').unwrap() + 1;
    let raw = whole[at..end].to_string();
    let mut keys = Vec::new();
    let mut rest = raw.as_str();
    while let Some(i) = rest.find("\":") {
        let head = &rest[..i];
        let start = head.rfind('"').unwrap();
        keys.push(head[start + 1..].to_string());
        rest = &rest[i + 2..];
        if let Some(j) = rest.find(",\"") {
            rest = &rest[j + 1..];
        } else {
            break;
        }
    }
    keys
}

#[test]
fn sanity_all_properties_are_sent() {
    let mut k = keys_as_sent("---\ntitle: T\ndate: D\nauthor: A\n---\nbody\n");
    k.sort();
    assert_eq!(k, vec!["author", "date", "title"]);
}

#[test]
fn properties_keep_the_file_order() {
    let k = keys_as_sent("---\ntitle: T\ndate: D\nauthor: A\n---\nbody\n");
    assert!(k == vec!["title", "date", "author"], "file order: got {k:?}");
}
