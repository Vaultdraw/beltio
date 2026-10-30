//! Blocking client over the control socket (used by the CLI and tests).

use crate::frame::{read_frame, write_frame, FrameError};
use crate::message::{Id, Incoming, Notification, Request, RpcError};
use serde_json::Value;
use std::io::BufReader;
use crate::transport::{self, Stream};
use std::path::Path;
use std::time::Duration;

#[derive(Debug)]
pub enum CallError {
    /// No app is listening (socket or pipe missing, or connection refused).
    NotRunning(String),
    /// Transport failure after connecting, or an unparsable reply.
    Io(String),
    /// The server answered with an error.
    Rpc(RpcError),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRunning(m) | Self::Io(m) => f.write_str(m),
            Self::Rpc(e) => match e.app_code() {
                Some(c) => write!(f, "{} ({c})", e.message),
                None => write!(f, "{} ({})", e.message, e.code),
            },
        }
    }
}

pub struct Client {
    writer: Stream,
    reader: BufReader<Stream>,
    next_id: i64,
    /// Notifications that arrived while waiting for a reply.
    pending: std::collections::VecDeque<Notification>,
}

impl Client {
    /// Connects; `NotRunning` when nothing listens at `path`.
    pub fn connect(path: &Path) -> Result<Self, CallError> {
        crate::dirs::check_socket_path_len(path).map_err(CallError::Io)?;
        let stream = transport::connect(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
                CallError::NotRunning(format!("Vaultdraw is not running (no control socket at {})", path.display()))
            }
            _ => CallError::Io(format!("cannot connect to {}: {e}", path.display())),
        })?;
        let reader = BufReader::new(stream.try_clone().map_err(|e| CallError::Io(e.to_string()))?);
        Ok(Self { writer: stream, reader, next_id: 1, pending: Default::default() })
    }

    /// Read timeout for replies (None = wait forever, e.g. event streams).
    pub fn set_timeout(&self, t: Option<Duration>) -> Result<(), CallError> {
        self.writer.set_read_timeout(t).map_err(|e| CallError::Io(e.to_string()))
    }

    /// Sends a request and waits for its reply; notifications in between are queued.
    pub fn call(&mut self, method: &str, params: Option<Value>) -> Result<Value, CallError> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&Request::new(id, method, params))?;
        loop {
            match self.read()? {
                Some(Incoming::Response(r)) if r.id == Some(Id::Num(id)) => {
                    return r.into_result().map_err(CallError::Rpc);
                }
                Some(Incoming::Response(r)) if r.id.is_none() => {
                    return Err(r.into_result().map_err(CallError::Rpc).err().unwrap_or(CallError::Io("bad reply".into())));
                }
                Some(Incoming::Response(_)) => continue,
                Some(Incoming::Notification(n)) => self.pending.push_back(n),
                None => return Err(CallError::Io("the app closed the connection".into())),
            }
        }
    }

    /// Sends any serializable request as one frame (`vaultdraw raw`).
    pub fn send(&mut self, value: &impl serde::Serialize) -> Result<(), CallError> {
        write_frame(&mut self.writer, value).map_err(|e| CallError::Io(e.to_string()))
    }

    /// Next notification (queued first, then from the socket). `None` at EOF.
    pub fn next_notification(&mut self) -> Result<Option<Notification>, CallError> {
        if let Some(n) = self.pending.pop_front() {
            return Ok(Some(n));
        }
        loop {
            match self.read()? {
                Some(Incoming::Notification(n)) => return Ok(Some(n)),
                Some(Incoming::Response(_)) => continue,
                None => return Ok(None),
            }
        }
    }

    /// Next raw line from the socket (`vaultdraw raw`). `None` at EOF.
    pub fn read_line(&mut self) -> Result<Option<Vec<u8>>, CallError> {
        read_frame(&mut self.reader, crate::MAX_FRAME_BYTES).map_err(frame_err)
    }

    fn read(&mut self) -> Result<Option<Incoming>, CallError> {
        match self.read_line()? {
            None => Ok(None),
            Some(line) => Incoming::parse(&line).map(Some).map_err(|e| CallError::Io(format!("invalid reply from the app: {e}"))),
        }
    }
}

fn frame_err(e: FrameError) -> CallError {
    match e {
        FrameError::Io(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
            CallError::Rpc(RpcError::app(crate::codes::TIMEOUT, "The app did not answer in time"))
        }
        e => CallError::Io(e.to_string()),
    }
}

#[cfg(test)]
#[cfg(unix)]
mod socket_path_tests {
    use super::*;

    /// Hunter C-3: a long state folder gave the OS's raw "path must be shorter than SUN_LEN".
    #[test]
    fn a_too_long_socket_path_reads_as_plain_words() {
        let p = std::path::PathBuf::from(format!("/tmp/{}/ctl.sock", "x".repeat(120)));
        let Err(CallError::Io(m)) = Client::connect(&p) else { panic!("expected an IO error") };
        assert!(m.contains("too long") && m.contains("VAULTDRAW_RUNTIME_DIR"), "{m}");
        assert!(!m.contains("SUN_LEN"), "{m}");
    }
}
