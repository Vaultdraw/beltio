//! Network access for features that need the internet: the consent gate and a bounded,
//! host-restricted downloader.
//!
//! Consent: `network.enabled` (master switch, default true when absent) must not be false, and
//! `network.allow_<purpose>` must be exactly `true`. Absent means "not asked yet" and is refused
//! like false; the frontend asks the user and writes the key.
// The commands that call this are compiled out under `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

use super::{config, err, Result};
use serde_json::Value;
use std::{io::Read, net::{IpAddr, SocketAddr}, time::Duration};
use ureq::unversioned::{
    resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver},
    transport::{DefaultConnector, NextTimeout},
};
use url::{Host, Url};

/// Pure check on the parsed config (`None` when `config.toml` is missing or does not parse).
pub(crate) fn check_consent(config: Option<&Value>, purpose: &str) -> Result<()> {
    let network = config.and_then(|c| c.get("network"));
    let enabled = match network.and_then(|n| n.get("enabled")) {
        None => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => false,
    };
    if !enabled {
        return Err(err("NETWORK_DISABLED", "Network access is switched off in Settings (network.enabled)"));
    }
    let key = format!("allow_{purpose}");
    let allowed = network.and_then(|n| n.get(&key)).and_then(Value::as_bool) == Some(true);
    if !allowed {
        return Err(err(
            "NETWORK_NOT_ALLOWED",
            format!("Network access for `{purpose}` is not allowed; allow it in Settings (network.{key})"),
        ));
    }
    Ok(())
}

/// Reads `config.toml` in `dirs` and requires consent for `purpose`. Call before any request.
pub(crate) fn ensure_network_allowed(dirs: &config::Dirs, purpose: &str) -> Result<()> {
    let loaded = config::load_settings_in(dirs)?;
    let value = serde_json::to_value(&loaded).map_err(|e| err("INTERNAL", e.to_string()))?;
    check_consent(value.get("config"), purpose)
}

// ---------------------------------------------------------------------------
// Downloader
// ---------------------------------------------------------------------------

/// Redirects are followed only to these hosts (GitHub's own).
const REDIRECT_HOSTS: [&str; 4] = ["github.com", "api.github.com", "raw.githubusercontent.com", "codeload.github.com"];
const MAX_REDIRECTS: usize = 3;

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// True for IP literals that point into a private or local network.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            let cgnat = o[0] == 100 && (o[1] & 0xc0) == 64; // 100.64.0.0/10
            v.is_private() || v.is_link_local() || v.is_unspecified() || v.is_broadcast() || o[0] == 0 || cgnat
        }
        // ::ffff:a.b.c.d is judged as the IPv4 address it wraps.
        IpAddr::V6(v) => match v.to_ipv4_mapped() {
            Some(v4) => is_private_ip(IpAddr::V4(v4)) || v4.is_loopback(),
            None => {
                let seg = v.segments()[0];
                v.is_unspecified() || (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
            }
        },
    }
}

