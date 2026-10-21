//! The event bus: one topic mask gates every publisher, subscribers are per connection.
//!
//! Zero idle cost: [`Bus::publish`] is one atomic load while nobody wants the topic; the
//! payload closure is never called and nothing is locked or allocated. A subscriber has a
//! bounded queue drained by its own writer thread (see `server.rs`), so a slow client can
//! never block a publisher: when its queue is full it is dropped and told with
//! `events.overflow` (it resubscribes for a fresh snapshot).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use vaultdraw_protocol::events::{self, mask_of, notification, APP_QUITTING, CONFIG_CHANGED, FILE_SAVED, OVERFLOW, TOPICS, VAULT_CHANGED, WINDOW_TOPICS};

/// Queued frames per subscriber before it is dropped.
pub(crate) const QUEUE: usize = 1024;

/// A serialized notification line (with its newline), shared by every receiving subscriber.
pub(crate) type Frame = Arc<Vec<u8>>;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Topic {
    Vault,
    File,
    Tab,
    Config,
    Command,
}

impl Topic {
    pub(crate) fn bit(self) -> u32 {
        1 << (self as u32)
    }
    pub(crate) fn name(self) -> &'static str {
        TOPICS[self as usize]
    }
    fn parse(name: &str) -> Option<Topic> {
        [Topic::Vault, Topic::File, Topic::Tab, Topic::Config, Topic::Command].into_iter().find(|t| t.name() == name)
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

struct Sub {
    id: u64,
    mask: u32,
    tx: SyncSender<Frame>,
    overflowed: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct Bus {
    mask: AtomicU32,
    seq: AtomicU64,
    next_id: AtomicU64,
    subs: Mutex<Vec<Sub>>,
    window_hook: OnceLock<Box<dyn Fn(u32) + Send + Sync>>,
}

/// What the connection needs to start streaming after it wrote the reply and the snapshot.
pub(crate) struct Staged {
    pub mask: u32,
    /// Last sequence number allocated at registration; every queued event is newer.
    pub seq: u64,
    pub rx: Receiver<Frame>,
    pub overflowed: Arc<AtomicBool>,
    pub id: u64,
}

/// Removes the subscriber when dropped (unsubscribe, replaced subscription, connection close).
pub(crate) struct Subscription {
    id: u64,
    bus: Arc<Bus>,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.bus.remove(self.id);
    }
}

fn window_mask() -> u32 {
    mask_of(&WINDOW_TOPICS)
}

impl Bus {
    /// Called with the wanted window topics (a mask) whenever that set changes.
    pub(crate) fn set_window_hook(&self, hook: impl Fn(u32) + Send + Sync + 'static) {
        let _ = self.window_hook.set(Box::new(hook));
    }

    /// Topics some subscriber wants.
    pub(crate) fn mask(&self) -> u32 {
        self.mask.load(Ordering::Acquire)
    }

    /// Wanted topics that the window produces.
    pub(crate) fn window_topics(&self) -> Vec<&'static str> {
        events::topics_of(self.mask() & window_mask())
    }

    /// Sends the event to subscribers of `topic`. Returns before building anything when none exist.
    #[inline]
    pub(crate) fn publish(&self, topic: Topic, name: &str, data: impl FnOnce() -> Value) {
        if self.mask.load(Ordering::Acquire) & topic.bit() == 0 {
            return;
        }
        self.deliver(Some(topic), name, data());
    }

    /// Sends the event to every subscriber, whatever its topics (`app.quitting`).
    pub(crate) fn publish_all(&self, name: &str, data: Value) {
        if self.mask.load(Ordering::Acquire) == 0 {
            return;
        }
        self.deliver(None, name, data);
    }

    fn deliver(&self, topic: Option<Topic>, name: &str, data: Value) {
        let mut subs = lock(&self.subs);
        if subs.is_empty() {
            return;
        }
        // The sequence number is allocated under the lock: every queue is strictly ordered.
        let seq = self.seq.fetch_add(1, Ordering::AcqRel) + 1;
        let mut bytes = serde_json::to_vec(&notification(name, seq, topic.map(Topic::name), data)).unwrap_or_default();
        bytes.push(b'\n');
        let frame: Frame = Arc::new(bytes);
        let mut dropped = false;
        subs.retain(|s| {
            if topic.is_some_and(|t| s.mask & t.bit() == 0) {
                return true;
            }
            match s.tx.try_send(frame.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) => {
                    s.overflowed.store(true, Ordering::Release);
                    dropped = true;
                    false
                }
                Err(TrySendError::Disconnected(_)) => {
                    dropped = true;
                    false
                }
            }
        });
        let changed = if dropped { self.recompute(&subs) } else { None };
        drop(subs);
        self.notify_window(changed);
    }

    /// Registers a subscriber. Events published from now on are queued for it.
    pub(crate) fn subscribe(self: &Arc<Self>, mask: u32) -> (Subscription, Staged) {
        let (tx, rx) = sync_channel(QUEUE);
        let overflowed = Arc::new(AtomicBool::new(false));
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut subs = lock(&self.subs);
        subs.push(Sub { id, mask, tx, overflowed: overflowed.clone() });
        let changed = self.recompute(&subs);
        let seq = self.seq.load(Ordering::Acquire);
        drop(subs);
        self.notify_window(changed);
        (Subscription { id, bus: self.clone() }, Staged { mask, seq, rx, overflowed, id })
    }

    pub(crate) fn remove(&self, id: u64) {
        let mut subs = lock(&self.subs);
        let before = subs.len();
        subs.retain(|s| s.id != id);
        let changed = if subs.len() != before { self.recompute(&subs) } else { None };
        drop(subs);
        self.notify_window(changed);
    }

    /// The `events.overflow` line a dropped subscriber's writer sends last.
    pub(crate) fn overflow_frame(&self) -> Frame {
        let seq = self.seq.fetch_add(1, Ordering::AcqRel) + 1;
        let mut bytes = serde_json::to_vec(&notification(OVERFLOW, seq, None, json!({"dropped": true}))).unwrap_or_default();
        bytes.push(b'\n');
        Arc::new(bytes)
    }

    /// Stores the union mask; returns the new wanted window mask when it changed.
    fn recompute(&self, subs: &[Sub]) -> Option<u32> {
        let union = subs.iter().fold(0, |m, s| m | s.mask);
        let old = self.mask.swap(union, Ordering::AcqRel);
        let (old_w, new_w) = (old & window_mask(), union & window_mask());
        (old_w != new_w).then_some(new_w)
    }

    fn notify_window(&self, changed: Option<u32>) {
        if let (Some(mask), Some(hook)) = (changed, self.window_hook.get()) {
            hook(mask);
        }
    }
}

