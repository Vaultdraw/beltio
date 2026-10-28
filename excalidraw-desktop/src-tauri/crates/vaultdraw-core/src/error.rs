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
    err(code, plain_io_message(&e))
}

/// What the user reads for a file-system error: plain words, never "(os error 2)" (bug hunt BH-9).
pub fn plain_io_message(e: &std::io::Error) -> String {
    use std::io::ErrorKind as K;
    let words = match e.kind() {
        K::NotFound => "The file or folder isn't there any more",
        K::PermissionDenied => "Permission denied: the file or folder is locked or read-only",
        K::AlreadyExists => "A file or folder with that name already exists",
        K::NotADirectory => "A file is in the way where a folder should be",
        K::IsADirectory => "A folder is in the way where a file should be",
        K::DirectoryNotEmpty => "The folder isn't empty",
        K::ReadOnlyFilesystem => "The disk is read-only",
        K::StorageFull | K::QuotaExceeded => "The disk is full",
        K::FileTooLarge => "The file is too large",
        K::InvalidFilename => "That name isn't allowed here",
        K::CrossesDevices => "It can't be moved to another disk this way",
        K::TimedOut => "The disk took too long to answer",
        K::Interrupted => "The operation was interrupted; try again",
        _ => "",
    };
    if !words.is_empty() {
        return words.to_string();
    }
    // Anything else: the system's sentence without its error number.
    let text = e.to_string();
    let text = match text.rfind(" (os error ") {
        Some(i) if text.ends_with(')') => text[..i].to_string(),
        _ => text,
    };
    let mut c = text.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => "Something went wrong with the file".into(),
    }
}

#[cfg(test)]
mod plain_words_tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn io_errors_read_as_plain_words_without_os_numbers() {
        for code in [1, 2, 5, 13, 17, 20, 21, 28, 30, 36, 39, 63, 66, 69, 122] {
            let m = ioerr(Error::from_raw_os_error(code)).message;
            assert!(!m.contains("os error"), "{code}: {m}");
            assert!(m.chars().next().is_some_and(|c| c.is_uppercase()), "{code}: {m}");
        }
        assert_eq!(ioerr(Error::from(ErrorKind::NotFound)).code, "NOT_FOUND");
        assert_eq!(ioerr(Error::other("weird thing")).message, "Weird thing");
    }
}
