//! Bug hunter J, 2026-10-30 (toimprove 215): the native parser runs the front matter case table
//! that the reading view and the browser stand-in run (src/notes/frontmatterContract.test.ts).
//! Rows whose `drift.native` is set disagree today; they are listed, not asserted, by the first
//! test and asserted by the `should_panic` test. Delete `should_panic` when 207 is fixed.

use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

fn rows() -> Vec<serde_json::Value> {
    let table: serde_json::Value = serde_json::from_str(include_str!("../src/contract/frontmatter_cases.json")).unwrap();
    table["cases"].as_array().unwrap().clone()
}

fn tags_of(text: &str) -> Vec<String> {
    parse_markdown(text, &ParseOptions::default()).frontmatter.map(|f| f.tags).unwrap_or_default()
}

fn want(r: &serde_json::Value) -> Vec<String> {
    r["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect()
}

#[test]
fn native_front_matter_matches_the_table() {
    let bad: Vec<String> = rows()
        .iter()
        .filter(|r| r["drift"]["native"].is_null())
        .filter(|r| tags_of(r["text"].as_str().unwrap()) != want(r))
        .map(|r| format!("{}: {:?}", r["label"].as_str().unwrap(), tags_of(r["text"].as_str().unwrap())))
        .collect();
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
}

#[test]
#[should_panic(expected = "native drift")]
fn known_native_drift_rows() {
    let bad: Vec<String> = rows()
        .iter()
        .filter(|r| !r["drift"]["native"].is_null())
        .filter(|r| tags_of(r["text"].as_str().unwrap()) != want(r))
        .map(|r| r["label"].as_str().unwrap().to_string())
        .collect();
    assert!(bad.is_empty(), "native drift: {bad:?}");
}
