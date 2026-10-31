//! Front matter property VALUES, one case table with the browser stand-in
//! (src/notes/frontmatterValues.contract.test.ts). Family "twin parsers" (hunter [notes],
//! 2026-10-31, toimprove 315). A row with `drift.native` disagrees with YAML and Obsidian today:
//! the test asserts it still disagrees, so it turns red the day it is fixed (then drop `drift`).

use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

fn props_of(yaml: &str) -> Vec<(String, String)> {
    let text = format!("---\n{yaml}\n---\nbody\n");
    parse_markdown(&text, &ParseOptions::default())
        .frontmatter
        .map(|f| f.properties.0)
        .unwrap_or_default()
}

fn want(r: &serde_json::Value) -> Vec<(String, String)> {
    r["props"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p[0].as_str().unwrap().to_string(), p[1].as_str().unwrap().to_string()))
        .collect()
}

#[test]
fn native_property_values_match_the_table() {
    let table: serde_json::Value =
        serde_json::from_str(include_str!("../src/contract/frontmatter_values.json")).unwrap();
    let mut bad = Vec::new();
    let mut fixed = Vec::new();
    for r in table["cases"].as_array().unwrap() {
        let got = props_of(r["yaml"].as_str().unwrap());
        let label = r["label"].as_str().unwrap();
        let agrees = got == want(r);
        if r["drift"]["native"].is_null() {
            if !agrees {
                bad.push(format!("{label}: {got:?}"));
            }
        } else if agrees {
            fixed.push(label.to_string());
        }
    }
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
    assert!(fixed.is_empty(), "drift rows that now agree (drop their `drift`): {fixed:?}");
}
