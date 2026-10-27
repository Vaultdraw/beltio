//! Packaged hang check (smoke-test builds only, `VAULTDRAW_WATCHDOG_SMOKE=1`; driven by
//! `scripts/watchdog-smoke.sh`). It hangs the page for real, waits for the watchdog dialog, then
//! sends Cmd+Q to the app, and the script checks that the process quit. Nothing here exists in
//! a release build.
//!
//! How the hang is made (the W0 spike's method): `SIGSTOP` to the web content process, then one
//! key event to the web view so WebKit's responsiveness timer starts. Cmd+Q is an `NSEvent`
//! posted to the application's own event queue, so it goes through the modal alert's key
//! equivalent. It does not cross the HID layer (that needs Accessibility permission).
//! Progress goes to stdout as `watchdog-smoke: ...` lines for the script to read.

use super::macos::{dialog_up, main_view};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSString};
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

const SIGSTOP: i32 = 17;
const SIGCONT: i32 = 19;
const KEY_DOWN: usize = 10;
const COMMAND: usize = 1 << 20;
const KEY_Q: u16 = 12;
const KEY_F19: u16 = 80;

fn say(line: &str) {
    println!("watchdog-smoke: {line}");
}

/// Stops the run with a failure line: the web process is continued first, so nothing is left
/// frozen.
fn fail(pid: Option<i32>, why: &str) -> ! {
    say(&format!("FAIL {why}"));
    if let Some(pid) = pid {
        unsafe { libc::kill(pid, SIGCONT) };
    }
    std::process::exit(3);
}

fn key_event(code: u16, modifiers: usize, chars: &str, window_number: isize) -> Retained<AnyObject> {
    let chars = NSString::from_str(chars);
    unsafe {
        let event: Option<Retained<AnyObject>> = msg_send![
            class!(NSEvent),
            keyEventWithType: KEY_DOWN,
            location: NSPoint::new(0.0, 0.0),
            modifierFlags: modifiers,
            timestamp: 0.0f64,
            windowNumber: window_number,
            context: std::ptr::null_mut::<AnyObject>(),
            characters: &*chars,
            charactersIgnoringModifiers: &*chars,
            isARepeat: false,
            keyCode: code
        ];
        event.unwrap_or_else(|| fail(None, "could not build a key event"))
    }
}

/// Starts the driver thread. Sleeps in `std::thread::sleep` only: no cost to anything else.
pub fn start(window: &WebviewWindow) {
    let window = window.clone();
    let spawned = std::thread::Builder::new().name("watchdog-smoke".into()).spawn(move || drive(&window));
    if let Err(e) = spawned {
        eprintln!("watchdog-smoke: FAIL no driver thread: {e}");
    }
}

fn drive(window: &WebviewWindow) {
    // The page has to be up and the hook installed.
    let until = Instant::now() + Duration::from_secs(30);
    while main_view().is_null() {
        if Instant::now() > until {
            fail(None, "the watchdog hook did not install");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_secs(4));

    let (tx, rx) = std::sync::mpsc::channel();
    let _ = window.with_webview(move |webview| {
        let _ = tx.send(crate::smoke::webkit_pids(webview.inner()).0);
    });
    let Some(pid) = rx.recv_timeout(Duration::from_secs(5)).ok().flatten() else {
        fail(None, "no web content pid");
    };
    say(&format!("web pid {pid}"));

    if unsafe { libc::kill(pid, SIGSTOP) } != 0 {
        fail(Some(pid), "SIGSTOP failed");
    }
    say("page stopped");
    let hung_at = Instant::now();

    // One key to the stopped page starts WebKit's responsiveness timer (3 s).
    let (tx, rx) = std::sync::mpsc::channel();
    let sent = window.with_webview(move |webview| unsafe {
        let view = webview.inner() as *mut AnyObject;
        let event = key_event(KEY_F19, 0, "", 0);
        let _: () = msg_send![view, keyDown: &*event];
        let _ = tx.send(());
    });
    if sent.is_err() || rx.recv_timeout(Duration::from_secs(5)).is_err() {
        fail(Some(pid), "could not send the key to the page");
    }

    let until = Instant::now() + Duration::from_secs(45);
    while !dialog_up() {
        if Instant::now() > until {
            fail(Some(pid), "no watchdog dialog within 45 s");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    say(&format!("dialog up after {} ms", hung_at.elapsed().as_millis()));

    // Let the alert finish showing, then press Cmd+Q on it.
    std::thread::sleep(Duration::from_millis(500));
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let modal: *mut AnyObject = msg_send![app, modalWindow];
        let number: isize = if modal.is_null() { 0 } else { msg_send![modal, windowNumber] };
        let event = key_event(KEY_Q, COMMAND, "q", number);
        let _: () = msg_send![app, postEvent: &*event, atStart: true];
    }
    say("sent Cmd+Q");

    // The process should be gone within a moment; if this thread is still running, it was not.
    std::thread::sleep(Duration::from_secs(10));
    fail(Some(pid), "Cmd+Q did not quit the app within 10 s");
}
