use super::*;
use crate::network::test_server::{start, Resp};
use std::sync::atomic::Ordering;
use tempfile::tempdir;

const THEME: &str = r##"{"dark":{"mSurface":"#000"}}"##;

fn dirs_in(root: &Path, consent: Option<&str>) -> config::Dirs {
    let d = config::Dirs { config: root.join("config"), state: root.join("state") };
    fs::create_dir_all(&d.config).unwrap();
    if let Some(text) = consent {
        fs::write(d.config.join("config.toml"), text).unwrap();
    }
    d
}

const ALLOW: &str = "[network]\nallow_themes = true\n";

fn src(url: &str) -> SourceIn {
    SourceIn { url: Some(url.into()), repo: None, path: None, commit: None, reference: None, sha256: "a".repeat(64) }
}

fn req(name: &str, replace: bool) -> WriteRequest {
    WriteRequest { name: name.into(), json: THEME.into(), source: src("https://x.example/a.json"), replace }
}

fn code<T>(r: Result<T>) -> String {
    r.err().map(|e| e.code).unwrap_or_default()
}

fn entry(path: &str, kind: &str, size: Option<u64>) -> TreeEntry {
    TreeEntry { path: path.into(), kind: kind.into(), size }
}

// ---- classification ----

fn repo(owner: &str, name: &str, reference: Option<&str>, sub: Option<&str>) -> Source {
    Source::Repo(RepoSpec { owner: owner.into(), repo: name.into(), reference: reference.map(Into::into), subpath: sub.map(Into::into) })
}

#[test]
fn classifies_repos() {
    assert_eq!(classify("owner/repo").unwrap(), repo("owner", "repo", None, None));
    assert_eq!(classify("  Vaultdraw/themes ").unwrap(), repo("Vaultdraw", "themes", None, None));
    assert_eq!(classify("github.com/o/r").unwrap(), repo("o", "r", None, None));
    assert_eq!(classify("https://github.com/o/r").unwrap(), repo("o", "r", None, None));
    assert_eq!(classify("https://github.com/o/r/").unwrap(), repo("o", "r", None, None));
    assert_eq!(classify("https://github.com/o/r.git").unwrap(), repo("o", "r", None, None));
    assert_eq!(classify("https://github.com/o/r/tree/main").unwrap(), repo("o", "r", Some("main"), None));
    assert_eq!(
        classify("https://github.com/o/r/tree/v1.2/themes/Dark%20Pack").unwrap(),
        repo("o", "r", Some("v1.2"), Some("themes/Dark Pack"))
    );
    assert_eq!(classify("github.com/o/r/tree/dev/x").unwrap(), repo("o", "r", Some("dev"), Some("x")));
}

#[test]
fn classifies_files() {
    let file = |s: &str| match classify(s).unwrap() {
        Source::File(u) => u.to_string(),
        other => panic!("{other:?}"),
    };
    assert_eq!(file("https://example.com/themes/Nord.json"), "https://example.com/themes/Nord.json");
    assert_eq!(file("https://example.com/a.JSON?x=1"), "https://example.com/a.JSON?x=1");
    assert_eq!(file("https://raw.githubusercontent.com/o/r/main/Nord.json"), "https://raw.githubusercontent.com/o/r/main/Nord.json");
    assert_eq!(
        file("https://github.com/o/r/blob/main/Tokyo%20Night/Tokyo%20Night.json"),
        "https://raw.githubusercontent.com/o/r/main/Tokyo%20Night/Tokyo%20Night.json"
    );
    assert_eq!(file("https://github.com/o/r/raw/abc1234/Nord.json"), "https://raw.githubusercontent.com/o/r/abc1234/Nord.json");
    assert_eq!(file("http://127.0.0.1:9/Nord.json"), "http://127.0.0.1:9/Nord.json");
}

#[test]
fn rejects_bad_inputs() {
    for bad in [
        "", "   ", "justone", "a/b/c", "owner/re po", "../x", "o/..", "http://example.com/a.json", "ftp://x/a.json",
        "https://u:p@example.com/a.json", "https://10.1.1.1/a.json", "https://github.com/o", "c:/x/y",
        "example.com/x.json", "example.com/a", "themes.example.org/dir/x.json", "www.github.com/o/r",
    ] {
        assert!(classify(bad).is_err(), "{bad:?} was accepted");
    }
    assert_eq!(code(classify("https://example.com/page")), "NOT_A_THEME_URL");
    assert_eq!(code(classify("https://github.com/o/r/blob/main/README.md")), "NOT_A_THEME_URL");
    assert_eq!(code(classify("https://github.com/o/r/issues")), "NOT_A_THEME_URL");
}