/// Parses and vets a URL: https (http only for loopback), no userinfo, no private IP literals.
/// Host names are vetted when they are resolved (`GuardedResolver`).
pub(crate) fn parse_url(text: &str) -> Result<Url> {
    let bad = |m: &str| err("INVALID_URL", m.to_string());
    let url = Url::parse(text.trim()).map_err(|_| bad("Not a valid URL"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(bad("URLs with a user name or password are not allowed"));
    }
    let loopback = is_loopback(&url);
    match url.scheme() {
        "https" if loopback => return Err(bad("Local addresses are only reachable over http")),
        "https" => {}
        "http" if loopback => {}
        _ => return Err(bad("Only https URLs are allowed")),
    }
    let ip = match url.host() {
        None => return Err(bad("The URL has no host")),
        Some(Host::Ipv4(ip)) => Some(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => Some(IpAddr::V6(ip)),
        Some(Host::Domain(_)) => None,
    };
    if ip.is_some_and(is_private_ip) {
        return Err(bad("Addresses on a private network are not allowed"));
    }
    Ok(url)
}

/// Resolves a redirect `Location` against `base`; only https GitHub hosts are accepted.
pub(crate) fn redirect_target(base: &Url, location: &str) -> Result<Url> {
    let refused = |m: String| err("REDIRECT_REFUSED", m);
    let next = base.join(location).map_err(|_| refused("Invalid redirect".into()))?;
    let host = next.host_str().unwrap_or("").to_ascii_lowercase();
    if next.scheme() != "https" || !REDIRECT_HOSTS.contains(&host.as_str()) {
        return Err(refused(format!("Redirect to `{host}` refused; only GitHub hosts are followed")));
    }
    parse_url(next.as_str()).map_err(|e| refused(e.message))
}

/// True for addresses a public host must never resolve to: private, link-local, CGNAT,
/// unspecified, multicast and loopback.
fn is_blocked_address(ip: IpAddr) -> bool {
    is_private_ip(ip)
        || ip.is_loopback()
        || ip.is_multicast()
        || matches!(ip, IpAddr::V6(v) if v.to_ipv4_mapped().is_some_and(|v4| v4.is_multicast()))
}

/// Marks the error raised when a host name resolves to a forbidden address.
#[derive(Debug)]
struct ForbiddenAddress;
impl std::fmt::Display for ForbiddenAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The host resolves to a private or local address")
    }
}
impl std::error::Error for ForbiddenAddress {}

/// Judges resolved addresses. A loopback URL (tests) must resolve only to loopback addresses;
/// any other host must resolve to none of the blocked ones (one bad answer refuses the host).
fn check_resolved(loopback_url: bool, addrs: &[SocketAddr]) -> bool {
    addrs.iter().all(|a| if loopback_url { a.ip().is_loopback() } else { !is_blocked_address(a.ip()) })
}

/// Resolves host names and vets the answers. ureq connects to exactly the addresses this
/// returns, so there is no second lookup an attacker could change (DNS rebinding).
#[derive(Debug)]
struct GuardedResolver<R: Resolver>(R);

impl<R: Resolver> Resolver for GuardedResolver<R> {
    fn resolve(&self, uri: &ureq::http::Uri, config: &ureq::config::Config, timeout: NextTimeout) -> std::result::Result<ResolvedSocketAddrs, ureq::Error> {
        let addrs = self.0.resolve(uri, config, timeout)?;
        let loopback_url = uri.host().is_some_and(|h| {
            let h = h.trim_start_matches('[').trim_end_matches(']');
            h.eq_ignore_ascii_case("localhost") || h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
        });
        if check_resolved(loopback_url, &addrs) {
            Ok(addrs)
        } else {
            Err(ureq::Error::Io(std::io::Error::new(std::io::ErrorKind::PermissionDenied, ForbiddenAddress)))
        }
    }
}

fn agent_with<R: Resolver>(resolver: R) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_global(Some(Duration::from_secs(20)))
        .user_agent(format!("Vaultdraw/{}", env!("CARGO_PKG_VERSION")))
        .build();
    ureq::Agent::with_parts(config, DefaultConnector::new(), GuardedResolver(resolver))
}

fn agent() -> ureq::Agent {
    agent_with(DefaultResolver::default())
}

fn net_error(e: ureq::Error) -> super::NativeError {
    match e {
        ureq::Error::Timeout(_) => err("NETWORK_TIMEOUT", "The request timed out"),
        ureq::Error::Io(ref io) if io.get_ref().is_some_and(|inner| inner.is::<ForbiddenAddress>()) => {
            err("PRIVATE_ADDRESS", "That host name points to a private or local address, so it was not contacted")
        }
        other => err("NETWORK_ERROR", format!("Request failed: {other}")),
    }
}

/// GET `url` (already vetted) and return at most `max_bytes` of body. Redirects are followed
/// manually, up to three, to GitHub hosts only. Does not check consent: the caller must.
pub(crate) fn get_bytes(url: &Url, max_bytes: u64, accept: &str) -> Result<Vec<u8>> {
    get_bytes_with(&agent(), url, max_bytes, accept)
}

