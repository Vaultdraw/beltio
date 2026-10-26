//! The hang watchdog's state machine: events in, actions out. No platform calls and no clock,
//! so every path is unit-tested; `macos.rs` feeds it WebKit's callbacks and runs the actions.
//!
//! ```text
//! Unresponsive ──> StartGrace(gen, grace)  ── grace thread sleeps ──> GraceElapsed(gen, check)
//! GraceElapsed: page answers again -> nothing | hidden or slept -> StartGrace again | else ShowDialog
//! DialogClosed(Wait) -> StartGrace(longer) | DialogClosed(Quit) -> Quit
//! Responsive -> CloseDialog (if open), back to idle; the hang is recorded if a dialog was shown
//! ```

/// The longest grace after repeated Wait answers.
pub const MAX_GRACE_MS: u64 = 60_000;
/// Wait backs off: the base grace times these factors (5, 15, 30, 60 s with the 5 s default).
const BACKOFF: [u64; 4] = [1, 3, 6, 12];

/// The grace before the next check, after `waits` Wait answers (or hidden re-checks).
pub fn grace_for(base_ms: u64, waits: u32) -> u64 {
    let factor = BACKOFF[(waits as usize).min(BACKOFF.len() - 1)];
    base_ms.saturating_mul(factor).min(MAX_GRACE_MS)
}

/// What the user chose in the dialog, or how it closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Choice {
    Wait,
    Quit,
    /// Closed by the app because the page answered again.
    Recovered,
}

impl Choice {
    pub fn as_str(self) -> &'static str {
        match self {
            Choice::Wait => "wait",
            Choice::Quit => "quit",
            Choice::Recovered => "recovered",
        }
    }
}

/// What the grace thread found when it woke up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Check {
    /// `[watchdog] enabled`, read now.
    pub enabled: bool,
    /// WebKit still reports the page as unresponsive.
    pub unresponsive: bool,
    /// The window is on screen (not hidden, not minimised).
    pub visible: bool,
    /// The Mac slept during the grace: the time asleep must not count as hanging.
    pub slept: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Unresponsive,
    Responsive,
    GraceElapsed { generation: u64, check: Check },
    DialogClosed(Choice),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// A new hang: note its start time (for the record).
    HangStarted,
    /// Sleep this long, then send `GraceElapsed` with the same generation.
    StartGrace { generation: u64, waits: u32 },
    ShowDialog,
    CloseDialog,
    /// Write the hang record (the hang ended, or the user quits).
    Record(Choice),
    Quit,
}

/// One hang at a time. `generation` changes on every WebKit signal, so a grace thread from an
/// earlier hang finds a different number and does nothing.
#[derive(Debug, Default)]
pub struct Machine {
    generation: u64,
    unresponsive: bool,
    dialog_open: bool,
    /// Wait answers (and hidden or asleep re-checks) in this hang: drives the back-off.
    waits: u32,
    /// The dialog was shown in this hang, and the last choice made in it.
    last_choice: Option<Choice>,
    /// CloseDialog was already sent for the open dialog (WebKit may flip twice in one loop).
    close_sent: bool,
}

impl Machine {
    pub const fn new() -> Self {
        Self { generation: 0, unresponsive: false, dialog_open: false, waits: 0, last_choice: None, close_sent: false }
    }

    #[cfg(test)]
    pub fn dialog_open(&self) -> bool {
        self.dialog_open
    }