#[test]
fn repo_paths_are_validated() {
    let ep = Endpoints::github();
    for bad in ["../x.json", "a/../b.json", "/abs.json", "a\\b.json", "", "a//b.json", "./a.json"] {
        assert_eq!(code(raw_url(&ep.raw, "o", "r", "main", bad)), "INVALID_PATH", "{bad:?}");
    }
    assert_eq!(code(raw_url(&ep.raw, "o", "r", "../x", "a.json")), "INVALID_PATH");
    assert_eq!(code(raw_url(&ep.raw, "o/x", "r", "main", "a.json")), "INVALID_PATH");
    let u = raw_url(&ep.raw, "o", "r", "0123abc", "Tokyo Night/Tokyo Night.json").unwrap();
    assert_eq!(u.as_str(), "https://raw.githubusercontent.com/o/r/0123abc/Tokyo%20Night/Tokyo%20Night.json");
}

// ---- tree filtering ----

#[test]
fn filters_tree_in_root_and_themes_dir() {
    let tree = vec![
        entry("Nord/Nord.json", "blob", Some(900)),
        entry("Nord/meta.json", "blob", Some(100)),
        entry("Nord/preview.png", "blob", Some(100)),
        entry("Dracula.json", "blob", Some(900)),
        entry("themes/Gruvbox/Gruvbox.json", "blob", Some(900)),
        entry("themes/Solo.json", "blob", None),
        entry("package.json", "blob", Some(10)),
        entry("tsconfig.json", "blob", Some(10)),
        entry("index.json", "blob", Some(10)),
        entry("source.json", "blob", Some(10)),
        entry("Big.json", "blob", Some(5000)),
        entry("Wrong/Other.json", "blob", Some(10)),
        entry("deep/er/Deep.json", "blob", Some(10)),
        entry("Folder.json", "tree", None),
        entry(".github/Hidden.json", "blob", Some(10)),
    ];
    let got = filter_tree(&tree, None, 1000);
    let names: Vec<_> = got.iter().map(|t| (t.name.as_str(), t.path.as_str())).collect();
    assert_eq!(
        names,
        [
            ("Dracula", "Dracula.json"),
            ("Gruvbox", "themes/Gruvbox/Gruvbox.json"),
            ("Nord", "Nord/Nord.json"),
            ("Solo", "themes/Solo.json"),
        ]
    );
}

#[test]
fn filters_tree_by_subpath_and_single_file() {
    let tree = vec![
        entry("a/Nord/Nord.json", "blob", Some(10)),
        entry("a/Plain.json", "blob", Some(10)),
        entry("a/Plain/Sub/Sub.json", "blob", Some(10)),
        entry("ab/Other.json", "blob", Some(10)),
        entry("Root.json", "blob", Some(10)),
    ];
    let names = |sub| filter_tree(&tree, Some(sub), 1000).into_iter().map(|t| t.name).collect::<Vec<_>>();
    assert_eq!(names("a"), ["Nord", "Plain"]);
    assert_eq!(names("/a/"), ["Nord", "Plain"]);
    assert_eq!(names("a/Plain.json"), ["Plain"]);
    assert!(names("zzz").is_empty());
}

#[test]
fn tree_listing_is_capped() {
    let tree: Vec<_> = (0..MAX_THEMES + 20).map(|i| entry(&format!("t{i:04}.json"), "blob", Some(1))).collect();
    assert_eq!(filter_tree(&tree, None, 10).len(), MAX_THEMES);
}

// ---- names, time ----

#[test]
fn sanitizes_names() {
    for ok in ["Nord", "Tokyo Night", "Rosé Pine", "a.b", "Ayu-Green_2"] {
        assert_eq!(sanitize_name(ok).unwrap(), ok);
    }
    let long = "x".repeat(81);
    for bad in ["", " ", ".", "..", ".hidden", "a/b", "a\\b", "a\u{0}b", "a\nb", "source", "Source", " pad", "pad ", "a:b", "a\u{202E}b", "a\u{200B}b", "\u{FEFF}a", &long] {
        assert_eq!(code(sanitize_name(bad)), "INVALID_NAME", "{bad:?}");
    }
    assert!(sanitize_name(&"x".repeat(80)).is_ok());
}

