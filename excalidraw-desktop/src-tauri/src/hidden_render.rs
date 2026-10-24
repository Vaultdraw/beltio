//! Test builds only (`smoke-test` feature): keep a hidden test window rendering, and record the
//! native window state so a run can say whether it ran hidden.
//!
//! A window manager that parks windows off-screen (OmniWM workspaces) leaves the window
//! "visible" to AppKit but on no screen. WebKit then has no display to drive
//! requestAnimationFrame from. This module keeps such a window on a display for WebKit only.
use std::env;

fn flag(name: &str) -> bool {
    env::var(name).ok().as_deref() == Some("1")
}

/// Experiment toggles (temporary): which hidden-render measures are on.
pub fn screen_override_enabled() -> bool {
    crate::smoke::test_run() && flag("VAULTDRAW_HR_SCREEN")
}

/// Experiment only: park the window off every screen, the way a tiling window manager parks
/// windows of an inactive workspace (simulates that without touching the window manager).
fn park_enabled() -> bool {
    crate::smoke::test_run() && flag("VAULTDRAW_HR_PARK")
}

/// Every 2 s, append the native window state to `$VAULTDRAW_STATE_DIR/window-state.jsonl`.
pub fn watch_window_state(window: &tauri::WebviewWindow) {
    if !crate::smoke::test_run() {
        return;
    }
    let Some(dir) = env::var_os("VAULTDRAW_STATE_DIR") else { return };
    let path = std::path::PathBuf::from(dir).join("window-state.jsonl");
    let window = window.clone();
    let park = park_enabled();
    if park {
        let _ = window.set_position(tauri::PhysicalPosition::new(-20_000, -20_000));
    }
    let _ = std::thread::Builder::new().name("window-state".into()).spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if park {
            let _ = window.set_position(tauri::PhysicalPosition::new(-20_000, -20_000));
        }
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

/// Test runs: give WebKit a display while AppKit says the window is on none (parked off-screen).
/// The window's class is replaced by a subclass whose `-screen` falls back to the main screen.
#[cfg(target_os = "macos")]
pub fn keep_window_on_a_display(window: &tauri::WebviewWindow) {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};
    if !screen_override_enabled() {
        return;
    }
    let Ok(ptr) = window.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    extern "C" {
        fn object_setClass(obj: *mut AnyObject, cls: *const AnyClass) -> *const AnyClass;
    }
    unsafe extern "C-unwind" fn screen(this: &AnyObject, _cmd: Sel) -> *mut AnyObject {
        let superclass = this.class().superclass().expect("subclass has a superclass");
        let real: *mut AnyObject = unsafe { msg_send![super(this, superclass), screen] };
        if !real.is_null() {
            return real;
        }
        unsafe { msg_send![class!(NSScreen), mainScreen] }
    }
    unsafe {
        let obj = ptr as *mut AnyObject;
        let current = (*obj).class();
        let name = c"VaultdrawTestOnDisplayWindow";
        let sub = match AnyClass::get(name) {
            Some(c) => c,
            None => {
                let Some(mut b) = ClassBuilder::new(name, current) else { return };
                b.add_method(sel!(screen), screen as unsafe extern "C-unwind" fn(_, _) -> _);
                b.register()
            }
        };
        if !std::ptr::eq(current, sub) {
            object_setClass(obj, sub);
        }
        // Tell WebKit the screen changed so it picks a display (and starts its display link).
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let note = objc2_foundation::NSString::from_str("NSWindowDidChangeScreenNotification");
        let _: () = msg_send![&*center, postNotificationName: &*note, object: &*obj];
    }
}

#[cfg(not(target_os = "macos"))]
pub fn keep_window_on_a_display(_window: &tauri::WebviewWindow) {}
