use super::*;
use std::cell::{Cell, RefCell};

struct Fake {
    ready: Cell<bool>,
    sent: RefCell<Vec<Value>>,
    focused: Cell<u32>,
}

impl Fake {
    fn new(ready: bool) -> Self {
        Self { ready: Cell::new(ready), sent: RefCell::default(), focused: Cell::new(0) }
    }
    fn plans(&self) -> Vec<Value> {
        self.sent.borrow().iter().filter(|p| p["action"] != "notice").cloned().collect()
    }
    fn notices(&self) -> Vec<String> {
        self.sent.borrow().iter().filter(|p| p["action"] == "notice").map(|p| p["message"].as_str().unwrap().to_string()).collect()
    }
}

impl Window for Fake {
    fn ready(&self) -> bool {
        self.ready.get()
    }
    fn run(&self, plan: Value) -> Result<Value, RpcError> {
        self.sent.borrow_mut().push(plan);
        Ok(json!({"status": "done"}))
    }
    fn focus(&self) {
        self.focused.set(self.focused.get() + 1);
    }
}

fn go(h: &Handler, w: &Fake, cfg: &str, url: &str, o: Origin) -> Result<Value, RpcError> {
    h.handle(w, cfg, url, o, Instant::now())
}

const OPEN: &str = "vaultdraw://open?file=a";
const NEW: &str = "vaultdraw://new?path=Inbox/Idea";

// ---- Policy and config ----

#[test]
fn policy_defaults_and_reads_both_keys() {
    let d = Policy { enabled: true, allow: vec![] };
    assert_eq!(Policy::from_toml(""), d);
    assert_eq!(Policy::from_toml("   \n"), d);
    assert!(!Policy::from_toml("not toml [").enabled, "a broken config fails closed");
    assert_eq!(Policy::from_toml("[control]\nenabled = false\n"), d, "the socket switch is not the link switch");
    let p = Policy::from_toml("[control]\nuri_enabled = false\nuri_allow = [\"new\", 3, \"appearance.toggleMode\"]\n");
    assert_eq!(p, Policy { enabled: false, allow: vec!["new".into(), "appearance.toggleMode".into()] });
    assert_eq!(Policy::from_toml("[control]\nuri_allow = \"new\"\n"), d, "a wrong allow list means nothing is pre-approved");
}

#[test]
fn security_off_switch_refuses_everything_from_outside_with_a_notice() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let cfg = "[control]\nuri_enabled = false\n";
    for o in [Origin::Os, Origin::Forwarded] {
        let e = go(&h, &w, cfg, OPEN, o).unwrap_err();
        assert_eq!(e.app_code(), Some(codes::DISABLED));
    }
    assert!(w.plans().is_empty());
    assert_eq!(w.notices().len(), 2);
    assert!(w.notices()[0].contains("control.uri_enabled"));
    // Config is read per request: flipping it back works at once.
    assert!(go(&h, &w, "", OPEN, Origin::Os).is_ok());
    // The palette entry point is the same handler: it respects the switch too.
    assert!(go(&h, &w, cfg, OPEN, Origin::User).is_err());
}

#[test]
fn off_switch_while_the_window_starts_queues_the_notice_only() {
    let (h, w) = (Handler::default(), Fake::new(false));
    assert!(go(&h, &w, "[control]\nuri_enabled = false\n", OPEN, Origin::Os).is_err());
    assert_eq!(h.queued(), 1);
    w.ready.set(true);
    h.drain(&w);
    assert!(w.plans().is_empty());
    assert_eq!(w.notices().len(), 1);
}

// ---- What asks and what does not ----

#[test]
fn security_new_and_cmd_and_switch_ask_by_default() {
    let (h, w) = (Handler::default(), Fake::new(true));
    for (url, key) in [(NEW, "allowed"), ("vaultdraw://cmd?id=appearance.toggleMode", "allowed"), ("vaultdraw://open?vault=DSA&file=a", "allowSwitch")] {
        go(&h, &w, "", url, Origin::Os).unwrap();
        let plan = w.plans().pop().unwrap();
        assert_eq!(plan[key], false, "{url}");
        assert_eq!(plan["allowSwitch"], false);
        assert_eq!(plan["origin"], "os");
    }
}

