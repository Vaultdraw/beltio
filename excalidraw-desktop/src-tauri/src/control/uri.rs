//! `vaultdraw://` links: the one place every entry point ends up (macOS Apple Event, argv of the
//! first launch, a forwarded second launch, `uri.handle` from the CLI, the palette's "open a
//! link"). It reads `[control]` for each request (live, no watcher), refuses or rate-limits,
//! applies the deny list, and hands the window a small plan (`uri.run`). The window runs the
//! plan through its normal handlers and asks the user before anything that changes state.
//! Nothing here touches the network or the file system besides reading `config.toml`.
//!
//! Plan fields: the parsed request (`action`, `vault`, `file`, `newTab`, `query`, `path`, `id`)
//! plus `allowed` (run `new` / `cmd` without asking), `allowSwitch` (switch vault without
//! asking) and `origin`. A refusal the user should see goes to the window as
//! `{action: "notice", message}`.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use vaultdraw_core::uri::{self, printable, UriRequest};
use vaultdraw_protocol::{codes, RpcError};

/// Requests allowed per `RATE_WINDOW` (all origins but the user's own palette).
pub(crate) const RATE_LIMIT: usize = 5;
pub(crate) const RATE_WINDOW: Duration = Duration::from_secs(10);
/// Plans held while the window starts.
pub(crate) const QUEUE_CAP: usize = 16;

/// Where a link came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Origin {
    /// macOS Apple Event or the first launch's argv: nobody waits for an answer, so the plan
    /// is queued until the window is ready.
    Os,
    /// A second launch forwarded over the control socket: the sender retries while not ready.
    Forwarded,
    /// `vaultdraw uri <url>`: a script; it sees errors on its own terminal.
    Cli,
    /// The user typed it into the palette: no confirmation, no rate limit, works when links
    /// from outside are off.
    User,
}

impl Origin {
    fn name(self) -> &'static str {
        match self {
            Self::Os => "os",
            Self::Forwarded => "forwarded",
            Self::Cli => "cli",
            Self::User => "user",
        }
    }
    fn queues(self) -> bool {
        self == Self::Os
    }
}

/// `[control]` keys read for each link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Policy {
    pub(crate) enabled: bool,
    pub(crate) allow: Vec<String>,
}

impl Policy {
    /// No config: links on, nothing pre-approved. A config that exists but cannot be parsed
    /// fails closed (links off): a typo must not turn the user's off switch back on.
    pub(crate) fn from_toml(text: &str) -> Self {
        let table = match text.parse::<toml::Table>() {
            Ok(t) => t,
            Err(_) if text.trim().is_empty() => toml::Table::new(),
            Err(_) => return Self { enabled: false, allow: vec![] },
        };
        let control = table.get("control").and_then(|c| c.as_table().cloned());
        let enabled = control.as_ref().and_then(|c| c.get("uri_enabled")?.as_bool()).unwrap_or(true);
        let allow = control
            .as_ref()
            .and_then(|c| c.get("uri_allow")?.as_array().cloned())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        Self { enabled, allow }
    }

    fn allows(&self, entry: &str) -> bool {
        self.allow.iter().any(|a| a == entry)
    }
}

/// Commands a link may never run on its own say-so, even after the user clicks Ask-Run:
/// destructive, system-level or link-related ones. Listing an id in `uri_allow` overrides this
/// for that id (the user's file, the user's choice).
const DENY_EXACT: &[&str] = &[
    "file.trash",
    "file.move",
    "file.rename",
    "file.resolveConflict",
    "cli.install",
    "cli.installSystem",
    "tags.rename",
    "templates.saveDrawing",
    "vault.newFromTemplate",
];
const DENY_PREFIX: &[&str] = &["file.import", "file.export", "plugin.", "plugins.", "links.openuri", "links.registerhandlers", "uri."];
const DENY_CONTAINS: &[&str] = &["quit", "delete", "discard", "trash", "remove", "install", "overwrite", "restore", "revert", "purge", "erase", "wipe"];

pub(crate) fn is_denied(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    DENY_EXACT.iter().any(|e| e.eq_ignore_ascii_case(id))
        || DENY_PREFIX.iter().any(|p| lower.starts_with(&p.to_ascii_lowercase()))
        || DENY_CONTAINS.iter().any(|c| lower.contains(c))
}

/// Sliding window: at most `RATE_LIMIT` accepted requests per `RATE_WINDOW`. A refused request
/// is not recorded (the window frees on its own). `notified` makes one burst show one notice.
#[derive(Default)]
struct Limiter {
    accepted: VecDeque<Instant>,
    notified: bool,
}

