//! macOS side of the hang watchdog: the guarded hook on wry's navigation delegate, the
//! re-check, and the `NSAlert`. Proven in the W0 spike (`personal/feature/hang-watchdog/spike/`).
//!
//! Rules from the spike:
//! - Set the navigation delegate again after `class_addMethod`: WebKit caches which optional
//!   methods a delegate answers when it is set.
//! - Nothing goes through the main dispatch queue while the alert is up (`runModal` stops it).
//!   WebKit still delivers the responsive callback in the modal loop, so recovery closes the
//!   alert with `abortModal` from there.
//! - WebKit signals unresponsive once per hang: Wait re-checks on its own timer.
//! - NSAlert maps Escape only to a button titled "Cancel": a local key monitor maps it to Wait,
//!   and exists only while the alert is up.

use super::machine::{grace_for, Action, Check, Choice, Event, Machine};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
use objc2::{class, msg_send, sel};
use std::ffi::{c_char, c_void};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

const UNRESPONSIVE_SEL: &std::ffi::CStr = c"_webViewWebProcessDidBecomeUnresponsive:";
const RESPONSIVE_SEL: &std::ffi::CStr = c"_webViewWebProcessDidBecomeResponsive:";
const DELEGATE_PROTOCOL: &std::ffi::CStr = c"WKNavigationDelegatePrivate";

/// NSAlert first and second button return codes; `abortModal` returns NSModalResponseAbort.
const RESPONSE_WAIT: isize = 1000;
const RESPONSE_QUIT: isize = 1001;
const ESCAPE_KEY_CODE: u16 = 53;
const KEY_DOWN_MASK: u64 = 1 << 10;
const COMMAND_MODIFIER: usize = 1 << 20;

static APP: OnceLock<AppHandle> = OnceLock::new();
static WEBVIEW: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
static MACHINE: Mutex<Machine> = Mutex::new(Machine::new());
/// When the current hang started (the unresponsive signal), for the record.
static HANG_START: Mutex<Option<Instant>> = Mutex::new(None);

#[repr(C)]
struct MethodDescription {
    name: *const c_void,
    types: *const c_char,
}

#[repr(C)]
#[derive(Default)]
struct TimebaseInfo {
    numer: u32,
    denom: u32,
}

#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn object_getClass(obj: *const AnyObject) -> *mut AnyClass;
    fn class_addMethod(cls: *mut AnyClass, name: Sel, imp: *const c_void, types: *const c_char) -> Bool;
    fn objc_getProtocol(name: *const c_char) -> *mut c_void;
    fn protocol_getMethodDescription(p: *mut c_void, sel: Sel, required: Bool, instance: Bool) -> MethodDescription;
}

#[link(name = "System", kind = "dylib")]
extern "C" {
    static _dispatch_main_q: c_void;
    fn dispatch_async_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    fn mach_absolute_time() -> u64;
    fn mach_continuous_time() -> u64;
    fn mach_timebase_info(info: *mut TimebaseInfo) -> i32;
}

/// Runs `f` on the main queue. Never used while the alert is up (see the module notes).
fn on_main(f: impl FnOnce() + Send + 'static) {
    extern "C" fn trampoline(ctx: *mut c_void) {
        let f: Box<Box<dyn FnOnce()>> = unsafe { Box::from_raw(ctx as *mut Box<dyn FnOnce()>) };
        f();
    }
    let boxed: Box<Box<dyn FnOnce()>> = Box::new(Box::new(f));
    unsafe { dispatch_async_f(&_dispatch_main_q as *const c_void, Box::into_raw(boxed) as *mut c_void, trampoline) };
}

/// Feeds the machine and runs what it asks for. The lock is released before any action runs,
/// because `ShowDialog` blocks in `runModal` and the responsive callback must get in meanwhile.
fn dispatch(event: Event) {
    let actions = match MACHINE.lock() {
        Ok(mut m) => m.on(event),
        Err(_) => return,
    };
    for action in actions {
        run(action);
    }
}

fn run(action: Action) {
    match action {
        Action::StartGrace { generation, waits } => start_grace(generation, waits),
        Action::ShowDialog => {
            let choice = show_alert();
            dispatch(Event::DialogClosed(choice));
        }
        Action::CloseDialog => unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, abortModal];
        },
        Action::Record(choice) => {
            let seconds = HANG_START
                .lock()
                .ok()
                .and_then(|mut s| if choice == Choice::Quit { *s } else { s.take() })
                .map_or(0.0, |t| t.elapsed().as_secs_f64());
            if choice == Choice::Quit {
                super::write_record(seconds, choice); // before exit: a thread would be cut off
            } else {
                let _ = std::thread::Builder::new()
                    .name("hang-record".into())
                    .spawn(move || super::write_record(seconds, choice));
            }
        }
        Action::Quit => {
            super::FORCE_QUIT.store(true, Ordering::SeqCst);
            if let Some(app) = APP.get() {
                app.exit(0);
            }
        }
    }
}

