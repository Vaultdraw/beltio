//! Background work yields to the user. Commands that answer a user action right away (a
//! folder listing in the tree, opening a drawing) `touch` this clock; background workers (the
//! search indexer) call `yield_to_ui` between small units of work and pause while the UI has
//! been busy within the last `QUIET`. Each pause is capped, and a worker always makes some
//! progress between pauses, so background work still finishes while the user keeps working.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::{Duration, Instant},
};

/// How long the UI must have been quiet before background work resumes.
pub(crate) const QUIET: Duration = Duration::from_millis(120);
/// The longest single pause.
pub(crate) const MAX_PAUSE: Duration = Duration::from_millis(400);
const STEP: Duration = Duration::from_millis(4);

static EPOCH: OnceLock<Instant> = OnceLock::new();
/// Milliseconds since `EPOCH` of the last UI request, plus one (0 = never).
static LAST: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// A user-facing request starts now.
pub(crate) fn touch() {
    LAST.store(now_ms() + 1, Ordering::Relaxed);
}

/// Time since the last UI request, or `None` if there was none.
fn since_last() -> Option<Duration> {
    match LAST.load(Ordering::Relaxed) {
        0 => None,
        last => Some(Duration::from_millis(now_ms().saturating_sub(last - 1))),
    }
}

/// True when a UI request came within `quiet`.
pub(crate) fn busy(quiet: Duration) -> bool {
    since_last().is_some_and(|d| d < quiet)
}

/// Waits (at most `max`) until the UI has been quiet for `quiet`. Returns how long it waited.
pub(crate) fn wait_quiet(quiet: Duration, max: Duration) -> Duration {
    let start = Instant::now();
    while busy(quiet) && start.elapsed() < max {
        std::thread::sleep(STEP);
    }
    start.elapsed()
}

/// Background work calls this between units: pauses while the UI is busy (bounded).
pub(crate) fn yield_to_ui() -> Duration {
    wait_quiet(QUIET, MAX_PAUSE)
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test touches the global clock, so the cases run in order in one test.
    #[test]
    fn waits_while_busy_returns_when_quiet_and_is_capped() {
        // A request now: busy, and the wait lasts about the quiet period.
        touch();
        assert!(busy(Duration::from_millis(50)));
        let waited = wait_quiet(Duration::from_millis(50), Duration::from_millis(1000));
        assert!(waited >= Duration::from_millis(40), "{waited:?}");
        assert!(waited < Duration::from_millis(400), "{waited:?}");
        assert!(!busy(Duration::from_millis(50)));
        // Requests that keep coming: the wait is capped.
        let stop = Instant::now() + Duration::from_millis(400);
        let toucher = std::thread::spawn(move || {
            while Instant::now() < stop {
                touch();
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        std::thread::sleep(Duration::from_millis(10));
        let waited = wait_quiet(Duration::from_millis(50), Duration::from_millis(100));
        assert!(waited >= Duration::from_millis(90) && waited < Duration::from_millis(300), "{waited:?}");
        toucher.join().unwrap();
    }
}
