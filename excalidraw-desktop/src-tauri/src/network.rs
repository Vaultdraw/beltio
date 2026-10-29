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
        return Err(err("NETWORK_DISABLED", "Network access is switched off in Settings"));
    }
    let key = format!("allow_{purpose}");
    let allowed = match network.and_then(|n| n.get(&key)) {
        // Web pictures are on unless the user turned them off (owner, 2026-10-29: "If there is a
        // link, download it and display it"); every other purpose still needs a yes.
        None => purpose == "images",
        Some(v) => v.as_bool() == Some(true),
    };
    if !allowed {
        return Err(err(
            "NETWORK_NOT_ALLOWED",
            format!("Downloading {} is not allowed. You can allow it in Settings.", purpose_phrase(purpose)),
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
// Granting consent
// ---------------------------------------------------------------------------

/// True for the keys that give consent: `network.enabled` and `network.allow_<purpose>`.
fn is_consent_key(key: &str) -> bool {
    key == "enabled" || key.strip_prefix("allow_").is_some_and(|p| !p.is_empty())
}

/// `update_config` (the webview's write path) may revoke consent or remove a consent key, but
/// never set one to anything but false: a grant goes through `network_grant` and its native
/// dialog, so a script in the page cannot give itself network access.
pub(crate) fn refuse_consent_grants(changes: &[config::LayerChange]) -> Result<()> {
    let refuse = |key: &str| {
        err(
            "CONSENT_REQUIRED",
            format!("`network.{key}` can only be turned on through the confirmation dialog (network_grant)"),
        )
    };
    let revokes = |v: &Value| matches!(v, Value::Null | Value::Bool(false));
    // The host list is read from config.toml only; the page has no business adding to it.
    let hosts_err = || {
        err("CONSENT_REQUIRED", "`network.allowed_hosts` can only be edited by hand in config.toml".to_string())
    };
    let empty = |v: &Value| matches!(v, Value::Null) || matches!(v, Value::Array(a) if a.is_empty());
    for change in changes {
        // Where the lists come from is read from config.toml only too (see `list_address`).
        if let Some((section, key)) = LIST_ADDRESS_KEYS.iter().find(|(s, k)| {
            change.key == format!("{s}.{k}")
                || (change.key == *s && matches!(&change.value, Value::Object(f) if f.get(*k).is_some_and(|v| !matches!(v, Value::Null))))
        }) {
            if !matches!(change.value, Value::Null) {
                return Err(err(
                    "CONSENT_REQUIRED",
                    format!("`{section}.{key}` can only be edited by hand in config.toml"),
                ));
            }
        }
        if change.key == "network.allowed_hosts" && !empty(&change.value) {
            return Err(hosts_err());
        }
        if change.key == "network" {
            if let Value::Object(fields) = &change.value {
                if fields.get("allowed_hosts").is_some_and(|v| !empty(v)) {
                    return Err(hosts_err());
                }
                if let Some((key, _)) = fields.iter().find(|(k, v)| is_consent_key(k) && !revokes(v)) {
                    return Err(refuse(key));
                }
            }
        } else if let Some(key) = change.key.strip_prefix("network.") {
            if is_consent_key(key) && !revokes(&change.value) {
                return Err(refuse(key));
            }
        }
    }
    Ok(())
}

/// The plain-language name of what a consent purpose downloads ("themes", "plugins").
fn purpose_phrase(purpose: &str) -> String {
    match purpose {
        "themes" => "themes".into(),
        "plugins" => "plugins".into(),
        "plugin_list" | "plugin_registry" => "the plugin list".into(),
        "images" => "pictures from web pages".into(),
        other => other.replace('_', " "),
    }
}

/// What the confirmation dialog says for one or more consent keys (`enabled` is the master
/// switch, `allow_<purpose>` one purpose). Plain words only: no config keys, no code quotes.
/// Returns `(title, text)`.
fn grant_prompt(keys: &[&str]) -> (String, String) {
    let master = keys.contains(&"enabled");
    let phrases: Vec<String> =
        keys.iter().filter_map(|k| k.strip_prefix("allow_")).map(purpose_phrase).collect();
    let list = match phrases.as_slice() {
        [] => String::new(),
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    };
    let title = match (master, list.is_empty()) {
        (true, true) => "Allow internet access?".to_string(),
        (true, false) => format!("Allow internet access to download {list}?"),
        (false, _) => format!("Allow downloading {list}?"),
    };
    let text = if list.is_empty() {
        "Vaultdraw will be able to use the internet for the features you allow. Nothing is sent until you use one. You can change this any time in Settings."
            .to_string()
    } else {
        format!(
            "Vaultdraw will connect to the internet to download {list}, only when you ask for it. You can change this any time in Settings."
        )
    };
    (title, text)
}

/// The button that grants, and the one that refuses (the same wording in every native dialog).
pub(crate) const ALLOW_LABEL: &str = "Allow";
pub(crate) const DENY_LABEL: &str = "Don't Allow";

/// Turns a consent key on after `confirm(title, text)` says yes. Returns whether it was granted;
/// a refusal writes nothing. `key` is `enabled` or `allow_<purpose>`, without the `network.` prefix.
#[cfg(test)]
pub(crate) fn grant_in(dirs: &config::Dirs, key: &str, confirm: impl FnOnce(&str, &str) -> bool) -> Result<bool> {
    grant_all_in(dirs, &[key], confirm)
}

/// The same for several keys at once (the master switch and a purpose): one dialog, one answer,
/// so a single click never shows the box twice. Every key is checked before anything is asked.
pub(crate) fn grant_all_in(dirs: &config::Dirs, keys: &[&str], confirm: impl FnOnce(&str, &str) -> bool) -> Result<bool> {
    let valid = |key: &str| {
        key.len() <= 40
            && is_consent_key(key)
            && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    };
    let mut unique: Vec<&str> = Vec::new();
    for key in keys {
        if !unique.contains(key) {
            unique.push(key);
        }
    }
    if unique.is_empty() || unique.len() > 4 || !unique.iter().all(|k| valid(k)) {
        return Err(err("INVALID_ARGUMENT", "Not a network consent key"));
    }
    let (title, text) = grant_prompt(&unique);
    if !confirm(&title, &text) {
        return Ok(false);
    }
    let changes: Vec<config::LayerChange> = unique
        .iter()
        .map(|k| config::LayerChange { key: format!("network.{k}"), value: Value::Bool(true), default: None })
        .collect();
    config::update_overrides_in(dirs, &changes)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Downloader
// ---------------------------------------------------------------------------

/// Redirects are followed only to these hosts (GitHub's own).
const REDIRECT_HOSTS: [&str; 4] = ["github.com", "api.github.com", "raw.githubusercontent.com", "codeload.github.com"];
const MAX_REDIRECTS: usize = 3;

/// Plain http to loopback exists only for Rust unit tests (a local test server). Release and
/// debug builds of the app speak https to public hosts only.
const ALLOW_LOOPBACK: bool = cfg!(test);

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// A wrapped IPv4 address (mapped, NAT64, 6to4) is judged as the IPv4 address it carries.
fn blocked_v4(v4: std::net::Ipv4Addr) -> bool {
    is_private_ip(IpAddr::V4(v4)) || v4.is_loopback() || v4.is_multicast()
}

/// True for IP literals that point into a private or local network, or into a range with no
/// public host: private, link-local, CGNAT, unspecified, "this network", broadcast, IETF
/// protocol (192.0.0.0/24), benchmarking (198.18.0.0/15), reserved (240.0.0.0/4), IPv6
/// unique-local, link-local, site-local, IPv4-compatible (::/96), and IPv6 forms that carry an
/// IPv4 address (mapped, NAT64, 6to4), which are judged by that address.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            let cgnat = o[0] == 100 && (o[1] & 0xc0) == 64; // 100.64.0.0/10
            let ietf = o[0] == 192 && o[1] == 0 && o[2] == 0; // 192.0.0.0/24
            let bench = o[0] == 198 && (o[1] & 0xfe) == 18; // 198.18.0.0/15
            let reserved = o[0] >= 240; // 240.0.0.0/4 (includes broadcast)
            v.is_private() || v.is_link_local() || v.is_unspecified() || o[0] == 0 || cgnat || ietf || bench || reserved
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return blocked_v4(v4);
            }
            let s = v.segments();
            let embedded = |hi: u16, lo: u16| std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
            // NAT64 well-known prefix 64:ff9b::/96 carries the IPv4 address in the last 32 bits.
            if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
                return blocked_v4(embedded(s[6], s[7]));
            }
            // 6to4 2002::/16 carries it in bits 16..48.
            if s[0] == 0x2002 {
                return blocked_v4(embedded(s[1], s[2]));
            }
            v.is_unspecified()
                || s[..6] == [0; 6] // ::/96, IPv4-compatible (deprecated) and ::1
                || (s[0] == 0x64 && s[1] == 0xff9b && s[2] == 1) // 64:ff9b:1::/48 local-use NAT64
                || (s[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
                || (s[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || (s[0] & 0xffc0) == 0xfec0 // fec0::/10 site-local
        }
    }
}

/// Parses and vets a URL: https only, no userinfo, no private or local IP literals.
/// Host names are vetted when they are resolved (`GuardedResolver`).
pub(crate) fn parse_url(text: &str) -> Result<Url> {
    parse_url_with(text, ALLOW_LOOPBACK)
}

/// `allow_loopback` admits plain http to loopback; only tests pass true (see `ALLOW_LOOPBACK`).
fn parse_url_with(text: &str, allow_loopback: bool) -> Result<Url> {
    let bad = |m: &str| err("INVALID_URL", m.to_string());
    let url = Url::parse(text.trim()).map_err(|_| bad("Not a valid URL"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(bad("URLs with a user name or password are not allowed"));
    }
    let loopback = is_loopback(&url);
    match url.scheme() {
        "https" if loopback => return Err(bad("Local addresses are not allowed")),
        "https" => {}
        "http" if loopback && allow_loopback => {}
        _ => return Err(bad("Only https URLs are allowed")),
    }
    let ip = match url.host() {
        None => return Err(bad("The URL has no host")),
        Some(Host::Ipv4(ip)) => Some(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => Some(IpAddr::V6(ip)),
        Some(Host::Domain(_)) => None,
    };
    if ip.is_some_and(|ip| !(loopback && allow_loopback) && is_blocked_address(ip)) {
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

/// A redirect `Location` for the `images` purpose: https to any public host, vetted like a first URL.
fn redirect_target_public(base: &Url, location: &str) -> Result<Url> {
    let refused = |m: String| err("REDIRECT_REFUSED", m);
    let next = base.join(location).map_err(|_| refused("Invalid redirect".into()))?;
    parse_public_url(next.as_str()).map_err(|e| refused(e.message))
}

/// A picture's address: like `parse_url`, and plain http is accepted too, for a public host only
/// (a note's pictures are often on http sites). Private, local and reserved addresses are refused
/// here for literal addresses and by the resolver for host names.
pub(crate) fn parse_public_url(text: &str) -> Result<Url> {
    let url = Url::parse(text.trim()).map_err(|_| err("INVALID_URL", "Not a valid URL"))?;
    if url.scheme() != "http" || is_loopback(&url) && ALLOW_LOOPBACK {
        return parse_url(text);
    }
    let mut secure = url.clone();
    secure.set_scheme("https").map_err(|_| err("INVALID_URL", "Not a valid URL"))?;
    parse_url(secure.as_str()).map(|_| url)
}

/// Largest picture a web download returns.
pub(crate) const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// True when the bytes hold a picture a drawing can hold (PNG, JPEG, GIF, WebP, SVG): one rule
/// with the TypeScript side (`vaultdraw_core::picture`, contract `picture_bytes.json`).
pub(crate) fn looks_like_image(b: &[u8]) -> bool {
    vaultdraw_core::picture::picture_type(b).is_some()
}

/// Hosts a picture download may contact: every public http or https host, unless `network.allow_images` is off
/// (asked in a native dialog, listing the sites). This is the one purpose that is not limited to
/// GitHub and `network.allowed_hosts`: the pictures live wherever the note's author put them.
/// Everything else still applies: https only, no user info, no private, local or reserved address
/// (literal or resolved), at most three redirects (each vetted the same way), 10 MiB, image bytes.
pub(crate) fn fetch_image_with(agent: &ureq::Agent, url_text: &str) -> Result<Vec<u8>> {
    let url = parse_public_url(url_text)?;
    let body = get_bytes_following(agent, &url, IMAGE_MAX_BYTES, "image/*", Redirects::PublicHttps)?;
    if !looks_like_image(&body) {
        return Err(err("NOT_AN_IMAGE", "That address is not a picture"));
    }
    Ok(body)
}

/// `fetch_image_with` after the consent check for the `images` purpose.
pub(crate) fn fetch_image(dirs: &config::Dirs, url_text: &str) -> Result<Vec<u8>> {
    ensure_network_allowed(dirs, "images")?;
    fetch_image_with(&agent(), url_text)
}

/// The app's own picture download (a pasted picture address): the same checks as a plugin's
/// `network.fetchImage` (web pictures on, public http or https, 10 MiB, picture bytes), run off the
/// main thread.
#[tauri::command]
pub(crate) async fn network_fetch_image(url: String) -> Result<tauri::ipc::Response> {
    let dirs = config::resolve_dirs()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || fetch_image(&dirs, &url))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
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

fn is_loopback_host(h: &str) -> bool {
    let h = h.trim_start_matches('[').trim_end_matches(']');
    h.eq_ignore_ascii_case("localhost") || h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

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
        let loopback_url = ALLOW_LOOPBACK && uri.host().is_some_and(is_loopback_host);
        if check_resolved(loopback_url, &addrs) {
            Ok(addrs)
        } else {
            Err(ureq::Error::Io(std::io::Error::new(std::io::ErrorKind::PermissionDenied, ForbiddenAddress)))
        }
    }
}

/// No proxy: ureq would read HTTPS_PROXY / ALL_PROXY from the environment, and the private
/// address check would then see only the proxy. The app is offline-first; a proxy can become
/// an explicit setting later.
fn agent_config() -> ureq::config::Config {
    ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_global(Some(Duration::from_secs(20)))
        .user_agent(format!("Vaultdraw/{}", env!("CARGO_PKG_VERSION")))
        .build()
}

fn agent_with<R: Resolver>(resolver: R) -> ureq::Agent {
    ureq::Agent::with_parts(agent_config(), DefaultConnector::new(), GuardedResolver(resolver))
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
    if !(ALLOW_LOOPBACK && is_loopback(url)) {
        check_host(url, &configured_hosts())?;
    }
    get_bytes_with(&agent(), url, max_bytes, accept)
}

/// The one outbound host list: GitHub's own hosts (themes, plugin registry, packages) plus the
/// hosts the user added to `network.allowed_hosts`. A page script can steer a theme or registry
/// address, so no address outside this list is ever contacted.
pub(crate) fn check_host(url: &Url, extra: &[String]) -> Result<()> {
    let host = url.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase();
    if REDIRECT_HOSTS.contains(&host.as_str()) || extra.iter().any(|h| h.eq_ignore_ascii_case(&host)) {
        return Ok(());
    }
    Err(err(
        "HOST_NOT_ALLOWED",
        format!("`{host}` is not on the list of allowed hosts. To use it, add it to `allowed_hosts` under [network] in config.toml"),
    ))
}

/// `network.allowed_hosts` from `config.toml` only. `overrides.toml` (where Settings and the
/// page's `update_config` write) is never read for this, so a script in the page cannot add a host.
pub(crate) fn hosts_from_config_toml(layers: &[config::LayerInfo]) -> Vec<String> {
    layers
        .iter()
        .find(|l| l.kind == "config")
        .and_then(|l| l.config.as_ref())
        .and_then(|c| c.get("network")?.get("allowed_hosts")?.as_array().cloned())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// The settings that say where a community list is downloaded from. Like `allowed_hosts` they are
/// read from `config.toml` only, so a script in the page cannot point the download elsewhere.
const LIST_ADDRESS_KEYS: [(&str, &str); 2] = [("plugins", "registry_url"), ("themes", "index_url")];

/// `[section] key` as a text from `config.toml` only (never `overrides.toml`); `None` when unset or blank.
pub(crate) fn list_address(layers: &[config::LayerInfo], section: &str, key: &str) -> Option<String> {
    layers
        .iter()
        .find(|l| l.kind == "config")
        .and_then(|l| l.config.as_ref())
        .and_then(|c| c.get(section)?.get(key)?.as_str())
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_owned)
}

fn configured_hosts() -> Vec<String> {
    config::resolve_dirs()
        .and_then(|d| config::load_settings_in(&d))
        .map(|loaded| hosts_from_config_toml(&loaded.layers))
        .unwrap_or_default()
}

/// Which redirects a download follows.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Redirects {
    /// https GitHub hosts only (themes, the plugin list, plugin packages).
    GithubOnly,
    /// Any public https host: each hop is vetted like the first URL (no private or local address,
    /// resolved names checked by the guarded resolver). Only the `images` purpose.
    PublicHttps,
}

fn get_bytes_with(agent: &ureq::Agent, url: &Url, max_bytes: u64, accept: &str) -> Result<Vec<u8>> {
    get_bytes_following(agent, url, max_bytes, accept, Redirects::GithubOnly)
}

fn get_bytes_following(agent: &ureq::Agent, url: &Url, max_bytes: u64, accept: &str, redirects: Redirects) -> Result<Vec<u8>> {
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
            current = match redirects {
                Redirects::GithubOnly => redirect_target(&current, &location)?,
                Redirects::PublicHttps => redirect_target_public(&current, &location)?,
            };
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
    fn security_only_listed_hosts_are_contacted() {
        let extra = vec!["Themes.Example.org".to_string()];
        for ok in [
            "https://raw.githubusercontent.com/Vaultdraw/themes/main/index.json",
            "https://api.github.com/repos/x/y",
            "https://github.com/x/y",
            "https://codeload.github.com/x/y/zip/main",
            "https://themes.example.org/a.json",
        ] {
            assert!(check_host(&url(ok), &extra).is_ok(), "{ok}");
        }
        for bad in ["https://evil.example/a.json", "https://raw.githubusercontent.com.evil.example/a", "https://example.org/a.json"] {
            let e = check_host(&url(bad), &extra).unwrap_err();
            assert_eq!(e.code, "HOST_NOT_ALLOWED", "{bad}");
            assert!(e.message.contains("allowed_hosts"));
        }
        // Without a config entry the default list is all there is.
        assert!(check_host(&url("https://themes.example.org/a.json"), &[]).is_err());
    }

    #[test]
    fn security_the_page_cannot_write_allowed_hosts() {
        let change = |key: &str, value: Value| config::LayerChange { key: key.into(), value, default: None };
        let bad = [change("network.allowed_hosts", serde_json::json!(["evil.example"])), change("network", serde_json::json!({"allowed_hosts": ["evil.example"]}))];
        for c in bad {
            assert_eq!(refuse_consent_grants(&[c]).unwrap_err().code, "CONSENT_REQUIRED");
        }
        assert!(refuse_consent_grants(&[change("network.allowed_hosts", Value::Null)]).is_ok(), "clearing is fine");
    }

    #[test]
    fn security_list_addresses_come_from_config_toml_not_overrides() {
        let layer = |kind: &'static str, config: Option<serde_json::Value>| config::LayerInfo {
            id: 0,
            kind,
            name: kind.into(),
            path: String::new(),
            status: "ok",
            error: None,
            config,
            from: None,
        };
        for (section, key) in LIST_ADDRESS_KEYS {
            let mine = serde_json::json!({ section: { key: " https://mine.example/i.json " } });
            let page = serde_json::json!({ section: { key: "https://raw.githubusercontent.com/evil/x/main/i.json" } });
            let layers = vec![layer("config", Some(mine)), layer("overrides", Some(page.clone()))];
            assert_eq!(list_address(&layers, section, key).as_deref(), Some("https://mine.example/i.json"));
            assert_eq!(list_address(&[layer("overrides", Some(page))], section, key), None, "{section}.{key}: overrides never count");
            assert_eq!(list_address(&[layer("config", Some(serde_json::json!({ section: { key: "  " } })))], section, key), None);
            // The page may not write it either (clearing is fine).
            let change = |k: &str, v: Value| config::LayerChange { key: k.into(), value: v, default: None };
            let evil = serde_json::json!("https://raw.githubusercontent.com/evil/x/main/i.json");
            assert_eq!(refuse_consent_grants(&[change(&format!("{section}.{key}"), evil.clone())]).unwrap_err().code, "CONSENT_REQUIRED");
            assert_eq!(refuse_consent_grants(&[change(section, serde_json::json!({ key: evil }))]).unwrap_err().code, "CONSENT_REQUIRED");
            assert!(refuse_consent_grants(&[change(&format!("{section}.{key}"), Value::Null)]).is_ok());
            assert!(refuse_consent_grants(&[change(section, serde_json::json!({"other": 1}))]).is_ok());
        }
    }

    #[test]
    fn security_extra_hosts_come_from_config_toml_not_overrides() {
        let layer = |kind: &'static str, config: Option<serde_json::Value>| config::LayerInfo {
            id: 0,
            kind,
            name: kind.into(),
            path: String::new(),
            status: "ok",
            error: None,
            config,
            from: None,
        };
        let layers = vec![
            layer("config", Some(serde_json::json!({"network": {"allowed_hosts": ["mine.example", 3]}}))),
            layer("overrides", Some(serde_json::json!({"network": {"allowed_hosts": ["page-added.example"]}}))),
        ];
        assert_eq!(hosts_from_config_toml(&layers), vec!["mine.example".to_string()]);
        assert!(hosts_from_config_toml(&[layer("overrides", Some(serde_json::json!({"network": {"allowed_hosts": ["x.example"]}})))]).is_empty());
        assert!(hosts_from_config_toml(&[layer("config", None)]).is_empty());
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

    // ---- security review fixes ----

    #[test]
    fn release_rules_refuse_plain_http_to_loopback() {
        for u in ["http://127.0.0.1:8080/a", "http://localhost/a", "http://[::1]:1/a", "http://127.0.0.2/a"] {
            assert_eq!(parse_url_with(u, false).unwrap_err().code, "INVALID_URL", "{u}");
            assert!(parse_url_with(u, true).is_ok(), "{u} is a test-only exception");
        }
        // https to a local name still refuses in both modes; nothing about it is test-only.
        for u in ["https://127.0.0.1/a", "https://localhost/a", "https://[::1]/a"] {
            for allow in [false, true] {
                assert_eq!(parse_url_with(u, allow).unwrap_err().code, "INVALID_URL", "{u} {allow}");
            }
        }
        assert!(parse_url_with("https://example.com/a", false).is_ok());
        assert!(!ALLOW_LOOPBACK || cfg!(test));
    }

    #[test]
    fn address_table() {
        // (address, blocked)
        let table: &[(&str, bool)] = &[
            // IPv4
            ("93.184.216.34", false), ("8.8.8.8", false), ("1.1.1.1", false), ("198.17.255.255", false), ("198.20.0.1", false),
            ("192.0.1.1", false), ("239.255.255.255", true), ("223.255.255.255", false),
            ("192.0.0.1", true), ("192.0.0.255", true), ("198.18.0.1", true), ("198.19.255.255", true),
            ("240.0.0.1", true), ("255.255.255.254", true), ("255.255.255.255", true),
            ("10.1.2.3", true), ("172.16.0.1", true), ("192.168.0.1", true), ("169.254.169.254", true),
            ("100.64.0.1", true), ("0.1.2.3", true), ("127.0.0.1", true),
            // IPv6 plain
            ("2606:2800:220:1::1", false), ("2001:4860:4860::8888", false),
            ("fd00::1", true), ("fe80::1", true), ("::", true), ("::1", true),
            // site-local fec0::/10
            ("fec0::1", true), ("feff::1", true), ("fe00::1", false),
            // IPv4-compatible ::a.b.c.d
            ("::8.8.8.8", true), ("::192.168.1.1", true), ("::7f00:1", true),
            // IPv4-mapped
            ("::ffff:8.8.8.8", false), ("::ffff:10.0.0.1", true), ("::ffff:127.0.0.1", true), ("::ffff:192.0.0.1", true),
            // NAT64 64:ff9b::/96 judged by the embedded IPv4
            ("64:ff9b::808:808", false), ("64:ff9b::a00:1", true), ("64:ff9b::7f00:1", true),
            ("64:ff9b::a9fe:a9fe", true), ("64:ff9b::c612:1", true), ("64:ff9b::f000:1", true),
            ("64:ff9b:1::1", true),
            // 6to4 2002::/16 judged by the embedded IPv4 (bits 16..48)
            ("2002:808:808::1", false), ("2002:a00:1::1", true), ("2002:7f00:1::1", true),
            ("2002:a9fe:a9fe::1", true), ("2002:c0a8:101::", true),
        ];
        for (text, blocked) in table {
            let ip: IpAddr = text.parse().unwrap();
            assert_eq!(is_blocked_address(ip), *blocked, "{text}");
            let url = format!("https://{}/a", if ip.is_ipv6() { format!("[{text}]") } else { text.to_string() });
            assert_eq!(parse_url_with(&url, false).is_err(), *blocked, "{url}");
        }
    }

    #[test]
    fn resolved_names_in_new_ranges_are_refused() {
        let (base, hits) = start(|_| Resp::ok("secret"));
        let port: u16 = base.rsplit(':').next().unwrap().parse().unwrap();
        let target = url("https://themes.example/a.json");
        for ip in ["64:ff9b::a00:1", "2002:c0a8:101::", "fec0::1", "::192.168.1.1", "192.0.0.8", "198.18.0.5", "240.0.0.9"] {
            let agent = agent_with(Fake(vec![SocketAddr::new(ip.parse().unwrap(), port)]));
            assert_eq!(get_bytes_with(&agent, &target, 100, "*/*").unwrap_err().code, "PRIVATE_ADDRESS", "{ip}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn requests_never_use_a_proxy() {
        // ureq's default reads ALL_PROXY / HTTPS_PROXY; the agent must not.
        std::env::set_var("ALL_PROXY", "http://127.0.0.1:9");
        std::env::set_var("HTTPS_PROXY", "http://127.0.0.1:9");
        let default_has_proxy = ureq::Agent::config_builder().build().proxy().is_some();
        let ours = agent_config();
        std::env::remove_var("ALL_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        assert!(default_has_proxy, "the test environment must make ureq pick up a proxy");
        assert!(ours.proxy().is_none());
    }

    fn change(key: &str, value: Value) -> config::LayerChange {
        config::LayerChange { key: key.into(), value, default: None }
    }

    #[test]
    fn update_config_may_revoke_but_not_grant() {
        for ok in [
            change("network.allow_themes", json!(false)),
            change("network.allow_themes", Value::Null),
            change("network.enabled", json!(false)),
            change("network.enabled", Value::Null),
            change("network", Value::Null),
            change("network", json!({"allow_themes": false, "enabled": false})),
            change("appearance.theme", json!("dark")),
            change("themes.max_install_kb", json!(64)),
        ] {
            assert!(refuse_consent_grants(std::slice::from_ref(&ok)).is_ok(), "{ok:?}");
        }
        for bad in [
            change("network.allow_themes", json!(true)),
            change("network.enabled", json!(true)),
            change("network.allow_catalogue", json!(true)),
            change("network.allow_themes", json!("true")),
            change("network.allow_themes", json!(1)),
            change("network", json!({"allow_themes": true})),
            change("network", json!({"enabled": true})),
        ] {
            let e = refuse_consent_grants(std::slice::from_ref(&bad)).unwrap_err();
            assert_eq!(e.code, "CONSENT_REQUIRED", "{bad:?}");
        }
        // One grant hidden among harmless changes refuses the whole call.
        let mixed = [change("appearance.theme", json!("dark")), change("network.allow_themes", json!(true))];
        assert_eq!(refuse_consent_grants(&mixed).unwrap_err().code, "CONSENT_REQUIRED");
    }

    fn dirs_in(t: &tempfile::TempDir) -> config::Dirs {
        config::Dirs { config: t.path().join("config"), state: t.path().join("state") }
    }

    #[test]
    fn grant_writes_only_after_the_dialog_says_yes() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        let mut seen = None;
        let granted = grant_in(&dirs, "allow_themes", |title, text| {
            seen = Some((title.to_string(), text.to_string()));
            false
        })
        .unwrap();
        assert!(!granted);
        let (title, text) = seen.unwrap();
        assert_eq!(title, "Allow downloading themes?");
        assert!(text.contains("download themes"), "{text}");
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "NETWORK_NOT_ALLOWED");
        let text = fs::read_to_string(dirs.config.join("config.toml")).unwrap_or_default();
        assert!(!text.contains("allow_themes = true"), "{text}");

        assert!(grant_in(&dirs, "allow_themes", |_, _| true).unwrap());
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "");
    }

    #[test]
    fn grant_enabled_turns_the_master_switch_back_on() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        fs::create_dir_all(&dirs.config).unwrap();
        fs::write(dirs.config.join("config.toml"), "[network]\nenabled = false\nallow_themes = true\n").unwrap();
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "NETWORK_DISABLED");
        assert!(!grant_in(&dirs, "enabled", |_, _| false).unwrap());
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "NETWORK_DISABLED");
        assert!(grant_in(&dirs, "enabled", |_, _| true).unwrap());
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "");
    }

    #[test]
    fn grant_several_keys_asks_once_and_writes_all() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        fs::create_dir_all(&dirs.config).unwrap();
        fs::write(dirs.config.join("config.toml"), "[network]\nenabled = false\n").unwrap();
        let mut asked = 0;
        let mut text_seen = String::new();
        let no = grant_all_in(&dirs, &["enabled", "allow_themes"], |_, text| {
            asked += 1;
            text_seen = text.to_string();
            false
        })
        .unwrap();
        assert!(!no);
        assert_eq!(asked, 1);
        assert!(text_seen.contains("internet") && text_seen.contains("themes"), "{text_seen}");
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "NETWORK_DISABLED");
        let yes = grant_all_in(&dirs, &["enabled", "allow_themes", "enabled"], |_, _| {
            asked += 1;
            true
        })
        .unwrap();
        assert!(yes);
        assert_eq!(asked, 2);
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "");
    }

    #[test]
    fn grant_several_keys_rejects_a_bad_one_without_asking() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        let r = grant_all_in(&dirs, &["enabled", "hotkeys"], |_, _| panic!("must not ask"));
        assert_eq!(r.unwrap_err().code, "INVALID_ARGUMENT");
    }

    #[test]
    fn grant_rejects_other_keys_without_asking() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        for key in ["", "allow_", "themes", "appearance.theme", "allow_themes.x", "ALLOW_THEMES", "allow_a b", "hotkeys"] {
            let r = grant_in(&dirs, key, |_, _| panic!("must not ask for {key:?}"));
            assert_eq!(r.unwrap_err().code, "INVALID_ARGUMENT", "{key:?}");
        }
    }

    #[test]
    fn prompts_are_plain_words_per_key() {
        let cases: [(&[&str], &str); 7] = [
            (&["allow_themes"], "Allow downloading themes?"),
            (&["allow_plugins"], "Allow downloading plugins?"),
            (&["allow_plugin_list"], "Allow downloading the plugin list?"),
            (&["allow_font_packs"], "Allow downloading font packs?"),
            (&["enabled"], "Allow internet access?"),
            (&["enabled", "allow_themes"], "Allow internet access to download themes?"),
            (&["allow_themes", "allow_plugins"], "Allow downloading themes and plugins?"),
        ];
        for (keys, want) in cases {
            let (title, text) = grant_prompt(keys);
            assert_eq!(title, want, "{keys:?}");
            for s in [&title, &text] {
                assert!(!s.contains('`') && !s.contains("network.") && !s.contains("allow_") && !s.contains('_'), "{keys:?}: {s}");
            }
            assert!(text.ends_with("in Settings.") || text.ends_with("Settings."), "{text}");
        }
    }

    #[test]
    fn consent_errors_name_no_config_key() {
        for (cfg, purpose) in [(json!({"network": {"enabled": false}}), "themes"), (json!({}), "plugins"), (json!({}), "plugin_list")] {
            let e = check_consent(Some(&cfg), purpose).unwrap_err();
            assert!(!e.message.contains("network.") && !e.message.contains('`') && !e.message.contains('_'), "{}", e.message);
        }
    }

    // --- web pictures (purpose `images`) ---

    const PNG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

    #[test]
    fn a_picture_is_downloaded_and_checked_by_its_bytes() {
        let (base, _) = start(|p| if p == "/a.png" { Resp::ok(PNG) } else { Resp::ok("<html>not a picture</html>") });
        assert_eq!(fetch_image_with(&agent(), &format!("{base}/a.png")).unwrap(), PNG);
        // A web page behind an image-looking address is refused.
        assert_eq!(fetch_image_with(&agent(), &format!("{base}/page.png")).unwrap_err().code, "NOT_AN_IMAGE");
        let (base, _) = start(|_| Resp::ok("<svg xmlns='http://www.w3.org/2000/svg'/>"));
        assert!(fetch_image_with(&agent(), &format!("{base}/x.svg")).is_ok());
    }

    #[test]
    fn private_and_local_addresses_are_never_contacted() {
        for bad in [
            "https://192.168.1.5/a.png",
            "https://10.0.0.1/a.png",
            "https://169.254.169.254/latest/meta-data",
            "https://127.0.0.1/a.png",
            "https://[::1]/a.png",
            "http://10.0.0.1/a.png",
            "https://user:pw@example.com/a.png",
            "ftp://example.com/a.png",
        ] {
            assert_eq!(fetch_image_with(&agent(), bad).unwrap_err().code, "INVALID_URL", "{bad}");
        }
    }

    #[test]
    fn a_redirect_to_a_private_or_local_address_is_refused() {
        for target in ["https://10.0.0.5/x.png", "http://10.0.0.5/x.png", "https://192.168.0.1/x.png", "ftp://example.com/x.png"] {
            let t = target.to_string();
            let (base, hits) = start(move |_| Resp { headers: vec![("Location".into(), t.clone())], ..Resp::status(302) });
            let e = fetch_image_with(&agent(), &format!("{base}/a.png")).unwrap_err();
            assert_eq!(e.code, "REDIRECT_REFUSED", "{target}");
            assert_eq!(hits.load(Ordering::SeqCst), 1);
        }
    }

    #[test]
    fn redirects_between_public_hosts_are_vetted_not_banned() {
        assert_eq!(redirect_target_public(&url("https://a.example/x"), "https://cdn.other.example/y.png").unwrap().host_str(), Some("cdn.other.example"));
        assert_eq!(redirect_target_public(&url("https://a.example/x"), "/y.png").unwrap().host_str(), Some("a.example"));
    }

    #[test]
    fn an_oversize_picture_is_aborted() {
        let (base, _) = start(|_| Resp::ok(vec![0x89; 5000]));
        let e = get_bytes_following(&agent(), &url(&format!("{base}/a.png")), 1000, "image/*", Redirects::PublicHttps).unwrap_err();
        assert_eq!(e.code, "TOO_LARGE");
        assert_eq!(IMAGE_MAX_BYTES, 10 * 1024 * 1024);
    }

    #[test]
    fn pictures_are_on_unless_turned_off_and_the_master_switch_wins() {
        let t = tempfile::tempdir().unwrap();
        let dirs = dirs_in(&t);
        fs::create_dir_all(&dirs.config).unwrap();
        // Nothing set: allowed, no question (owner, 2026-10-29). Other purposes still need a yes.
        assert_eq!(code(ensure_network_allowed(&dirs, "images")), "");
        assert_eq!(code(ensure_network_allowed(&dirs, "themes")), "NETWORK_NOT_ALLOWED");
        fs::write(dirs.config.join("config.toml"), "[network]\nallow_images = false\n").unwrap();
        assert_eq!(fetch_image(&dirs, "https://example.com/a.png").unwrap_err().code, "NETWORK_NOT_ALLOWED");
        fs::write(dirs.config.join("config.toml"), "[network]\nenabled = false\nallow_images = true\n").unwrap();
        assert_eq!(fetch_image(&dirs, "https://example.com/a.png").unwrap_err().code, "NETWORK_DISABLED");
        fs::write(dirs.config.join("config.toml"), "[network]\nenabled = false\n").unwrap();
        assert_eq!(fetch_image(&dirs, "https://example.com/a.png").unwrap_err().code, "NETWORK_DISABLED");
    }

    #[test]
    fn picture_addresses_take_public_http_and_https_only() {
        for ok in ["https://images.example.com/x?purpose=inline", "http://example.com/a"] {
            assert!(parse_public_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://10.0.0.1/a.png",
            "http://192.168.1.2/a.png",
            "http://169.254.169.254/latest",
            "https://[fd00::1]/a.png",
            "http://user:pw@example.com/a.png",
            "ftp://example.com/a.png",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(parse_public_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn picture_bytes_are_recognised() {
        assert!(looks_like_image(PNG));
        assert!(looks_like_image(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(looks_like_image(b"GIF89a"));
        assert!(looks_like_image(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!looks_like_image(b"<!doctype html><html>"));
        assert!(!looks_like_image(b""));
    }
}