    pub fn on(&mut self, event: Event) -> Vec<Action> {
        match event {
            Event::Unresponsive => {
                if self.unresponsive {
                    return Vec::new(); // duplicate signal: the grace already runs
                }
                self.generation += 1;
                self.unresponsive = true;
                self.waits = 0;
                self.last_choice = None;
                vec![Action::HangStarted, self.grace()]
            }
            Event::Responsive => {
                self.generation += 1;
                let was = std::mem::replace(&mut self.unresponsive, false);
                let mut actions = Vec::new();
                let closing = self.dialog_open && !self.close_sent;
                if closing {
                    self.close_sent = true;
                    actions.push(Action::CloseDialog);
                }
                // The hang reached the dialog: record how it ended.
                if was && (self.last_choice.take().is_some() || closing) {
                    actions.push(Action::Record(Choice::Recovered));
                }
                self.waits = 0;
                actions
            }
            Event::GraceElapsed { generation, check } => {
                if generation != self.generation || !self.unresponsive || self.dialog_open {
                    return Vec::new();
                }
                if !check.unresponsive {
                    // WebKit answers again before telling us: the hang is over.
                    self.unresponsive = false;
                    if self.last_choice.take().is_some() {
                        return vec![Action::Record(Choice::Recovered)];
                    }
                    return Vec::new();
                }
                if !check.enabled {
                    // Off: forget this hang (WebKit may never send Responsive, e.g. after a crash);
                    // the next signal reads the setting again.
                    self.generation += 1;
                    self.unresponsive = false;
                    return Vec::new();
                }
                if !check.visible || check.slept {
                    // Look again after one more grace; the Wait back-off is for Wait answers only.
                    return vec![self.grace()];
                }
                self.dialog_open = true;
                self.close_sent = false;
                vec![Action::ShowDialog]
            }
            Event::DialogClosed(choice) => {
                if !self.dialog_open {
                    return Vec::new();
                }
                self.dialog_open = false;
                self.close_sent = false;
                match choice {
                    Choice::Quit => vec![Action::Record(Choice::Quit), Action::Quit],
                    Choice::Wait => {
                        self.last_choice = Some(Choice::Wait);
                        if !self.unresponsive {
                            return Vec::new();
                        }
                        self.waits = self.waits.saturating_add(1);
                        vec![self.grace()]
                    }
                    // Closed because the page answered: Responsive already recorded it.
                    Choice::Recovered => Vec::new(),
                }
            }
        }
    }

