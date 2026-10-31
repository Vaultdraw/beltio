//! Which text is a `[[wikilink]]`: the native parser runs the case table the reading view runs
//! (src/notes/wikilinkContract.test.ts). Family "twin parsers", hunter [notes] 2026-10-31. A row
//! with `drift.native` disagrees today: the test asserts it still does, so it turns red when fixed.

use vaultdraw_core::markdown::{parse_markdown, DocLinkKind, ParseOptions};

fn targets(text: &str) -> Vec<String> {
    parse_markdown(text, &ParseOptions::default())
        .links
        .iter()
        .filter(|l| matches!(l.kind, DocLinkKind::Wikilink))
        .map(|l| l.target.clone())
        .collect()
}

#[test]
fn native_wikilinks_match_the_table() {
    let table: serde_json::Value =
        serde_json::from_str(include_str!("../src/contract/wikilink_cases.json")).unwrap();
    let (mut bad, mut fixed) = (Vec::new(), Vec::new());
    for r in table["cases"].as_array().unwrap() {
        let want: Vec<String> =
            r["links"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
        let got = targets(r["text"].as_str().unwrap());
        let label = r["label"].as_str().unwrap();
        let agrees = got == want;
        if r["drift"]["native"].is_null() {
            if !agrees {
                bad.push(format!("{label}: {got:?}"));
            }
        } else if agrees {
            fixed.push(label.to_string());
        }
    }
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
    assert!(fixed.is_empty(), "drift rows that now agree (drop `drift.native`): {fixed:?}");
}
