//! Linux side of the hang watchdog: WebKitGTK's public `is-web-process-responsive` property
//! (WebKitGTK 2.34 and newer), the re-check on the GTK main loop, and a `gtk::MessageDialog`.
//! Same `dispatch` / `run` shape as `macos.rs` over `machine.rs`.
//!
//! Rules, the GTK twins of the macOS spike:
//! - GTK is single-threaded: the web view and the dialog live in thread-locals on the main
//!   thread; the grace thread hands its re-check over with `glib::idle_add_once`.
//! - `dialog.run()` spins a nested main loop, so the `notify` signal still fires while the
//!   dialog is up: recovery closes it with `dialog.response(RESPONSE_RECOVERED)`, the twin of
//!   `abortModal`.
//! - WebKit signals unresponsive once per hang: Wait re-checks on its own timer.
//! - Escape is the dialog's delete-event, mapped to Wait; Quit is Ctrl+Q (a plain `q` typed
//!   into the hung page must not lose edits).

use super::machine::{grace_for, Action, Check, Choice, Event, Machine};
use gtk::prelude::*;
use std::cell::RefCell;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};
use webkit2gtk::WebViewExt;

const PROPERTY: &str = "is-web-process-responsive";
const RESPONSE_WAIT: gtk::ResponseType = gtk::ResponseType::Other(1);
const RESPONSE_QUIT: gtk::ResponseType = gtk::ResponseType::Other(2);
/// Sent by the responsive signal while the dialog is up.
const RESPONSE_RECOVERED: gtk::ResponseType = gtk::ResponseType::Other(3);

static APP: OnceLock<AppHandle> = OnceLock::new();
static MACHINE: Mutex<Machine> = Mutex::new(Machine::new());
/// When the current hang started (the unresponsive signal), for the record.
static HANG_START: Mutex<Option<Instant>> = Mutex::new(None);

thread_local! {
    /// The main window's web view; main thread only (GTK objects are not `Send`).
    static WEBVIEW: RefCell<Option<webkit2gtk::WebView>> = const { RefCell::new(None) };
    /// The dialog while it is up, so the responsive signal can close it.
    static DIALOG: RefCell<Option<gtk::MessageDialog>> = const { RefCell::new(None) };
}

/// Feeds the machine and runs what it asks for. The lock is released before any action runs,
/// because `ShowDialog` blocks in `dialog.run()` and the responsive signal must get in meanwhile.
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
        Action::HangStarted => {
            if let Ok(mut start) = HANG_START.lock() {
                *start = Some(Instant::now());
            }
        }
        Action::StartGrace { generation, waits } => start_grace(generation, waits),
        Action::ShowDialog => {
            let choice = show_dialog();
            dispatch(Event::DialogClosed(choice));
        }
        Action::CloseDialog => DIALOG.with(|d| {
            if let Some(dialog) = d.borrow().as_ref() {
                dialog.response(RESPONSE_RECOVERED);
            }
        }),
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
            super::FORCE_QUIT.store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(app) = APP.get() {
                app.exit(0);
            }
        }
    }
}

/// One short-lived thread per grace: reads the settings, sleeps, then re-checks on the GTK
/// main loop (where the web view lives).
fn start_grace(generation: u64, waits: u32) {
    let spawned = std::thread::Builder::new().name("hang-grace".into()).spawn(move || {
        let settings = super::settings();
        let check = Check { enabled: settings.enabled, unresponsive: true, visible: true, slept: false };
        if !settings.enabled {
            dispatch(Event::GraceElapsed { generation, check });
            return;
        }
        let before = Clocks::now();
        std::thread::sleep(Duration::from_millis(grace_for(settings.grace_ms, waits)));
        let slept = slept_between(before, Clocks::now());
        glib::idle_add_once(move || {
            let check = Check { unresponsive: read_unresponsive(), visible: window_visible(), slept, ..check };
            dispatch(Event::GraceElapsed { generation, check });
        });
    });
    if let Err(e) = spawned {
        eprintln!("vaultdraw: hang watchdog: no grace thread: {e}");
    }
}

/// Boot time counts suspend, monotonic time doesn't: the twins of `mach_continuous_time` and
/// `mach_absolute_time`.
#[derive(Debug, Clone, Copy)]
struct Clocks {
    boot: Duration,
    mono: Duration,
}

impl Clocks {
    fn now() -> Self {
        Self { boot: clock(libc::CLOCK_BOOTTIME), mono: clock(libc::CLOCK_MONOTONIC) }
    }
}

fn clock(id: libc::clockid_t) -> Duration {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(id, &mut ts) } != 0 {
        return Duration::ZERO;
    }
    Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32)
}

/// A gap of more than a second between the two clocks means the machine slept.
fn slept_between(before: Clocks, after: Clocks) -> bool {
    let boot = after.boot.saturating_sub(before.boot);
    let mono = after.mono.saturating_sub(before.mono);
    boot.saturating_sub(mono) > Duration::from_secs(1)
}

/// Main thread.
fn read_unresponsive() -> bool {
    WEBVIEW.with(|w| w.borrow().as_ref().is_some_and(|view| !view.is_web_process_responsive()))
}

/// Main thread. Hidden or minimised windows get no dialog (WebKit still signals them).
fn window_visible() -> bool {
    WEBVIEW.with(|w| w.borrow().as_ref().and_then(toplevel).is_some_and(|win| gtk_window_visible(&win)))
}

fn toplevel(view: &webkit2gtk::WebView) -> Option<gtk::Window> {
    view.toplevel()?.downcast::<gtk::Window>().ok()
}