fn get_bytes_with(agent: &ureq::Agent, url: &Url, max_bytes: u64, accept: &str) -> Result<Vec<u8>> {
    let mut current = url.clone();
    for _ in 0..=MAX_REDIRECTS {
        let mut resp = agent.get(current.as_str()).header("Accept", accept).call().map_err(net_error)?;
        let status = resp.status().as_u16();
        if (300..400).contains(&status) {
            let location = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| err("REDIRECT_REFUSED", "Redirect without a Location"))?
                .to_string();
            current = redirect_target(&current, &location)?;
            continue;
        }
        if status != 200 {
            return Err(err("HTTP_STATUS", format!("HTTP status {status} from {}", current.host_str().unwrap_or(""))));
        }
        let mut body = Vec::new();
        resp.body_mut()
            .as_reader()
            .take(max_bytes.saturating_add(1))
            .read_to_end(&mut body)
            .map_err(|e| err("NETWORK_ERROR", format!("Download failed: {e}")))?;
        if body.len() as u64 > max_bytes {
            return Err(err("TOO_LARGE", format!("The download is larger than {} KB", max_bytes / 1024)));
        }
        return Ok(body);
    }
    Err(err("TOO_MANY_REDIRECTS", "Too many redirects"))
}

/// A tiny loopback HTTP server for tests: `route(path)` gives the response; `hits` counts connections.
#[cfg(test)]
pub(crate) mod test_server {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{atomic::{AtomicUsize, Ordering}, Arc},
        thread,
    };

    pub(crate) struct Resp {
        pub status: u16,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
        /// false = no Content-Length: the body ends when the connection closes.
        pub length: bool,
    }
    impl Resp {
        pub fn ok(body: impl Into<Vec<u8>>) -> Self {
            Resp { status: 200, headers: vec![], body: body.into(), length: true }
        }
        pub fn status(status: u16) -> Self {
            Resp { status, headers: vec![], body: vec![], length: true }
        }
    }

    /// Returns (`http://127.0.0.1:port`, connection counter).
    pub(crate) fn start(route: impl Fn(&str) -> Resp + Send + 'static) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut stream = stream;
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                let head = String::from_utf8_lossy(&buf).into_owned();
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                let r = route(&path);
                let mut out = format!("HTTP/1.1 {} X\r\nConnection: close\r\n", r.status);
                for (k, v) in &r.headers {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                if r.length {
                    out.push_str(&format!("Content-Length: {}\r\n", r.body.len()));
                }
                out.push_str("\r\n");
                let _ = stream.write_all(out.as_bytes());
                let _ = stream.write_all(&r.body);
            }
        });
        (base, hits)
    }
}

#[cfg(test)]
mod tests {
    use super::test_server::{start, Resp};
    use super::*;
    use std::sync::atomic::Ordering;

    fn url(s: &str) -> Url {
        parse_url(s).unwrap()
    }

    #[test]
    fn parse_url_rules() {
        assert!(parse_url("https://example.com/a.json").is_ok());
        assert!(parse_url("http://127.0.0.1:8080/a.json").is_ok());
        assert!(parse_url("http://localhost/a.json").is_ok());
        assert!(parse_url("http://[::1]:1/a.json").is_ok());
        for bad in [
            "http://example.com/a.json",
            "ftp://example.com/a.json",
            "file:///etc/passwd",
            "https://user:pw@example.com/a.json",
            "https://user@example.com/a.json",
            "https://192.168.1.1/a.json",
            "https://10.0.0.5/a.json",
            "https://169.254.169.254/latest",
            "https://[fe80::1]/a",
            "https://[fd00::1]/a",
            "https://0.0.0.0/a",
            "https://100.64.0.1/a",
            "https://[::ffff:192.168.1.1]/a",
            "https://[::ffff:169.254.169.254]/a",
            "https://127.0.0.1/a",
            "https://localhost/a",
            "https://[::1]/a",
            "not a url",
        ] {
            assert_eq!(parse_url(bad).unwrap_err().code, "INVALID_URL", "{bad}");
        }
    }

