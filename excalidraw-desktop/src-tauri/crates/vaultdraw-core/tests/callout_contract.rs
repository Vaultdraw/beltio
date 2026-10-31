//! Which text is a callout: the native parser runs the case table the reading view runs
//! (src/notes/calloutContract.test.ts). Family "twin parsers", hunter [notes] 2026-10-31. A row
//! with `drift.native` disagrees today: the test asserts it still does.

use serde_json::Value;
use vaultdraw_core::markdown::{parse_markdown, ParseOptions};

fn walk(v: &Value, out: &mut Vec<(String, String)>) {
    match v {
        Value::Object(m) => {
            if m.get("kind").and_then(|k| k.as_str()) == Some("callout") {
                out.push((
                    m["calloutType"].as_str().unwrap_or("").to_string(),
                    m["foldState"].as_str().unwrap_or("").to_string(),
                ));
            }
            for x in m.values() {
                walk(x, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
        _ => {}
    }
}

#[test]
fn native_callouts_match_the_table() {
    let table: Value =
        serde_json::from_str(include_str!("../src/contract/callout_cases.json")).unwrap();
    let (mut bad, mut fixed) = (Vec::new(), Vec::new());
    for r in table["cases"].as_array().unwrap() {
        let want: Vec<(String, String)> = r["callouts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c[0].as_str().unwrap().to_string(), c[1].as_str().unwrap().to_string()))
            .collect();
        let doc = parse_markdown(r["text"].as_str().unwrap(), &ParseOptions::default());
        let json = serde_json::to_value(&doc.blocks).unwrap();
        let mut got = Vec::new();
        walk(&json, &mut got);
        let label = r["label"].as_str().unwrap();
        let agrees = got == want;
        if r["drift"]["native"].is_null() {
            if !agrees {
                bad.push(format!("{label}: {got:?} (want {want:?})"));
            }
        } else if agrees {
            fixed.push(label.to_string());
        }
    }
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
    assert!(fixed.is_empty(), "drift rows that now agree (drop `drift.native`): {fixed:?}");
}