fn gtk_window_visible(win: &gtk::Window) -> bool {
    let iconified = win.window().is_some_and(|gdk| gdk.state().contains(gtk::gdk::WindowState::ICONIFIED));
    win.is_visible() && !iconified
}

/// Main thread. Wait: Return, Escape, or a click. Quit: Ctrl+Q or a click. Recovery closes it
/// from the responsive signal.
fn show_dialog() -> Choice {
    let parent = WEBVIEW.with(|w| w.borrow().as_ref().and_then(toplevel));
    let dialog = gtk::MessageDialog::new(
        parent.as_ref(),
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        gtk::MessageType::Warning,
        gtk::ButtonsType::None,
        "Vaultdraw isn't responding.",
    );
    dialog.set_title("Vaultdraw");
    dialog.set_secondary_text(Some(
        "The page has not answered for a while. Waiting may let it finish.\nQuitting now loses edits made since the last autosave.",
    ));
    dialog.add_button("Wait", RESPONSE_WAIT);
    dialog.add_button("Quit", RESPONSE_QUIT);
    dialog.set_default_response(RESPONSE_WAIT);
    dialog.connect_key_press_event(|dialog, event| {
        if is_ctrl_q(event.keyval(), event.state()) {
            dialog.response(RESPONSE_QUIT);
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });
    DIALOG.with(|d| *d.borrow_mut() = Some(dialog.clone()));
    let response = dialog.run();
    DIALOG.with(|d| d.borrow_mut().take());
    dialog.close();
    choice_for(response)
}

fn is_ctrl_q(key: gtk::gdk::keys::Key, state: gtk::gdk::ModifierType) -> bool {
    use gtk::gdk::keys::constants as keys;
    (key == keys::q || key == keys::Q) && state.contains(gtk::gdk::ModifierType::CONTROL_MASK)
}

fn choice_for(response: gtk::ResponseType) -> Choice {
    match response {
        RESPONSE_QUIT => Choice::Quit,
        RESPONSE_RECOVERED => Choice::Recovered,
        // Wait, Escape (DeleteEvent), or the dialog closed some other way: keep the app open.
        _ => Choice::Wait,
    }
}

/// Main thread. The signal handler: one hook, nothing else runs while the app is healthy.
fn on_notify(view: &webkit2gtk::WebView) {
    if view.is_web_process_responsive() {
        dispatch(Event::Responsive);
        // After a hang that never reached the dialog, nothing took the start time.
        if let Ok(mut start) = HANG_START.lock() {
            *start = None;
        }
    } else {
        dispatch(Event::Unresponsive);
    }
}

/// Checks that this WebKitGTK has the property, then connects the signal. `Err` is the reason
/// for the one warning line.
fn guard_and_hook(view: webkit2gtk::WebView) -> Result<(), String> {
    if !view.has_property(PROPERTY, None) {
        return Err(format!("WebKitWebView has no {PROPERTY} property (WebKitGTK 2.34 or newer needed)"));
    }
    view.connect_is_web_process_responsive_notify(on_notify);
    WEBVIEW.with(|w| *w.borrow_mut() = Some(view));
    Ok(())
}

pub fn install(window: &WebviewWindow) {
    let _ = APP.set(window.app_handle().clone());
    let result = window.with_webview(|webview| {
        if let Err(why) = guard_and_hook(webview.inner()) {
            eprintln!("{}", off_line(&why));
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
        let line = off_line("WebKitWebView has no is-web-process-responsive property");
        assert_eq!(line, "vaultdraw: WARNING: hang watchdog off: WebKitWebView has no is-web-process-responsive property");
        assert!(!line.contains('\n'));
    }

    #[test]
    fn clocks_tick_and_agree_while_awake() {
        let a = Clocks::now();
        std::thread::sleep(Duration::from_millis(20));
        let b = Clocks::now();
        assert!(b.mono > a.mono && b.boot > a.boot);
        assert!(!slept_between(a, b), "no suspend during the test");
    }

    #[test]
    fn a_gap_between_the_clocks_means_sleep() {
        let s = Duration::from_secs;
        let before = Clocks { boot: s(100), mono: s(100) };
        assert!(!slept_between(before, Clocks { boot: s(105), mono: s(105) }), "same gap: awake");
        assert!(!slept_between(before, Clocks { boot: s(106), mono: s(105) }), "1 s is not sleep");
        assert!(slept_between(before, Clocks { boot: s(130), mono: s(105) }), "25 s asleep");
        assert!(!slept_between(Clocks { boot: s(200), mono: s(200) }, before), "clocks going backwards: no panic");
    }

    #[test]
    fn responses_map_to_choices() {
        assert_eq!(choice_for(RESPONSE_QUIT), Choice::Quit);
        assert_eq!(choice_for(RESPONSE_RECOVERED), Choice::Recovered);
        assert_eq!(choice_for(RESPONSE_WAIT), Choice::Wait);
        assert_eq!(choice_for(gtk::ResponseType::DeleteEvent), Choice::Wait, "Escape waits");
        assert_eq!(choice_for(gtk::ResponseType::None), Choice::Wait);
    }

    #[test]
    fn only_ctrl_q_quits() {
        use gtk::gdk::keys::constants as keys;
        use gtk::gdk::ModifierType as M;
        assert!(is_ctrl_q(keys::q, M::CONTROL_MASK));
        assert!(is_ctrl_q(keys::Q, M::CONTROL_MASK | M::SHIFT_MASK));
        assert!(!is_ctrl_q(keys::q, M::empty()), "a plain q must not quit");
        assert!(!is_ctrl_q(keys::q, M::MOD1_MASK), "Alt+Q is not Quit");
        assert!(!is_ctrl_q(keys::w, M::CONTROL_MASK));
    }
}
