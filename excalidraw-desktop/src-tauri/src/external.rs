//! Opening links in the user's default browser (never in the webview) and the
//! two facts a bug report needs: OS name/version and CPU architecture.
use super::{err, ioerr, Result};
use serde::Serialize;

/// https only, with a host and no credentials, parsed as a URL (not a string prefix).
/// Returns the normalised, percent-encoded form, which macOS `open` always parses as a URL.
fn validate_https(url: &str) -> Result<String> {
    let invalid = || err("INVALID_URL", "Only https links can be opened");
    // `https:///x` would be normalised to host `x`: never a real link, so refuse it.
    if url.len() > 4096 || !url.starts_with("https://") || url[8..].starts_with('/') {
        return Err(invalid());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| invalid())?;
    let https_with_host = parsed.scheme() == "https"
        && parsed.host_str().is_some_and(|h| !h.is_empty())
        && parsed.username().is_empty()
        && parsed.password().is_none();
    let out: String = parsed.into();
    // After normalising, only RFC 3986 characters may remain (WHATWG leaves e.g. `|` and `^`
    // unencoded, which macOS rejects as a URL and would then read as a file path).
    let rfc3986 = |c: char| c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c);
    if https_with_host && out.chars().all(rfc3986) {
        Ok(out)
    } else {
        Err(invalid())
    }
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<()> {
    let url = validate_https(&url)?;
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(ioerr)
}

#[derive(Serialize)]
pub(crate) struct SystemInfo {
    os: &'static str,
    version: String,
    arch: &'static str,
}

/// Reads one value from `os-release` text (`KEY=value`, optionally quoted, `#` comments), as in
/// os-release(5). Backslash escapes inside quotes are resolved for `\\`, `\"`, `\$` and `` \` ``.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn os_release_value(text: &str, key: &str) -> Option<String> {
    let mut found = None;
    for line in text.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once('=') else { continue };
        if k.trim() != key {
            continue;
        }
        let v = v.trim();
        let unquoted = match v.chars().next() {
            Some(q @ ('"' | '\'')) if v.len() >= 2 && v.ends_with(q) => {
                let inner = &v[1..v.len() - 1];
                if q == '"' {
                    let mut out = String::with_capacity(inner.len());
                    let mut chars = inner.chars();
                    while let Some(c) = chars.next() {
                        match (c, chars.clone().next()) {
                            ('\\', Some(n @ ('\\' | '"' | '$' | '`'))) => {
                                out.push(n);
                                chars.next();
                            }
                            _ => out.push(c),
                        }
                    }
                    out
                } else {
                    inner.to_string()
                }
            }
            _ => v.to_string(),
        };
        found = Some(unquoted); // the last assignment wins, as when the file is sourced
    }
    found.filter(|s| !s.is_empty())
}

/// The distribution name and version for a bug report: `PRETTY_NAME`, else `NAME` + `VERSION_ID`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn os_release_pretty(text: &str) -> Option<String> {
    if let Some(p) = os_release_value(text, "PRETTY_NAME") {
        return Some(p);
    }
    let name = os_release_value(text, "NAME")?;
    Some(match os_release_value(text, "VERSION_ID") {
        Some(v) => format!("{name} {v}"),
        None => name,
    })
}

fn os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sw_vers").arg("-productVersion").output() {
            return String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    #[cfg(target_os = "linux")]
    {
        // os-release(5): /etc first, then the vendor copy under /usr/lib.
        for path in ["/etc/os-release", "/usr/lib/os-release"] {
            if let Some(v) = std::fs::read_to_string(path).ok().as_deref().and_then(os_release_pretty) {
                return v;
            }
        }
    }
    String::new()
}

/// Only called when the user starts a bug report. Async, so `sw_vers` never runs on the UI thread.
#[tauri::command(async)]
pub(crate) fn system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS,
        version: os_version(),
        arch: std::env::consts::ARCH,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_only() {
        let ok = "https://github.com/Vaultdraw/vaultdraw/issues/new?title=a%20b";
        assert_eq!(validate_https(ok).unwrap(), ok);
        for bad in [
            "http://a.b",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "HTTPS://a.b",
            "https:x",
            "https://",
            "https:///x",
            "https://u:p@a.b",
            "-a",
            "",
        ] {
            assert!(validate_https(bad).is_err(), "{bad}");
        }
        assert!(validate_https(&format!("https://a.b/{}", "x".repeat(4100))).is_err());
    }

    #[test]
    fn hands_open_only_strict_urls() {
        // Encodable characters come back percent-encoded ...
        let out = validate_https("https://a.b/{x} \"\u{202e}").unwrap();
        assert_eq!(out, "https://a.b/%7Bx%7D%20%22%E2%80%AE");
        // ... and ones WHATWG leaves raw (macOS would read them as a file path) are refused.
        for bad in ["https://a.b/x|y", "https://a.b/^"] {
            assert!(validate_https(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn os_release_prefers_pretty_name_and_unquotes() {
        let text = "# comment\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n";
        assert_eq!(os_release_pretty(text).as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(os_release_value(text, "ID").as_deref(), Some("ubuntu"));
        assert_eq!(os_release_value(text, "MISSING"), None);
    }

    #[test]
    fn os_release_falls_back_to_name_and_version_id() {
        assert_eq!(os_release_pretty("NAME=Arch Linux\n").as_deref(), Some("Arch Linux"));
        assert_eq!(os_release_pretty("NAME='Void'\nVERSION_ID=1\n").as_deref(), Some("Void 1"));
        assert_eq!(os_release_pretty("").as_deref(), None);
        assert_eq!(os_release_pretty("PRETTY_NAME=\"\"\n").as_deref(), None);
    }

    #[test]
    fn os_release_handles_escapes_last_wins_and_odd_lines() {
        let text = "PRETTY_NAME=\"A \\\"b\\\" \\$c\"\nPRETTY_NAME=\"Second\"\nnot a pair\n  =x\n";
        assert_eq!(os_release_value(text, "PRETTY_NAME").as_deref(), Some("Second"));
        let one = "PRETTY_NAME=\"A \\\"b\\\" \\$c\"\n";
        assert_eq!(os_release_value(one, "PRETTY_NAME").as_deref(), Some("A \"b\" $c"));
        // a lone quote is kept as written
        assert_eq!(os_release_value("NAME=\"\n", "NAME").as_deref(), Some("\""));
    }

    #[test]
    fn system_info_has_arch() {
        assert!(!system_info().arch.is_empty());
    }
}