    fn grace(&self) -> Action {
        Action::StartGrace { generation: self.generation, waits: self.waits }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HUNG: Check = Check { enabled: true, unresponsive: true, visible: true, slept: false };

    fn start(m: &mut Machine) -> u64 {
        match m.on(Event::Unresponsive).as_slice() {
            [Action::HangStarted, Action::StartGrace { generation, waits: 0 }] => *generation,
            other => panic!("expected a grace, got {other:?}"),
        }
    }

    fn elapsed(m: &mut Machine, generation: u64, check: Check) -> Vec<Action> {
        m.on(Event::GraceElapsed { generation, check })
    }

    #[test]
    fn backoff_is_5_15_30_60_and_capped() {
        let g: Vec<u64> = (0..6).map(|w| grace_for(5000, w)).collect();
        assert_eq!(g, [5000, 15000, 30000, 60000, 60000, 60000]);
        assert_eq!(grace_for(60_000, 0), 60_000);
        assert_eq!(grace_for(20_000, 1), MAX_GRACE_MS, "capped at 60 s");
    }

    #[test]
    fn a_persistent_hang_shows_the_dialog_once() {
        let mut m = Machine::new();
        let g = start(&mut m);
        assert_eq!(elapsed(&mut m, g, HUNG), [Action::ShowDialog]);
        assert!(m.dialog_open());
        assert!(elapsed(&mut m, g, HUNG).is_empty(), "no second dialog");
        assert!(m.on(Event::Unresponsive).is_empty(), "a duplicate signal does nothing");
    }

    #[test]
    fn recovery_during_the_grace_cancels_silently() {
        let mut m = Machine::new();
        let g = start(&mut m);
        assert!(m.on(Event::Responsive).is_empty(), "no dialog, nothing to record");
        assert!(elapsed(&mut m, g, HUNG).is_empty(), "the old grace thread finds a new generation");
    }

    #[test]
    fn a_healthy_recheck_cancels_and_a_new_signal_starts_over() {
        let mut m = Machine::new();
        let g = start(&mut m);
        assert!(elapsed(&mut m, g, Check { unresponsive: false, ..HUNG }).is_empty());
        let g2 = start(&mut m);
        assert_ne!(g, g2);
    }

    #[test]
    fn disabled_ignores_the_hang_until_it_ends() {
        let mut m = Machine::new();
        let g = start(&mut m);
        assert!(elapsed(&mut m, g, Check { enabled: false, ..HUNG }).is_empty());
        assert!(elapsed(&mut m, g, HUNG).is_empty(), "the hang is forgotten");
        // No Responsive ever comes (the web process crashed): the next signal still works.
        start(&mut m);
    }

    #[test]
    fn hidden_or_asleep_rechecks_later_with_backoff() {
        let mut m = Machine::new();
        let g = start(&mut m);
        assert_eq!(elapsed(&mut m, g, Check { visible: false, ..HUNG }), [Action::StartGrace { generation: g, waits: 0 }]);
        assert_eq!(elapsed(&mut m, g, Check { slept: true, ..HUNG }), [Action::StartGrace { generation: g, waits: 0 }]);
        assert_eq!(elapsed(&mut m, g, HUNG), [Action::ShowDialog]);
        assert_eq!(m.on(Event::DialogClosed(Choice::Wait)), [Action::StartGrace { generation: g, waits: 1 }], "Wait backs off from the start");
    }

    #[test]
    fn wait_backs_off_and_rechecks_on_its_own_timer() {
        let mut m = Machine::new();
        let g = start(&mut m);
        for waits in 1..=4 {
            assert_eq!(elapsed(&mut m, g, HUNG), [Action::ShowDialog]);
            assert_eq!(m.on(Event::DialogClosed(Choice::Wait)), [Action::StartGrace { generation: g, waits }]);
        }
    }

    #[test]
    fn recovery_closes_the_dialog_and_records_it() {
        let mut m = Machine::new();
        let g = start(&mut m);
        elapsed(&mut m, g, HUNG);
        assert_eq!(m.on(Event::Responsive), [Action::CloseDialog, Action::Record(Choice::Recovered)]);
        assert!(m.on(Event::DialogClosed(Choice::Recovered)).is_empty());
        assert!(!m.dialog_open());
        // The back-off resets: the next hang starts at the base grace.
        assert_eq!(m.on(Event::Unresponsive), [Action::HangStarted, Action::StartGrace { generation: g + 2, waits: 0 }]);
    }

    #[test]
    fn a_double_flip_closes_the_dialog_once() {
        let mut m = Machine::new();
        let g = start(&mut m);
        elapsed(&mut m, g, HUNG);
        assert_eq!(m.on(Event::Responsive), [Action::CloseDialog, Action::Record(Choice::Recovered)]);
        assert_eq!(m.on(Event::Unresponsive).len(), 2, "a new hang starts its grace");
        assert!(m.on(Event::Responsive).is_empty(), "no second abortModal");
        m.on(Event::DialogClosed(Choice::Recovered));
        assert!(!m.dialog_open());
    }

    #[test]
    fn recovery_after_wait_is_recorded_once() {
        let mut m = Machine::new();
        let g = start(&mut m);
        elapsed(&mut m, g, HUNG);
        m.on(Event::DialogClosed(Choice::Wait));
        assert_eq!(m.on(Event::Responsive), [Action::Record(Choice::Recovered)]);
        assert!(m.on(Event::Responsive).is_empty(), "a second signal records nothing");
    }

    #[test]
    fn quit_records_and_quits() {
        let mut m = Machine::new();
        let g = start(&mut m);
        elapsed(&mut m, g, HUNG);
        assert_eq!(m.on(Event::DialogClosed(Choice::Quit)), [Action::Record(Choice::Quit), Action::Quit]);
    }

    #[test]
    fn a_stray_dialog_close_does_nothing() {
        let mut m = Machine::new();
        assert!(m.on(Event::DialogClosed(Choice::Wait)).is_empty());
        assert!(m.on(Event::Responsive).is_empty());
    }
}