#[test]
fn formats_iso_timestamps() {
    assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
    assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    assert_eq!(iso_utc(1_792_800_000), "2026-10-24T00:00:00Z");
}

#[test]
fn file_name_prefers_json_name_field() {
    let u = Url::parse("https://x.example/dir/Tokyo%20Night.json").unwrap();
    assert_eq!(file_theme_name("{}", &u), "Tokyo Night");
    assert_eq!(file_theme_name(r#"{"name":" Custom "}"#, &u), "Custom");
    assert_eq!(file_theme_name(r#"{"name":""}"#, &u), "Tokyo Night");
}

// ---- write / installed / uninstall ----

#[test]
fn writes_installed_theme_and_source_json() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let w = write_in(&d, &req("Nord", false)).unwrap();
    let folder = d.config.join("themes").join("Nord");
    assert_eq!(w, Written { name: "Nord".into(), path: folder.join("Nord.json").to_string_lossy().into_owned() });
    assert_eq!(fs::read_to_string(folder.join("Nord.json")).unwrap(), THEME);
    let s: Value = serde_json::from_slice(&fs::read(folder.join("source.json")).unwrap()).unwrap();
    assert_eq!(s["url"], "https://x.example/a.json");
    assert_eq!(s["repo"], Value::Null);
    assert_eq!(s["sha256"], "a".repeat(64));
    assert!(s["installed"].as_str().unwrap().ends_with('Z'));
    // No temp files left behind.
    let names: Vec<_> = fs::read_dir(&folder).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(names.len(), 2, "{names:?}");

    let list = installed_in(&d).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Nord");
    assert_eq!(list[0].source["sha256"], "a".repeat(64));
}

#[test]
fn clash_needs_replace_and_only_for_installed_themes() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    write_in(&d, &req("Nord", false)).unwrap();
    assert_eq!(code(write_in(&d, &req("Nord", false))), "THEME_EXISTS");
    let mut again = req("Nord", true);
    again.json = r##"{"dark":{"mSurface":"#111"}}"##.into();
    write_in(&d, &again).unwrap();
    assert!(fs::read_to_string(themes.join("Nord").join("Nord.json")).unwrap().contains("#111"));

    // Hand-made folder and loose file: never overwritten, even with replace.
    fs::create_dir_all(themes.join("Mine")).unwrap();
    fs::write(themes.join("Mine").join("Mine.json"), "{}").unwrap();
    fs::write(themes.join("Loose.json"), "{}").unwrap();
    for name in ["Mine", "Loose"] {
        assert_eq!(code(write_in(&d, &req(name, true))), "THEME_EXISTS", "{name}");
    }
    assert_eq!(fs::read_to_string(themes.join("Mine").join("Mine.json")).unwrap(), "{}");
    assert!(!themes.join("Mine").join("source.json").exists());
}

#[test]
fn write_rejects_bad_requests_without_touching_disk() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    assert_eq!(code(write_in(&d, &req("../evil", false))), "INVALID_NAME");
    assert_eq!(code(write_in(&d, &req("source", false))), "INVALID_NAME");
    let mut bad = req("A", false);
    bad.json = "{not json".into();
    assert_eq!(code(write_in(&d, &bad)), "INVALID_JSON");
    let mut big = req("A", false);
    big.json = format!("\"{}\"", "x".repeat(MAX_THEME_BYTES as usize));
    assert_eq!(code(write_in(&d, &big)), "TOO_LARGE");
    let mut src_bad = req("A", false);
    src_bad.source.sha256 = "xyz".into();
    assert_eq!(code(write_in(&d, &src_bad)), "INVALID_SOURCE");
    assert!(!themes.join("A").exists());
    assert!(!d.config.parent().unwrap().join("evil").exists());
}

#[test]
fn installed_lists_only_folders_with_source_json() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    assert!(installed_in(&d).unwrap().is_empty());
    write_in(&d, &req("beta", false)).unwrap();
    write_in(&d, &req("Alpha", false)).unwrap();
    fs::create_dir_all(themes.join("Mine")).unwrap();
    fs::write(themes.join("Mine").join("Mine.json"), "{}").unwrap();
    fs::write(themes.join("Loose.json"), "{}").unwrap();
    let names: Vec<_> = installed_in(&d).unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(names, ["Alpha", "beta"]);
}

