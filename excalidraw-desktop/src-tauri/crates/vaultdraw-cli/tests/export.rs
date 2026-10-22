//! `vaultdraw export`: request params, the written bytes, overwrite rules, stdout, --json and
//! --print-request, against the fake server.
mod common;
use common::*;
use serde_json::{json, Value};
use std::process::Output;

// Base64 of `<svg/>\n` and of a few binary bytes (generated with `base64`).
const SVG_B64: &str = "PHN2Zy8+Cg==";
const SVG: &[u8] = b"<svg/>\n";
const PNG_B64: &str = "iVBORwD/EA==";
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x00, 0xff, 0x10];

fn parse(s: &str) -> Value {
    serde_json::from_str(s.trim()).unwrap()
}

/// Replies to `export.render` with the bytes of the requested format.
fn app(method: &str, params: &Value) -> Result<Value, (i64, String, Option<&'static str>)> {
    match method {
        "export.render" => {
            let (name, mime, b64, size) = match params["format"].as_str() {
                Some("svg") => ("a.svg", "image/svg+xml", SVG_B64, SVG.len()),
                _ => ("a.png", "image/png", PNG_B64, PNG.len()),
            };
            Ok(json!({"path":"a.excalidraw","fileName":name,"mime":mime,"size":size,"bytes":b64}))
        }
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

fn run(args: &[&str]) -> (Output, Vec<Value>) {
    let f = Fake::start(app);
    let o = vd(args, Some(&f.socket), None);
    let seen = f.seen.lock().unwrap().clone();
    (o, seen)
}

#[test]
fn export_sends_only_the_options_set_and_writes_the_exact_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("out.svg");
    let f = Fake::start(app);
    let o = vd(&["export", "a", "--format", "svg", "--scale", "2", "--dark", "-o", file.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(out(&o), format!("exported a.excalidraw -> {} ({} bytes)\n", file.display(), SVG.len()));
    assert_eq!(std::fs::read(&file).unwrap(), SVG);
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen[0]["method"], "export.render");
    assert_eq!(seen[0]["params"], json!({"file":"a","format":"svg","scale":2.0,"dark":true}));
    // No temporary file left behind.
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn format_comes_from_the_extension_and_options_map_to_their_keys() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("p.PDF");
    let (o, seen) = run(&["export", "Graphs/a.excalidraw", "-o", file.to_str().unwrap(), "--no-background", "--no-pattern", "--embed-scene", "--page"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(
        seen[0]["params"],
        json!({"path":"Graphs/a.excalidraw","format":"pdf","background":false,"pattern":false,"embedScene":true,"pageShaped":true})
    );
    // Default format is png when neither --format nor a known extension is given.
    let (_, seen) = run(&["export", "a", "-o", dir.path().join("x.bin").to_str().unwrap()]);
    assert_eq!(seen[0]["params"], json!({"file":"a","format":"png"}));
}

#[test]
fn existing_file_is_refused_without_force_and_force_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("keep.png");
    std::fs::write(&file, b"old").unwrap();
    let f = Fake::start(app);
    let o = vd(&["export", "a", "-o", file.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("keep.png") && err(&o).contains("--force"), "{}", err(&o));
    assert_eq!(std::fs::read(&file).unwrap(), b"old");
    assert!(f.seen.lock().unwrap().is_empty(), "refused before the render");
    let o = vd(&["export", "a", "-o", file.to_str().unwrap(), "--force"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(&file).unwrap(), PNG);
}

#[test]
fn stdout_gets_the_raw_bytes_and_the_status_line_goes_to_stderr() {
    let (o, seen) = run(&["export", "a", "--format", "png", "-o", "-"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(o.stdout, PNG);
    assert!(err(&o).contains("exported a.excalidraw -> - (7 bytes)"), "{}", err(&o));
    assert_eq!(seen.len(), 1);
    let (o, seen) = run(&["export", "a", "-o", "-", "--json"]);
    assert_eq!(code(&o), 1);
    assert!(o.stdout.is_empty());
    assert!(seen.is_empty());
}

#[test]
fn json_output_has_the_reply_fields_and_no_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("j.svg");
    let (o, _) = run(&["export", "a", "--format", "svg", "-o", file.to_str().unwrap(), "--json"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(
        parse(&out(&o)),
        json!({"path":"a.excalidraw","fileName":"a.svg","mime":"image/svg+xml","size":SVG.len(),"out":file.to_str().unwrap()})
    );
}

#[test]
fn print_request_shows_the_line_without_a_socket() {
    let o = vd(&["export", "a", "--format", "pdf", "--scale", "1.5", "--print-request"], None, None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let line = parse(&out(&o));
    assert_eq!(line["method"], "export.render");
    assert_eq!(line["params"], json!({"file":"a","format":"pdf","scale":1.5}));
}

#[test]
fn a_reply_whose_size_does_not_match_is_a_protocol_error() {
    let f = Fake::start(|m, _| match m {
        "export.render" => Ok(json!({"path":"a.excalidraw","fileName":"a.png","mime":"image/png","size":3,"bytes":PNG_B64})),
        _ => Err((-32601, "Method not found".into(), None)),
    });
    let o = vd(&["export", "a", "-o", "-"], Some(&f.socket), None);
    assert_eq!(code(&o), 4, "{}", err(&o));
    assert!(err(&o).contains("BAD_REPLY"), "{}", err(&o));
}
