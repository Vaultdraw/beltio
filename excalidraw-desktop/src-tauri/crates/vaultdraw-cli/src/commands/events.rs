//! Event streaming: `events` (NDJSON) and `open --wait` (which watches the tab topic).

use super::{out_line, rpc};
use crate::cli::Cli;
use crate::error::Fail;
use crate::rpc::request_line;
use serde_json::{json, Map, Value};
use vaultdraw_protocol::client::Client;
use vaultdraw_protocol::events::{APP_QUITTING, OVERFLOW, SNAPSHOT, TAB, TAB_CHANGED};
use vaultdraw_protocol::methods;

fn subscribe_params(topics: &[&str]) -> Option<Value> {
    (!topics.is_empty()).then(|| json!({ "topics": topics }))
}

/// Connects and subscribes; the stream then has no read timeout.
fn subscribe(cli: &Cli, topics: &[&str]) -> Result<(crate::rpc::Rpc, Client), Fail> {
    let rpc = rpc(cli)?;
    let mut client = rpc.connect()?;
    rpc.call_on(&mut client, methods::EVENTS_SUBSCRIBE, subscribe_params(topics))?;
    // Best effort: macOS refuses setsockopt on a socket whose peer already closed.
    let _ = client.set_timeout(None);
    Ok((rpc, client))
}

/// Every notification as one JSON line, flushed; ends on EOF or a closed stdout.
pub fn stream(cli: &Cli, topics: &[String]) -> Result<(), Fail> {
    let topics: Vec<&str> = topics.iter().map(String::as_str).collect();
    if cli.print_request {
        println!("{}", request_line(methods::EVENTS_SUBSCRIBE, subscribe_params(&topics)));
        return Ok(());
    }
    let (_, mut client) = subscribe(cli, &topics)?;
    while let Some(n) = client.next_notification()? {
        if !out_line(&serde_json::to_string(&n).unwrap_or_default()) {
            break;
        }
    }
    Ok(())
}

/// The tab list of a snapshot (`tabs` array or `{tabs: [...]}`) or a `tab.changed` event.
fn tab_paths(params: &Value) -> Option<Vec<&str>> {
    let tabs = params.get("tabs")?;
    let list = tabs.as_array().or_else(|| tabs.get("tabs")?.as_array())?;
    Some(list.iter().filter_map(|t| t.get("path").and_then(Value::as_str)).collect())
}

/// `open --wait`: subscribe to `tab` first (so nothing is missed), open, then wait until no tab
/// shows the drawing any more (exit 0), or the app quits / the stream ends (also 0).
pub fn open_wait(cli: &Cli, params: Map<String, Value>) -> Result<(), Fail> {
    let (rpc, mut client) = subscribe(cli, &[TAB])?;
    let _ = client.set_timeout(Some(std::time::Duration::from_secs(cli.timeout.max(1))));
    let opened = rpc.call_on(&mut client, methods::FILE_OPEN, Some(Value::Object(params)))?;
    let _ = client.set_timeout(None);
    let path = opened.get("path").and_then(Value::as_str).unwrap_or_default().to_string();
    println!("opened {path}");
    // `seen` guards against a stale event from before the open showing no tab.
    let mut seen = false;
    while let Some(n) = client.next_notification()? {
        match n.method.as_str() {
            APP_QUITTING | OVERFLOW => break,
            SNAPSHOT | TAB_CHANGED => {
                if let Some(paths) = n.params.as_ref().and_then(tab_paths) {
                    let present = paths.contains(&path.as_str());
                    if seen && !present {
                        break;
                    }
                    seen |= present;
                }
            }
            _ => {}
        }
    }
    Ok(())
}
