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
    /// The user typed it into the palette. It still asks before anything that changes state
    /// (the command can be called by any script in the page), and is rate limited.
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
    /// Own rate-limit bucket: a local script cannot starve links from the system.
    fn bucket(self) -> usize {
        match self {
            Self::Os => 0,
            Self::Forwarded | Self::Cli => 1,
            Self::User => 2,
        }
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
        let off = Self { enabled: false, allow: vec![] };
        let table = match text.parse::<toml::Table>() {
            Ok(t) => t,
            Err(_) if text.trim().is_empty() => toml::Table::new(),
            Err(_) => return off,
        };
        // No `[control]` at all: defaults. Present but not a table: fail closed.
        let control = match table.get("control") {
            None => toml::Table::new(),
            Some(c) => match c.as_table() {
                Some(t) => t.clone(),
                None => return off,
            },
        };
        // A wrongly typed switch (string, number) means off, never on.
        let enabled = control.get("uri_enabled").map_or(true, |v| v.as_bool().unwrap_or(false));
        let allow = control
            .get("uri_allow")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        Self { enabled, allow }
    }

    fn allows(&self, entry: &str) -> bool {
        self.allow.iter().any(|a| a == entry)
    }
}

/// Commands a link may never run on its own say-so (plugin commands are not here: the window
/// only runs built-in commands for a link unless the id is listed in `uri_allow`), even after the user clicks Ask-Run:
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
const DENY_PREFIX: &[&str] = &["file.import", "file.export", "links.openuri", "links.registerhandlers", "uri.", "control.", "ai."];
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
    /// A file from the system was accepted: the window may read it once.
    fn grant(&self, _path: &str) {}
}

#[derive(Default)]
struct State {
    queue: VecDeque<Value>,
    limiters: [Limiter; 3],
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
    let mut plan = serde_json::to_value(req).map_err(|e| e.to_string())?;
    // Pre-approval comes only from `uri_allow`; nobody's own origin skips the question.
    let allow_switch = policy.allows("switch-vault");
    let allowed = match req {
        UriRequest::Cmd { id } => {
            let listed = policy.allows(id);
            if is_denied(id) && !listed {
                return Err(format!("A link cannot run {} (blocked for links; allow it in control.uri_allow)", printable(id, 60)));
            }
            listed
        }
        UriRequest::New { .. } => policy.allows("new"),
        _ => true,
    };
    plan["allowed"] = json!(allowed);
    plan["allowSwitch"] = json!(allow_switch);
    plan["origin"] = json!(origin.name());
    Ok(plan)
}

/// Will the window show a question for this plan? (Then it must not steal focus.)
fn will_ask(plan: &Value) -> bool {
    let flag = |k: &str| plan[k] == json!(true);
    match plan["action"].as_str() {
        Some("new" | "cmd") => !flag("allowed"),
        Some("open" | "search") => plan.get("vault").is_some() && !flag("allowSwitch"),
        _ => false,
    }
}

impl Handler {
    /// Checks every request from outside shares: window ready (or queued), rate limit, off switch.
    fn admit(&self, win: &dyn Window, config_text: &str, origin: Origin, now: Instant, off_message: &str) -> Result<Policy, RpcError> {
        let policy = Policy::from_toml(config_text);
        let toast = origin != Origin::Cli;
        if !win.ready() && !origin.queues() {
            return Err(RpcError::app(codes::NOT_READY, "The app window is not ready yet"));
        }
        {
            let verdict = self.state.lock().unwrap().limiters[origin.bucket()].check(now);
            if let Verdict::Limited(first) = verdict {
                if first {
                    self.show(win, origin, toast, "Too many links at once: ignoring some (limit 5 per 10 seconds)");
                }
                return Err(RpcError::app(codes::RATE_LIMITED, "Too many links at once (limit 5 per 10 seconds)"));
            }
        }
        if !policy.enabled {
            self.show(win, origin, toast, &format!("{off_message} (control.uri_enabled)"));
            return Err(RpcError::app(codes::DISABLED, format!("{off_message} (control.uri_enabled = false)")));
        }
        Ok(policy)
    }