/// One short-lived thread per grace: reads the settings, sleeps, then re-checks on the main
/// thread (where the web view lives).
fn start_grace(generation: u64, waits: u32) {
    let spawned = std::thread::Builder::new().name("hang-grace".into()).spawn(move || {
        let settings = super::settings();
        let check = Check { enabled: settings.enabled, unresponsive: true, visible: true, slept: false };
        if !settings.enabled {
            dispatch(Event::GraceElapsed { generation, check });
            return;
        }
        let (abs0, cont0) = unsafe { (mach_absolute_time(), mach_continuous_time()) };
        std::thread::sleep(Duration::from_millis(grace_for(settings.grace_ms, waits)));
        let (abs1, cont1) = unsafe { (mach_absolute_time(), mach_continuous_time()) };
        // Continuous time counts sleep, absolute time doesn't: a gap means the Mac slept.
        let asleep = ticks_to_duration((cont1 - cont0).saturating_sub(abs1 - abs0));
        let slept = asleep > Duration::from_secs(1);
        on_main(move || {
            let check = Check { unresponsive: read_unresponsive(), visible: window_visible(), slept, ..check };
            dispatch(Event::GraceElapsed { generation, check });
        });
    });
    if let Err(e) = spawned {
        eprintln!("vaultdraw: hang watchdog: no grace thread: {e}");
    }
}

fn ticks_to_duration(ticks: u64) -> Duration {
    let mut info = TimebaseInfo::default();
    unsafe { mach_timebase_info(&mut info) };
    if info.denom == 0 {
        return Duration::ZERO;
    }
    Duration::from_nanos((ticks as u128 * info.numer as u128 / info.denom as u128) as u64)
}

/// Main thread. `_webProcessIsResponsive` was checked by the guard at install.
fn read_unresponsive() -> bool {
    let view = WEBVIEW.load(Ordering::SeqCst);
    if view.is_null() {
        return false;
    }
    let responsive: Bool = unsafe { msg_send![view, _webProcessIsResponsive] };
    !responsive.as_bool()
}

/// Main thread. Hidden or minimised windows get no dialog (WebKit still signals them).
fn window_visible() -> bool {
    let view = WEBVIEW.load(Ordering::SeqCst);
    if view.is_null() {
        return false;
    }
    unsafe {
        let window: *mut AnyObject = msg_send![view, window];
        if window.is_null() {
            return false;
        }
        let visible: Bool = msg_send![window, isVisible];
        let mini: Bool = msg_send![window, isMiniaturized];
        visible.as_bool() && !mini.as_bool()
    }
}

fn ns(s: &str) -> Retained<objc2_foundation::NSString> {
    objc2_foundation::NSString::from_str(s)
}

/// Main thread. Wait: Return, Escape, or a click. Quit: Cmd+Q or a click (a plain "q" typed
/// into the hung page must not lose edits). Recovery closes it from the responsive callback.
fn show_alert() -> Choice {
    let response: isize = unsafe {
        let alert: Retained<AnyObject> = msg_send![class!(NSAlert), new];
        let _: () = msg_send![&*alert, setMessageText: &*ns("Vaultdraw isn't responding.")];
        let _: () = msg_send![&*alert, setInformativeText: &*ns(
            "The page has not answered for a while. Waiting may let it finish.\nQuitting now loses edits made since the last autosave."
        )];
        let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*ns("Wait")];
        let quit: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*ns("Quit")];
        let _: () = msg_send![quit, setKeyEquivalent: &*ns("q")];
        let _: () = msg_send![quit, setKeyEquivalentModifierMask: COMMAND_MODIFIER];
        let block = block2::RcBlock::new(|event: *mut AnyObject| -> *mut AnyObject {
            let code: u16 = msg_send![event, keyCode];
            if code == ESCAPE_KEY_CODE {
                let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let _: () = msg_send![app, stopModalWithCode: RESPONSE_WAIT];
                return std::ptr::null_mut();
            }
            event
        });
        let monitor: Option<Retained<AnyObject>> =
            msg_send![class!(NSEvent), addLocalMonitorForEventsMatchingMask: KEY_DOWN_MASK, handler: &*block];
        let response: isize = msg_send![&*alert, runModal];
        if let Some(m) = monitor {
            let _: () = msg_send![class!(NSEvent), removeMonitor: &*m];
        }
        response
    };
    match response {
        RESPONSE_QUIT => Choice::Quit,
        RESPONSE_WAIT => Choice::Wait,
        _ => Choice::Recovered, // aborted by the responsive callback
    }
}

