//! Test builds only (`smoke-test` feature): record the native window state so a run can say
//! whether it ran hidden. (Experiments in 2026-10 found no measure that keeps a parked window
//! drawing; see personal/feature/hidden-render/REPORT.md.)
use std::env;

/// Every 2 s, append the native window state to `$VAULTDRAW_STATE_DIR/window-state.jsonl`.
pub fn watch_window_state(window: &tauri::WebviewWindow) {
    if !crate::smoke::test_run() {
        return;
    }
    let Some(dir) = env::var_os("VAULTDRAW_STATE_DIR") else { return };
    let path = std::path::PathBuf::from(dir).join("window-state.jsonl");
    let window = window.clone();
    let _ = std::thread::Builder::new().name("window-state".into()).spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let w = window.clone();
        let path = path.clone();
        if window
            .run_on_main_thread(move || {
                let line = native_state(&w).to_string();
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                    let _ = writeln!(f, "{line}");
                }
            })
            .is_err()
        {
            return;
        }
    });
}

/// Native window state (main thread): AppKit visibility, occlusion, screen and position.
pub fn native_state(window: &tauri::WebviewWindow) -> serde_json::Value {
    let monitor = window.current_monitor().ok().flatten().map(|m| m.name().cloned().unwrap_or_default());
    let pos = window.outer_position().ok().map(|p| [p.x, p.y]);
    let size = window.outer_size().ok().map(|s| [s.width, s.height]);
    #[cfg(target_os = "macos")]
    let mac = mac_state(window);
    #[cfg(not(target_os = "macos"))]
    let mac = serde_json::Value::Null;
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    serde_json::json!({ "wallMs": ms, "monitor": monitor, "pos": pos, "size": size, "mac": mac })
}

#[cfg(target_os = "macos")]
fn mac_state(window: &tauri::WebviewWindow) -> serde_json::Value {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    let Ok(ptr) = window.ns_window() else { return serde_json::Value::Null };
    if ptr.is_null() {
        return serde_json::Value::Null;
    }
    unsafe {
        let w: &AnyObject = &*(ptr as *mut AnyObject);
        let visible: Bool = msg_send![w, isVisible];
        let occlusion: usize = msg_send![w, occlusionState];
        let screen: *mut AnyObject = msg_send![w, screen];
        let mini: Bool = msg_send![w, isMiniaturized];
        let active_space: Bool = msg_send![w, isOnActiveSpace];
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let (app_hidden, app_active) = if app.is_null() {
            (false, false)
        } else {
            let h: Bool = msg_send![&*app, isHidden];
            let a: Bool = msg_send![&*app, isActive];
            (h.as_bool(), a.as_bool())
        };
        serde_json::json!({
            "isVisible": visible.as_bool(),
            "occlusionVisible": occlusion & 2 != 0,
            "hasScreen": !screen.is_null(),
            "miniaturized": mini.as_bool(),
            "onActiveSpace": active_space.as_bool(),
            "appHidden": app_hidden,
            "appActive": app_active,
        })
    }
}
