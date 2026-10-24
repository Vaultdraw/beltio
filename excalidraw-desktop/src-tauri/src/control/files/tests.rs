use super::*;
use std::fs;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

const DRAWING: &str = r#"{"type":"excalidraw","version":2,"elements":[]}"#;
const LIB: &str = r#"{"type":"excalidrawlib","version":2,"libraryItems":[{"id":"a"}]}"#;

#[test]
fn kinds_by_extension_case_insensitive() {
    assert_eq!(kind_of("/a/b.excalidraw"), Some(Kind::Drawing));
    assert_eq!(kind_of("/a/B.EXCALIDRAW"), Some(Kind::Drawing));
    assert_eq!(kind_of("/a/b.excalidrawlib"), Some(Kind::Library));
    for no in ["/a/b.json", "/a/b.excalidraw.txt", "/a/excalidraw", "/a/b."] {
        assert_eq!(kind_of(no), None, "{no}");
    }
    assert!(is_file_arg("x.excalidraw") && !is_file_arg("-x.excalidraw") && !is_file_arg("vaultdraw://open"));
}

#[test]
fn relative_paths_resolve_against_an_absolute_cwd_only() {
    assert_eq!(absolute("/a/b.excalidraw", None).as_deref(), Some("/a/b.excalidraw"));
    assert_eq!(absolute("b.excalidraw", Some("/w")).as_deref(), Some("/w/b.excalidraw"));
    assert_eq!(absolute("b.excalidraw", None), None);
    assert_eq!(absolute("b.excalidraw", Some("rel")), None);
}

#[test]
fn security_plan_refuses_odd_paths() {
    let ok = plan_for("/v/a.excalidraw", "os").unwrap();
    assert_eq!(ok["action"], "file");
    assert_eq!(ok["kind"], "drawing");
    assert_eq!(plan_for("/v/a.excalidrawlib", "os").unwrap()["kind"], "library");
    assert!(plan_for("a.excalidraw", "os").is_err(), "relative");
    assert!(plan_for("/v/a.txt", "os").is_err(), "extension");
    assert!(plan_for("/v/a\nb.excalidraw", "os").is_err(), "newline");
    assert!(plan_for("/v/a\u{202e}b.excalidraw", "os").is_err(), "bidi");
    assert!(plan_for(&format!("/{}.excalidraw", "a".repeat(MAX_PATH_BYTES)), "os").is_err(), "long");
}

#[test]
fn security_a_grant_works_once_and_is_capped() {
    let g = Grants::default();
    g.grant("/a.excalidraw");
    assert!(!g.take("/other.excalidraw"));
    assert!(g.take("/a.excalidraw"));
    assert!(!g.take("/a.excalidraw"), "single use");
    for i in 0..GRANT_CAP + 5 {
        g.grant(&format!("/f{i}.excalidraw"));
    }
    assert_eq!(g.len(), GRANT_CAP);
    assert!(!g.take("/f0.excalidraw"), "the oldest was dropped");
    assert!(g.take(&format!("/f{}.excalidraw", GRANT_CAP + 4)));
}

#[test]
fn reads_a_drawing_and_a_library() {
    let d = tmp();
    let a = d.path().join("a.excalidraw");
    fs::write(&a, DRAWING).unwrap();
    let r = read_checked(a.to_str().unwrap(), Kind::Drawing).unwrap();
    assert_eq!(r, ExternalFile { name: "a.excalidraw".into(), json: DRAWING.into() });
    let l = d.path().join("l.excalidrawlib");
    fs::write(&l, LIB).unwrap();
    assert_eq!(read_checked(l.to_str().unwrap(), Kind::Library).unwrap().json, LIB);
}

#[test]
fn security_wrong_extension_kind_or_content_is_refused() {
    let d = tmp();
    let a = d.path().join("a.excalidraw");
    fs::write(&a, DRAWING).unwrap();
    assert!(read_checked(a.to_str().unwrap(), Kind::Library).is_err(), "kind must match the extension");
    let bad = d.path().join("bad.excalidraw");
    fs::write(&bad, "not json").unwrap();
    assert!(read_checked(bad.to_str().unwrap(), Kind::Drawing).is_err());
    let lib = d.path().join("l.excalidrawlib");
    fs::write(&lib, DRAWING).unwrap();
    assert!(read_checked(lib.to_str().unwrap(), Kind::Library).is_err(), "a drawing is not a library");
    let bin = d.path().join("bin.excalidraw");
    fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
    assert!(read_checked(bin.to_str().unwrap(), Kind::Drawing).is_err());
    assert!(read_checked("rel.excalidraw", Kind::Drawing).is_err(), "relative");
    assert!(read_checked(d.path().join("missing.excalidraw").to_str().unwrap(), Kind::Drawing).is_err());
    let dir = d.path().join("dir.excalidraw");
    fs::create_dir(&dir).unwrap();
    assert!(read_checked(dir.to_str().unwrap(), Kind::Drawing).is_err(), "a folder");
}

#[cfg(unix)]
#[test]
fn security_a_symlink_is_refused() {
    let d = tmp();
    let real = d.path().join("real.excalidraw");
    fs::write(&real, DRAWING).unwrap();
    let link = d.path().join("link.excalidraw");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let e = read_checked(link.to_str().unwrap(), Kind::Drawing).unwrap_err();
    assert_eq!(e.code, "INVALID_PATH");
    assert!(read_checked(real.to_str().unwrap(), Kind::Drawing).is_ok());
}

#[test]
fn security_an_oversize_drawing_is_refused() {
    let d = tmp();
    let big = d.path().join("big.excalidraw");
    let f = fs::File::create(&big).unwrap();
    f.set_len(vaultdraw_core::paths::MAX_DRAWING_BYTES + 1).unwrap();
    assert_eq!(read_checked(big.to_str().unwrap(), Kind::Drawing).unwrap_err().code, "INVALID_FILE");
}