static BUS: OnceLock<Arc<Bus>> = OnceLock::new();

/// The app-wide bus.
pub(crate) fn bus() -> &'static Arc<Bus> {
    BUS.get_or_init(Default::default)
}

pub(crate) fn publish(topic: Topic, name: &str, data: impl FnOnce() -> Value) {
    bus().publish(topic, name, data);
}

/// Wanted window topics (what `control_ready` and `control-topics` tell the page).
pub(crate) fn window_topics() -> Vec<&'static str> {
    bus().window_topics()
}

// --- Rust publishers: one-line hooks for the call sites ---

pub(crate) fn vault_changed(paths: &[String], rescan: bool) {
    publish(Topic::Vault, VAULT_CHANGED, || json!({"paths": paths, "rescan": rescan}));
}

pub(crate) fn file_saved(path: &str, revision: &str) {
    publish(Topic::File, FILE_SAVED, || json!({"path": path, "revision": revision}));
}

pub(crate) fn config_changed() {
    publish(Topic::Config, CONFIG_CHANGED, || json!({}));
}

pub(crate) fn app_quitting() {
    bus().publish_all(APP_QUITTING, json!({}));
}

/// The window publishes its events (`file.opened`, `tab.changed`, `command.ran`) here; the
/// call is dropped when nobody wants the topic.
#[tauri::command]
pub(crate) async fn control_event(topic: String, name: String, data: Option<Value>) {
    let Some(topic) = Topic::parse(&topic).filter(|t| WINDOW_TOPICS.contains(&t.name())) else { return };
    publish(topic, &name, || data.unwrap_or_else(|| json!({})));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::{Duration, Instant};

    fn parse(f: &Frame) -> Value {
        serde_json::from_slice(f).unwrap()
    }

    #[test]
    fn topic_bits_match_the_protocol() {
        for t in [Topic::Vault, Topic::File, Topic::Tab, Topic::Config, Topic::Command] {
            assert_eq!(Some(t.bit()), events::topic_bit(t.name()));
            assert_eq!(Topic::parse(t.name()), Some(t));
        }
        assert_eq!(Topic::parse("nope"), None);
    }

    #[test]
    fn no_subscriber_never_builds_the_payload() {
        let bus = Bus::default();
        let built = AtomicUsize::new(0);
        bus.publish(Topic::File, "file.saved", || {
            built.fetch_add(1, Ordering::SeqCst);
            json!({})
        });
        assert_eq!(built.load(Ordering::SeqCst), 0);
        // A subscriber to another topic does not make it build either.
        let bus = Arc::new(Bus::default());
        let (_sub, _staged) = bus.subscribe(Topic::Vault.bit());
        bus.publish(Topic::File, "file.saved", || {
            built.fetch_add(1, Ordering::SeqCst);
            json!({})
        });
        assert_eq!(built.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn delivers_in_order_with_monotonic_seq_and_topic_filter() {
        let bus = Arc::new(Bus::default());
        let (_sub, staged) = bus.subscribe(Topic::File.bit() | Topic::Vault.bit());
        assert_eq!(staged.seq, 0);
        bus.publish(Topic::File, "file.saved", || json!({"path": "a"}));
        bus.publish(Topic::Tab, "tab.changed", || json!({}));
        bus.publish(Topic::Vault, "vault.changed", || json!({"paths": []}));
        bus.publish_all("app.quitting", json!({}));
        let got: Vec<Value> = staged.rx.try_iter().map(|f| parse(&f)).collect();
        let methods: Vec<&str> = got.iter().map(|v| v["method"].as_str().unwrap()).collect();
        assert_eq!(methods, ["file.saved", "vault.changed", "app.quitting"]);
        let seqs: Vec<u64> = got.iter().map(|v| v["params"]["seq"].as_u64().unwrap()).collect();
        assert!(seqs.windows(2).all(|w| w[0] < w[1]), "{seqs:?}");
        assert_eq!(got[0]["params"]["topic"], "file");
        assert_eq!(got[0]["params"]["path"], "a");
        assert!(got[2]["params"].get("topic").is_none());
    }

    #[test]
    fn dropping_the_subscription_clears_the_mask_and_reports_window_topics() {
        let bus = Arc::new(Bus::default());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        bus.set_window_hook(move |m| s2.lock().unwrap().push(m));
        let (a, _ra) = bus.subscribe(Topic::Vault.bit());
        assert!(seen.lock().unwrap().is_empty(), "vault is not a window topic");
        let (b, _rb) = bus.subscribe(Topic::Tab.bit() | Topic::Config.bit());
        assert_eq!(bus.window_topics(), ["tab"]);
        let (c, _rc) = bus.subscribe(Topic::Tab.bit());
        drop(b);
        assert_eq!(bus.window_topics(), ["tab"], "still wanted by another subscriber");
        drop(c);
        drop(a);
        assert_eq!(bus.mask(), 0);
        assert_eq!(*seen.lock().unwrap(), vec![Topic::Tab.bit(), 0]);
    }

    #[test]
    fn overflow_drops_the_subscriber_without_blocking_the_publisher() {
        let bus = Arc::new(Bus::default());
        let (_sub, staged) = bus.subscribe(Topic::File.bit());
        let started = Instant::now();
        for i in 0..QUEUE + 10 {
            bus.publish(Topic::File, "file.saved", || json!({"i": i}));
        }
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(staged.overflowed.load(Ordering::SeqCst));
        assert_eq!(bus.mask(), 0, "the dropped subscriber no longer wants anything");
        assert_eq!(staged.rx.try_iter().count(), QUEUE);
        let f = bus.overflow_frame();
        assert_eq!(parse(&f)["method"], "events.overflow");
    }

    #[test]
    fn publish_cost_without_subscribers() {
        let bus = Bus::default();
        let n = 1_000_000u32;
        let t = Instant::now();
        for i in 0..n {
            bus.publish(Topic::File, "file.saved", || json!({"i": std::hint::black_box(i)}));
        }
        let per = t.elapsed().as_nanos() as f64 / n as f64;
        eprintln!("publish() with no subscriber: {per:.2} ns/op");
        assert!(per < 100.0);
    }
}
