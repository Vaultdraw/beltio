//! Error type shared by every vault operation: a stable `code` plus a human message.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct NativeError {
    pub code: String,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, NativeError>;

#[inline]
pub fn err(code: &str, message: impl Into<String>) -> NativeError {
    NativeError {
        code: code.into(),
        message: message.into(),
    }
}
#[inline]
pub fn ioerr(e: std::io::Error) -> NativeError {
    let code = match e.kind() {
        std::io::ErrorKind::NotFound => "NOT_FOUND",
        std::io::ErrorKind::PermissionDenied => "READ_ONLY",
        std::io::ErrorKind::AlreadyExists => "NAME_COLLISION",
        _ => "IO_ERROR",
    };
    err(code, e.to_string())
}
