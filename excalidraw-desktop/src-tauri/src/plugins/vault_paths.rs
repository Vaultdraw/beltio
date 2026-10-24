//! The path rules for plugin calls (`vault.list`, `file.read`, `file.write`), run before the
//! control API's own checks. Plugins see a smaller vault than the core does: no dot folders
//! (`.git`, `.obsidian`), only `.excalidraw` files, short paths. The core's `validate_relative`
//! and `safe_path` then run unchanged inside the control calls (symlinks, escapes, reserved names).
use vaultdraw_core::validate_relative;
use vaultdraw_protocol::RpcError;

/// Longest path a plugin may pass (the core allows 4096).
pub(crate) const MAX_PLUGIN_PATH: usize = 1024;
const DRAWING_SUFFIX: &str = ".excalidraw";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A drawing: must end in `.excalidraw`.
    File,
    /// A folder to list; empty is the vault root.
    Folder,
}

fn invalid(message: &str) -> RpcError {
    RpcError::app("INVALID_PATH", message)
}

/// Checks `path` for a plugin call. `Ok` means the string is acceptable; whether the entry exists,
/// is a symlink or leaves the vault is decided by the core call that follows.
pub(crate) fn check_plugin_path(path: &str, kind: Kind) -> Result<(), RpcError> {
    if path.is_empty() {
        return if kind == Kind::Folder { Ok(()) } else { Err(invalid("A drawing path is required")) };
    }
    if path.len() > MAX_PLUGIN_PATH {
        return Err(invalid("Path is longer than 1024 bytes"));
    }
    if has_dot_segment(path) {
        return Err(invalid("Plugins cannot use paths with a segment that starts with a dot"));
    }
    if kind == Kind::File && !path.to_ascii_lowercase().ends_with(DRAWING_SUFFIX) {
        return Err(invalid("Drawing paths must end in .excalidraw"));
    }
    validate_relative(path).map_err(|e| RpcError::app(&e.code, e.message))?;
    Ok(())
}

/// True when any segment of `path` starts with a dot (such entries are hidden from plugins).
pub(crate) fn has_dot_segment(path: &str) -> bool {
    path.split('/').any(|s| s.starts_with('.'))
}
