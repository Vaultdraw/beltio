//! Event topics, event method names and notification building (see RESEARCH-C3.md).

use crate::Notification;
use serde_json::{json, Map, Value};

pub const VAULT: &str = "vault";
pub const FILE: &str = "file";
pub const TAB: &str = "tab";
pub const CONFIG: &str = "config";
pub const COMMAND: &str = "command";

/// All topics; the bit of a topic in a mask is its index here.
pub const TOPICS: [&str; 5] = [VAULT, FILE, TAB, CONFIG, COMMAND];
/// Topics whose events come from the window (`file` is both Rust and window).
pub const WINDOW_TOPICS: [&str; 3] = [FILE, TAB, COMMAND];

pub const SNAPSHOT: &str = "events.snapshot";
pub const VAULT_CHANGED: &str = "vault.changed";
pub const FILE_SAVED: &str = "file.saved";
pub const FILE_OPENED: &str = "file.opened";
pub const TAB_CHANGED: &str = "tab.changed";
pub const CONFIG_CHANGED: &str = "config.changed";
pub const COMMAND_RAN: &str = "command.ran";
pub const APP_QUITTING: &str = "app.quitting";
pub const OVERFLOW: &str = "events.overflow";

/// The mask bit of a topic, `None` for an unknown topic.
pub fn topic_bit(topic: &str) -> Option<u32> {
    TOPICS.iter().position(|t| *t == topic).map(|i| 1 << i)
}

/// Mask of the given topics; unknown topics are ignored.
pub fn mask_of(topics: &[&str]) -> u32 {
    topics.iter().filter_map(|t| topic_bit(t)).fold(0, |m, b| m | b)
}

/// Topics set in a mask, in [`TOPICS`] order.
pub fn topics_of(mask: u32) -> Vec<&'static str> {
    TOPICS.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, t)| *t).collect()
}

/// An event notification: params are `{seq, topic?, ...data}`. `data` fields are merged in
/// (a non-object `data` is ignored).
pub fn notification(method: &str, seq: u64, topic: Option<&str>, data: Value) -> Notification {
    let mut params = Map::new();
    params.insert("seq".into(), json!(seq));
    if let Some(t) = topic {
        params.insert("topic".into(), json!(t));
    }
    if let Value::Object(fields) = data {
        params.extend(fields);
    }
    Notification::new(method, Some(Value::Object(params)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_round_trip() {
        assert_eq!(mask_of(&TOPICS), 0b11111);
        assert_eq!(mask_of(&[TAB, VAULT]), 0b00101);
        assert_eq!(topics_of(mask_of(&[COMMAND, FILE])), vec![FILE, COMMAND]);
        assert_eq!(topics_of(0), Vec::<&str>::new());
        for t in TOPICS {
            assert_eq!(topics_of(topic_bit(t).unwrap()), vec![t]);
        }
        assert!(WINDOW_TOPICS.iter().all(|t| TOPICS.contains(t)));
    }

    #[test]
    fn unknown_topic() {
        assert_eq!(topic_bit("nope"), None);
        assert_eq!(mask_of(&["nope", FILE]), topic_bit(FILE).unwrap());
    }

    #[test]
    fn notification_shape() {
        let n = notification(FILE_SAVED, 7, Some(FILE), json!({"path": "a.excalidraw", "revision": 3}));
        assert_eq!(
            serde_json::to_value(&n).unwrap(),
            json!({"jsonrpc":"2.0","method":"file.saved","params":{"seq":7,"topic":"file","path":"a.excalidraw","revision":3}})
        );
        let q = notification(APP_QUITTING, 8, None, json!({}));
        assert_eq!(serde_json::to_string(&q).unwrap(), r#"{"jsonrpc":"2.0","method":"app.quitting","params":{"seq":8}}"#);
    }
}
