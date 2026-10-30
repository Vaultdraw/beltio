//! `net.*` and `secret.*` plugin rows: a streamed request to an AI provider with a key the page
//! never holds (the webview's CSP forbids `fetch`, so the request goes through Rust).
//!
//! `net.open` sends the request and returns `{"id","status"}` once the response headers arrive;
//! a thread then reads the body and queues chunks, and `net.read` pulls them (first byte tag:
//! 0 data, 1 ended, 2 nothing yet, 3 error JSON). `net.close` cancels. Secrets live in
//! `<state dir>/plugin-secrets/<id>.json` (0600); there is deliberately no way to read one back.
use super::manifest::is_valid_id;
use crate::network::{self, ForbiddenAddress};
use crate::{err, ioerr, Result};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{channel, Receiver, RecvTimeoutError, Sender},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};
use ureq::unversioned::{
    resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver},
    transport::{DefaultConnector, NextTimeout},
};
use url::Url;

const PURPOSE: &str = "ai";
const MAX_REQUEST_BODY: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY: usize = 8 * 1024 * 1024;
const CHUNK: usize = 16 * 1024;
const MAX_STREAMS: usize = 4;
const READ_WAIT: Duration = Duration::from_millis(1500);
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const TAG_DATA: u8 = 0;
const TAG_END: u8 = 1;
const TAG_WAIT: u8 = 2;
const TAG_ERROR: u8 = 3;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Runs a `net.*` or `secret.*` row. `config` loads the parsed `config.toml` and is called only
/// for a request that leaves the computer.
pub(crate) fn call(state_dir: &Path, config: impl FnOnce() -> Result<Option<Value>>, plugin_id: &str, method: &str, body: &[u8]) -> Result<Vec<u8>> {
    match method {
        "net.open" => open(state_dir, config, plugin_id, body),
        "net.read" => read(plugin_id, body),
        "net.close" => close(plugin_id, body),
        "secret.set" => secret_set(state_dir, plugin_id, body),
        "secret.has" => secret_has(state_dir, plugin_id, body),
        "secret.delete" => secret_delete(state_dir, plugin_id, body),
        _ => Err(err("NOT_FOUND", format!("Plugins cannot call \"{method}\""))),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T> {
    serde_json::from_slice(body).map_err(|_| err("INVALID_ARGUMENT", "The request body is not the expected JSON"))
}

// ---------------------------------------------------------------------------
// net.open
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenRequest {
    url: String,
    method: Option<String>,
    headers: Option<BTreeMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    auth: Option<Auth>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Auth {
    secret: String,
    header: String,
    prefix: Option<String>,
}

/// A request that passed every check, with the key already placed in its headers.
struct Prepared {
    url: Url,
    post: bool,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout: Duration,
}

/// The URL rules: http or https, no user:pass; https unless the host is this computer; a literal
/// private address is refused here (a host name is vetted when it resolves).
fn check_url(text: &str) -> Result<Url> {
    let bad = |m: &str| err("INVALID_URL", m);
    let url = Url::parse(text).map_err(|_| bad("That is not a valid address"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(bad("Only https addresses are allowed, or http to this computer"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(bad("Addresses with a user name or password are not allowed"));
    }
    let host = url.host_str().ok_or_else(|| bad("That address has no host"))?;
    if !network::is_loopback(&url) {
        if url.scheme() != "https" {
            return Err(bad("Only https addresses are allowed, or http to this computer"));
        }
        if host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok_and(network::is_blocked_address) {
            return Err(err("PRIVATE_ADDRESS", "That address is private or local, so it was not contacted"));
        }
    }
    Ok(url)
}

/// Offline mode and `network.allow_ai` apply to requests that leave the computer. A loopback
/// request (a model running locally) never leaves it, so it is allowed even in Offline mode.
fn check_policy(url: &Url, config: impl FnOnce() -> Result<Option<Value>>) -> Result<()> {
    if network::is_loopback(url) {
        return Ok(());
    }
    network::check_consent(config()?.as_ref(), PURPOSE)
}

fn is_forbidden_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(n.as_str(), "host" | "content-length" | "connection" | "cookie" | "transfer-encoding") || n.starts_with("proxy-")
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c)
}

fn is_plain_ascii(s: &str) -> bool {
    s.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

fn check_header(name: &str, value: &str) -> Result<()> {
    if name.is_empty() || !name.chars().all(is_token_char) || !is_plain_ascii(value) {
        return Err(err("INVALID_ARGUMENT", format!("The header \"{name}\" is not plain ASCII")));
    }
    if is_forbidden_header(name) {
        return Err(err("INVALID_ARGUMENT", format!("The header \"{name}\" cannot be set")));
    }
    Ok(())
}

fn prepare(state_dir: &Path, plugin_id: &str, req: OpenRequest, config: impl FnOnce() -> Result<Option<Value>>) -> Result<Prepared> {
    let url = check_url(&req.url)?;
    check_policy(&url, config)?;
    let post = match req.method.as_deref() {
        None => req.body.is_some(),
        Some("POST") => true,
        Some("GET") if req.body.is_none() => false,
        Some("GET") => return Err(err("INVALID_ARGUMENT", "A GET request cannot have a body")),
        Some(_) => return Err(err("INVALID_ARGUMENT", "method must be GET or POST")),
    };
    if req.body.as_ref().is_some_and(|b| b.len() > MAX_REQUEST_BODY) {
        return Err(err("TOO_LARGE", "The request is larger than 2 MiB"));
    }
    let timeout_ms = req.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(1000..=600_000).contains(&timeout_ms) {
        return Err(err("INVALID_ARGUMENT", "timeoutMs must be between 1000 and 600000"));
    }
    let mut headers = Vec::new();
    for (k, v) in req.headers.unwrap_or_default() {
        check_header(&k, &v)?;
        headers.push((k, v));
    }
    if let Some(auth) = req.auth {
        let value = format!("{}{}", auth.prefix.unwrap_or_default(), secret_value(state_dir, plugin_id, &auth.secret)?);
        check_header(&auth.header, &value).map_err(|_| err("INVALID_ARGUMENT", "The auth header or the saved key has characters that cannot be sent"))?;
        headers.retain(|(k, _)| !k.eq_ignore_ascii_case(&auth.header));
        headers.push((auth.header, value));
    }
    Ok(Prepared { url, post, headers, body: req.body, timeout: Duration::from_millis(timeout_ms) })
}

/// Like `network::GuardedResolver`, but a loopback URL host is allowed (and must resolve to
/// loopback only); every other host must resolve to no private or local address.
#[derive(Debug)]
struct AiResolver<R: Resolver>(R);

impl<R: Resolver> Resolver for AiResolver<R> {
    fn resolve(&self, uri: &ureq::http::Uri, config: &ureq::config::Config, timeout: NextTimeout) -> std::result::Result<ResolvedSocketAddrs, ureq::Error> {
        let addrs = self.0.resolve(uri, config, timeout)?;
        let loopback_url = uri.host().is_some_and(network::is_loopback_host);
        if network::check_resolved(loopback_url, &addrs) {
            Ok(addrs)
        } else {
            Err(ureq::Error::Io(io::Error::new(io::ErrorKind::PermissionDenied, ForbiddenAddress)))
        }
    }
}

/// No proxy, no redirects, no overall time limit (a long answer may stream for minutes);
/// `timeout` bounds connecting, the wait for the headers and every read.
fn agent(timeout: Duration) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_connect(Some(timeout))
        .timeout_recv_response(Some(timeout))
        .timeout_per_read(Some(timeout))
        .user_agent(format!("Vaultdraw/{}", env!("CARGO_PKG_VERSION")))
        .build();
    ureq::Agent::with_parts(config, DefaultConnector::new(), AiResolver(DefaultResolver::default()))
}

fn send(p: &Prepared) -> Result<ureq::http::Response<ureq::Body>> {
    let ag = agent(p.timeout);
    let result = if p.post {
        let mut r = ag.post(p.url.as_str());
        for (k, v) in &p.headers {
            r = r.header(k, v);
        }
        r.send(p.body.as_deref().unwrap_or("").as_bytes())
    } else {
        let mut r = ag.get(p.url.as_str());
        for (k, v) in &p.headers {
            r = r.header(k, v);
        }
        r.call()
    };
    result.map_err(network::net_error)
}

fn open(state_dir: &Path, config: impl FnOnce() -> Result<Option<Value>>, plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let prepared = prepare(state_dir, plugin_id, parse(body)?, config)?;
    if streams_of(plugin_id) >= MAX_STREAMS {
        return Err(too_many());
    }
    let resp = send(&prepared)?;
    let status = resp.status().as_u16();
    let reader = resp.into_body().into_reader();
    let id = start_stream(plugin_id, reader)?;
    Ok(serde_json::to_vec(&json!({ "id": id, "status": status })).unwrap_or_default())
}

fn too_many() -> crate::NativeError {
    err("TOO_MANY_STREAMS", format!("At most {MAX_STREAMS} requests can be open at once"))
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

enum Msg {
    Data(Vec<u8>),
    End,
    Error(String, String),
}

struct Stream {
    plugin: String,
    cancel: Arc<AtomicBool>,
    rx: Mutex<Receiver<Msg>>,
}

static STREAMS: LazyLock<Mutex<HashMap<u64, Arc<Stream>>>> = LazyLock::new(Default::default);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn streams() -> std::sync::MutexGuard<'static, HashMap<u64, Arc<Stream>>> {
    STREAMS.lock().unwrap_or_else(|e| e.into_inner())
}

fn streams_of(plugin_id: &str) -> usize {
    streams().values().filter(|s| s.plugin == plugin_id).count()
}

/// Registers a stream for `plugin_id` and starts the thread that owns `reader`.
fn start_stream(plugin_id: &str, reader: impl Read + Send + 'static) -> Result<u64> {
    let (tx, rx) = channel();
    let cancel = Arc::new(AtomicBool::new(false));
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = streams();
        if map.values().filter(|s| s.plugin == plugin_id).count() >= MAX_STREAMS {
            return Err(too_many());
        }
        map.insert(id, Arc::new(Stream { plugin: plugin_id.into(), cancel: cancel.clone(), rx: Mutex::new(rx) }));
    }
    std::thread::spawn(move || pump(reader, tx, cancel));
    Ok(id)
}

/// Reads the body in chunks until the end, an error, the size cap, a cancel or the consumer going away.
fn pump(mut reader: impl Read, tx: Sender<Msg>, cancel: Arc<AtomicBool>) {
    let mut buf = vec![0u8; CHUNK];
    let mut total = 0usize;
    while !cancel.load(Ordering::Relaxed) {
        let msg = match reader.read(&mut buf) {
            Ok(0) => Msg::End,
            Ok(n) => {
                total += n;
                if total > MAX_RESPONSE_BODY {
                    Msg::Error("TOO_LARGE".into(), "The answer is larger than 8 MiB".into())
                } else {
                    Msg::Data(buf[..n].to_vec())
                }
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => {
                let ne = read_error(e);
                Msg::Error(ne.code, ne.message)
            }
        };
        let last = !matches!(msg, Msg::Data(_));
        if tx.send(msg).is_err() || last {
            return;
        }
    }
}

fn read_error(e: io::Error) -> crate::NativeError {
    let kind = e.kind();
    match e.into_inner().map(|inner| inner.downcast::<ureq::Error>()) {
        Some(Ok(u)) => network::net_error(*u),
        _ if kind == io::ErrorKind::TimedOut => err("NETWORK_TIMEOUT", "The connection stopped sending data"),
        _ => err("NETWORK_ERROR", "The connection was lost"),
    }
}

#[derive(Deserialize)]
struct IdBody {
    id: u64,
}

/// The stream `id` of `plugin_id`; another plugin's id reads as unknown.
fn lookup(plugin_id: &str, id: u64) -> Result<Arc<Stream>> {
    streams().get(&id).filter(|s| s.plugin == plugin_id).cloned().ok_or_else(|| err("NOT_FOUND", "No such open request"))
}

fn read(plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let id = parse::<IdBody>(body)?.id;
    let stream = lookup(plugin_id, id)?;
    let msg = stream.rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(READ_WAIT);
    // A finished stream frees its slot; a later read of it is NOT_FOUND.
    let finish = || {
        streams().remove(&id);
    };
    Ok(match msg {
        Ok(Msg::Data(d)) => [&[TAG_DATA][..], &d].concat(),
        Ok(Msg::End) | Err(RecvTimeoutError::Disconnected) => {
            finish();
            vec![TAG_END]
        }
        Ok(Msg::Error(code, message)) => {
            finish();
            [&[TAG_ERROR][..], &serde_json::to_vec(&json!({ "code": code, "message": message })).unwrap_or_default()].concat()
        }
        Err(RecvTimeoutError::Timeout) => vec![TAG_WAIT],
    })
}

fn close(plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let id = parse::<IdBody>(body)?.id;
    if let Ok(stream) = lookup(plugin_id, id) {
        stream.cancel.store(true, Ordering::Relaxed);
        streams().remove(&id);
    }
    Ok(Vec::new())
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const SECRETS_DIR: &str = "plugin-secrets";
const MAX_SECRET_CHARS: usize = 4096;
static SECRETS_LOCK: Mutex<()> = Mutex::new(());
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

#[derive(Deserialize)]
struct SetBody {
    name: String,
    value: String,
}

fn check_secret_name(name: &str) -> Result<()> {
    let ok = (1..=64).contains(&name.chars().count()) && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(err("INVALID_ARGUMENT", "A key name is 1 to 64 characters of a-z, 0-9, dot, dash and underscore"))
    }
}

fn secrets_path(state_dir: &Path, plugin_id: &str) -> Result<PathBuf> {
    if !is_valid_id(plugin_id) {
        return Err(err("INVALID_ARGUMENT", "Invalid plugin id"));
    }
    let dir = state_dir.join(SECRETS_DIR);
    let file = dir.join(format!("{plugin_id}.json"));
    for p in [&dir, &file] {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(err("INVALID_PATH", "The keys folder is a symbolic link"));
        }
    }
    Ok(file)
}

/// The plugin's keys. A missing or damaged file reads as empty (the next `secret.set` replaces it).
fn load_secrets(path: &Path) -> Map<String, Value> {
    fs::read(path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| if let Value::Object(m) = v { Some(m) } else { None }).unwrap_or_default()
}

fn save_secrets(path: &Path, map: &Map<String, Value>) -> Result<()> {
    if map.is_empty() {
        return match fs::remove_file(path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(ioerr(e)),
            _ => Ok(()),
        };
    }
    let dir = path.parent().ok_or_else(|| err("INTERNAL", "Keys path has no parent"))?;
    create_private_dir(dir)?;
    let bytes = serde_json::to_vec(map).map_err(|e| err("INTERNAL", e.to_string()))?;
    write_private(dir, path, &bytes)
}

fn create_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(ioerr)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(ioerr)?;
    }
    Ok(())
}

/// Temp file (0600 from the start) in the same folder, then rename over `dest`.
fn write_private(dir: &Path, dest: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = dir.join(format!(".tmp-{}-{}", std::process::id(), TMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
    let res = (|| {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, dest)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res.map_err(ioerr)
}

fn secrets_guard() -> std::sync::MutexGuard<'static, ()> {
    SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn secret_set(state_dir: &Path, plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let SetBody { name, value } = parse(body)?;
    check_secret_name(&name)?;
    if !(1..=MAX_SECRET_CHARS).contains(&value.chars().count()) {
        return Err(err("INVALID_ARGUMENT", "A key is 1 to 4096 characters"));
    }
    let path = secrets_path(state_dir, plugin_id)?;
    let _g = secrets_guard();
    let mut map = load_secrets(&path);
    map.insert(name, Value::String(value));
    save_secrets(&path, &map)?;
    Ok(Vec::new())
}

fn secret_has(state_dir: &Path, plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let NameBody { name } = parse(body)?;
    check_secret_name(&name)?;
    let path = secrets_path(state_dir, plugin_id)?;
    let _g = secrets_guard();
    Ok(vec![u8::from(load_secrets(&path).contains_key(&name))])
}

fn secret_delete(state_dir: &Path, plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let NameBody { name } = parse(body)?;
    check_secret_name(&name)?;
    let path = secrets_path(state_dir, plugin_id)?;
    let _g = secrets_guard();
    let mut map = load_secrets(&path);
    if map.remove(&name).is_some() {
        save_secrets(&path, &map)?;
    }
    Ok(Vec::new())
}

/// For `net.open` auth only: the plugin never gets this value back.
fn secret_value(state_dir: &Path, plugin_id: &str, name: &str) -> Result<String> {
    check_secret_name(name)?;
    let path = secrets_path(state_dir, plugin_id)?;
    let _g = secrets_guard();
    match load_secrets(&path).remove(name) {
        Some(Value::String(s)) => Ok(s),
        _ => Err(err("SECRET_MISSING", "No API key is saved")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::test_server::{start, Resp};
    use std::{
        net::TcpListener,
        time::Instant,
    };

    fn none() -> Result<Option<Value>> {
        Ok(None)
    }

    fn offline() -> Result<Option<Value>> {
        Ok(Some(json!({"network": {"offline": true}})))
    }

    fn call_net(dir: &Path, plugin: &str, method: &str, body: Value) -> Result<Vec<u8>> {
        call(dir, none, plugin, method, &serde_json::to_vec(&body).unwrap())
    }

    fn open_ok(dir: &Path, plugin: &str, body: Value) -> (u64, u64) {
        let v: Value = serde_json::from_slice(&call_net(dir, plugin, "net.open", body).unwrap()).unwrap();
        (v["id"].as_u64().unwrap(), v["status"].as_u64().unwrap())
    }

    /// Pulls every chunk until the end tag; returns (body, error JSON if the stream failed).
    fn drain(dir: &Path, plugin: &str, id: u64) -> (Vec<u8>, Option<Value>) {
        let mut out = Vec::new();
        for _ in 0..2000 {
            let r = call_net(dir, plugin, "net.read", json!({"id": id})).unwrap();
            match r[0] {
                TAG_DATA => out.extend_from_slice(&r[1..]),
                TAG_END => return (out, None),
                TAG_WAIT => {}
                TAG_ERROR => return (out, Some(serde_json::from_slice(&r[1..]).unwrap())),
                t => panic!("unknown tag {t}"),
            }
        }
        panic!("stream never ended");
    }

    fn code(r: Result<Vec<u8>>) -> String {
        r.expect_err("should fail").code
    }

    /// A one-shot server that records the request head and answers with `response`.
    fn capture_server(response: &'static str) -> (String, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(String::new()));
        let sink = seen.clone();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                *sink.lock().unwrap() = String::from_utf8_lossy(&buf).to_lowercase();
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (base, seen)
    }

    const OK_HEAD: &str = "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok";

    #[test]
    fn open_and_read_stream_the_body_in_order_then_end() {
        let dir = tempfile::tempdir().unwrap();
        let body: Vec<u8> = (0..50_000u32).map(|i| (i % 251) as u8).collect();
        let sent = body.clone();
        let (base, _) = start(move |_| Resp::ok(sent.clone()));
        let (id, status) = open_ok(dir.path(), "t-order", json!({"url": format!("{base}/x"), "method": "POST", "body": "{}"}));
        assert_eq!(status, 200);
        let (got, err) = drain(dir.path(), "t-order", id);
        assert!(err.is_none());
        assert_eq!(got, body);
        // The finished stream freed its slot.
        assert_eq!(code(call_net(dir.path(), "t-order", "net.read", json!({"id": id}))), "NOT_FOUND");
    }

    #[test]
    fn a_401_is_a_status_with_a_readable_body() {
        let dir = tempfile::tempdir().unwrap();
        let (base, _) = start(|_| Resp { status: 401, headers: vec![], body: br#"{"error":"bad key"}"#.to_vec(), length: true });
        let (id, status) = open_ok(dir.path(), "t-401", json!({"url": base}));
        assert_eq!(status, 401);
        assert_eq!(drain(dir.path(), "t-401", id).0, br#"{"error":"bad key"}"#);
    }

    #[test]
    fn a_redirect_is_returned_not_followed() {
        let dir = tempfile::tempdir().unwrap();
        let (base, hits) = start(|path| {
            if path == "/r" {
                Resp { status: 302, headers: vec![("Location".into(), "/dest".into())], body: vec![], length: true }
            } else {
                Resp::ok("dest")
            }
        });
        let (id, status) = open_ok(dir.path(), "t-redirect", json!({"url": format!("{base}/r")}));
        assert_eq!(status, 302);
        assert!(drain(dir.path(), "t-redirect", id).0.is_empty());
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn offline_mode_blocks_the_internet_but_not_this_computer() {
        let dir = tempfile::tempdir().unwrap();
        let body = serde_json::to_vec(&json!({"url": "https://api.example.com/v1"})).unwrap();
        assert_eq!(code(call(dir.path(), offline, "t-off", "net.open", &body)), "NETWORK_DISABLED");
        let off = || Ok(Some(json!({"network": {"allow_ai": false}})));
        assert_eq!(code(call(dir.path(), off, "t-off", "net.open", &body)), "NETWORK_NOT_ALLOWED");
        // Loopback never leaves the computer: allowed in Offline mode and with allow_ai = false.
        let (base, _) = start(|_| Resp::ok("local"));
        let local = serde_json::to_vec(&json!({"url": base})).unwrap();
        let r = call(dir.path(), offline, "t-off", "net.open", &local).unwrap();
        let id = serde_json::from_slice::<Value>(&r).unwrap()["id"].as_u64().unwrap();
        assert_eq!(drain(dir.path(), "t-off", id).0, b"local");
        assert!(call(dir.path(), off, "t-off", "net.open", &local).is_ok());
    }

    #[test]
    fn address_rules() {
        let dir = tempfile::tempdir().unwrap();
        for (url, want) in [
            ("http://192.168.1.5/x", "INVALID_URL"),
            ("http://example.com/x", "INVALID_URL"),
            ("ftp://example.com/x", "INVALID_URL"),
            ("https://user:pw@example.com/x", "INVALID_URL"),
            ("not a url", "INVALID_URL"),
            ("https://10.0.0.1/x", "PRIVATE_ADDRESS"),
            ("https://169.254.169.254/x", "PRIVATE_ADDRESS"),
            ("https://[fd00::1]/x", "PRIVATE_ADDRESS"),
        ] {
            assert_eq!(code(call_net(dir.path(), "t-addr", "net.open", json!({"url": url}))), want, "{url}");
        }
        assert!(check_url("http://localhost:11434/api").is_ok());
        assert!(check_url("https://127.0.0.1/api").is_ok());
        assert!(check_url("http://[::1]:8080/api").is_ok());
        assert!(check_url("https://api.openai.com/v1/chat").is_ok());
    }

    #[test]
    fn auth_header_comes_from_the_saved_secret() {
        let dir = tempfile::tempdir().unwrap();
        let open = |plugin: &str, base: &str| call_net(dir.path(), plugin, "net.open", json!({"url": base, "headers": {"X-Other": "1", "authorization": "Bearer page-supplied"}, "auth": {"secret": "api-key", "header": "Authorization", "prefix": "Bearer "}}));
        let (base, seen) = capture_server(OK_HEAD);
        let e = open("t-auth", &base).expect_err("no key saved yet");
        assert_eq!(e.code, "SECRET_MISSING");
        call_net(dir.path(), "t-auth", "secret.set", json!({"name": "api-key", "value": "sk-test-123"})).unwrap();
        let v: Value = serde_json::from_slice(&open("t-auth", &base).unwrap()).unwrap();
        drain(dir.path(), "t-auth", v["id"].as_u64().unwrap());
        let head = seen.lock().unwrap().clone();
        assert!(head.contains("authorization: bearer sk-test-123"), "{head}");
        assert!(!head.contains("page-supplied"), "{head}");
        assert!(head.contains("x-other: 1"));
        assert!(head.contains("user-agent: vaultdraw/"));
        // Another plugin does not see this plugin's key.
        assert_eq!(open("t-auth-2", &base).unwrap_err().code, "SECRET_MISSING");
    }

    #[test]
    fn forbidden_and_odd_headers_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let url = "http://127.0.0.1:1/";
        for name in ["Host", "content-length", "Connection", "COOKIE", "Proxy-Authorization", "proxy-x", "Transfer-Encoding"] {
            let r = call_net(dir.path(), "t-hdr", "net.open", json!({"url": url, "headers": {name: "x"}}));
            assert_eq!(code(r), "INVALID_ARGUMENT", "{name}");
        }
        for (name, value) in [("X-A", "line\nbreak"), ("X-A", "caf\u{e9}"), ("bad name", "x"), ("", "x")] {
            let r = call_net(dir.path(), "t-hdr", "net.open", json!({"url": url, "headers": {name: value}}));
            assert_eq!(code(r), "INVALID_ARGUMENT", "{name:?}");
        }
    }

    #[test]
    fn argument_limits() {
        let dir = tempfile::tempdir().unwrap();
        let url = "http://127.0.0.1:1/";
        let bad = |v: Value| code(call_net(dir.path(), "t-arg", "net.open", v));
        assert_eq!(bad(json!({"url": url, "timeoutMs": 999})), "INVALID_ARGUMENT");
        assert_eq!(bad(json!({"url": url, "timeoutMs": 600_001})), "INVALID_ARGUMENT");
        assert_eq!(bad(json!({"url": url, "method": "PUT"})), "INVALID_ARGUMENT");
        assert_eq!(bad(json!({"url": url, "method": "GET", "body": "x"})), "INVALID_ARGUMENT");
        assert_eq!(bad(json!({"url": url, "body": "x".repeat(MAX_REQUEST_BODY + 1)})), "TOO_LARGE");
        assert_eq!(bad(json!({"url": url, "surprise": 1})), "INVALID_ARGUMENT");
        assert_eq!(bad(json!({})), "INVALID_ARGUMENT");
        // Nothing listens on port 1: a network error, not a panic.
        assert!(matches!(bad(json!({"url": url, "timeoutMs": 1000})).as_str(), "NETWORK_ERROR" | "NETWORK_TIMEOUT"));
    }

    /// Yields 64 bytes at a time forever; sets `dropped` when the stream thread lets go of it.
    struct Endless(Arc<AtomicBool>);
    impl Read for Endless {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            std::thread::sleep(Duration::from_millis(5));
            let n = buf.len().min(64);
            buf[..n].fill(7);
            Ok(n)
        }
    }
    impl Drop for Endless {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn close_cancels_the_reader_and_twice_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        let id = start_stream("t-close", Endless(dropped.clone())).unwrap();
        let r = call_net(dir.path(), "t-close", "net.read", json!({"id": id})).unwrap();
        assert_eq!(r[0], TAG_DATA);
        assert!(call_net(dir.path(), "t-close", "net.close", json!({"id": id})).unwrap().is_empty());
        let deadline = Instant::now() + Duration::from_secs(3);
        while !dropped.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(dropped.load(Ordering::SeqCst), "the reader thread should stop after close");
        assert!(call_net(dir.path(), "t-close", "net.close", json!({"id": id})).unwrap().is_empty());
        assert_eq!(code(call_net(dir.path(), "t-close", "net.read", json!({"id": id}))), "NOT_FOUND");
    }

    #[test]
    fn another_plugin_cannot_read_or_close_a_stream() {
        let dir = tempfile::tempdir().unwrap();
        let id = start_stream("t-owner", Endless(Arc::new(AtomicBool::new(false)))).unwrap();
        assert_eq!(code(call_net(dir.path(), "t-thief", "net.read", json!({"id": id}))), "NOT_FOUND");
        call_net(dir.path(), "t-thief", "net.close", json!({"id": id})).unwrap();
        assert_eq!(call_net(dir.path(), "t-owner", "net.read", json!({"id": id})).unwrap()[0], TAG_DATA);
        call_net(dir.path(), "t-owner", "net.close", json!({"id": id})).unwrap();
        assert_eq!(code(call_net(dir.path(), "t-owner", "net.read", json!({"id": 999_999_999}))), "NOT_FOUND");
    }

    #[test]
    fn at_most_four_streams_per_plugin() {
        let ids: Vec<u64> = (0..MAX_STREAMS).map(|_| start_stream("t-many", Endless(Arc::new(AtomicBool::new(false)))).unwrap()).collect();
        assert_eq!(start_stream("t-many", Endless(Arc::new(AtomicBool::new(false)))).unwrap_err().code, "TOO_MANY_STREAMS");
        // Another plugin has its own allowance.
        let other = start_stream("t-many-2", Endless(Arc::new(AtomicBool::new(false)))).unwrap();
        let dir = tempfile::tempdir().unwrap();
        for id in &ids {
            call_net(dir.path(), "t-many", "net.close", json!({"id": id})).unwrap();
        }
        call_net(dir.path(), "t-many-2", "net.close", json!({"id": other})).unwrap();
        assert!(start_stream("t-many", Endless(Arc::new(AtomicBool::new(false)))).map(|id| call_net(dir.path(), "t-many", "net.close", json!({"id": id}))).is_ok());
    }

    #[test]
    fn a_stalled_stream_says_nothing_yet_and_a_long_one_hits_the_cap() {
        struct Silent;
        impl Read for Silent {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                std::thread::sleep(Duration::from_secs(3));
                Ok(0)
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let id = start_stream("t-wait", Silent).unwrap();
        assert_eq!(call_net(dir.path(), "t-wait", "net.read", json!({"id": id})).unwrap(), vec![TAG_WAIT]);
        call_net(dir.path(), "t-wait", "net.close", json!({"id": id})).unwrap();
        // Past the cap the stream ends with TOO_LARGE.
        let big = io::repeat(1).take(MAX_RESPONSE_BODY as u64 + CHUNK as u64);
        let id = start_stream("t-cap", big).unwrap();
        let (_, e) = drain(dir.path(), "t-cap", id);
        assert_eq!(e.unwrap()["code"], "TOO_LARGE");
    }

    #[test]
    fn a_read_error_is_tag_three_with_code_and_message() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::TimedOut, "slow"))
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let id = start_stream("t-err", Broken).unwrap();
        let (_, e) = drain(dir.path(), "t-err", id);
        assert_eq!(e.unwrap()["code"], "NETWORK_TIMEOUT");
    }

    #[test]
    fn secrets_roundtrip_with_private_file_modes() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let has = |name: &str| call_net(d, "t-sec", "secret.has", json!({"name": name})).unwrap();
        assert_eq!(has("api-key"), vec![0]);
        assert!(call_net(d, "t-sec", "secret.set", json!({"name": "api-key", "value": "sk-abc"})).unwrap().is_empty());
        assert_eq!(has("api-key"), vec![1]);
        assert_eq!(call_net(d, "t-sec-2", "secret.has", json!({"name": "api-key"})).unwrap(), vec![0]);
        let file = d.join(SECRETS_DIR).join("t-sec.json");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(&file).unwrap()).unwrap(), json!({"api-key": "sk-abc"}));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(d.join(SECRETS_DIR)).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // Overwrite keeps the mode; no temp files are left.
        call_net(d, "t-sec", "secret.set", json!({"name": "api-key", "value": "sk-new"})).unwrap();
        assert_eq!(fs::read_dir(d.join(SECRETS_DIR)).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        call_net(d, "t-sec", "secret.delete", json!({"name": "api-key"})).unwrap();
        call_net(d, "t-sec", "secret.delete", json!({"name": "api-key"})).unwrap();
        assert_eq!(has("api-key"), vec![0]);
        assert!(!file.exists());
    }

    #[test]
    fn secret_arguments_are_checked_and_values_never_appear_in_errors() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let long_name = "a".repeat(65);
        for name in ["", "Upper", "has space", "slash/x", long_name.as_str()] {
            assert_eq!(code(call_net(d, "t-sarg", "secret.set", json!({"name": name, "value": "v"}))), "INVALID_ARGUMENT", "{name:?}");
            assert_eq!(code(call_net(d, "t-sarg", "secret.has", json!({"name": name}))), "INVALID_ARGUMENT");
        }
        let too_long = "k".repeat(4097);
        for value in ["", too_long.as_str()] {
            let e = call_net(d, "t-sarg", "secret.set", json!({"name": "ok", "value": value})).unwrap_err();
            assert_eq!(e.code, "INVALID_ARGUMENT");
            assert!(!e.message.contains("kkkk"));
        }
        assert!(call_net(d, "t-sarg", "secret.set", json!({"name": "ok", "value": "k".repeat(4096)})).is_ok());
        // A saved key with a newline cannot be sent, and the error does not show it.
        call_net(d, "t-sarg", "secret.set", json!({"name": "nl", "value": "SECRETVALUE\nX"})).unwrap();
        let e = call_net(d, "t-sarg", "net.open", json!({"url": "http://127.0.0.1:1/", "auth": {"secret": "nl", "header": "Authorization"}})).unwrap_err();
        assert_eq!(e.code, "INVALID_ARGUMENT");
        assert!(!e.message.contains("SECRETVALUE"));
        // No way to read a key back.
        assert_eq!(code(call(d, none, "t-sarg", "secret.get", b"{}")), "NOT_FOUND");
        // A damaged file reads as empty and is replaced by the next set.
        fs::write(d.join(SECRETS_DIR).join("t-sarg.json"), "not json").unwrap();
        assert_eq!(call_net(d, "t-sarg", "secret.has", json!({"name": "ok"})).unwrap(), vec![0]);
        call_net(d, "t-sarg", "secret.set", json!({"name": "ok", "value": "v"})).unwrap();
        assert_eq!(call_net(d, "t-sarg", "secret.has", json!({"name": "ok"})).unwrap(), vec![1]);
        assert_eq!(code(call_net(d, "../evil", "secret.set", json!({"name": "ok", "value": "v"}))), "INVALID_ARGUMENT");
    }

    #[test]
    fn the_rows_are_in_the_allowlist_with_their_permissions() {
        use super::super::gateway::{Route, ALLOWLIST};
        for (m, p) in [("net.open", "net"), ("net.read", "net"), ("net.close", "net"), ("secret.set", "secret"), ("secret.has", "secret"), ("secret.delete", "secret")] {
            let row = ALLOWLIST.iter().find(|r| r.method == m).unwrap_or_else(|| panic!("{m}"));
            assert_eq!((row.permission, row.route), (Some(p), Route::Raw));
        }
        assert!(ALLOWLIST.iter().all(|r| r.method != "secret.get"));
    }
}
