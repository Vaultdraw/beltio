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

fn os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sw_vers").arg("-productVersion").output() {
            return String::from_utf8_lossy(&out.stdout).trim().to_string();
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
    fn system_info_has_arch() {
        assert!(!system_info().arch.is_empty());
    }
}
