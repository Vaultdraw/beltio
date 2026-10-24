use super::*;
use serde_json::Value;
use std::time::Instant;

fn fixtures() -> Vec<Value> {
    let doc: Value = serde_json::from_str(include_str!("fixtures/uri.json")).unwrap();
    doc["cases"].as_array().unwrap().clone()
}

/// Every golden case: the same request (as the window plan) or the same error code.
#[test]
fn golden_fixtures() {
    let cases = fixtures();
    assert!(cases.len() > 60);
    for c in cases {
        let (name, input) = (c["name"].as_str().unwrap(), c["input"].as_str().unwrap());
        let got = parse(input);
        match (c.get("ok"), c.get("err")) {
            (Some(ok), None) => {
                let req = got.unwrap_or_else(|e| panic!("{name}: expected ok, got {e}"));
                assert_eq!(&serde_json::to_value(&req).unwrap(), ok, "{name}");
            }
            (None, Some(code)) => {
                let e = got.err().unwrap_or_else(|| panic!("{name}: expected an error"));
                assert_eq!(e.code(), code.as_str().unwrap(), "{name}: {e}");
            }
            _ => panic!("{name}: fixture needs exactly one of ok / err"),
        }
    }
}

#[test]
fn the_url_size_limit_is_in_bytes() {
    let base = "vaultdraw://open?file=a&pad=";
    let fits = format!("{base}{}", "x".repeat(MAX_URL_BYTES - base.len()));
    assert!(parse(&fits).is_ok());
    assert_eq!(parse(&format!("{fits}x")), Err(UriError::TooLong));
    // Multi-byte characters count as bytes, not characters.
    let wide = format!("{base}{}", "é".repeat(MAX_URL_BYTES / 2));
    assert_eq!(parse(&wide), Err(UriError::TooLong));
}

#[test]
fn errors_never_echo_control_characters() {
    let e = parse("vaultdraw://a%0Ab%E2%80%AEc?x=1").unwrap_err();
    assert!(matches!(e, UriError::UnknownAction(_)));
    let msg = e.to_string();
    assert!(!msg.contains('\n') && !msg.contains('\u{202e}'), "{msg:?}");
    assert!(printable(&"z".repeat(100), 10).ends_with('…'));
}

#[test]
fn an_encoded_dotdot_is_caught_after_decoding_and_double_encoding_stays_literal() {
    assert!(parse("vaultdraw://open?file=%2e%2e%2fx").is_err());
    // `%252e%252e` decodes once to the text "%2e%2e": a harmless name, never decoded twice.
    let r = parse("vaultdraw://open?file=%252e%252e/x").unwrap();
    assert_eq!(r, UriRequest::Open { vault: None, file: Some("%2e%2e/x".into()), new_tab: false });
}

#[test]
fn parse_is_fast() {
    let mut samples = Vec::new();
    for i in 0..2000 {
        let url = format!("vaultdraw://open?vault=DSA&file=Graphs/BFS{i}&newTab=1");
        let t = Instant::now();
        let _ = std::hint::black_box(parse(std::hint::black_box(&url)));
        samples.push(t.elapsed());
    }
    samples.sort();
    eprintln!("uri::parse p50 {:?} p95 {:?}", samples[1000], samples[1900]);
    // Budget p95 < 50 us; the bound is loose so a loaded machine does not flake it.
    assert!(samples[1900].as_micros() < 500, "parse is slow");
}