#[test]
fn open_and_search_run_at_once() {
    let (h, w) = (Handler::default(), Fake::new(true));
    go(&h, &w, "", OPEN, Origin::Os).unwrap();
    go(&h, &w, "", "vaultdraw://search?query=x", Origin::Os).unwrap();
    assert!(w.plans().iter().all(|p| p["allowed"] == true));
}

#[test]
fn uri_allow_entries_remove_the_prompt_for_exactly_that_entry() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let cfg = "[control]\nuri_allow = [\"new\", \"appearance.toggleMode\", \"switch-vault\"]\n";
    go(&h, &w, cfg, NEW, Origin::Os).unwrap();
    go(&h, &w, cfg, "vaultdraw://cmd?id=appearance.toggleMode", Origin::Os).unwrap();
    go(&h, &w, cfg, "vaultdraw://cmd?id=appearance.setMode", Origin::Os).unwrap();
    go(&h, &w, cfg, "vaultdraw://open?vault=DSA", Origin::Os).unwrap();
    let p = w.plans();
    assert_eq!(p[0]["allowed"], true);
    assert_eq!(p[1]["allowed"], true);
    assert_eq!(p[2]["allowed"], false, "another command still asks");
    assert_eq!(p[3]["allowSwitch"], true);
    // `new` listed does not allow a cmd, and a command id does not allow `new`.
    go(&h, &w, "[control]\nuri_allow = [\"appearance.toggleMode\"]\n", NEW, Origin::Os).unwrap();
    assert_eq!(w.plans().pop().unwrap()["allowed"], false);
}

#[test]
fn security_the_users_own_link_still_asks_before_changing_anything() {
    let (h, w) = (Handler::default(), Fake::new(true));
    for url in [NEW, "vaultdraw://cmd?id=appearance.toggleMode", "vaultdraw://open?vault=DSA"] {
        go(&h, &w, "", url, Origin::User).unwrap();
        let p = w.plans().pop().unwrap();
        assert_eq!(p["allowSwitch"], false, "{url}");
        assert_eq!(p["allowed"], url.contains("open"), "{url}");
        assert_eq!(p["origin"], "user");
    }
    assert_eq!(w.focused.get(), 0, "typing a link does not steal focus");
}

#[test]
fn security_a_link_that_asks_does_not_raise_the_window() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    let at = |i: u64| t0 + Duration::from_secs(i * 3);
    for (i, url) in [NEW, "vaultdraw://cmd?id=appearance.toggleMode", "vaultdraw://open?vault=DSA&file=a", "vaultdraw://search?query=x&vault=DSA"].iter().enumerate() {
        h.handle(&w, "", url, Origin::Os, at(i as u64)).unwrap();
    }
    assert_eq!(w.focused.get(), 0);
    // Pre-approved or plain: raised.
    h.handle(&w, "[control]\nuri_allow = [\"new\"]\n", NEW, Origin::Os, at(5)).unwrap();
    h.handle(&w, "", OPEN, Origin::Os, at(6)).unwrap();
    assert_eq!(w.focused.get(), 2);
}

// ---- Deny list ----

#[test]
fn security_deny_list_is_pinned() {
    for id in [
        "file.trash", "file.move", "file.rename", "file.resolveConflict", "cli.install", "cli.installSystem", "tags.rename", "templates.saveDrawing",
        "vault.newFromTemplate", "file.importFile", "file.importPdf", "file.exportPng", "file.exportPdf", "app.quit", "File.Trash", "Links.OpenUri", "uri.run", "history.deleteAll", "x.discardChanges",
        "plugins.install", "links.openUri", "links.registerHandlers", "drawing.trashActive", "cli.uninstall",
    ] {
        assert!(is_denied(id), "{id} must be denied");
    }
    for id in ["appearance.toggleMode", "view.zoomReset", "drawing.open:Graphs/BFS", "navigator.toggle", "settings.open", "links.back", "graph.open", "security.audit", "view.exitFullscreen"] {
        assert!(!is_denied(id), "{id} must stay allowed");
    }
}

