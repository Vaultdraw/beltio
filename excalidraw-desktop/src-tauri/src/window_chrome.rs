//! Linux window chrome: `[window] decorations = "custom" | "native"`.
//!
//! `custom` (the default) builds the main window without the system title bar; the in-app
//! header then carries the window buttons. The key is read once at startup (a few tens of
//! microseconds, Linux only) and the choice reaches the page through an initialization
//! script, so the page needs no startup IPC. Restart required. macOS and Windows never read it.

/// The page flag set by the initialization script (`src/vault/windowChrome.ts` reads it).
pub const CUSTOM_CHROME_SCRIPT: &str = "window.__VAULTDRAW_CHROME__ = 'custom';";

/// `[window] decorations`, highest layer first. Anything but the string `"native"` counts as
/// `custom` (a wrong value is reported by the Settings page, and one bar is the safe default).
pub fn custom_from(tables: &[toml::Table]) -> bool {
    let value = tables.iter().find_map(|t| t.get("window")?.get("decorations"));
    !matches!(value.and_then(|v| v.as_str()), Some("native"))
}

/// Reads the key now. Only the Linux window setup calls it.
#[cfg(target_os = "linux")]
pub fn custom() -> bool {
    match crate::config::resolve_dirs() {
        Ok(dirs) => custom_from(&vaultdraw_core::control_settings::layered_tables(&dirs)),
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(texts: &[&str]) -> Vec<toml::Table> {
        texts.iter().map(|t| t.parse().unwrap()).collect()
    }

    #[test]
    fn custom_by_default() {
        assert!(custom_from(&[]));
        assert!(custom_from(&tables(&["[editor]\nx = 1\n"])));
        assert!(custom_from(&tables(&["[window]\ndecorations = \"custom\"\n"])));
    }

    #[test]
    fn native_when_asked() {
        assert!(!custom_from(&tables(&["[window]\ndecorations = \"native\"\n"])));
    }

    #[test]
    fn highest_layer_wins_and_bad_values_are_unset() {
        let layers = tables(&["[window]\ndecorations = \"native\"\n", "[window]\ndecorations = \"custom\"\n"]);
        assert!(!custom_from(&layers));
        assert!(custom_from(&tables(&["[window]\ndecorations = 3\n"])));
        assert!(custom_from(&tables(&["[window]\ndecorations = \"bogus\"\n"])));
    }
}
