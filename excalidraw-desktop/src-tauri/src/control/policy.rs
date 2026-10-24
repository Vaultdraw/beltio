//! Who may call what, and how often: the gate every request passes after the role is known.
//!
//! - The `mcp` role (AI tools) is closed until the AI switch exists (C7b): `mcp_enabled()`.
//! - Once open, each `mcp` connection has a token bucket, and only one window call from all
//!   `mcp` connections runs at a time, so an AI client cannot flood the editor.
//! - `cli` and `uri` pass through untouched (the `uri` role has its own limiter in `uri.rs`).
//!
//! Pure and clock-injected so the tests need no sleeping.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use vaultdraw_protocol::methods::{roles, MethodSpec};
use vaultdraw_protocol::{codes, RpcError};

/// Requests per second one `mcp` connection may sustain.
const RATE_PER_SEC: f64 = 20.0;
/// Requests an idle `mcp` connection may send at once.
const BURST: f64 = 40.0;
/// Advice for a caller that found the single window slot busy.
const SLOT_RETRY_MS: u64 = 250;

/// The AI master switch. Closed in C7a; C7b reads `ai.enabled` from config.toml here.
pub(crate) fn mcp_enabled() -> bool {
    false
}

/// A token bucket, one per connection.
#[derive(Debug)]
pub(crate) struct Limiter {
    tokens: f64,
    last: Instant,
}

impl Limiter {
    pub(crate) fn new(now: Instant) -> Self {
        Self { tokens: BURST, last: now }
    }

    /// Takes one token, or returns how long to wait for the next one.
    fn take(&mut self, now: Instant) -> Result<(), Duration> {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * RATE_PER_SEC).min(BURST);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64((1.0 - self.tokens) / RATE_PER_SEC))
        }
    }
}

impl Default for Limiter {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

/// Admits one request from `role`. Only the `mcp` role is ever refused here.
pub(crate) fn admit(role: &str, limiter: &mut Limiter) -> Result<(), RpcError> {
    admit_with(role, limiter, mcp_enabled(), Instant::now())
}

fn admit_with(role: &str, limiter: &mut Limiter, enabled: bool, now: Instant) -> Result<(), RpcError> {
    if role != roles::MCP {
        return Ok(());
    }
    if !enabled {
        return Err(RpcError::app(codes::NOT_PERMITTED, "The AI interface is disabled"));
    }
    limiter.take(now).map_err(|wait| {
        let ms = (wait.as_millis() as u64).max(1);
        RpcError::app(codes::RATE_LIMITED, "Too many requests, slow down").with("retryAfterMs", ms)
    })
}

/// The one in-flight window call of the `mcp` role.
pub(crate) struct Slots {
    busy: AtomicBool,
}

impl Slots {
    pub(crate) const fn new() -> Self {
        Self { busy: AtomicBool::new(false) }
    }
}

static MCP_SLOTS: Slots = Slots::new();

/// Held while a window call runs; frees the slot when dropped.
#[must_use]
pub(crate) struct WindowSlot<'a>(Option<&'a Slots>);

impl Drop for WindowSlot<'_> {
    fn drop(&mut self) {
        if let Some(s) = self.0 {
            s.busy.store(false, Ordering::Release);
        }
    }
}

/// Takes the window slot for a call: only `mcp` calls to a window method need one. Another
/// call in flight is refused with `RATE_LIMITED` rather than queued (a queue would hide a
/// stuck editor behind a growing line of AI requests).
pub(crate) fn window_slot(role: &str, spec: &MethodSpec) -> Result<WindowSlot<'static>, RpcError> {
    window_slot_in(&MCP_SLOTS, role, spec)
}

fn window_slot_in<'a>(slots: &'a Slots, role: &str, spec: &MethodSpec) -> Result<WindowSlot<'a>, RpcError> {
    if role != roles::MCP || !spec.window {
        return Ok(WindowSlot(None));
    }
    if slots.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok() {
        Ok(WindowSlot(Some(slots)))
    } else {
        Err(RpcError::app(codes::RATE_LIMITED, "Another AI request is still running in the app").with("retryAfterMs", SLOT_RETRY_MS))
    }
}

/// `[control] notify_edits` from config.toml: show a notice when a script or AI tool edits the
/// drawing. Anything but `false` (missing, broken, wrong type) means true.
pub(crate) fn notify_edits(toml_text: &str) -> bool {
    toml_text
        .parse::<toml::Table>()
        .ok()
        .and_then(|t| t.get("control")?.get("notify_edits")?.as_bool())
        .unwrap_or(true)
}