#[test]
fn uninstall_only_removes_installed_themes() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    write_in(&d, &req("Nord", false)).unwrap();
    fs::create_dir_all(themes.join("Mine")).unwrap();
    fs::write(themes.join("Mine").join("Mine.json"), "{}").unwrap();
    assert_eq!(code(uninstall_in(&d, "Mine")), "THEME_NOT_INSTALLED");
    assert_eq!(code(uninstall_in(&d, "Missing")), "THEME_NOT_INSTALLED");
    assert_eq!(code(uninstall_in(&d, "../Mine")), "INVALID_NAME");
    assert_eq!(code(uninstall_in(&d, "")), "INVALID_NAME");
    assert!(themes.join("Mine").join("Mine.json").exists());
    uninstall_in(&d, "Nord").unwrap();
    assert!(!themes.join("Nord").exists());
}

#[test]
fn uninstall_keeps_files_the_user_added() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    write_in(&d, &req("Nord", false)).unwrap();
    fs::write(themes.join("Nord").join("Nord-mine.json"), "{}").unwrap();
    uninstall_in(&d, "Nord").unwrap();
    assert!(themes.join("Nord").join("Nord-mine.json").exists());
    assert!(!themes.join("Nord").join("Nord.json").exists() && !themes.join("Nord").join("source.json").exists());
}

#[cfg(unix)]
#[test]
fn symlinked_folders_are_not_ours() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), None);
    let themes = d.config.join("themes");
    let outside = t.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("source.json"), "{}").unwrap();
    fs::create_dir_all(&themes).unwrap();
    std::os::unix::fs::symlink(&outside, themes.join("Link")).unwrap();
    assert!(installed_in(&d).unwrap().is_empty());
    assert_eq!(code(uninstall_in(&d, "Link")), "THEME_NOT_INSTALLED");
    assert_eq!(code(write_in(&d, &req("Link", true))), "THEME_EXISTS");
    assert!(outside.join("source.json").exists());
}

// ---- network flows against a loopback server ----

fn ep(base: &str) -> Endpoints {
    Endpoints { api: base.into(), raw: base.into() }
}

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

fn repo_server() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    start(|p| match p {
        "/repos/o/r/commits/HEAD" | "/repos/o/r/commits/dev" => Resp::ok(SHA),
        p if p == format!("/repos/o/r/git/trees/{SHA}?recursive=1") => Resp::ok(
            r#"{"sha":"x","truncated":false,"tree":[
                {"path":"Nord","type":"tree"},
                {"path":"Nord/Nord.json","type":"blob","size":30},
                {"path":"Nord/meta.json","type":"blob","size":30},
                {"path":"Tokyo Night.json","type":"blob","size":30},
                {"path":"Big.json","type":"blob","size":999999},
                {"path":"package.json","type":"blob","size":30}]}"#,
        ),
        p if p == format!("/o/r/{SHA}/Nord/Nord.json") => Resp::ok(THEME),
        p if p == format!("/o/r/{SHA}/Tokyo%20Night.json") => Resp::ok(r#"{"name":"Tokyo"}"#),
        _ => Resp::status(404),
    })
}
use std::sync::Arc;

