//! Opening links in the user's default browser (never in the webview) and the
//! two facts a bug report needs: OS name/version and CPU architecture.
use super::{err, ioerr, Result};
use serde::Serialize;

/// https only, a host, and nothing a command line could misread.
fn validate_https(url: &str) -> Result<()> {
    let rest = url.strip_prefix("https://").unwrap_or("");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let ok = !host.is_empty()
        && url.len() <= 4096
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok {
        Ok(())
    } else {
        Err(err("INVALID_URL", "Only https links can be opened"))
    }
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<()> {
    validate_https(&url)?;
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

/// Only called when the user starts a bug report.
#[tauri::command]
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
        assert!(validate_https("https://github.com/Vaultdraw/vaultdraw/issues/new?title=a%20b").is_ok());
        for bad in ["http://a.b", "file:///etc/passwd", "https://", "https:///x", "https://a.b/ c", "-a", "", "https://a.b/\n"] {
            assert!(validate_https(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn system_info_has_arch() {
        assert!(!system_info().arch.is_empty());
    }
}
