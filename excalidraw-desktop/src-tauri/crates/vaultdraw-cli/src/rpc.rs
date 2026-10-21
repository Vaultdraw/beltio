//! One round trip to the app: connect, call, NOT_READY retry, protocol-mismatch detection.

use crate::error::{Fail, EXIT_NOT_RUNNING, EXIT_PROTOCOL};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use vaultdraw_protocol::client::{CallError, Client};
use vaultdraw_protocol::dirs::InstancePaths;
use vaultdraw_protocol::message::Request;
use vaultdraw_protocol::{codes, methods, API_LEVEL, API_MIN, ENV_SOCKET, METHOD_NOT_FOUND};

const NOT_READY_WINDOW: Duration = Duration::from_secs(2);
const NOT_READY_STEP: Duration = Duration::from_millis(100);

pub struct Rpc {
    socket: PathBuf,
    timeout: Duration,
}

/// `--socket`, else `$VAULTDRAW_SOCKET`, else the instance socket of the environment.
pub fn resolve_socket(flag: Option<&Path>) -> Result<PathBuf, Fail> {
    if let Some(p) = flag {
        return Ok(p.to_path_buf());
    }
    if let Some(p) = std::env::var_os(ENV_SOCKET).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(p));
    }
    InstancePaths::from_env(None).map(|p| p.socket).map_err(Fail::cli)
}

/// The request line `--print-request` shows (same encoding as the wire).
pub fn request_line(method: &str, params: Option<Value>) -> String {
    serde_json::to_string(&Request::new(1, method, params)).unwrap_or_default()
}

impl Rpc {
    pub fn new(socket: PathBuf, timeout_secs: u64) -> Self {
        Self { socket, timeout: Duration::from_secs(timeout_secs.max(1)) }
    }

    pub fn connect(&self) -> Result<Client, Fail> {
        let client = Client::connect(&self.socket)?;
        client.set_timeout(Some(self.timeout))?;
        Ok(client)
    }

    pub fn call(&self, method: &str, params: Option<Value>) -> Result<Value, Fail> {
        let mut client = self.connect()?;
        match self.try_on(&mut client, method, params) {
            Ok(v) => Ok(v),
            Err(e) => {
                drop(client); // the mismatch probe opens its own connection
                Err(self.finish(e))
            }
        }
    }

    /// One call on an open connection (NOT_READY retry, mismatch detection).
    pub fn call_on(&self, client: &mut Client, method: &str, params: Option<Value>) -> Result<Value, Fail> {
        self.try_on(client, method, params).map_err(|e| self.finish(e))
    }

    /// The call with the NOT_READY retry; errors are left raw for [`Self::finish`].
    fn try_on(&self, client: &mut Client, method: &str, params: Option<Value>) -> Result<Value, CallError> {
        let started = Instant::now();
        loop {
            match client.call(method, params.clone()) {
                Err(CallError::Rpc(e)) if e.app_code() == Some(codes::NOT_READY) && started.elapsed() < NOT_READY_WINDOW => {
                    // The window may still be loading: retry briefly.
                    std::thread::sleep(NOT_READY_STEP);
                }
                r => return r,
            }
        }
    }

    fn finish(&self, e: CallError) -> Fail {
        match e {
            CallError::Rpc(e) if e.app_code() == Some(codes::NOT_READY) => Fail::new(EXIT_NOT_RUNNING, e.message, codes::NOT_READY),
            CallError::Rpc(e) if e.code == METHOD_NOT_FOUND => self.check_mismatch().unwrap_or_else(|| CallError::Rpc(e).into()),
            e @ CallError::Io(_) => self.check_mismatch().unwrap_or_else(|| e.into()),
            e => e.into(),
        }
    }

    /// Asks `rpc.discover` on a fresh connection; `Some(fail)` (exit 4) when the app's served
    /// API range does not overlap what this CLI speaks.
    fn check_mismatch(&self) -> Option<Fail> {
        let mut client = Client::connect(&self.socket).ok()?;
        client.set_timeout(Some(Duration::from_secs(2))).ok()?;
        let v = client.call(methods::RPC_DISCOVER, None).ok()?;
        let api = v.get("api")?.as_u64()?;
        let min = v.get("apiMin").and_then(Value::as_u64).unwrap_or(api);
        if api < u64::from(API_MIN) || min > u64::from(API_LEVEL) {
            return Some(Fail::new(
                EXIT_PROTOCOL,
                format!(
                    "the app speaks API level {min}..{api}, this CLI speaks {API_MIN}..{API_LEVEL}: restart Vaultdraw after an update"
                ),
                "PROTOCOL_MISMATCH",
            ));
        }
        None
    }
}