    #[test]
    fn redirect_targets_are_github_https_only() {
        let base = url("https://github.com/o/r/raw/main/a.json");
        assert_eq!(
            redirect_target(&base, "https://raw.githubusercontent.com/o/r/main/a.json").unwrap().host_str(),
            Some("raw.githubusercontent.com")
        );
        assert_eq!(redirect_target(&base, "/o/r/other").unwrap().host_str(), Some("github.com"));
        for bad in ["https://evil.example/a", "http://github.com/a", "https://127.0.0.1/a", "https://github.com.evil.example/a"] {
            assert_eq!(redirect_target(&base, bad).unwrap_err().code, "REDIRECT_REFUSED", "{bad}");
        }
    }

    #[test]
    fn downloads_a_body() {
        let (base, _) = start(|_| Resp::ok("hello"));
        assert_eq!(get_bytes(&url(&format!("{base}/a.json")), 100, "*/*").unwrap(), b"hello");
    }

    #[test]
    fn oversize_body_is_aborted_with_or_without_content_length() {
        let (base, _) = start(|p| Resp { length: p == "/len", ..Resp::ok(vec![b'x'; 5000]) });
        for p in ["/len", "/chunked"] {
            assert_eq!(get_bytes(&url(&format!("{base}{p}")), 1000, "*/*").unwrap_err().code, "TOO_LARGE", "{p}");
        }
        assert_eq!(get_bytes(&url(&format!("{base}/len")), 5000, "*/*").unwrap().len(), 5000);
    }

    #[test]
    fn http_errors_carry_the_status() {
        let (base, _) = start(|_| Resp::status(404));
        let e = get_bytes(&url(&format!("{base}/missing")), 100, "*/*").unwrap_err();
        assert_eq!(e.code, "HTTP_STATUS");
        assert!(e.message.contains("404"), "{}", e.message);
    }

    #[test]
    fn redirects_to_other_hosts_are_refused() {
        for target in ["https://evil.example/x.json", "http://127.0.0.1:1/x.json"] {
            let t = target.to_string();
            let (base, hits) = start(move |_| Resp { headers: vec![("Location".into(), t.clone())], ..Resp::status(302) });
            let e = get_bytes(&url(&format!("{base}/a.json")), 100, "*/*").unwrap_err();
            assert_eq!(e.code, "REDIRECT_REFUSED", "{target}");
            assert_eq!(hits.load(Ordering::SeqCst), 1);
        }
    }

    #[derive(Debug)]
    struct Fake(Vec<SocketAddr>);
    impl Resolver for Fake {
        fn resolve(&self, _: &ureq::http::Uri, _: &ureq::config::Config, _: NextTimeout) -> std::result::Result<ResolvedSocketAddrs, ureq::Error> {
            let mut out = self.empty();
            for a in &self.0 {
                out.push(*a);
            }
            Ok(out)
        }
    }

    #[test]
    fn host_names_resolving_to_private_addresses_are_refused() {
        let (base, hits) = start(|_| Resp::ok("secret"));
        let port: u16 = base.rsplit(':').next().unwrap().parse().unwrap();
        let target = url("https://themes.example/a.json");
        for ip in ["127.0.0.1", "10.0.0.5", "192.168.1.9", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"] {
            let agent = agent_with(Fake(vec![SocketAddr::new(ip.parse().unwrap(), port)]));
            let e = get_bytes_with(&agent, &target, 100, "*/*").unwrap_err();
            assert_eq!(e.code, "PRIVATE_ADDRESS", "{ip}");
        }
        // One private answer among public ones refuses the host too.
        let mixed = agent_with(Fake(vec!["93.184.216.34:443".parse().unwrap(), SocketAddr::new("10.0.0.5".parse().unwrap(), 443)]));
        assert_eq!(get_bytes_with(&mixed, &target, 100, "*/*").unwrap_err().code, "PRIVATE_ADDRESS");
        assert_eq!(hits.load(Ordering::SeqCst), 0, "nothing was contacted");
    }

