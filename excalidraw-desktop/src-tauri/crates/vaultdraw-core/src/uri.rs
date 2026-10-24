//! The `vaultdraw://` URI parser: pure, strict, no I/O. Every entry point (OS link, forwarded
//! launch, `vaultdraw uri`) parses with this one function; the window never sees a raw URL.
//! Shared golden cases: `uri/fixtures/uri.json` (asserted here and by the TypeScript test of
//! `decodeVaultUrl`, so the in-drawing link and the OS link cannot drift).
//!
//! Grammar: `vaultdraw://<action>[?key=value&...]`, scheme and action case-insensitive, values
//! percent-encoded UTF-8 (`+` is a plus). Unknown keys are ignored; a repeated key: first wins.

use serde::Serialize;
use std::fmt;

/// Whole URL, in bytes.
pub const MAX_URL_BYTES: usize = 8192;
/// A vault-relative drawing path, in characters.
pub const MAX_PATH_CHARS: usize = 1024;
pub const MAX_QUERY_CHARS: usize = 512;
pub const MAX_ID_CHARS: usize = 128;
pub const MAX_VAULT_CHARS: usize = 255;

/// What a link asks for. Serialized (camelCase fields) as the plan the window runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum UriRequest {
    /// Bring the window to the front.
    Focus,
    /// Open a drawing, or switch to a vault (no `file`).
    #[serde(rename_all = "camelCase")]
    Open {
        #[serde(skip_serializing_if = "Option::is_none")]
        vault: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        file: Option<String>,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        new_tab: bool,
    },
    /// Open the vault search with the text filled in.
    Search {
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        vault: Option<String>,
    },
    /// Create a drawing and open it (never overwrites).
    New {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        vault: Option<String>,
    },
    /// Run one palette command by id.
    Cmd { id: String },
}

impl UriRequest {
    /// The action name as written in the URL (and in `control.uri_allow` for `new`).
    pub fn action_name(&self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Open { .. } => "open",
            Self::Search { .. } => "search",
            Self::New { .. } => "new",
            Self::Cmd { .. } => "cmd",
        }
    }
}

/// Why a URL was refused. `code()` is the stable name the golden fixtures use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UriError {
    TooLong,
    NotAVaultdrawUrl,
    UnknownAction(String),
    /// A required parameter is absent.
    Missing(&'static str),
    /// A parameter is present but unacceptable (`reason` is plain words for the toast).
    Invalid { param: &'static str, reason: &'static str },
}

impl UriError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooLong => "too_long",
            Self::NotAVaultdrawUrl => "scheme",
            Self::UnknownAction(_) => "unknown_action",
            Self::Missing(_) => "missing",
            Self::Invalid { .. } => "invalid",
        }
    }
}

impl fmt::Display for UriError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => write!(f, "The link is too long"),
            Self::NotAVaultdrawUrl => write!(f, "Not a vaultdraw:// link"),
            // The action is attacker text: shown truncated and with control characters removed.
            Self::UnknownAction(a) => write!(f, "Unknown link action \"{}\"", printable(a, 40)),
            Self::Missing(p) => write!(f, "The link needs a {p}"),
            Self::Invalid { param, reason } => write!(f, "The link's {param} {reason}"),
        }
    }
}

impl std::error::Error for UriError {}

/// `s` without control characters, at most `max` characters (plus an ellipsis when cut).
pub fn printable(s: &str, max: usize) -> String {
    let clean: String = s.chars().filter(|c| !c.is_control() && !is_bidi(*c)).collect();
    if clean.chars().count() > max {
        let cut: String = clean.chars().take(max).collect();
        format!("{cut}…")
    } else {
        clean
    }
}

