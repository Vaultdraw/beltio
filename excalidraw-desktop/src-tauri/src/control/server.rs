//! The control socket server: blocking accept loop, one thread per connection, NDJSON
//! JSON-RPC 2.0. Knows nothing about Tauri; the app plugs in through [`Dispatch`].

use super::events::{Bus, Staged, Subscription};
use super::policy;
use serde_json::{json, Value};
use std::io::{self, BufReader, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vaultdraw_protocol::dirs::InstancePaths;
use vaultdraw_protocol::events::{self, mask_of, notification};
use vaultdraw_protocol::frame::{read_frame, write_frame, FrameError};
use vaultdraw_protocol::methods::{self, roles, EVENTS_SUBSCRIBE, EVENTS_UNSUBSCRIBE, RPC_HELLO};
use vaultdraw_protocol::{codes, Id, Request, Response, RpcError, API_LEVEL, INVALID_REQUEST, MAX_FRAME_BYTES, PARSE_ERROR};

/// Connections served at once; more are dropped (a runaway client must not exhaust threads).
const MAX_CONNECTIONS: usize = 64;

/// Executes an allowed call. `role` is the connection's role; the server has already checked
/// the method exists and the role may call it.
pub(crate) trait Dispatch: Send + Sync + 'static {
    fn call(&self, role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError>;
    /// Current state for `events.snapshot` (`vault`, `activeDrawing`, `tabs`); `mask` is the
    /// subscriber's topics so only wanted parts are fetched.
    fn snapshot(&self, _mask: u32) -> Value {
        json!({})
    }
}

/// A connection's write half, shared by replies and the event writer thread.
type SharedWriter = Arc<Mutex<UnixStream>>;

/// A client that does not read for this long is cut off instead of stalling its writers.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// Per-connection state.
pub(crate) struct Conn {
    role: String,
    /// Rate limit of this connection (used by the `mcp` role only).
    limiter: policy::Limiter,
    sub: Option<Subscription>,
    /// A subscription whose reply is being written; the snapshot and deltas follow it.
    staged: Option<Staged>,
}

impl Default for Conn {
    fn default() -> Self {
        Self { role: roles::CLI.to_string(), limiter: policy::Limiter::default(), sub: None, staged: None }
    }
}

/// Injectable peer check (tests simulate another user).
#[derive(Clone, Copy)]
pub(crate) struct ServerConfig {
    pub peer_uid: fn(RawFd) -> io::Result<u32>,
    pub my_uid: u32,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { peer_uid: vaultdraw_protocol::peer::peer_uid, my_uid: vaultdraw_protocol::peer::my_uid() }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct ServerHandle {
    socket: PathBuf,
    stop: Arc<AtomicBool>,
}

impl ServerHandle {
    /// Stops accepting and removes the socket (tests; the app leaves it for the next start).
    #[cfg(test)]
    pub(crate) fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = UnixStream::connect(&self.socket);
        let _ = std::fs::remove_file(&self.socket);
    }
}

/// Binds `paths.socket` (any existing file is stale: the caller holds the instance lock) and
/// serves connections on a background thread.
pub(crate) fn start(paths: &InstancePaths, dispatch: Arc<dyn Dispatch>, bus: Arc<Bus>, cfg: ServerConfig) -> io::Result<ServerHandle> {
    paths.check_socket_len().map_err(io::Error::other)?;
    match std::fs::remove_file(&paths.socket) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let listener = UnixListener::bind(&paths.socket)?;
    std::fs::set_permissions(&paths.socket, std::fs::Permissions::from_mode(0o600))?;
    let stop = Arc::new(AtomicBool::new(false));
    let handle = ServerHandle { socket: paths.socket.clone(), stop: stop.clone() };
    std::thread::Builder::new().name("control-accept".into()).spawn(move || accept_loop(listener, dispatch, bus, cfg, stop))?;
    Ok(handle)
}

fn accept_loop(listener: UnixListener, dispatch: Arc<dyn Dispatch>, bus: Arc<Bus>, cfg: ServerConfig, stop: Arc<AtomicBool>) {
    let live = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = stream else { continue };
        if live.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            continue;
        }
        live.fetch_add(1, Ordering::SeqCst);
        let (dispatch, bus) = (dispatch.clone(), bus.clone());
        let spawned = std::thread::Builder::new().name("control-conn".into()).stack_size(512 * 1024).spawn({
            let live = live.clone();
            move || {
                serve_connection(stream, &*dispatch, &bus, cfg);
                live.fetch_sub(1, Ordering::SeqCst);
            }
        });
        if spawned.is_err() {
            live.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

fn serve_connection(stream: UnixStream, dispatch: &dyn Dispatch, bus: &Arc<Bus>, cfg: ServerConfig) {
    match (cfg.peer_uid)(stream.as_raw_fd()) {
        Ok(uid) if uid == cfg.my_uid => {}
        _ => return,
    }
    let Ok(read_half) = stream.try_clone() else { return };
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let mut reader = BufReader::new(read_half);
    let writer: SharedWriter = Arc::new(Mutex::new(stream));
    let mut conn = Conn::default();
    loop {
        let reply = match read_frame(&mut reader, MAX_FRAME_BYTES) {
            Ok(None) | Err(FrameError::Io(_)) => return,
            Ok(Some(line)) => handle_line(&line, &mut conn, dispatch, bus),
            Err(FrameError::TooLarge) => Some(Response::err(None, RpcError::new(INVALID_REQUEST, "Message too large"))),
        };
        if let Some(r) = reply {
            if write_to(&writer, &r).is_err() {
                return;
            }
        }
        // Reply first, then the snapshot, then the queued deltas (the writer starts last).
        if let Some(staged) = conn.staged.take() {
            if start_stream(staged, dispatch, bus, &writer).is_err() {
                return;
            }
        }
    }
}

fn write_to(writer: &SharedWriter, value: &impl serde::Serialize) -> io::Result<()> {
    let mut w = writer.lock().unwrap_or_else(|p| p.into_inner());
    write_frame(&mut *w, value)
}

/// Writes `events.snapshot` and starts the thread that drains the subscriber's queue.
fn start_stream(staged: Staged, dispatch: &dyn Dispatch, bus: &Arc<Bus>, writer: &SharedWriter) -> io::Result<()> {
    write_to(writer, &notification(events::SNAPSHOT, staged.seq, None, dispatch.snapshot(staged.mask)))?;
    let (bus, writer) = (bus.clone(), writer.clone());
    std::thread::Builder::new().name("control-events".into()).stack_size(256 * 1024).spawn(move || {
        let Staged { rx, overflowed, id, .. } = staged;
        let write = |bytes: &[u8]| {
            let mut w = writer.lock().unwrap_or_else(|p| p.into_inner());
            w.write_all(bytes).and_then(|()| w.flush())
        };
        // `recv` ends when the subscriber was removed (unsubscribe, close, overflow).
        while let Ok(frame) = rx.recv() {
            if write(&frame).is_err() {
                bus.remove(id);
                let _ = writer.lock().unwrap_or_else(|p| p.into_inner()).shutdown(std::net::Shutdown::Both);
                return;
            }
        }
        if overflowed.load(Ordering::Acquire) {
            let _ = write(&bus.overflow_frame());
        }
    })?;
    Ok(())
}

/// One frame in, at most one response out (notifications get none).
pub(crate) fn handle_line(line: &[u8], conn: &mut Conn, dispatch: &dyn Dispatch, bus: &Arc<Bus>) -> Option<Response> {
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        return Some(Response::err(None, RpcError::new(PARSE_ERROR, "Parse error")));
    };
    let id = value.get("id").and_then(|v| serde_json::from_value::<Id>(v.clone()).ok());
    let request = match serde_json::from_value::<Request>(value) {
        Ok(r) if r.jsonrpc == "2.0" => r,
        _ => return Some(Response::err(id, RpcError::new(INVALID_REQUEST, "Invalid Request"))),
    };
    let result = handle_request(&request, conn, dispatch, bus);
    let id = request.id?;
    Some(match result {
        Ok(v) => Response::ok(Some(id), v),
        Err(e) => Response::err(Some(id), e),
    })
}

fn handle_request(req: &Request, conn: &mut Conn, dispatch: &dyn Dispatch, bus: &Arc<Bus>) -> Result<Value, RpcError> {
    if req.method == RPC_HELLO {
        let wanted = req.params.as_ref().and_then(|p| p.get("role")).and_then(Value::as_str);
        let Some(wanted) = wanted.filter(|r| roles::ALL.contains(r)) else {
            return Err(RpcError::invalid_params("role must be one of cli, uri, mcp"));
        };
        if conn.role == roles::MCP && wanted != roles::MCP {
            return Err(RpcError::app(codes::NOT_PERMITTED, "The mcp role cannot be changed on this connection"));
        }
        conn.role = wanted.to_string();
        return Ok(json!({"api": API_LEVEL, "role": wanted}));
    }
    let role = conn.role.clone();
    // The AI master switch and the `mcp` rate limit come before anything else, so a closed
    // interface does not even reveal which methods exist.
    policy::admit(&role, &mut conn.limiter)?;
    let spec = methods::find(&req.method).ok_or_else(|| RpcError::method_not_found(&req.method))?;
    if !spec.allows(&role) {
        return Err(RpcError::app(codes::NOT_PERMITTED, format!("Role '{role}' may not call {}", req.method)).with("method", req.method.clone()));
    }
    // One window call at a time for the `mcp` role; held until the call returns.
    let _slot = policy::window_slot(&role, spec)?;
    match req.method.as_str() {
        EVENTS_SUBSCRIBE => subscribe(req.params.as_ref(), conn, bus),
        EVENTS_UNSUBSCRIBE => {
            conn.sub = None;
            conn.staged = None;
            Ok(json!({"unsubscribed": true}))
        }
        _ => dispatch.call(&role, &req.method, req.params.clone()),
    }
}

/// `events.subscribe {topics?}`: registers now, so no event after the reply is missed; the
/// connection loop writes the reply, then the snapshot, then starts the writer.
fn subscribe(params: Option<&Value>, conn: &mut Conn, bus: &Arc<Bus>) -> Result<Value, RpcError> {
    let mask = match params.and_then(|p| p.get("topics")).filter(|t| !t.is_null()) {
        None => mask_of(&events::TOPICS),
        Some(list) => {
            let bad = || RpcError::invalid_params(format!("topics must be a non-empty list of: {}", events::TOPICS.join(", ")));
            let names = list.as_array().filter(|a| !a.is_empty()).ok_or_else(bad)?;
            names.iter().try_fold(0, |m, n| Ok(m | n.as_str().and_then(events::topic_bit).ok_or_else(bad)?))?
        }
    };
    conn.sub = None; // a second subscribe replaces the first
    let (sub, staged) = bus.subscribe(mask);
    let reply = json!({"seq": staged.seq, "topics": events::topics_of(mask)});
    conn.sub = Some(sub);
    conn.staged = Some(staged);
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use vaultdraw_protocol::{CallError, Client};

    use crate::control::events::{Bus, Topic};

    #[derive(Default)]
    struct Fake {
        bus: Arc<Bus>,
    }
    impl Dispatch for Fake {
        fn snapshot(&self, _mask: u32) -> Value {
            json!({"vault": {"name": "V"}, "activeDrawing": null})
        }
        fn call(&self, role: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
            match method {
                // Test hook: publish `n` file.saved events (the closure runs per call).
                "app.focus" => {
                    let n = params.and_then(|p| p["n"].as_u64()).unwrap_or(1);
                    for i in 0..n {
                        self.bus.publish(Topic::File, "file.saved", || json!({"path": "a.excalidraw", "i": i, "t": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64}));
                    }
                    Ok(json!({"focused": true}))
                }
                "app.status" => Ok(json!({"running": true, "role": role})),
                "app.open" => Ok(json!({"handled": params.and_then(|p| p["argv"].as_array().map(Vec::len)).unwrap_or(0)})),
                "command.run" => Err(RpcError::app(codes::UNAVAILABLE, "no").with("id", "x")),
                _ => Err(RpcError::method_not_found(method)),
            }
        }
    }

    struct Rig {
        _dir: tempfile::TempDir,
        paths: InstancePaths,
        handle: ServerHandle,
        bus: Arc<Bus>,
    }
    impl Drop for Rig {
        fn drop(&mut self) {
            self.handle.shutdown();
        }
    }

    fn rig_with(cfg: ServerConfig) -> Rig {
        let dir = tempfile::Builder::new().prefix("vd-").tempdir_in("/tmp").unwrap();
        let paths = InstancePaths::in_dir(dir.path());
        let bus = Arc::new(Bus::default());
        let handle = start(&paths, Arc::new(Fake { bus: bus.clone() }), bus.clone(), cfg).unwrap();
        Rig { _dir: dir, paths, handle, bus }
    }
    fn rig() -> Rig {
        rig_with(ServerConfig::default())
    }

    fn raw(rig: &Rig) -> (UnixStream, BufReader<UnixStream>) {
        let s = UnixStream::connect(&rig.paths.socket).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let r = BufReader::new(s.try_clone().unwrap());
        (s, r)
    }
    fn send_line(s: &mut UnixStream, line: &str) {
        use std::io::Write;
        s.write_all(line.as_bytes()).unwrap();
        s.write_all(b"\n").unwrap();
    }
    fn recv(r: &mut BufReader<UnixStream>) -> Value {
        serde_json::from_slice(&read_frame(r, 1 << 20).unwrap().expect("reply")).unwrap()
    }

    #[test]
    fn round_trip_and_socket_mode() {
        let rig = rig();
        assert_eq!(std::fs::metadata(&rig.paths.socket).unwrap().permissions().mode() & 0o777, 0o600);
        let mut c = Client::connect(&rig.paths.socket).unwrap();
        assert_eq!(c.call("app.status", None).unwrap(), json!({"running": true, "role": "cli"}));
        let e = c.call("command.run", Some(json!({"id": "x"}))).unwrap_err();
        let CallError::Rpc(e) = e else { panic!() };
        assert_eq!(e.app_code(), Some("UNAVAILABLE"));
    }

    #[test]
    fn parse_error_invalid_request_unknown_method() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, "{nope");
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(PARSE_ERROR), Value::Null));
        send_line(&mut s, r#"{"jsonrpc":"1.0","id":4,"method":"app.status"}"#);
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(INVALID_REQUEST), json!(4)));
        send_line(&mut s, r#"[1,2]"#);
        assert_eq!(recv(&mut r)["error"]["code"], INVALID_REQUEST);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":"a","method":"nope.nothing"}"#);
        let v = recv(&mut r);
        assert_eq!((v["error"]["code"].as_i64(), v["id"].clone()), (Some(vaultdraw_protocol::METHOD_NOT_FOUND), json!("a")));
    }

    #[test]
    fn notifications_get_no_reply() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, r#"{"jsonrpc":"2.0","method":"app.status"}"#);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":9,"method":"app.status"}"#);
        assert_eq!(recv(&mut r)["id"], 9);
    }

    #[test]
    fn roles_gate_methods_and_mcp_is_closed() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        // uri may not call app.status (cli only) but may call app.open.
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"rpc.hello","params":{"role":"uri"}}"#);
        assert_eq!(recv(&mut r)["result"], json!({"api": 1, "role": "uri"}));
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":2,"method":"app.status"}"#);
        assert_eq!(recv(&mut r)["error"]["data"]["code"], "NOT_PERMITTED");
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":3,"method":"app.open","params":{"argv":["a","b"]}}"#);
        assert_eq!(recv(&mut r)["result"], json!({"handled": 2}));
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":4,"method":"rpc.hello","params":{"role":"root"}}"#);
        assert_eq!(recv(&mut r)["error"]["code"], vaultdraw_protocol::INVALID_PARAMS);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":5,"method":"rpc.hello","params":{"role":"mcp"}}"#);
        assert_eq!(recv(&mut r)["result"]["role"], "mcp");
        for m in ["app.status", "rpc.discover", "command.list"] {
            send_line(&mut s, &format!(r#"{{"jsonrpc":"2.0","id":6,"method":"{m}"}}"#));
            assert_eq!(recv(&mut r)["error"]["data"]["code"], "NOT_PERMITTED", "{m}");
        }

        // Once mcp, always mcp: no way back to a wider role; re-declaring mcp is fine.
        for role in ["cli", "uri"] {
            send_line(&mut s, &format!(r#"{{"jsonrpc":"2.0","id":7,"method":"rpc.hello","params":{{"role":"{role}"}}}}"#));
            let e = recv(&mut r);
            assert_eq!(e["error"]["data"]["code"], "NOT_PERMITTED", "{role}");
            assert_eq!(e["error"]["message"], "The mcp role cannot be changed on this connection");
        }
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":8,"method":"rpc.hello","params":{"role":"mcp"}}"#);
        assert_eq!(recv(&mut r)["result"]["role"], "mcp");
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":9,"method":"app.status"}"#);
        assert_eq!(recv(&mut r)["error"]["data"]["code"], "NOT_PERMITTED");
    }

    #[test]
    fn stale_socket_is_replaced() {
        let dir = tempfile::Builder::new().prefix("vd-").tempdir_in("/tmp").unwrap();
        let paths = InstancePaths::in_dir(dir.path());
        drop(UnixListener::bind(&paths.socket).unwrap()); // leaves a dead socket file
        assert!(Client::connect(&paths.socket).is_err());
        let handle = start(&paths, Arc::new(Fake::default()), Arc::new(Bus::default()), ServerConfig::default()).unwrap();
        assert!(Client::connect(&paths.socket).unwrap().call("app.status", None).is_ok());
        handle.shutdown();
    }

    #[test]
    fn other_users_are_dropped() {
        let rig = rig_with(ServerConfig { peer_uid: |_| Ok(vaultdraw_protocol::peer::my_uid() + 1), my_uid: vaultdraw_protocol::peer::my_uid() });
        let (mut s, mut r) = raw(&rig);
        send_line(&mut s, r#"{"jsonrpc":"2.0","id":1,"method":"app.status"}"#);
        assert!(read_frame(&mut r, 1 << 20).map(|f| f.is_none()).unwrap_or(true), "no reply for a foreign uid");
    }

    #[test]
    fn forward_reaches_app_open() {
        let rig = rig();
        super::super::instance::forward(&rig.paths.socket, &["vaultdraw://x".into()], Some("/tmp"), Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn round_trip_latency() {
        let rig = rig();
        let mut c = Client::connect(&rig.paths.socket).unwrap();
        let mut samples = Vec::new();
        for _ in 0..500 {
            let t = Instant::now();
            c.call("app.status", None).unwrap();
            samples.push(t.elapsed());
        }
        samples.sort();
        eprintln!("app.status round trip (fake dispatcher): p50 {:?} p95 {:?}", samples[250], samples[475]);
        assert!(samples[250] < Duration::from_millis(2));
    }

    fn call_line(s: &mut UnixStream, id: u32, method: &str, params: Value) {
        send_line(s, &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string());
    }

    #[test]
    fn subscribe_replies_then_snapshot_then_deltas_in_order() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        call_line(&mut s, 1, "events.subscribe", json!({"topics": ["file"]}));
        let reply = recv(&mut r);
        assert_eq!(reply["id"], 1);
        assert_eq!(reply["result"], json!({"seq": 0, "topics": ["file"]}));
        let snap = recv(&mut r);
        assert_eq!(snap["method"], "events.snapshot");
        assert_eq!(snap["params"]["vault"]["name"], "V");
        // Publishing happens on another connection; deltas arrive after the snapshot.
        let mut other = Client::connect(&rig.paths.socket).unwrap();
        other.call("app.focus", Some(json!({"n": 3}))).unwrap();
        let seqs: Vec<u64> = (0..3).map(|_| recv(&mut r)["params"]["seq"].as_u64().unwrap()).collect();
        assert_eq!(seqs, [1, 2, 3]);
        // The same connection still serves requests, interleaved with events.
        call_line(&mut s, 2, "app.status", json!({}));
        assert_eq!(recv(&mut r)["id"], 2);
    }

    #[test]
    fn topic_filter_unknown_topic_and_unsubscribe() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        call_line(&mut s, 1, "events.subscribe", json!({"topics": ["tab", "bogus"]}));
        assert_eq!(recv(&mut r)["error"]["code"], vaultdraw_protocol::INVALID_PARAMS);
        call_line(&mut s, 2, "events.subscribe", json!({"topics": []}));
        assert_eq!(recv(&mut r)["error"]["code"], vaultdraw_protocol::INVALID_PARAMS);
        call_line(&mut s, 3, "events.subscribe", json!({"topics": ["tab"]}));
        assert_eq!(recv(&mut r)["result"]["topics"], json!(["tab"]));
        assert_eq!(recv(&mut r)["method"], "events.snapshot");
        let mut other = Client::connect(&rig.paths.socket).unwrap();
        other.call("app.focus", Some(json!({"n": 2}))).unwrap(); // file topic: filtered out
        call_line(&mut s, 4, "events.unsubscribe", json!({}));
        assert_eq!(recv(&mut r), json!({"jsonrpc": "2.0", "id": 4, "result": {"unsubscribed": true}}));
        assert_eq!(rig.bus.mask(), 0);
    }

    #[test]
    fn closing_the_connection_clears_the_mask() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        call_line(&mut s, 1, "events.subscribe", json!({}));
        recv(&mut r);
        recv(&mut r);
        assert_eq!(rig.bus.mask(), 0b11111);
        drop((s, r));
        let t = Instant::now();
        while rig.bus.mask() != 0 && t.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(rig.bus.mask(), 0);
    }

    #[test]
    fn slow_subscriber_is_dropped_with_overflow_and_publisher_is_not_blocked() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        call_line(&mut s, 1, "events.subscribe", json!({"topics": ["file"]}));
        recv(&mut r);
        recv(&mut r);
        // The client reads nothing while 20000 events are published: socket buffer and queue fill.
        let mut other = Client::connect(&rig.paths.socket).unwrap();
        let t = Instant::now();
        other.call("app.focus", Some(json!({"n": 20000}))).unwrap();
        assert!(t.elapsed() < Duration::from_secs(5), "publisher blocked: {:?}", t.elapsed());
        assert_eq!(rig.bus.mask(), 0, "overflowed subscriber removed");
        // The client then sees its backlog and, last, events.overflow.
        let mut last = Value::Null;
        while let Ok(Some(f)) = read_frame(&mut r, 1 << 20) {
            last = serde_json::from_slice(&f).unwrap();
            if last["method"] == "events.overflow" {
                break;
            }
        }
        assert_eq!(last["method"], "events.overflow");
    }

    #[test]
    fn event_latency() {
        let rig = rig();
        let (mut s, mut r) = raw(&rig);
        call_line(&mut s, 1, "events.subscribe", json!({"topics": ["file"]}));
        recv(&mut r);
        recv(&mut r);
        let mut other = Client::connect(&rig.paths.socket).unwrap();
        let mut samples = Vec::new();
        for _ in 0..500 {
            other.call("app.focus", Some(json!({"n": 1}))).unwrap();
            let ev = recv(&mut r);
            let sent = ev["params"]["t"].as_u64().unwrap();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64;
            samples.push(Duration::from_nanos(now.saturating_sub(sent)));
        }
        samples.sort();
        eprintln!("event latency publish -> client receive (1 subscriber): p50 {:?} p95 {:?}", samples[250], samples[475]);
        assert!(samples[250] < Duration::from_millis(5));
    }
}
