//! The quiet update check: one request to GitHub's "latest release" answer, once per launch (the
//! page asks after startup work is done). It reports a release only when it is newer than this
//! build. Offline mode and `network.allow_updates = false` stop it before any request (the shared
//! gate in `network.rs`); the page also skips it when `updates.check_on_startup` is false.
#![cfg_attr(test, allow(dead_code))]

use super::{config, err, network, Result};
use serde::Serialize;
use serde_json::Value;

const RELEASES_API: &str = "https://api.github.com/repos/Vaultdraw/vaultdraw/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/Vaultdraw/vaultdraw/releases/latest";
const RELEASE_PREFIX: &str = "https://github.com/Vaultdraw/vaultdraw/";
const MAX_BYTES: u64 = 512 * 1024;

/// A release newer than this build.
#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct UpdateInfo {
    pub version: String,
    pub url: String,
}

/// "v0.1.2", "0.2", "1.0.0-beta.1" -> the numeric parts before any suffix.
fn parse_version(text: &str) -> Option<Vec<u64>> {
    let core = text.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let parts: Option<Vec<u64>> = core.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| !p.is_empty() && p.len() <= 4)
}

fn is_newer(latest: &str, current: &str) -> bool {
    let (Some(mut a), Some(mut b)) = (parse_version(latest), parse_version(current)) else { return false };
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    a > b
}

/// The newer release in GitHub's answer, if any. Drafts and pre-releases never count.
fn newer_release(body: &[u8], current: &str) -> Result<Option<UpdateInfo>> {
    let json: Value = serde_json::from_slice(body).map_err(|_| err("INVALID_FILE", "The update answer is not valid"))?;
    let flag = |k: &str| json.get(k).and_then(Value::as_bool).unwrap_or(false);
    if flag("draft") || flag("prerelease") {
        return Ok(None);
    }
    let Some(tag) = json.get("tag_name").and_then(Value::as_str) else { return Ok(None) };
    if !is_newer(tag, current) {
        return Ok(None);
    }
    // Only a Vaultdraw release page is ever offered: a reply cannot point the notice elsewhere.
    let url = json
        .get("html_url")
        .and_then(Value::as_str)
        .filter(|u| u.starts_with(RELEASE_PREFIX))
        .unwrap_or(RELEASES_PAGE);
    Ok(Some(UpdateInfo { version: tag.trim_start_matches(['v', 'V']).to_string(), url: url.to_string() }))
}

pub(crate) fn check_in(dirs: &config::Dirs, api_url: &str, current: &str) -> Result<Option<UpdateInfo>> {
    network::ensure_network_allowed(dirs, "updates")?;
    let url = network::parse_url(api_url)?;
    let body = network::get_bytes(&url, MAX_BYTES, "application/vnd.github+json")?;
    newer_release(&body, current)
}

/// One check, off the main thread. `Ok(None)`: up to date.
#[tauri::command]
pub(crate) async fn update_check() -> Result<Option<UpdateInfo>> {
    let dirs = config::resolve_dirs()?;
    tauri::async_runtime::spawn_blocking(move || check_in(&dirs, RELEASES_API, env!("CARGO_PKG_VERSION")))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::test_server::{start, Resp};
    use std::{fs, sync::atomic::Ordering};

    fn dirs_in(root: &std::path::Path, text: Option<&str>) -> config::Dirs {
        let d = config::Dirs { config: root.join("config"), state: root.join("state") };
        fs::create_dir_all(&d.config).unwrap();
        if let Some(t) = text {
            fs::write(d.config.join("config.toml"), t).unwrap();
        }
        d
    }

    #[test]
    fn versions_compare_by_number() {
        for (a, b, newer) in [
            ("v0.1.2", "0.1.1", true),
            ("0.1.1", "0.1.1", false),
            ("v0.1.0", "0.1.1", false),
            ("v0.10.0", "0.9.9", true),
            ("1.0", "0.9.9", true),
            ("0.2.0-beta.1", "0.1.9", true),
            ("garbage", "0.1.1", false),
            ("", "0.1.1", false),
        ] {
            assert_eq!(is_newer(a, b), newer, "{a} vs {b}");
        }
    }

    #[test]
    fn only_a_newer_final_release_is_reported_and_only_with_a_vaultdraw_link() {
        let body = |extra: &str| format!(r#"{{"tag_name":"v0.3.0","html_url":"https://github.com/Vaultdraw/vaultdraw/releases/tag/v0.3.0"{extra}}}"#);
        let got = newer_release(body("").as_bytes(), "0.2.0").unwrap().unwrap();
        assert_eq!(got.version, "0.3.0");
        assert_eq!(got.url, "https://github.com/Vaultdraw/vaultdraw/releases/tag/v0.3.0");
        assert!(newer_release(body("").as_bytes(), "0.3.0").unwrap().is_none());
        assert!(newer_release(body(r#","prerelease":true"#).as_bytes(), "0.2.0").unwrap().is_none());
        assert!(newer_release(body(r#","draft":true"#).as_bytes(), "0.2.0").unwrap().is_none());
        let evil = br#"{"tag_name":"v9.0.0","html_url":"https://evil.example/download"}"#;
        assert_eq!(newer_release(evil, "0.2.0").unwrap().unwrap().url, RELEASES_PAGE);
        assert!(newer_release(b"not json", "0.2.0").is_err());
    }

    #[test]
    fn the_check_asks_once_online_and_never_when_off() {
        let tmp = tempfile::tempdir().unwrap();
        let (base, hits) = start(|_| Resp::ok(r#"{"tag_name":"v99.0.0"}"#));
        let api = format!("{base}/latest");
        let online = dirs_in(&tmp.path().join("a"), None);
        assert_eq!(check_in(&online, &api, "0.1.0").unwrap().unwrap().version, "99.0.0");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        for (i, cfg) in ["[network]\noffline = true\n", "[network]\nenabled = false\n", "[network]\nallow_updates = false\n"].iter().enumerate() {
            let d = dirs_in(&tmp.path().join(format!("b{i}")), Some(cfg));
            assert!(check_in(&d, &api, "0.1.0").is_err(), "{cfg}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 1, "no request left while off");
    }
}
