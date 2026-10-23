//! `vaultdraw export`: request params, the written bytes, overwrite rules, stdout, --json,
//! --print-request, folder batches (--out-dir) and --frame / --padding, against the fake server.
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

/// Replies to `export.render` with the bytes of the requested format. A drawing is not a folder:
/// `vault.list` answers NOT_FOUND, as the app does.
fn app(method: &str, params: &Value) -> Result<Value, (i64, String, Option<&'static str>)> {
    match method {
        "vault.list" => Err((-32000, "Directory not found".into(), Some("NOT_FOUND"))),
        "export.render" | "export.spool" => {
            let (name, mime, b64, size) = match params["format"].as_str() {
                Some("svg") => ("a.svg", "image/svg+xml", SVG_B64, SVG.len()),
                _ => ("a.png", "image/png", PNG_B64, PNG.len()),
            };
            if method == "export.spool" {
                let raw = if mime == "image/png" { PNG } else { SVG };
                Ok(json!({"path":"a.excalidraw","fileName":name,"mime":mime,"size":size,"spool":spool_file(raw)}))
            } else {
                Ok(json!({"path":"a.excalidraw","fileName":name,"mime":mime,"size":size,"bytes":b64}))
            }
        }
        _ => Err((-32601, "Method not found".into(), None)),
    }
}

/// What the app does for `spool: true`: a file in its `export-spool` folder (a fresh name each time).
fn spool_file(bytes: &[u8]) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!("vd-export-spool-test-{}", std::process::id())).join("export-spool");
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join(format!("{:032x}", N.fetch_add(1, Ordering::SeqCst) + 1));
    std::fs::write(&p, bytes).unwrap();
    p.to_str().unwrap().to_string()
}

/// The `export.render` requests the app received (the folder probe is `vault.list`).
fn renders(f: &Fake) -> Vec<Value> {
    f.seen.lock().unwrap().iter().filter(|r| r["method"] == "export.render" || r["method"] == "export.spool").cloned().collect()
}

