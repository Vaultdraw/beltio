//! JSON-RPC 2.0 envelopes. Field order in serialized output is stable (golden tests).

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request ids: numbers or strings (JSON-RPC allows both; null is not used).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Num(i64),
    Str(String),
}

/// Application error vocabulary (`error.data.code`). Matches the app's NativeError codes.
pub mod codes {
    /// The command exists but its `when` clauses fail right now (`data.failed` lists them).
    pub const UNAVAILABLE: &str = "UNAVAILABLE";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const CONFLICT: &str = "CONFLICT";
    pub const READ_ONLY: &str = "READ_ONLY";
    pub const INVALID_PATH: &str = "INVALID_PATH";
    /// The connection's role may not call this method.
    pub const NOT_PERMITTED: &str = "NOT_PERMITTED";
    /// A call into the app's window did not answer in time.
    pub const TIMEOUT: &str = "TIMEOUT";
    /// The app is starting (window not ready yet) or has no window; retry.
    pub const NOT_READY: &str = "NOT_READY";
    /// No vault is open in the app and the method needs one.
    pub const NO_VAULT: &str = "NO_VAULT";
    pub const IO_ERROR: &str = "IO_ERROR";
    /// The drawing cannot be read or rendered (not a drawing, or an empty canvas for an export).
    pub const INVALID_FILE: &str = "INVALID_FILE";
    /// The result is over a size cap (`export.render`: 32 MiB of output; `export.spool` has no cap).
    pub const TOO_LARGE: &str = "TOO_LARGE";
    /// `[control] uri_enabled = false`: links from outside are turned off.
    pub const DISABLED: &str = "DISABLED";
    /// Too many links in a short time (5 per 10 s) or the start-up queue is full.
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    /// None = notification (no reply expected).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Id>,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    pub fn new(id: i64, method: impl Into<String>, params: Option<Value>) -> Self {
        Self { jsonrpc: "2.0".into(), id: Some(Id::Num(id)), method: method.into(), params }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorData {
    /// One of [`codes`].
    pub code: String,
    /// Extra structured detail (`id`, `failed`, `path`, `revision` …), flattened.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<ErrorData>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), data: None }
    }
    /// An application error (`-32000`) with `data.code`.
    pub fn app(data_code: &str, message: impl Into<String>) -> Self {
        Self {
            code: crate::APP_ERROR,
            message: message.into(),
            data: Some(ErrorData { code: data_code.into(), extra: Default::default() }),
        }
    }
    /// Adds a field to `data` (no-op for protocol errors without data).
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        if let Some(d) = self.data.as_mut() {
            d.extra.insert(key.into(), value.into());
        }
        self
    }
    pub fn method_not_found(method: &str) -> Self {
        Self::new(crate::METHOD_NOT_FOUND, format!("Unknown method: {method}"))
    }
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(crate::INVALID_PARAMS, message)
    }
    /// `data.code` when this is an application error.
    pub fn app_code(&self) -> Option<&str> {
        self.data.as_ref().map(|d| d.code.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    /// Null only when the request could not be parsed.
    pub id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn ok(id: Option<Id>, result: Value) -> Self {
        Self { jsonrpc: "2.0".into(), id, result: Some(result), error: None }
    }
    pub fn err(id: Option<Id>, error: RpcError) -> Self {
        Self { jsonrpc: "2.0".into(), id, result: None, error: Some(error) }
    }
    pub fn into_result(self) -> Result<Value, RpcError> {
        match self.error {
            Some(e) => Err(e),
            None => Ok(self.result.unwrap_or(Value::Null)),
        }
    }
}

/// A server-to-client event (no id), e.g. `events.snapshot`, `file.saved`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Notification {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self { jsonrpc: "2.0".into(), method: method.into(), params }
    }
}

/// Anything a client can read from the socket.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Response(Response),
    Notification(Notification),
}

impl Incoming {
    /// A line with `method` and no `id` is a notification; everything else is a response.
    pub fn parse(line: &[u8]) -> serde_json::Result<Self> {
        let v: Value = serde_json::from_slice(line)?;
        if v.get("method").is_some() && v.get("id").map_or(true, Value::is_null) {
            Ok(Self::Notification(serde_json::from_value(v)?))
        } else {
            Ok(Self::Response(serde_json::from_value(v)?))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_golden_shape() {
        let r = Request::new(7, "command.run", Some(json!({"id": "vault.newDrawing"})));
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"jsonrpc":"2.0","id":7,"method":"command.run","params":{"id":"vault.newDrawing"}}"#
        );
        let no_params = Request::new(1, "app.status", None);
        assert_eq!(serde_json::to_string(&no_params).unwrap(), r#"{"jsonrpc":"2.0","id":1,"method":"app.status"}"#);
    }

    #[test]
    fn error_golden_shape() {
        let e = RpcError::app(codes::UNAVAILABLE, "Command is not available now")
            .with("id", "vault.newDrawing")
            .with("failed", json!(["writable"]));
        let r = Response::err(Some(Id::Num(7)), e);
        // Key order inside `data` is not part of the contract (serde_json sorts maps).
        let expected: serde_json::Value = serde_json::from_str(
            r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32000,"message":"Command is not available now","data":{"code":"UNAVAILABLE","id":"vault.newDrawing","failed":["writable"]}}}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&r).unwrap(), expected);
    }

    #[test]
    fn incoming_distinguishes_notifications() {
        let n = Incoming::parse(br#"{"jsonrpc":"2.0","method":"file.saved","params":{"path":"a"}}"#).unwrap();
        assert!(matches!(n, Incoming::Notification(_)));
        let r = Incoming::parse(br#"{"jsonrpc":"2.0","id":"x","result":true}"#).unwrap();
        assert!(matches!(r, Incoming::Response(_)));
    }

    #[test]
    fn string_ids_round_trip() {
        let r: Request = serde_json::from_str(r#"{"jsonrpc":"2.0","id":"a1","method":"m"}"#).unwrap();
        assert_eq!(r.id, Some(Id::Str("a1".into())));
    }
}