/// Bidirectional controls: they can make a name read as another one.
fn is_bidi(c: char) -> bool {
    matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Parses one URL. Pure: the same text always gives the same result.
pub fn parse(url: &str) -> Result<UriRequest, UriError> {
    if url.len() > MAX_URL_BYTES {
        return Err(UriError::TooLong);
    }
    let rest = strip_scheme(url).ok_or(UriError::NotAVaultdrawUrl)?;
    let rest = rest.split('#').next().unwrap_or("");
    let (head, query) = match rest.split_once('?') {
        Some((h, q)) => (h, q),
        None => (rest, ""),
    };
    // `vaultdraw://open` or `vaultdraw://open/`; any further path is refused.
    let action = head.strip_suffix('/').unwrap_or(head);
    if action.contains('/') {
        return Err(UriError::Invalid { param: "address", reason: "has an unexpected path" });
    }
    let q = Query(query);
    match action.to_ascii_lowercase().as_str() {
        "" | "focus" => Ok(UriRequest::Focus),
        "open" => {
            let vault = q.vault()?;
            let file = q.first_of(&["file", "path"], "file")?.map(|v| rel_path(&v, "file")).transpose()?;
            if vault.is_none() && file.is_none() {
                return Err(UriError::Missing("file or vault"));
            }
            let new_tab = matches!(q.get("newTab")?.as_deref(), Some("1" | "true"));
            Ok(UriRequest::Open { vault, file, new_tab })
        }
        "search" => {
            let query = q.get("query")?.ok_or(UriError::Missing("query"))?;
            text(&query, "query", MAX_QUERY_CHARS)?;
            Ok(UriRequest::Search { query, vault: q.vault()? })
        }
        "new" => {
            let path = q.first_of(&["path", "file"], "path")?.ok_or(UriError::Missing("path"))?;
            Ok(UriRequest::New { path: rel_path(&path, "path")?, vault: q.vault()? })
        }
        "cmd" => {
            let id = q.get("id")?.ok_or(UriError::Missing("id"))?;
            command_id(&id)?;
            Ok(UriRequest::Cmd { id })
        }
        other => Err(UriError::UnknownAction(other.to_string())),
    }
}

fn strip_scheme(url: &str) -> Option<&str> {
    let (scheme, rest) = url.split_once(':')?;
    if !scheme.eq_ignore_ascii_case("vaultdraw") {
        return None;
    }
    rest.strip_prefix("//")
}

struct Query<'a>(&'a str);

impl Query<'_> {
    /// First pair whose raw key is `key`, decoded. `Ok(None)` when absent.
    fn get(&self, key: &'static str) -> Result<Option<String>, UriError> {
        self.first_of(&[key], key)
    }

    /// First pair (in URL order) whose key is one of `keys`.
    fn first_of(&self, keys: &[&str], param: &'static str) -> Result<Option<String>, UriError> {
        for pair in self.0.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            if keys.contains(&k) && pair.contains('=') {
                return decode(v).map(Some).ok_or(UriError::Invalid { param, reason: "is not valid percent-encoded text" });
            }
        }
        Ok(None)
    }

    fn vault(&self) -> Result<Option<String>, UriError> {
        let Some(v) = self.get("vault")? else { return Ok(None) };
        text(&v, "vault", MAX_VAULT_CHARS)?;
        // A name, never a path.
        if v.contains(['/', '\\']) || v == "." || v == ".." {
            return Err(UriError::Invalid { param: "vault", reason: "must be a vault name, not a path" });
        }
        Ok(Some(v))
    }
}

/// Percent-decoding to UTF-8; `+` stays a plus. `None` on a bad escape or invalid UTF-8.
fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = b.get(i + 1..i + 3)?;
            let h = u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
            out.push(h);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Non-empty, within `max` characters, no control or bidirectional characters.
fn text(v: &str, param: &'static str, max: usize) -> Result<(), UriError> {
    if v.is_empty() {
        return Err(UriError::Invalid { param, reason: "is empty" });
    }
    if v.chars().count() > max {
        return Err(UriError::Invalid { param, reason: "is too long" });
    }
    if v.chars().any(|c| c.is_control() || is_bidi(c)) {
        return Err(UriError::Invalid { param, reason: "contains control characters" });
    }
    Ok(())
}

/// A vault-relative path: no absolute form, no drive letter, no `.`/`..`/empty segment, no backslash.
fn rel_path(v: &str, param: &'static str) -> Result<String, UriError> {
    text(v, param, MAX_PATH_CHARS)?;
    let bytes = v.as_bytes();
    if v.starts_with(['/', '\\']) || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':') {
        return Err(UriError::Invalid { param, reason: "must be relative to the vault" });
    }
    if v.contains('\\') {
        return Err(UriError::Invalid { param, reason: "must use / between folders" });
    }
    if v.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return Err(UriError::Invalid { param, reason: "must stay inside the vault" });
    }
    Ok(v.to_string())
}

/// Palette command ids (and prefix commands like `drawing.open:<path>`): `[A-Za-z0-9._:/-]`.
fn command_id(v: &str) -> Result<(), UriError> {
    if v.is_empty() {
        return Err(UriError::Invalid { param: "id", reason: "is empty" });
    }
    if v.chars().count() > MAX_ID_CHARS {
        return Err(UriError::Invalid { param: "id", reason: "is too long" });
    }
    if !v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-')) {
        return Err(UriError::Invalid { param: "id", reason: "has characters a command id cannot have" });
    }
    Ok(())
}

#[cfg(test)]
mod tests;