    #[test]
    fn resolved_address_judgement() {
        let a = |s: &str| -> SocketAddr { s.parse().unwrap() };
        assert!(check_resolved(false, &[a("93.184.216.34:443"), a("[2606:2800:220:1::1]:443")]));
        assert!(!check_resolved(false, &[a("127.0.0.1:443")]));
        assert!(!check_resolved(false, &[a("93.184.216.34:443"), a("172.16.0.1:443")]));
        assert!(check_resolved(true, &[a("127.0.0.1:80"), a("[::1]:80")]));
        // A loopback URL must not reach anywhere else (e.g. /etc/hosts remapping `localhost`).
        assert!(!check_resolved(true, &[a("10.0.0.1:80")]));
    }

    #[test]
    fn connection_refused_is_a_network_error() {
        // Port 1 on loopback: nothing listens.
        assert_eq!(get_bytes(&url("http://127.0.0.1:1/a.json"), 100, "*/*").unwrap_err().code, "NETWORK_ERROR");
    }

    use serde_json::json;
    use std::fs;

    fn code(r: Result<()>) -> String {
        r.err().map(|e| e.code).unwrap_or_default()
    }

    #[test]
    fn pure_gate_four_states() {
        assert_eq!(code(check_consent(None, "themes")), "NETWORK_NOT_ALLOWED");
        assert_eq!(code(check_consent(Some(&json!({})), "themes")), "NETWORK_NOT_ALLOWED");
        assert_eq!(code(check_consent(Some(&json!({"network": {"enabled": false, "allow_themes": true}})), "themes")), "NETWORK_DISABLED");
        assert_eq!(code(check_consent(Some(&json!({"network": {"allow_themes": false}})), "themes")), "NETWORK_NOT_ALLOWED");
        assert!(check_consent(Some(&json!({"network": {"allow_themes": true}})), "themes").is_ok());
        assert!(check_consent(Some(&json!({"network": {"enabled": true, "allow_themes": true}})), "themes").is_ok());
    }

    #[test]
    fn gate_is_per_purpose_and_fails_closed() {
        let cfg = json!({"network": {"allow_themes": true}});
        assert_eq!(code(check_consent(Some(&cfg), "catalogue")), "NETWORK_NOT_ALLOWED");
        // Wrong types never count as consent.
        assert_eq!(code(check_consent(Some(&json!({"network": {"allow_themes": "true"}})), "themes")), "NETWORK_NOT_ALLOWED");
        assert_eq!(code(check_consent(Some(&json!({"network": {"enabled": "yes", "allow_themes": true}})), "themes")), "NETWORK_DISABLED");
    }

    fn gate_with(config: Option<&str>) -> String {
        let t = tempfile::tempdir().unwrap();
        let dirs = config::Dirs { config: t.path().join("config"), state: t.path().join("state") };
        if let Some(text) = config {
            fs::create_dir_all(&dirs.config).unwrap();
            fs::write(dirs.config.join("config.toml"), text).unwrap();
        }
        code(ensure_network_allowed(&dirs, "themes"))
    }

    #[test]
    fn reads_config_toml() {
        assert_eq!(gate_with(Some("")), "NETWORK_NOT_ALLOWED");
        assert_eq!(gate_with(Some("[network]\nenabled = false\nallow_themes = true\n")), "NETWORK_DISABLED");
        assert_eq!(gate_with(Some("[network]\nallow_themes = false\n")), "NETWORK_NOT_ALLOWED");
        assert_eq!(gate_with(Some("[network]\nallow_themes = true\n")), "");
        assert_eq!(gate_with(Some("this is not toml [")), "NETWORK_NOT_ALLOWED");
    }

    #[test]
    fn default_config_makes_no_request() {
        // A fresh install writes the default config; it must not grant consent.
        assert_eq!(gate_with(None), "NETWORK_NOT_ALLOWED");
    }
}