#[test]
fn security_a_denied_command_is_refused_even_after_asking_and_an_explicit_allow_overrides() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let e = go(&h, &w, "", "vaultdraw://cmd?id=file.trash", Origin::Os).unwrap_err();
    assert_eq!(e.app_code(), Some(codes::NOT_PERMITTED));
    assert!(w.plans().is_empty());
    assert!(w.notices()[0].contains("file.trash"));
    // The user's file, the user's choice: listing the id overrides, and it then runs unasked.
    go(&h, &w, "[control]\nuri_allow = [\"file.trash\"]\n", "vaultdraw://cmd?id=file.trash", Origin::Os).unwrap();
    let p = w.plans().pop().unwrap();
    assert_eq!((p["action"].clone(), p["allowed"].clone()), (json!("cmd"), json!(true)));
}

// ---- Parser rules reach the user as errors, nothing runs ----

#[test]
fn security_bad_links_never_reach_the_window_as_plans() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    for (i, url) in [
        "vaultdraw://open?file=../x", "vaultdraw://open?file=/etc/passwd", "vaultdraw://new?path=a%00b", "vaultdraw://open?vault=%2Ftmp%2Fx",
        "vaultdraw://delete?file=a", "https://example.com", "vaultdraw://cmd?id=a;b",
    ]
    .iter()
    .enumerate()
    {
        // Spread over time: the rate limit is not what is under test here.
        let e = h.handle(&w, "", url, Origin::Os, t0 + Duration::from_secs(i as u64 * 3)).unwrap_err();
        assert_eq!(e.code, vaultdraw_protocol::INVALID_PARAMS, "{url}");
    }
    assert!(w.plans().is_empty());
    assert_eq!(w.notices().len(), 7);
}

#[test]
fn security_plans_carry_no_callback_or_unknown_fields() {
    let (h, w) = (Handler::default(), Fake::new(true));
    go(&h, &w, "", "vaultdraw://open?file=a&x-success=https%3A%2F%2Fevil.example&overwrite=1&content=x", Origin::Os).unwrap();
    let plan = w.plans().pop().unwrap();
    let keys: Vec<&str> = plan.as_object().unwrap().keys().map(String::as_str).collect();
    let mut keys = keys;
    keys.sort();
    assert_eq!(keys, ["action", "allowSwitch", "allowed", "file", "origin"]);
}

#[test]
fn security_new_never_carries_overwrite_semantics() {
    let (h, w) = (Handler::default(), Fake::new(true));
    go(&h, &w, "", "vaultdraw://new?path=a&overwrite=1&replace=1", Origin::Os).unwrap();
    let plan = w.plans().pop().unwrap();
    assert!(plan.get("overwrite").is_none() && plan.get("replace").is_none());
}

// ---- Rate limit and queue ----

#[test]
fn security_rate_limit_is_five_per_ten_seconds_with_one_notice() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    for _ in 0..5 {
        h.handle(&w, "", OPEN, Origin::Os, t0).unwrap();
    }
    let e = h.handle(&w, "", OPEN, Origin::Os, t0 + Duration::from_secs(1)).unwrap_err();
    assert_eq!(e.app_code(), Some(codes::RATE_LIMITED));
    for _ in 0..3 {
        assert!(h.handle(&w, "", OPEN, Origin::Os, t0 + Duration::from_secs(2)).is_err());
    }
    assert_eq!(w.plans().len(), 5);
    assert_eq!(w.notices().len(), 1, "one burst, one notice");
    // After the window passes, links work again.
    assert!(h.handle(&w, "", OPEN, Origin::Os, t0 + RATE_WINDOW + Duration::from_millis(1)).is_ok());
    assert_eq!(w.plans().len(), 6);
}