#[test]
fn consent_denied_makes_zero_connections() {
    let (base, hits) = repo_server();
    for config in [Some("[network]\nallow_themes = false\n"), Some("[network]\noffline = true\nallow_themes = true\n"), Some("[network]\nenabled = false\n")] {
        let t = tempdir().unwrap();
        let d = dirs_in(t.path(), config);
        let expect = if config.is_some_and(|c| c.contains("offline") || c.contains("enabled")) { "NETWORK_DISABLED" } else { "NETWORK_NOT_ALLOWED" };
        assert_eq!(code(resolve_in(&d, &ep(&base), &format!("{base}/Nord.json"), 1000)), expect);
        assert_eq!(code(resolve_in(&d, &ep(&base), "o/r", 1000)), expect);
        let f = FetchRef::Url { url: format!("{base}/Nord.json") };
        assert_eq!(code(fetch_in(&d, &ep(&base), &f, 1000)), expect);
        assert_eq!(code(update_fetch_in(&d, &ep(&base), "Nord", 1000)), expect);
    }
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[test]
fn resolves_a_single_file_url() {
    let (base, _) = start(|p| if p == "/dir/Nord.json" { Resp::ok(THEME) } else { Resp::status(404) });
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    let r = resolve_in(&d, &ep(&base), &format!("{base}/dir/Nord.json"), 1000).unwrap();
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(v["kind"], "file");
    assert_eq!(v["name"], "Nord");
    assert_eq!(v["json"], THEME);
    assert_eq!(v["sha256"], sha256_hex(THEME.as_bytes()));
    assert_eq!(v["url"], format!("{base}/dir/Nord.json"));
    assert_eq!(code(resolve_in(&d, &ep(&base), &format!("{base}/dir/Missing.json"), 1000)), "HTTP_STATUS");
    // The caller's limit is honoured.
    assert_eq!(code(resolve_in(&d, &ep(&base), &format!("{base}/dir/Nord.json"), 5)), "TOO_LARGE");
}

#[test]
fn resolves_a_repo_and_fetches_its_files() {
    let (base, _) = repo_server();
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    let r = serde_json::to_value(resolve_in(&d, &ep(&base), "o/r", 100_000).unwrap()).unwrap();
    assert_eq!(
        r,
        json!({"kind":"repo","owner":"o","repo":"r","commit":SHA,"ref":"HEAD","themes":[
            {"name":"Nord","path":"Nord/Nord.json"},
            {"name":"Tokyo Night","path":"Tokyo Night.json"}]})
    );
    // `tree/dev` resolves that ref.
    let dev = serde_json::to_value(resolve_in(&d, &ep(&base), "https://github.com/o/r/tree/dev", 100_000).unwrap()).unwrap();
    assert_eq!(dev["ref"], "dev");
    assert_eq!(code(resolve_in(&d, &ep(&base), "https://github.com/o/r/tree/nope", 100_000)), "HTTP_STATUS");

    let f = FetchRef::Repo { owner: "o".into(), repo: "r".into(), commit: SHA.into(), path: "Nord/Nord.json".into() };
    let got = fetch_in(&d, &ep(&base), &f, 1000).unwrap();
    assert_eq!(got.json, THEME);
    assert_eq!(got.sha256, sha256_hex(THEME.as_bytes()));
    assert_eq!(got.url, format!("{base}/o/r/{SHA}/Nord/Nord.json"));
    let spaced = FetchRef::Repo { owner: "o".into(), repo: "r".into(), commit: SHA.into(), path: "Tokyo Night.json".into() };
    assert!(fetch_in(&d, &ep(&base), &spaced, 1000).unwrap().json.contains("Tokyo"));
    let evil = FetchRef::Repo { owner: "o".into(), repo: "r".into(), commit: SHA.into(), path: "../x.json".into() };
    assert_eq!(code(fetch_in(&d, &ep(&base), &evil, 1000)), "INVALID_PATH");
    let url = FetchRef::Url { url: format!("{base}/o/r/{SHA}/Nord/Nord.json") };
    assert_eq!(fetch_in(&d, &ep(&base), &url, 1000).unwrap().json, THEME);
}

#[test]
fn repo_without_themes_is_an_error() {
    let (base, _) = start(|p| {
        if p.contains("/commits/") {
            Resp::ok(SHA)
        } else {
            Resp::ok(r#"{"tree":[{"path":"README.md","type":"blob","size":1}]}"#)
        }
    });
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    assert_eq!(code(resolve_in(&d, &ep(&base), "o/r", 1000)), "NO_THEMES_FOUND");
}

#[test]
fn update_check_url_source() {
    use std::sync::Mutex;
    let body = Arc::new(Mutex::new(THEME.to_string()));
    let served = body.clone();
    let (base, _) = start(move |_| Resp::ok(served.lock().unwrap().clone()));
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    let url = format!("{base}/Nord.json");
    let mut r = req("Nord", false);
    r.source = SourceIn { url: Some(url.clone()), repo: None, path: None, commit: None, reference: None, sha256: sha256_hex(THEME.as_bytes()) };
    write_in(&d, &r).unwrap();

    let same = update_fetch_in(&d, &ep(&base), "Nord", 1000).unwrap();
    assert!(!same.changed && same.json.is_none() && same.commit.is_none());
    assert_eq!(serde_json::to_value(&same).unwrap(), json!({"changed": false, "sha256": sha256_hex(THEME.as_bytes())}));

    let newer = r##"{"dark":{"mSurface":"#222"}}"##;
    *body.lock().unwrap() = newer.into();
    let changed = update_fetch_in(&d, &ep(&base), "Nord", 1000).unwrap();
    assert!(changed.changed);
    assert_eq!(changed.json.as_deref(), Some(newer));
    assert_eq!(changed.sha256, sha256_hex(newer.as_bytes()));

    // Not installed (hand-made) themes cannot be updated.
    fs::create_dir_all(d.config.join("themes").join("Mine")).unwrap();
    assert_eq!(code(update_fetch_in(&d, &ep(&base), "Mine", 1000)), "THEME_NOT_INSTALLED");
}

#[test]
fn update_check_repo_source_uses_head_commit() {
    let (base, _) = repo_server();
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    let mut r = req("Nord", false);
    r.source = SourceIn {
        url: None,
        repo: Some("o/r".into()),
        path: Some("Nord/Nord.json".into()),
        commit: Some("f".repeat(40)),
        reference: None,
        sha256: "b".repeat(64),
    };
    write_in(&d, &r).unwrap();
    let u = update_fetch_in(&d, &ep(&base), "Nord", 1000).unwrap();
    assert!(u.changed);
    assert_eq!(u.commit.as_deref(), Some(SHA));
    assert_eq!(u.json.as_deref(), Some(THEME));
    assert_eq!(u.sha256, sha256_hex(THEME.as_bytes()));
}

#[test]
fn bare_web_address_is_not_a_github_repo() {
    // A dot in the first segment means a host name; GitHub owners cannot contain dots.
    let e = classify("example.com/x.json").unwrap_err();
    assert_eq!(e.code, "NOT_A_THEME_URL");
    assert!(e.message.contains("https://"), "{}", e.message);
    // Real owner/repo forms still work, including dots in the repo name.
    assert!(classify("o/r.js").is_ok());
    assert!(classify("github.com/o/r").is_ok());
}

/// Server where `dev` and `HEAD` point at different commits, to prove which one an update follows.
fn two_branch_server() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    let dev_sha = "d".repeat(40);
    start(move |p| match p {
        "/repos/o/r/commits/HEAD" => Resp::ok(SHA),
        "/repos/o/r/commits/dev" => Resp::ok(dev_sha.clone()),
        p if p == format!("/o/r/{SHA}/Nord/Nord.json") => Resp::ok(r#"{"name":"from-default-branch"}"#),
        p if p == format!("/o/r/{}/Nord/Nord.json", "d".repeat(40)) => Resp::ok(THEME),
        _ => Resp::status(404),
    })
}

fn installed_from(d: &config::Dirs, reference: Option<&str>) {
    let mut r = req("Nord", false);
    r.source = SourceIn {
        url: None,
        repo: Some("o/r".into()),
        path: Some("Nord/Nord.json".into()),
        commit: Some("f".repeat(40)),
        reference: reference.map(str::to_string),
        sha256: "b".repeat(64),
    };
    write_in(d, &r).unwrap();
}

#[test]
fn update_follows_the_branch_it_was_installed_from() {
    let (base, _) = two_branch_server();
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    installed_from(&d, Some("dev"));
    let u = update_fetch_in(&d, &ep(&base), "Nord", 1000).unwrap();
    assert_eq!(u.commit.as_deref(), Some("d".repeat(40).as_str()));
    assert_eq!(u.json.as_deref(), Some(THEME));
    // The ref is stored in source.json.
    let stored = installed_in(&d).unwrap();
    assert_eq!(stored[0].source["ref"], "dev");
}

#[test]
fn update_without_a_stored_ref_follows_the_default_branch() {
    let (base, _) = two_branch_server();
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    installed_from(&d, None);
    let u = update_fetch_in(&d, &ep(&base), "Nord", 1000).unwrap();
    assert_eq!(u.commit.as_deref(), Some(SHA));
}

#[test]
fn a_malformed_ref_is_refused() {
    let t = tempdir().unwrap();
    let d = dirs_in(t.path(), Some(ALLOW));
    let mut r = req("Nord", false);
    r.source.reference = Some("../x".into());
    assert_eq!(code(write_in(&d, &r)), "INVALID_SOURCE");
}