fn run(args: &[&str]) -> (Output, Vec<Value>) {
    let f = Fake::start(app);
    let o = vd(args, Some(&f.socket), None);
    let seen = renders(&f);
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
    let seen = renders(&f);
    assert_eq!(seen[0]["method"], "export.spool");
    assert_eq!(seen[0]["params"], json!({"file":"a","format":"svg","scale":2.0,"dark":true}));
    // No temporary file left behind.
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn format_comes_from_the_extension_and_options_map_to_their_keys() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("p.PDF");
    let (o, seen) = run(&["export", "Graphs/a.excalidraw", "-o", file.to_str().unwrap(), "--no-pattern"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(seen[0]["params"], json!({"path":"Graphs/a.excalidraw","format":"pdf","pattern":false}));
    let file = dir.path().join("s.svg");
    let (o, seen) = run(&["export", "a", "-o", file.to_str().unwrap(), "--no-background", "--embed-scene", "--page"]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(seen[0]["params"], json!({"file":"a","format":"svg","background":false,"embedScene":true,"pageShaped":true}));
}

#[test]
fn an_unknown_or_mismatched_extension_is_a_usage_error_before_any_request() {
    let dir = tempfile::tempdir().unwrap();
    let at = |name: &str| dir.path().join(name).to_str().unwrap().to_string();
    let (bin, noext, png) = (at("x.bin"), at("noext"), at("x.png"));
    for (args, needle) in [
        (vec!["export", "a", "-o", &bin], ".png, .svg or .pdf"),
        (vec!["export", "a", "-o", &noext], ".png, .svg or .pdf"),
        (vec!["export", "a", "-o", &png, "--format", "svg"], "does not match"),
    ] {
        let (o, seen) = run(&args);
        assert_eq!(code(&o), 1, "{args:?}: {}", err(&o));
        assert!(err(&o).contains(needle), "{args:?}: {}", err(&o));
        assert!(seen.is_empty(), "{args:?}");
    }
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn pdf_refuses_the_options_it_would_ignore_before_any_request() {
    for flag in [&["--dark"][..], &["--no-background"], &["--scale", "2"], &["--embed-scene"], &["--page"]] {
        let mut args = vec!["export", "a", "--format", "pdf", "-o", "-"];
        args.extend_from_slice(flag);
        let (o, seen) = run(&args);
        assert_eq!(code(&o), 1, "{flag:?}: {}", err(&o));
        assert!(err(&o).contains("not apply to pdf"), "{flag:?}: {}", err(&o));
        assert!(seen.is_empty(), "{flag:?}");
    }
}

#[test]
fn the_default_name_is_checked_before_the_render() {
    let dir = tempfile::tempdir().unwrap();
    let f = Fake::start(app);
    let o = vd_at(&["export", "a"], Some(&f.socket), dir.path());
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(dir.path().join("a.png")).unwrap(), PNG);
    // A repeat export fails fast: no second render.
    let o = vd_at(&["export", "a"], Some(&f.socket), dir.path());
    assert_eq!(code(&o), 1, "{}", err(&o));
    assert!(err(&o).contains("a.png") && err(&o).contains("--force"), "{}", err(&o));
    assert_eq!(f.seen.lock().unwrap().len(), 1, "refused before the second render");
    let o = vd_at(&["export", "a", "--force"], Some(&f.socket), dir.path());
    assert_eq!(code(&o), 0, "{}", err(&o));
}

#[test]
fn o_naming_an_existing_folder_writes_the_drawing_name_into_it() {
    let dir = tempfile::tempdir().unwrap();
    let f = Fake::start(app);
    let o = vd(&["export", "a", "--format", "svg", "-o", dir.path().to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(dir.path().join("a.svg")).unwrap(), SVG);
    assert!(out(&o).contains(&dir.path().join("a.svg").display().to_string()), "{}", out(&o));
    let o = vd(&["export", "a", "--format", "svg", "-o", dir.path().to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1, "{}", err(&o));
    assert_eq!(f.seen.lock().unwrap().len(), 1, "the taken name is refused before the render");
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
    assert!(renders(&f).is_empty(), "refused before the render");
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
    let o = vd(&["export", "a", "--format", "svg", "--scale", "1.5", "--print-request"], None, None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let line = parse(&out(&o));
    assert_eq!(line["method"], "export.spool");
    assert_eq!(line["params"], json!({"file":"a","format":"svg","scale":1.5}));
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

/// Lists folders for `vault.list`; drawings render like `app`, except one named `broken`.
fn folder_app(method: &str, params: &Value) -> Result<Value, (i64, String, Option<&'static str>)> {
    match method {
        "vault.list" => match params["dir"].as_str() {
            Some("Graphs") => Ok(json!({"entries": [
                {"path":"Graphs/a.excalidraw","kind":"drawing"},
                {"path":"Graphs/sub","kind":"folder"},
                {"path":"Graphs/sub/b.excalidraw","kind":"drawing"}]})),
            Some("Bad") => Ok(json!({"entries": [
                {"path":"Bad/ok.excalidraw","kind":"drawing"},
                {"path":"Bad/broken.excalidraw","kind":"drawing"}]})),
            Some("") => Ok(json!({"entries": [{"path":"Top.EXCALIDRAW","kind":"drawing"}]})),
            Some("Evil") => Ok(json!({"entries": [
                {"path":"../escape.excalidraw","kind":"drawing"},
                {"path":"Evil/later.excalidraw","kind":"drawing"}]})),
            _ => Err((-32000, "Directory not found".into(), Some("NOT_FOUND"))),
        },
        "export.render" | "export.spool" if params["path"].as_str().is_some_and(|p| p.contains("broken")) => {
            Err((-32000, "Cannot export an empty canvas".into(), Some("INVALID_FILE")))
        }
        _ => app(method, params),
    }
}

#[test]
fn a_single_drawing_sends_one_request_and_no_folder_listing() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("one.png");
    let f = Fake::start(folder_app);
    let o = vd(&["export", "Graphs", "-o", file.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert_eq!(seen[0]["method"], "export.spool");
}

#[test]
fn folder_exports_every_drawing_under_out_dir_with_the_new_extension() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("out");
    let f = Fake::start(folder_app);
    let o = vd(&["export", "Graphs/", "--out-dir", root.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(root.join("Graphs/a.png")).unwrap(), PNG);
    assert_eq!(std::fs::read(root.join("Graphs/sub/b.png")).unwrap(), PNG);
    assert!(out(&o).contains("exported 2 of 2 drawings"), "{}", out(&o));
    let seen = f.seen.lock().unwrap();
    assert_eq!(seen[0]["method"], "vault.list");
    assert_eq!(seen[0]["params"], json!({"dir":"Graphs","recursive":true}));
    let paths: Vec<&str> = seen[1..].iter().map(|r| r["params"]["path"].as_str().unwrap()).collect();
    assert_eq!(paths, ["Graphs/a.excalidraw", "Graphs/sub/b.excalidraw"]);
    assert!(seen[1..].iter().all(|r| r["method"] == "export.spool" && r["params"]["format"] == "png"));
}

#[test]
fn dot_is_the_vault_root_and_the_suffix_is_matched_case_insensitively() {
    let dir = tempfile::tempdir().unwrap();
    let f = Fake::start(folder_app);
    let o = vd(&["export", ".", "--out-dir", dir.path().to_str().unwrap(), "--format", "svg"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(f.seen.lock().unwrap()[0]["params"], json!({"dir":"","recursive":true}));
    assert_eq!(std::fs::read(dir.path().join("Top.svg")).unwrap(), SVG);
}

#[test]
fn a_failing_drawing_is_reported_and_the_batch_goes_on_with_exit_2() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("out");
    let f = Fake::start(folder_app);
    let o = vd(&["export", "Bad", "--out-dir", root.to_str().unwrap(), "--format", "svg", "--json"], Some(&f.socket), None);
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("vaultdraw: Bad/broken.excalidraw: Cannot export an empty canvas (INVALID_FILE)"), "{}", err(&o));
    assert!(err(&o).contains("exported 1 of 2 drawings"), "{}", err(&o));
    assert_eq!(err(&o).trim().lines().last(), Some("vaultdraw: 1 of 2 drawings failed (EXPORT_FAILED)"), "{}", err(&o));
    assert_eq!(std::fs::read(root.join("Bad/ok.svg")).unwrap(), SVG);
    assert!(!root.join("Bad/broken.svg").exists());
    // One JSON line per drawing on stdout, in order.
    let lines: Vec<Value> = out(&o).lines().map(parse).collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["path"], "Bad/ok.excalidraw");
    assert_eq!(lines[0]["ok"], true);
    assert_eq!(lines[0]["size"], SVG.len());
    assert!(lines[0].get("error").is_none());
    assert_eq!(lines[1], json!({"path":"Bad/broken.excalidraw","ok":false,"code":"INVALID_FILE","error":"Cannot export an empty canvas"}));
}

#[test]
fn an_existing_file_is_skipped_without_force_and_overwritten_with_it() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("Graphs")).unwrap();
    let taken = dir.path().join("Graphs/a.png");
    std::fs::write(&taken, b"old").unwrap();
    let f = Fake::start(folder_app);
    let o = vd(&["export", "Graphs", "--out-dir", dir.path().to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("Graphs/a.excalidraw") && err(&o).contains("--force"), "{}", err(&o));
    assert_eq!(std::fs::read(&taken).unwrap(), b"old");
    assert_eq!(std::fs::read(dir.path().join("Graphs/sub/b.png")).unwrap(), PNG);
    // Refused before its render: only the other drawing was rendered.
    assert_eq!(renders(&f).len(), 1);
    let o = vd(&["export", "Graphs", "--out-dir", dir.path().to_str().unwrap(), "--force"], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(&taken).unwrap(), PNG);
}

#[test]
fn an_unsafe_listed_path_stops_the_batch_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("out");
    let f = Fake::start(folder_app);
    let o = vd(&["export", "Evil", "--out-dir", root.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 4, "{}", err(&o));
    assert!(err(&o).contains("unsafe path") && err(&o).contains("BAD_REPLY"), "{}", err(&o));
    assert!(!dir.path().join("escape.png").exists());
    assert!(!root.exists());
    assert!(renders(&f).is_empty());
}

#[test]
fn out_dir_refuses_o_and_a_drawing_target() {
    let dir = tempfile::tempdir().unwrap();
    let f = Fake::start(folder_app);
    let file = dir.path().join("x.png");
    let o = vd(&["export", "Graphs", "-o", file.to_str().unwrap(), "--out-dir", dir.path().to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1, "{}", err(&o));
    assert!(f.seen.lock().unwrap().is_empty(), "refused before any request");
    let o = vd(&["export", "Graphs/a.excalidraw", "--out-dir", dir.path().to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 2, "{}", err(&o));
    assert!(err(&o).contains("is not a folder of the vault") && err(&o).contains("-o <file>"), "{}", err(&o));
    assert!(renders(&f).is_empty());
}

#[test]
fn out_dir_without_the_app_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    let o = vd(&["export", "Graphs", "--out-dir", dir.path().to_str().unwrap()], None, None);
    assert_eq!(code(&o), 3, "{}", err(&o));
}

#[test]
fn print_request_shows_the_listing_for_a_folder_batch() {
    let o = vd(&["export", "Graphs/", "--out-dir", "out", "--print-request"], None, None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    let line = parse(&out(&o));
    assert_eq!(line["method"], "vault.list");
    assert_eq!(line["params"], json!({"dir":"Graphs","recursive":true}));
}

#[test]
fn frame_and_padding_go_into_the_render_request_and_are_checked() {
    let o = vd(&["export", "a", "--frame", "Slide 1", "--padding", "0", "--print-request"], None, None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(parse(&out(&o))["params"], json!({"file":"a","format":"png","frame":"Slide 1","padding":0}));
    for bad in [&["--padding", "-1"][..], &["--padding", "201"], &["--format", "pdf", "--frame", "F"], &["--format", "pdf", "--padding", "5"]] {
        let mut args = vec!["export", "a", "--print-request"];
        args.extend_from_slice(bad);
        let o = vd(&args, None, None);
        assert_eq!(code(&o), 1, "{bad:?}: {}", err(&o));
    }
}

#[test]
fn an_app_without_spool_support_still_works_through_base64() {
    let f = Fake::start(|m, _| match m {
        "export.render" => Ok(json!({"path":"a.excalidraw","fileName":"a.png","mime":"image/png","size":PNG.len(),"bytes":PNG_B64})),
        _ => Err((-32601, "Method not found".into(), None)),
    });
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("o.png");
    let o = vd(&["export", "a", "-o", file.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert_eq!(std::fs::read(&file).unwrap(), PNG);
    let methods: Vec<String> = f.seen.lock().unwrap().iter().map(|r| r["method"].as_str().unwrap().to_string()).filter(|m| m.starts_with("export.")).collect();
    assert_eq!(methods, ["export.spool", "export.render"]);
}

#[test]
fn the_spool_file_is_gone_after_each_outcome() {
    let dir = tempfile::tempdir().unwrap();
    let f = Fake::start(app);
    let file = dir.path().join("o.png");
    let spools = || {
        let d = std::env::temp_dir().join(format!("vd-export-spool-test-{}", std::process::id())).join("export-spool");
        std::fs::read_dir(d).map(|r| r.count()).unwrap_or(0)
    };
    // File, stdout, taken name (refused before the render), and a missing folder.
    for args in [vec!["export", "a", "-o", file.to_str().unwrap()], vec!["export", "a", "-o", "-", "--force"], vec!["export", "a", "-o", file.to_str().unwrap()]] {
        vd(&args, Some(&f.socket), None);
        assert_eq!(spools(), 0, "{args:?}");
    }
    let missing = dir.path().join("nope/o.png");
    let o = vd(&["export", "a", "-o", missing.to_str().unwrap()], Some(&f.socket), None);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("the folder") && err(&o).contains("does not exist"), "{}", err(&o));
    assert_eq!(spools(), 0);
    assert_eq!(std::fs::read(&file).unwrap(), PNG);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