#[test]
fn security_each_origin_group_has_its_own_rate_bucket() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    // A local script uses up its own budget...
    for _ in 0..5 {
        h.handle(&w, "", OPEN, Origin::Cli, t0).unwrap();
    }
    assert!(h.handle(&w, "", OPEN, Origin::Forwarded, t0).is_err(), "Cli and Forwarded share one bucket");
    // ...and links from the system and the palette still get through.
    for _ in 0..5 {
        h.handle(&w, "", OPEN, Origin::Os, t0).unwrap();
        h.handle(&w, "", OPEN, Origin::User, t0).unwrap();
    }
    assert!(h.handle(&w, "", OPEN, Origin::User, t0).is_err(), "the palette is limited too");
}

#[test]
fn a_refused_request_is_not_counted_so_the_window_frees_itself() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    for _ in 0..5 {
        h.handle(&w, "", OPEN, Origin::Os, t0).unwrap();
    }
    for i in 0..50 {
        let _ = h.handle(&w, "", OPEN, Origin::Os, t0 + Duration::from_millis(100 * i));
    }
    // 5 s after the first accepted burst, hammering did not extend the window.
    assert!(h.handle(&w, "", OPEN, Origin::Os, t0 + RATE_WINDOW).is_ok());
}

#[test]
fn queue_holds_until_ready_then_drains_in_order() {
    let (h, w) = (Handler::default(), Fake::new(false));
    let t0 = Instant::now();
    for (i, name) in ["a", "b", "c"].iter().enumerate() {
        let r = h.handle(&w, "", &format!("vaultdraw://open?file={name}"), Origin::Os, t0 + Duration::from_secs(i as u64 * 3)).unwrap();
        assert_eq!(r["status"], "queued");
    }
    assert!(w.plans().is_empty());
    assert_eq!(w.focused.get(), 3);
    w.ready.set(true);
    h.drain(&w);
    let files: Vec<_> = w.plans().iter().map(|p| p["file"].as_str().unwrap().to_string()).collect();
    assert_eq!(files, ["a", "b", "c"]);
    assert_eq!(h.queued(), 0);
}

#[test]
fn security_queue_is_capped_at_sixteen() {
    let (h, w) = (Handler::default(), Fake::new(false));
    // Spread over time so the rate limit is not what stops it.
    let t0 = Instant::now();
    let mut refused = 0;
    for i in 0..30u64 {
        let r = h.handle(&w, "", OPEN, Origin::Os, t0 + Duration::from_secs(i * 3));
        if r.is_err() {
            refused += 1;
        }
    }
    assert_eq!(h.queued(), QUEUE_CAP);
    assert_eq!(refused, 30 - QUEUE_CAP);
}

#[test]
fn a_socket_caller_gets_not_ready_instead_of_a_queue_and_spends_no_budget() {
    let (h, w) = (Handler::default(), Fake::new(false));
    let t0 = Instant::now();
    for o in [Origin::Cli, Origin::Forwarded] {
        for _ in 0..20 {
            let e = h.handle(&w, "", OPEN, o, t0).unwrap_err();
            assert_eq!(e.app_code(), Some(codes::NOT_READY));
        }
    }
    assert_eq!(h.queued(), 0);
    w.ready.set(true);
    for _ in 0..5 {
        h.handle(&w, "", OPEN, Origin::Cli, t0).unwrap();
    }
}

#[test]
fn cli_errors_are_not_toasted_but_returned() {
    let (h, w) = (Handler::default(), Fake::new(true));
    assert!(go(&h, &w, "", "vaultdraw://open?file=..", Origin::Cli).is_err());
    assert!(w.notices().is_empty());
}

#[test]
fn links_raise_the_window_but_a_refusal_does_not() {
    let (h, w) = (Handler::default(), Fake::new(true));
    go(&h, &w, "", OPEN, Origin::Os).unwrap();
    assert_eq!(w.focused.get(), 1);
    let _ = go(&h, &w, "", "vaultdraw://open?file=..", Origin::Os);
    assert_eq!(w.focused.get(), 1);
}

