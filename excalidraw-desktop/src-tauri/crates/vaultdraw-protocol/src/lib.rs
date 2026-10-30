//! Vaultdraw control API: the contract shared by the app's control server, the `vaultdraw`
//! CLI and tests (personal/feature/control-api).
//!
//! - Transport: one Unix domain socket per user (`<runtime>/ctl.sock`; a named pipe derived from
//!   that path on Windows, see [`transport`]), newline-delimited
//!   JSON-RPC 2.0 in both directions. Replies carry the request id; notifications (events)
//!   have no id and may arrive between replies.
//! - Versioning: [`API_LEVEL`] is an integer. Within a level, changes are additive only
//!   (new methods, new optional params, new result fields); clients ignore unknown fields.
//!   `tests/fixtures/api-v1.json` is the golden `rpc.discover` method list.
//! - Errors: JSON-RPC codes for protocol faults, [`APP_ERROR`] with `data.code` from
//!   [`codes`] for everything the app (or the headless core) refuses.

pub mod client;
pub mod dirs;
pub mod events;
pub mod frame;
pub mod message;
pub mod methods;
pub mod peer;
pub mod transport;

pub use client::{CallError, Client};
pub use message::{codes, ErrorData, Id, Notification, Request, Response, RpcError};

/// Current API level. Bump only for a breaking change (and keep serving the old level).
pub const API_LEVEL: u32 = 1;
/// Lowest API level this build still serves / understands.
pub const API_MIN: u32 = 1;

/// Largest frame (one JSON line) either side accepts: 2.5 times the largest drawing (32 MiB), so a
/// drawing sent as a JSON string still fits after escaping (each `"` becomes `\"`, so 2 times at
/// worst for real drawings) plus the envelope.
pub const MAX_FRAME_BYTES: usize = 80 * 1024 * 1024;

/// JSON-RPC 2.0 error codes.
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;
/// The single application error code; `data.code` says what went wrong.
pub const APP_ERROR: i64 = -32000;

/// Environment variable the app sets for processes it starts (and the CLI honours first).
pub const ENV_SOCKET: &str = "VAULTDRAW_SOCKET";