enum Verdict {
    Ok,
    /// Refused; true on the first refusal of a burst (show a notice).
    Limited(bool),
}

impl Limiter {
    fn check(&mut self, now: Instant) -> Verdict {
        while self.accepted.front().is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW) {
            self.accepted.pop_front();
        }
        if self.accepted.len() >= RATE_LIMIT {
            let first = !self.notified;
            self.notified = true;
            return Verdict::Limited(first);
        }
        self.notified = false;
        self.accepted.push_back(now);
        Verdict::Ok
    }
}

/// The window, as far as this module needs it (the real one wraps the Tauri window bridge).
pub(crate) trait Window {
    fn ready(&self) -> bool;
    /// Runs `uri.run` in the window and returns its reply.
    fn run(&self, plan: Value) -> Result<Value, RpcError>;
    /// Brings the window to the front.
    fn focus(&self);
}

#[derive(Default)]
struct State {
    queue: VecDeque<Value>,
    limiter: Limiter,
}

#[derive(Default)]
pub(crate) struct Handler {
    state: Mutex<State>,
}

fn notice(message: &str) -> Value {
    json!({"action": "notice", "message": message})
}

/// The plan for `req`, or the refusal text. Pure.
pub(crate) fn plan_for(req: &UriRequest, policy: &Policy, origin: Origin) -> Result<Value, String> {
    let user = origin == Origin::User;
    let mut plan = serde_json::to_value(req).map_err(|e| e.to_string())?;
    let (allowed, allow_switch) = match req {
        UriRequest::Cmd { id } => {
            let listed = policy.allows(id);
            if is_denied(id) && !listed {
                return Err(format!("A link cannot run {} (blocked for links; allow it in control.uri_allow)", printable(id, 60)));
            }
            (user || listed, user || policy.allows("switch-vault"))
        }
        UriRequest::New { .. } => (user || policy.allows("new"), user || policy.allows("switch-vault")),
        _ => (true, user || policy.allows("switch-vault")),
    };
    plan["allowed"] = json!(allowed);
    plan["allowSwitch"] = json!(allow_switch);
    plan["origin"] = json!(origin.name());
    Ok(plan)
}

impl Handler {
    /// One link, from any entry point. `config_text` is `config.toml` as read just now.
    pub(crate) fn handle(&self, win: &dyn Window, config_text: &str, url: &str, origin: Origin, now: Instant) -> Result<Value, RpcError> {
        let policy = Policy::from_toml(config_text);
        let toast = origin != Origin::Cli;
        if !win.ready() && !origin.queues() {
            return Err(RpcError::app(codes::NOT_READY, "The app window is not ready yet"));
        }
        if origin != Origin::User {
            let verdict = self.state.lock().unwrap().limiter.check(now);
            if let Verdict::Limited(first) = verdict {
                if first {
                    self.show(win, origin, toast, "Too many links at once: ignoring some (limit 5 per 10 seconds)");
                }
                return Err(RpcError::app(codes::RATE_LIMITED, "Too many links at once (limit 5 per 10 seconds)"));
            }
        }
        if !policy.enabled && origin != Origin::User {
            self.show(win, origin, toast, "Links from outside are turned off (control.uri_enabled)");
            return Err(RpcError::app(codes::DISABLED, "Links from outside are turned off (control.uri_enabled = false)"));
        }
        let req = match uri::parse(url) {
            Ok(r) => r,
            Err(e) => {
                self.show(win, origin, toast, &e.to_string());
                return Err(RpcError::invalid_params(e.to_string()));
            }
        };
        let plan = match plan_for(&req, &policy, origin) {
            Ok(p) => p,
            Err(msg) => {
                self.show(win, origin, toast, &msg);
                return Err(RpcError::app(codes::NOT_PERMITTED, msg));
            }
        };
        if origin != Origin::User {
            win.focus();
        }
        if win.ready() {
            return win.run(plan);
        }
        self.enqueue(plan)?;
        // The window may have become ready between the check and the enqueue: its
        // ready hook would have found an empty queue, so drain here.
        if win.ready() {
            self.drain(win);
        }
        Ok(json!({"status": "queued"}))
    }

    /// Shows a refusal to the user: now, or queued while the window starts.
    fn show(&self, win: &dyn Window, origin: Origin, toast: bool, message: &str) {
        if !toast {
            return;
        }
        if win.ready() {
            let _ = win.run(notice(message));
        } else if origin.queues() {
            let _ = self.enqueue(notice(message));
        }
    }