extern "C" fn on_unresponsive(_this: *mut AnyObject, _cmd: Sel, _webview: *mut AnyObject) {
    if let Ok(mut start) = HANG_START.lock() {
        start.get_or_insert_with(Instant::now);
    }
    dispatch(Event::Unresponsive);
}

extern "C" fn on_responsive(_this: *mut AnyObject, _cmd: Sel, _webview: *mut AnyObject) {
    dispatch(Event::Responsive);
    // After a hang that never reached the dialog, nothing took the start time.
    if let Ok(mut start) = HANG_START.lock() {
        *start = None;
    }
}

/// Checks that this WebKit still has the private selectors, then hooks them. `Err` is the
/// reason for the one warning line.
unsafe fn guard_and_hook(view: *mut AnyObject) -> Result<(), String> {
    let has_state: bool = msg_send![view, respondsToSelector: sel!(_webProcessIsResponsive)];
    if !has_state {
        return Err("WKWebView has no _webProcessIsResponsive".into());
    }
    let proto = objc_getProtocol(DELEGATE_PROTOCOL.as_ptr());
    if proto.is_null() {
        return Err("protocol WKNavigationDelegatePrivate not found".into());
    }
    let unresponsive = Sel::register(UNRESPONSIVE_SEL);
    let responsive = Sel::register(RESPONSIVE_SEL);
    for (name, sel) in [(UNRESPONSIVE_SEL, unresponsive), (RESPONSIVE_SEL, responsive)] {
        if protocol_getMethodDescription(proto, sel, Bool::NO, Bool::YES).name.is_null() {
            return Err(format!("WKNavigationDelegatePrivate does not declare {}", name.to_string_lossy()));
        }
    }
    let delegate: *mut AnyObject = msg_send![view, navigationDelegate];
    if delegate.is_null() {
        return Err("the web view has no navigation delegate".into());
    }
    let cls = object_getClass(delegate);
    let types = c"v@:@";
    class_addMethod(cls, unresponsive, on_unresponsive as *const c_void, types.as_ptr());
    class_addMethod(cls, responsive, on_responsive as *const c_void, types.as_ptr());
    // WebKit caches what the delegate answers when it is set: set it again.
    let _: () = msg_send![view, setNavigationDelegate: delegate];
    Ok(())
}

pub fn install(window: &WebviewWindow) {
    let _ = APP.set(window.app_handle().clone());
    let result = window.with_webview(|webview| {
        let view = webview.inner() as *mut AnyObject;
        match unsafe { guard_and_hook(view) } {
            Ok(()) => WEBVIEW.store(view, Ordering::SeqCst),
            Err(why) => eprintln!("{}", off_line(&why)),
        }
    });
    if let Err(e) = result {
        eprintln!("{}", off_line(&e.to_string()));
    }
}

fn off_line(why: &str) -> String {
    format!("vaultdraw: WARNING: hang watchdog off: {why}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_off_line_is_one_line_with_the_reason() {
        let line = off_line("WKNavigationDelegatePrivate does not declare x");
        assert_eq!(line, "vaultdraw: WARNING: hang watchdog off: WKNavigationDelegatePrivate does not declare x");
        assert!(!line.contains('\n'));
    }

    #[test]
    fn this_webkit_declares_the_private_selectors() {
        // The guard's metadata check, against the WebKit on this Mac (no web view needed).
        unsafe {
            let _ = AnyClass::get(c"WKWebView");
            let proto = objc_getProtocol(DELEGATE_PROTOCOL.as_ptr());
            if proto.is_null() {
                eprintln!("WKNavigationDelegatePrivate not loaded in the test process; skipped");
                return;
            }
            for name in [UNRESPONSIVE_SEL, RESPONSIVE_SEL] {
                let d = protocol_getMethodDescription(proto, Sel::register(name), Bool::NO, Bool::YES);
                assert!(!d.name.is_null(), "{name:?}");
            }
        }
    }

    #[test]
    fn timebase_converts_ticks() {
        assert_eq!(ticks_to_duration(0), Duration::ZERO);
        let one_s = {
            let mut info = TimebaseInfo::default();
            unsafe { mach_timebase_info(&mut info) };
            1_000_000_000u64 * info.denom as u64 / info.numer as u64
        };
        let d = ticks_to_duration(one_s);
        assert!(d >= Duration::from_millis(999) && d <= Duration::from_millis(1001), "{d:?}");
    }
}