#[test]
fn is_uri_matches_the_scheme_only_case_insensitively() {
    assert!(is_uri("vaultdraw://open"));
    assert!(is_uri("VaultDraw:x"));
    assert!(!is_uri("vaultdraw"));
    assert!(!is_uri("/tmp/vaultdraw://x"));
    assert!(!is_uri("héllo wörld"), "non-ASCII near the start must not panic");
}

#[test]
fn handling_one_link_is_fast() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let mut samples = Vec::new();
    let t0 = Instant::now();
    for i in 0..1000u64 {
        let t = Instant::now();
        // A fresh handler window each time: time the parse + policy + plan, not the limiter refusals.
        let _ = h.handle(&w, "[control]\nuri_allow = [\"new\"]\n", OPEN, Origin::User, t0 + RATE_WINDOW * i as u32);
        samples.push(t.elapsed());
        w.sent.borrow_mut().clear();
    }
    samples.sort();
    eprintln!("uri handle (config parse included) p50 {:?} p95 {:?}", samples[500], samples[950]);
    // Budget: p95 < 20 ms to hand the plan over; the bound is loose against load.
    assert!(samples[950] < Duration::from_millis(20));
}

#[test]
fn a_plan_survives_a_window_that_goes_away_while_draining() {
    struct Flaky(Fake);
    impl Window for Flaky {
        fn ready(&self) -> bool {
            self.0.ready.get()
        }
        fn run(&self, plan: Value) -> Result<Value, RpcError> {
            self.0.ready.set(false);
            Err(RpcError::app(codes::NOT_READY, format!("gone {plan}")))
        }
        fn focus(&self) {}
    }
    let h = Handler::default();
    let w = Fake::new(false);
    let t0 = Instant::now();
    for i in 0..3u64 {
        h.handle(&w, "", OPEN, Origin::Os, t0 + Duration::from_secs(i * 3)).unwrap();
    }
    let f = Flaky(Fake::new(true));
    h.drain(&f);
    assert_eq!(h.queued(), 3, "nothing is lost");
}

#[test]
fn a_plan_queued_just_as_the_window_becomes_ready_is_not_stranded() {
    // `ready()` answers false for the first check, true afterwards.
    struct Racy(Fake, Cell<u32>);
    impl Window for Racy {
        fn ready(&self) -> bool {
            let n = self.1.get();
            self.1.set(n + 1);
            n >= 2
        }
        fn run(&self, plan: Value) -> Result<Value, RpcError> {
            self.0.run(plan)
        }
        fn focus(&self) {}
    }
    let h = Handler::default();
    let w = Racy(Fake::new(true), Cell::new(0));
    let r = h.handle(&w, "", OPEN, Origin::Os, Instant::now()).unwrap();
    assert_eq!(r["status"], "queued");
    assert_eq!(h.queued(), 0);
    assert_eq!(w.0.plans().len(), 1);
}

#[test]
fn security_a_flood_while_links_are_off_cannot_flood_toasts() {
    let (h, w) = (Handler::default(), Fake::new(true));
    let t0 = Instant::now();
    for _ in 0..200 {
        let _ = h.handle(&w, "[control]\nuri_enabled = false\n", OPEN, Origin::Os, t0);
    }
    assert!(w.notices().len() <= RATE_LIMIT + 1, "{} notices", w.notices().len());
}

#[test]
fn security_a_wrongly_typed_switch_or_table_means_off() {
    for cfg in [
        "[control]\nuri_enabled = \"false\"\n",
        "[control]\nuri_enabled = \"true\"\n",
        "[control]\nuri_enabled = 0\n",
        "[control]\nuri_enabled = 1\n",
        "[control]\nuri_enabled = []\n",
        "control = true\n",
        "control = \"yes\"\n",
        "control = [1]\n",
    ] {
        assert!(!Policy::from_toml(cfg).enabled, "{cfg:?}");
    }
    assert!(Policy::from_toml("[control]\nuri_enabled = true\n").enabled);
    assert!(Policy::from_toml("[other]\nx = 1\n").enabled);
}