/// Reads `notify_edits` from the config file (1 MiB cap; unreadable means true).
pub(crate) fn notify_edits_in_config() -> bool {
    let Ok(dirs) = crate::config::resolve_dirs() else { return true };
    let path = dirs.config.join("config.toml");
    crate::config::read_toml_text(&path, "config.toml", 1024 * 1024).map(|text| notify_edits(&text)).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use vaultdraw_protocol::methods::{find, APP_STATUS, FILE_READ, SCENE_APPLY, TAB_LIST};

    fn code(e: &RpcError) -> Option<&str> {
        e.app_code()
    }

    #[test]
    fn closed_switch_refuses_mcp_only() {
        let t = Instant::now();
        let mut l = Limiter::new(t);
        let e = admit_with(roles::MCP, &mut l, false, t).unwrap_err();
        assert_eq!(code(&e), Some(codes::NOT_PERMITTED));
        assert_eq!(e.message, "The AI interface is disabled");
        assert!(admit_with(roles::CLI, &mut l, false, t).is_ok());
        assert!(admit_with(roles::URI, &mut l, false, t).is_ok());
        // The public entry point is closed in C7a.
        assert!(!mcp_enabled());
        assert!(admit(roles::MCP, &mut Limiter::default()).is_err());
    }

    #[test]
    fn bucket_refuses_after_the_burst_and_refills_over_time() {
        let t = Instant::now();
        let mut l = Limiter::new(t);
        for i in 0..40 {
            assert!(admit_with(roles::MCP, &mut l, true, t).is_ok(), "request {i} inside the burst");
        }
        let e = admit_with(roles::MCP, &mut l, true, t).unwrap_err();
        assert_eq!(code(&e), Some(codes::RATE_LIMITED));
        let retry = e.data.as_ref().unwrap().extra["retryAfterMs"].as_u64().unwrap();
        assert!((1..=50).contains(&retry), "one token takes 50 ms at 20 per second, got {retry}");
        // Waiting the advised time frees exactly one request.
        let later = t + Duration::from_millis(retry);
        assert!(admit_with(roles::MCP, &mut l, true, later).is_ok());
        assert!(admit_with(roles::MCP, &mut l, true, later).is_err());
        // A long pause refills to the burst, not beyond.
        let much_later = later + Duration::from_secs(60);
        for _ in 0..40 {
            assert!(admit_with(roles::MCP, &mut l, true, much_later).is_ok());
        }
        assert!(admit_with(roles::MCP, &mut l, true, much_later).is_err());
    }

    #[test]
    fn cli_and_uri_are_never_limited() {
        let t = Instant::now();
        let mut l = Limiter::new(t);
        for _ in 0..500 {
            assert!(admit_with(roles::CLI, &mut l, true, t).is_ok());
            assert!(admit_with(roles::URI, &mut l, true, t).is_ok());
        }
        // And they did not use up the mcp connection's tokens.
        assert!(admit_with(roles::MCP, &mut l, true, t).is_ok());
    }

    #[test]
    fn one_window_call_in_flight_across_mcp_connections() {
        let slots = Slots::new();
        let window = find(SCENE_APPLY).unwrap();
        let plain = find(APP_STATUS).unwrap();
        let first = window_slot_in(&slots, roles::MCP, window).unwrap();
        // A second mcp window call (another connection) is refused with advice.
        let e = window_slot_in(&slots, roles::MCP, window).err().unwrap();
        assert_eq!(code(&e), Some(codes::RATE_LIMITED));
        assert!(e.data.as_ref().unwrap().extra["retryAfterMs"].as_u64().unwrap() > 0);
        // Non-window methods and other roles do not need the slot.
        assert!(window_slot_in(&slots, roles::MCP, plain).is_ok());
        assert!(window_slot_in(&slots, roles::CLI, window).is_ok());
        assert!(window_slot_in(&slots, roles::URI, find(TAB_LIST).unwrap()).is_ok());
        drop(first);
        // Released on drop; also when the guard of a refused call goes away.
        let again = window_slot_in(&slots, roles::MCP, window).unwrap();
        drop(again);
        assert!(window_slot_in(&slots, roles::MCP, find(FILE_READ).unwrap()).is_ok());
        assert!(window_slot_in(&slots, roles::MCP, window).is_ok());
    }

    #[test]
    fn notify_edits_is_true_unless_set_to_false() {
        assert!(notify_edits(""));
        assert!(notify_edits("not toml ["));
        assert!(notify_edits("[control]\nnotify_edits = true\n"));
        assert!(notify_edits("[control]\nnotify_edits = \"no\"\n"));
        assert!(notify_edits("[control]\nenabled = false\n"));
        assert!(!notify_edits("[control]\nnotify_edits = false\n"));
    }

    /// Cost of what every request pays: the method lookup plus the admit check.
    #[test]
    fn policy_check_benchmark() {
        let mut limiter = Limiter::default();
        let mut samples = Vec::new();
        for _ in 0..5000 {
            let t = Instant::now();
            let spec = std::hint::black_box(find(std::hint::black_box(SCENE_APPLY)));
            let ok = admit(std::hint::black_box(roles::CLI), &mut limiter).is_ok() && spec.is_some_and(|s| s.allows(roles::CLI));
            samples.push(t.elapsed());
            assert!(ok);
        }
        samples.sort();
        eprintln!("find + admit + allows: p50 {:?} p95 {:?}", samples[2500], samples[4750]);
        assert!(samples[4750] < Duration::from_micros(200), "budget is 0.2 ms");
    }
}
