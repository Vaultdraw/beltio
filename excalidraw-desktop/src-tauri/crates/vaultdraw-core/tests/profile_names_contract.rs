//! Family hunter shell, 2026-10-31: the native profile-name rule runs the case table that the New
//! profile dialog runs (src/tests/profileNameContract.test.ts).

use vaultdraw_core::config::valid_profile_name;

#[test]
fn native_profile_names_match_the_table() {
    let table: serde_json::Value = serde_json::from_str(include_str!("../src/contract/profile_names.json")).unwrap();
    let bad: Vec<String> = table["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| {
            let name = match &r["name"] {
                serde_json::Value::String(s) => s.clone(),
                o => o["repeat"].as_str().unwrap().repeat(o["times"].as_u64().unwrap() as usize),
            };
            let ok = r["ok"].as_bool().unwrap();
            (valid_profile_name(&name) != ok).then(|| r["label"].as_str().unwrap().to_string())
        })
        .collect();
    assert!(bad.is_empty(), "rows that disagree: {bad:?}");
}