    fn enqueue(&self, plan: Value) -> Result<(), RpcError> {
        let mut s = self.state.lock().unwrap();
        if s.queue.len() >= QUEUE_CAP {
            return Err(RpcError::app(codes::RATE_LIMITED, "Too many links waiting for the window"));
        }
        s.queue.push_back(plan);
        Ok(())
    }

    pub(crate) fn queued(&self) -> usize {
        self.state.lock().unwrap().queue.len()
    }

    /// Sends everything queued while the window started, in order.
    pub(crate) fn drain(&self, win: &dyn Window) {
        let plans: Vec<Value> = self.state.lock().unwrap().queue.drain(..).collect();
        let mut iter = plans.into_iter();
        while let Some(plan) = iter.next() {
            if win.run(plan.clone()).is_err() && !win.ready() {
                // The window went away again: keep this one and the rest for the next ready.
                let mut s = self.state.lock().unwrap();
                for p in std::iter::once(plan).chain(iter).rev() {
                    s.queue.push_front(p);
                }
                return;
            }
        }
    }
}

// ---- The app: global handler, the Tauri window, entry points ----------------------------

static HANDLER: OnceLock<Handler> = OnceLock::new();

fn handler() -> &'static Handler {
    HANDLER.get_or_init(Handler::default)
}

struct AppWindow<'a>(&'a tauri::AppHandle);

impl Window for AppWindow<'_> {
    fn ready(&self) -> bool {
        super::bridge::pending().is_ready()
    }
    fn run(&self, plan: Value) -> Result<Value, RpcError> {
        super::bridge::call_window(self.0, "uri.run", Some(plan), super::bridge::CALL_TIMEOUT)
    }
    fn focus(&self) {
        use tauri::Manager;
        if let Some(w) = self.0.get_webview_window(super::bridge::WINDOW_LABEL) {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

/// `[control]` lives in config.toml: read it now (a missing or unreadable file means defaults).
fn read_config_text() -> String {
    let Ok(dirs) = crate::config::resolve_dirs() else { return String::new() };
    let path = dirs.config.join("config.toml");
    if !path.exists() {
        return String::new();
    }
    // Present but unreadable (too big, not UTF-8, I/O error): fail closed, links off.
    crate::config::read_toml_text(&path, "config.toml", 1024 * 1024).unwrap_or_else(|_| "[control]\nuri_enabled = false\n".into())
}

/// Every entry point calls this.
pub(crate) fn handle(app: &tauri::AppHandle, url: &str, origin: Origin) -> Result<Value, RpcError> {
    handler().handle(&AppWindow(app), &read_config_text(), url, origin, Instant::now())
}

/// True for text that is a `vaultdraw:` link (scheme only; the parser decides the rest).
pub(crate) fn is_uri(arg: &str) -> bool {
    arg.get(..10).is_some_and(|p| p.eq_ignore_ascii_case("vaultdraw:"))
}

/// macOS: links from the OS (Apple Event), on a worker thread so the main loop never waits for
/// the window. Anything else (`file:` opens belong to C6b) is dropped.
#[cfg(target_os = "macos")]
pub(crate) fn on_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let links: Vec<String> = urls.into_iter().map(String::from).filter(|u| is_uri(u)).collect();
    spawn_links(app, links);
}

/// Links in the first launch's own argv (Linux and Windows; `open -n` on macOS).
pub(crate) fn on_startup_argv(app: &tauri::AppHandle) {
    let links: Vec<String> = std::env::args().skip(1).filter(|a| is_uri(a)).collect();
    spawn_links(app, links);
}

fn spawn_links(app: &tauri::AppHandle, links: Vec<String>) {
    if links.is_empty() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("uri-links".into()).spawn(move || {
        for url in links {
            let _ = handle(&app, &url, Origin::Os);
        }
    });
}

/// The window just became ready: send the queue (a thread only when something waits).
pub(crate) fn on_window_ready(app: &tauri::AppHandle) {
    if handler().queued() == 0 {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("uri-drain".into()).spawn(move || handler().drain(&AppWindow(&app)));
}

/// The palette's "open a link": the user's own text, no confirmation.
#[tauri::command]
pub(crate) async fn uri_open(app: tauri::AppHandle, url: String) -> crate::Result<Value> {
    tauri::async_runtime::spawn_blocking(move || handle(&app, &url, Origin::User))
        .await
        .map_err(|e| crate::err("INTERNAL", e.to_string()))?
        .map_err(|e| {
            let code = e.app_code().unwrap_or("INVALID_ARGUMENT").to_string();
            crate::err(&code, e.message)
        })
}

#[cfg(test)]
mod tests;
