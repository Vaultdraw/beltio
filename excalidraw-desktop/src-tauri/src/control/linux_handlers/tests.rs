use super::*;
use std::cell::RefCell;
use std::fs;

const PROGRAM: &str = "/opt/Vaultdraw/Vaultdraw.AppImage";

fn no_run(_: &str, _: &[&str]) -> std::result::Result<(), String> {
    Ok(())
}

#[test]
fn the_desktop_file_lists_the_types_and_the_scheme() {
    let t = desktop_text(PROGRAM).unwrap();
    assert!(t.starts_with("[Desktop Entry]\n"));
    assert!(t.contains("Exec=\"/opt/Vaultdraw/Vaultdraw.AppImage\" %U\n"));
    assert!(t.contains(
        "MimeType=application/vnd.excalidraw+json;application/vnd.excalidrawlib+json;x-scheme-handler/vaultdraw;\n"
    ));
    assert!(t.contains(MARKER));
    assert!(!t.contains("{{"), "no template field left over");
}

#[test]
fn the_mime_file_maps_both_extensions() {
    assert!(MIME_XML.contains(r#"<glob pattern="*.excalidraw"/>"#));
    assert!(MIME_XML.contains(r#"<glob pattern="*.excalidrawlib"/>"#));
    assert!(MIME_XML.contains(r#"type="application/vnd.excalidraw+json""#));
    assert!(MIME_XML.contains(r#"type="application/vnd.excalidrawlib+json""#));
    assert!(MIME_XML.contains(MARKER));
}

#[test]
fn security_the_program_path_is_quoted_and_cannot_add_keys() {
    assert_eq!(exec_value("/a b/c").unwrap(), "\"/a b/c\"");
    assert_eq!(exec_value("/a\"b").unwrap(), "\"/a\\\\\"b\"");
    assert_eq!(exec_value("/a$b`c").unwrap(), "\"/a\\\\$b\\\\`c\"");
    assert_eq!(exec_value("/a\\b").unwrap(), "\"/a\\\\\\\\b\"");
    assert_eq!(exec_value("/100%/x").unwrap(), "\"/100%%/x\"");
    for bad in ["/a\nExec=/bin/sh", "/a\rb", "/a\0b", "relative/path", ""] {
        assert!(exec_value(bad).is_err(), "{bad:?}");
    }
    // The whole file never gains a line from the path.
    let t = desktop_text("/a b/c d").unwrap();
    assert_eq!(t.lines().filter(|l| l.starts_with("Exec=")).count(), 1);
}

#[test]
fn the_data_folder_is_the_users_never_system_wide() {
    assert_eq!(data_home(Some("/x/data"), Some("/home/u")).unwrap(), PathBuf::from("/x/data"));
    assert_eq!(data_home(None, Some("/home/u")).unwrap(), PathBuf::from("/home/u/.local/share"));
    assert_eq!(data_home(Some("relative"), Some("/home/u")).unwrap(), PathBuf::from("/home/u/.local/share"));
    assert!(data_home(None, None).is_err());
    assert!(data_home(None, Some("home/u")).is_err());
}

#[test]
fn plan_names_exactly_two_files_under_the_data_folder_and_three_commands() {
    let d = tempfile::tempdir().unwrap();
    let p = plan(d.path(), PROGRAM).unwrap();
    let paths: Vec<_> = p.files.iter().map(|f| Path::new(&f.path).strip_prefix(d.path()).unwrap().to_str().unwrap().to_string()).collect();
    assert_eq!(paths, ["applications/vaultdraw.desktop", "mime/packages/vaultdraw.xml"]);
    assert!(p.files.iter().all(|f| f.state == State::New));
    assert_eq!(p.commands.len(), 3);
    assert!(p.commands[2].ends_with("x-scheme-handler/vaultdraw"), "only the link scheme gets a default");
    assert!(!p.commands.iter().any(|c| c.contains("excalidraw+json")), "file types are not claimed");
    assert!(!d.path().join("applications").exists(), "planning writes nothing");
}

#[test]
fn apply_writes_the_files_runs_the_helpers_and_is_idempotent() {
    let d = tempfile::tempdir().unwrap();
    let ran = RefCell::new(Vec::<String>::new());
    let run = |prog: &str, args: &[&str]| {
        ran.borrow_mut().push(format!("{prog} {}", args.join(" ")));
        Ok(())
    };
    let r = apply(&plan(d.path(), PROGRAM).unwrap(), &run).unwrap();
    assert_eq!(r.written.len(), 2);
    assert_eq!(ran.borrow().len(), 3);
    let desktop = fs::read_to_string(d.path().join("applications/vaultdraw.desktop")).unwrap();
    assert_eq!(desktop, desktop_text(PROGRAM).unwrap());
    ran.borrow_mut().clear();
    let again = apply(&plan(d.path(), PROGRAM).unwrap(), &run).unwrap();
    assert!(again.written.is_empty() && again.skipped.len() == 2);
    assert!(ran.borrow().is_empty(), "nothing changed, nothing run");
}

#[test]
fn a_moved_program_updates_our_own_file() {
    let d = tempfile::tempdir().unwrap();
    apply(&plan(d.path(), PROGRAM).unwrap(), &no_run).unwrap();
    let p = plan(d.path(), "/new/place/Vaultdraw").unwrap();
    assert_eq!(p.files[0].state, State::Update);
    assert_eq!(p.files[1].state, State::Same);
    let r = apply(&p, &no_run).unwrap();
    assert_eq!(r.written.len(), 1);
    assert!(fs::read_to_string(d.path().join("applications/vaultdraw.desktop")).unwrap().contains("/new/place/Vaultdraw"));
}

#[test]
fn security_a_file_that_is_not_ours_is_never_replaced() {
    let d = tempfile::tempdir().unwrap();
    let apps = d.path().join("applications");
    fs::create_dir_all(&apps).unwrap();
    fs::write(apps.join("vaultdraw.desktop"), "[Desktop Entry]\nName=Mine\n").unwrap();
    let p = plan(d.path(), PROGRAM).unwrap();
    assert_eq!(p.files[0].state, State::Foreign);
    let r = apply(&p, &no_run).unwrap();
    assert_eq!(fs::read_to_string(apps.join("vaultdraw.desktop")).unwrap(), "[Desktop Entry]\nName=Mine\n");
    assert_eq!(r.written.len(), 1, "the free target is still written");
    assert!(r.skipped[0].contains("left alone"));
}

#[cfg(unix)]
#[test]
fn security_a_symlink_target_is_never_followed_or_replaced() {
    let d = tempfile::tempdir().unwrap();
    let apps = d.path().join("applications");
    fs::create_dir_all(&apps).unwrap();
    let victim = d.path().join("victim.txt");
    fs::write(&victim, "keep").unwrap();
    std::os::unix::fs::symlink(&victim, apps.join("vaultdraw.desktop")).unwrap();
    let p = plan(d.path(), PROGRAM).unwrap();
    assert_eq!(p.files[0].state, State::Foreign);
    apply(&p, &no_run).unwrap();
    assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
}

#[test]
fn security_state_is_checked_again_at_apply_time() {
    let d = tempfile::tempdir().unwrap();
    let p = plan(d.path(), PROGRAM).unwrap();
    // After the dialog, someone else creates the file.
    let apps = d.path().join("applications");
    fs::create_dir_all(&apps).unwrap();
    fs::write(apps.join("vaultdraw.desktop"), "theirs").unwrap();
    apply(&p, &no_run).unwrap();
    assert_eq!(fs::read_to_string(apps.join("vaultdraw.desktop")).unwrap(), "theirs");
}

#[test]
fn a_missing_helper_is_a_note_not_a_failure() {
    let d = tempfile::tempdir().unwrap();
    let run = |prog: &str, _: &[&str]| if prog == "xdg-mime" { Err("not found".to_string()) } else { Ok(()) };
    let r = apply(&plan(d.path(), PROGRAM).unwrap(), &run).unwrap();
    assert_eq!(r.written.len(), 2);
    assert_eq!(r.notes, ["xdg-mime: not found"]);
}
