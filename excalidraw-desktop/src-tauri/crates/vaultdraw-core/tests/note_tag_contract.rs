//! Which #text is a tag in a note body: the native parser runs the case table the reading view
//! runs (src/notes/tagShapes.family.test.ts). Family "twin parsers", hunter [notes] 2026-10-31.
//! A row with `drift.native` disagrees today: the test asserts it still does.

use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

#[test]
fn native_note_tags_match_the_table() {
    let table: serde_json::Value =
        serde_json::from_str(include_str!("../src/contract/note_tag_cases.json")).unwrap();
    let (mut bad, mut fixed) = (Vec::new(), Vec::new());
    for r in table["cases"].as_array().unwrap() {
        let want: Vec<String> =
            r["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
        let doc = parse_markdown(r["text"].as_str().unwrap(), &ParseOptions::default());
        let label = r["label"].as_str().unwrap();
        // The document lists each tag once, in order of first use.
        let mut seen = Vec::new();
        for t in &want {
            if !seen.contains(t) {
                seen.push(t.clone());
            }
        }
        let agrees = doc.tags == seen;
        if r["drift"]["native"].is_null() {
            if !agrees {
                bad.push(format!("{label}: {:?} (want {seen:?})", doc.tags));
            }
        } else if agrees {
            fixed.push(label.to_string());
        }
    }
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
    assert!(fixed.is_empty(), "drift rows that now agree (drop `drift.native`): {fixed:?}");
}