    /// Sends a plan now, or queues it while the window starts.
    fn deliver(&self, win: &dyn Window, plan: Value) -> Result<Value, RpcError> {
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

    /// One file the system opened (Finder, argv). Same switch, rate limit and queue as links.
    /// The window decides what to do with it and asks before copying or switching vault.
    pub(crate) fn handle_file(&self, win: &dyn Window, config_text: &str, path: &str, origin: Origin, now: Instant) -> Result<Value, RpcError> {
        let toast = origin != Origin::Cli;
        self.admit(win, config_text, origin, now, "Opening files from outside is turned off")?;
        // The same normalized text is granted and sent, so the window's read matches the grant.
        let normalized;
        let path = if path.starts_with('/') {
            normalized = super::files::normalize(path);
            &normalized
        } else {
            path // a relative path is refused below, never made absolute
        };
        let plan = match super::files::plan_for(path, origin.name()) {
            Ok(p) => p,
            Err(msg) => {
                self.show(win, origin, toast, &msg);
                return Err(RpcError::invalid_params(msg));
            }
        };
        win.grant(path);
        win.focus();
        self.deliver(win, plan)
    }

    /// One link, from any entry point. `config_text` is `config.toml` as read just now.
    pub(crate) fn handle(&self, win: &dyn Window, config_text: &str, url: &str, origin: Origin, now: Instant) -> Result<Value, RpcError> {
        let toast = origin != Origin::Cli;
        let policy = self.admit(win, config_text, origin, now, "Links from outside are turned off (control.uri_enabled)")?;
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
        // Raise the window only for links that run at once: a dialog must not pop up under a
        // key the user is still holding.
        if origin != Origin::User && !will_ask(&plan) {
            win.focus();
        }
        self.deliver(win, plan)
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
    fn grant(&self, path: &str) {
        super::files::grants().grant(path);
    }
    fn focus(&self) {
        use tauri::Manager;
        if let Some(w) = self.0.get_webview_window(super::bridge::WINDOW_LABEL) {
            if w.is_focused().unwrap_or(false) {
                return;
            }
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

/// Something the system handed the app: a link or a file path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Item {
    Link(String),
    File(String),
}

/// Sorts system-provided texts (links and `file:` URLs from an Apple Event, argv entries) into
/// items, in order. A `file:` URL becomes its path; anything else is dropped.
pub(crate) fn classify_opened(urls: impl IntoIterator<Item = String>, cwd: Option<&str>) -> Vec<Item> {
    urls.into_iter()
        .filter_map(|u| {
            if is_uri(&u) {
                Some(Item::Link(u))
            } else if u.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("file:")) {
                let path = file_url_path(&u)?;
                super::files::is_file_arg(&path).then_some(Item::File(path))
            } else if !u.contains("://") && super::files::is_file_arg(&u) {
                super::files::absolute(&u, cwd).map(Item::File)
            } else {
                None
            }
        })
        .collect()
}

/// The path in a `file:` URL (percent-decoded); `None` for any other text or a remote host.
fn file_url_path(text: &str) -> Option<String> {
    let url = tauri::Url::parse(text).ok()?;
    url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned())
}

/// macOS: links and files from the OS (Apple Event), on a worker thread so the main loop never
/// waits for the window.
#[cfg(target_os = "macos")]
pub(crate) fn on_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    spawn_items(app, classify_opened(urls.into_iter().map(String::from), None));
}

/// Links and files in the first launch's own argv (Linux and Windows; `open -n` on macOS).
pub(crate) fn on_startup_argv(app: &tauri::AppHandle) {
    let cwd = std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned());
    spawn_items(app, classify_opened(std::env::args().skip(1), cwd.as_deref()));
}

fn spawn_items(app: &tauri::AppHandle, items: Vec<Item>) {
    if items.is_empty() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("uri-links".into()).spawn(move || {
        for item in items {
            let _ = match item {
                Item::Link(url) => handle(&app, &url, Origin::Os),
                Item::File(path) => handle_file(&app, &path, Origin::Os),
            };
        }
    });
}

/// Every file entry point calls this.
pub(crate) fn handle_file(app: &tauri::AppHandle, path: &str, origin: Origin) -> Result<Value, RpcError> {
    handler().handle_file(&AppWindow(app), &read_config_text(), path, origin, Instant::now())
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
