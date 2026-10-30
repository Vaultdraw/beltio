//! `vdplugin://localhost/<id>/<path>` (Windows: `http://vdplugin.localhost/<id>/<path>`).
//! Serves only allow-listed files that canonicalize inside a known plugin folder; never `plugin.toml`.
use super::{manifest::is_valid_id, scan::Index};
use std::{borrow::Cow, fs, path::Path};

pub(crate) const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
type Response = tauri::http::Response<Cow<'static, [u8]>>;

const MIME: &[(&str, &str)] = &[
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json"),
    ("map", "application/json"),
    ("png", "image/png"),
    ("svg", "image/svg+xml"),
    ("woff2", "font/woff2"),
    ("wasm", "application/wasm"),
];

const APP_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "vdplugin://localhost",
    "http://vdplugin.localhost",
    #[cfg(debug_assertions)]
    "http://localhost:1420",
];

pub(crate) fn mime_for(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit_once('.')?.1.to_ascii_lowercase();
    MIME.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Splits a URL path into `(id, relative path)`; decodes once and rejects anything unsafe.
fn parse_path(uri_path: &str) -> Option<(String, String)> {
    let decoded = percent_decode(uri_path.strip_prefix('/')?)?;
    if decoded.contains(['%', '\\', '\0', ':']) {
        return None;
    }
    let (id, rel) = decoded.split_once('/')?;
    (is_valid_id(id) && super::manifest::is_safe_rel_path(rel)).then(|| (id.to_string(), rel.to_string()))
}

pub(crate) struct Resolved {
    pub path: std::path::PathBuf,
    pub mime: &'static str,
}

/// Maps a URL path to a servable file, or the HTTP status to answer with.
pub(crate) fn resolve(index: &Index, uri_path: &str) -> Result<Resolved, u16> {
    let (id, rel) = parse_path(uri_path).ok_or(400u16)?;
    let entry = index.get(&id).ok_or(404u16)?;
    let name = rel.rsplit('/').next().unwrap_or(&rel);
    let mime = mime_for(name).ok_or(403u16)?;
    let joined = entry.dir.join(&rel);
    let meta = fs::symlink_metadata(&joined).map_err(|_| 404u16)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(403);
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(413);
    }
    let canonical = dunce::canonicalize(joined).map_err(|_| 404u16)?;
    if !canonical.starts_with(&entry.canonical) {
        return Err(403);
    }
    Ok(Resolved { path: canonical, mime })
}

fn base(status: u16, origin: Option<&str>) -> tauri::http::response::Builder {
    let mut b = tauri::http::Response::builder()
        .status(status)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-cache");
    if let Some(o) = origin.filter(|o| APP_ORIGINS.contains(o)) {
        b = b.header("Access-Control-Allow-Origin", o).header("Vary", "Origin");
    }
    b
}

fn empty(status: u16, origin: Option<&str>) -> Response {
    base(status, origin).body(Cow::Borrowed(&[][..])).expect("static response parts are valid")
}

/// Answers one request.
pub(crate) fn respond(method: &str, origin: Option<&str>, uri_path: &str, index: &Index) -> Response {
    match method {
        "OPTIONS" => base(204, origin)
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "*")
            .header("Access-Control-Max-Age", "600")
            .body(Cow::Borrowed(&[][..]))
            .expect("static response parts are valid"),
        "GET" => match resolve(index, uri_path) {
            Ok(r) => match read_capped(&r.path) {
                Some(bytes) => base(200, origin)
                    .header("Content-Type", r.mime)
                    .body(Cow::Owned(bytes))
                    .expect("static response parts are valid"),
                None => empty(404, origin),
            },
            Err(status) => empty(status, origin),
        },
        _ => empty(405, origin),
    }
}

fn read_capped(path: &Path) -> Option<Vec<u8>> {
    crate::read_bounded(path, MAX_FILE_BYTES).ok()
}

/// Register the `vdplugin` scheme; file I/O (and a first scan, if needed) runs off the main thread.
pub(crate) fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("vdplugin", |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        let method = request.method().as_str().to_string();
        let origin = request.headers().get("origin").and_then(|v| v.to_str().ok()).map(str::to_string);
        let uri_path = request.uri().path().to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let index: std::sync::Arc<Index> = if method == "GET" { super::index_snapshot(&app) } else { Default::default() };
            responder.respond(respond(&method, origin.as_deref(), &uri_path, &index));
        });
    })
}
