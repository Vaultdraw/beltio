//! Exit codes and the one error type every handler returns.

use vaultdraw_protocol::client::CallError;
use vaultdraw_protocol::codes;

pub const EXIT_CLI: i32 = 1;
pub const EXIT_REFUSED: i32 = 2;
pub const EXIT_NOT_RUNNING: i32 = 3;
pub const EXIT_PROTOCOL: i32 = 4;

/// A failure with its exit code; printed as `vaultdraw: <message> (<TAG>)`.
#[derive(Debug)]
pub struct Fail {
    pub exit: i32,
    pub message: String,
    pub tag: String,
    /// Extra machine-readable detail (e.g. the lock holder); shown with `--json`.
    pub data: Option<serde_json::Value>,
}

impl Fail {
    pub fn new(exit: i32, message: impl Into<String>, tag: &str) -> Self {
        Self { exit, message: message.into(), tag: tag.to_string(), data: None }
    }

    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }

    /// Local usage or I/O failure (exit 1).
    pub fn cli(message: impl Into<String>) -> Self {
        Self::new(EXIT_CLI, message, "CLI_ERROR")
    }

    pub fn not_running(&self) -> bool {
        self.exit == EXIT_NOT_RUNNING
    }
}

impl std::fmt::Display for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "vaultdraw: {} ({})", self.message, self.tag)
    }
}

impl From<CallError> for Fail {
    fn from(e: CallError) -> Self {
        match e {
            CallError::NotRunning(m) => Self::new(EXIT_NOT_RUNNING, m, "NOT_RUNNING"),
            CallError::Io(m) => Self::new(EXIT_CLI, m, codes::IO_ERROR),
            CallError::Rpc(e) => {
                let tag = e.app_code().map(str::to_string).unwrap_or_else(|| e.code.to_string());
                Self { exit: EXIT_REFUSED, message: e.message, tag, data: None }
            }
        }
    }
}
