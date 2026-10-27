//! Where Vaultdraw keeps its files (one ladder for the app, the CLI and tests).
//!
//! - config: `$VAULTDRAW_CONFIG_DIR`, else `$XDG_CONFIG_HOME/vaultdraw`, else `~/.config/vaultdraw`
//! - state:  `$VAULTDRAW_STATE_DIR`, else `$XDG_STATE_HOME/vaultdraw`, else `~/.local/state/vaultdraw`
//! - runtime (control socket): `$VAULTDRAW_RUNTIME_DIR`, else `$XDG_RUNTIME_DIR/vaultdraw`,
//!   else `<state>/run` (macOS has no XDG_RUNTIME_DIR). Created 0700.
//!
//! Inside the runtime dir (one app process per user, decision 1): `ctl.sock` (0600),
//! `instance.lock` (flock held while the app lives) and `instance.json` (pid, version, api).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirs {
    pub config: PathBuf,
    pub state: PathBuf,
}

/// Pure resolution: `get` reads an environment variable, `windows` selects the platform
/// table and `smoke_root` (smoke-test builds only) replaces the platform default when the
/// override is unset. Empty variables count as unset; relative XDG values are ignored as the
/// XDG spec requires. The error is a human message (the app maps it to `CONFIG_DIR`).
pub fn resolve_dirs_with(
    get: impl Fn(&str) -> Option<OsString>,
    windows: bool,
    smoke_root: Option<&Path>,
) -> Result<Dirs, String> {
    let var = |name: &str| get(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let abs = |name: &str| var(name).filter(|p| p.is_absolute());
    let resolve = |override_var: &str, smoke_leaf: &str, xdg: &str, xdg_rel: &str, win: &str| -> Result<PathBuf, String> {
        if let Some(p) = var(override_var) {
            if !p.is_absolute() {
                return Err(format!("{override_var} must be an absolute path"));
            }
            return Ok(p);
        }
        if let Some(root) = smoke_root {
            return Ok(root.join(smoke_leaf));
        }
        if windows {
            return abs(win).map(|p| p.join("Vaultdraw")).ok_or_else(|| format!("%{win}% is not set"));
        }
        if let Some(p) = abs(xdg) {
            return Ok(p.join("vaultdraw"));
        }
        abs("HOME")
            .map(|home| home.join(xdg_rel).join("vaultdraw"))
            .ok_or_else(|| "Cannot determine the home directory ($HOME is not set)".to_string())
    };
    Ok(Dirs {
        config: resolve("VAULTDRAW_CONFIG_DIR", "config", "XDG_CONFIG_HOME", ".config", "APPDATA")?,
        state: resolve("VAULTDRAW_STATE_DIR", "state", "XDG_STATE_HOME", ".local/state", "LOCALAPPDATA")?,
    })
}

/// The runtime directory for a resolved state dir.
pub fn runtime_dir_with(get: impl Fn(&str) -> Option<OsString>, state: &Path) -> PathBuf {
    let var = |name: &str| get(name).filter(|v| !v.is_empty()).map(PathBuf::from).filter(|p| p.is_absolute());
    if let Some(p) = var("VAULTDRAW_RUNTIME_DIR") {
        return p;
    }
    // An explicit state dir (tests, perf runs, smoke) isolates the instance too, even on
    // Linux where XDG_RUNTIME_DIR is always set.
    if var("VAULTDRAW_STATE_DIR").is_none() {
        if let Some(p) = var("XDG_RUNTIME_DIR") {
            return p.join("vaultdraw");
        }
    }
    state.join("run")
}

/// Files of the (single) app instance inside a runtime dir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstancePaths {
    pub dir: PathBuf,
    pub socket: PathBuf,
    pub lock: PathBuf,
    pub info: PathBuf,
}

/// `sun_path` is 104 bytes on macOS (108 on Linux), including the terminating NUL.
pub const MAX_SOCKET_PATH: usize = 103;

impl InstancePaths {
    pub fn in_dir(dir: impl Into<PathBuf>) -> Self {
        let dir = dir.into();
        Self { socket: dir.join("ctl.sock"), lock: dir.join("instance.lock"), info: dir.join("instance.json"), dir }
    }

    /// Resolves from the process environment (`smoke_root` as for [`resolve_dirs_with`]).
    pub fn from_env(smoke_root: Option<&Path>) -> Result<Self, String> {
        let get = |k: &str| std::env::var_os(k);
        let dirs = resolve_dirs_with(get, cfg!(windows), smoke_root)?;
        Ok(Self::in_dir(runtime_dir_with(get, &dirs.state)))
    }

    /// Fails when the socket path is too long for `bind`/`connect`.
    pub fn check_socket_len(&self) -> Result<(), String> {
        let n = self.socket.as_os_str().len();
        if n > MAX_SOCKET_PATH {
            return Err(format!(
                "control socket path is {n} bytes, longer than the {MAX_SOCKET_PATH}-byte limit: {} (set VAULTDRAW_RUNTIME_DIR to a shorter directory)",
                self.socket.display()
            ));
        }
        Ok(())
    }
}

/// Creates `dir` (and parents) and makes the leaf 0700. Refuses a symlink or a directory
/// owned by another user (the trust boundary of the socket).
#[cfg(unix)]
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    match std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let meta = std::fs::symlink_metadata(dir)?;
    if !meta.is_dir() {
        return Err(std::io::Error::other(format!("{} is not a directory", dir.display())));
    }
    // SAFETY: getuid has no preconditions.
    if meta.uid() != unsafe { libc::getuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("{} belongs to another user", dir.display()),
        ));
    }
    if meta.mode() & 0o077 != 0 {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let m: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k: &str| m.get(k).map(OsString::from)
    }

    #[test]
    fn runtime_ladder() {
        let s = Path::new("/h/.local/state/vaultdraw");
        assert_eq!(runtime_dir_with(env(&[("VAULTDRAW_RUNTIME_DIR", "/r")]), s), PathBuf::from("/r"));
        assert_eq!(runtime_dir_with(env(&[("XDG_RUNTIME_DIR", "/run/user/1000")]), s), PathBuf::from("/run/user/1000/vaultdraw"));
        assert_eq!(runtime_dir_with(env(&[("XDG_RUNTIME_DIR", "rel")]), s), s.join("run"));
        assert_eq!(runtime_dir_with(env(&[]), s), s.join("run"));
        // An explicit state dir isolates test instances from the user's app.
        assert_eq!(
            runtime_dir_with(env(&[("XDG_RUNTIME_DIR", "/run/user/1000"), ("VAULTDRAW_STATE_DIR", "/t/s")]), Path::new("/t/s")),
            PathBuf::from("/t/s/run")
        );
    }

    #[test]
    fn config_and_state_ladder() {
        let d = resolve_dirs_with(env(&[("HOME", "/h")]), false, None).unwrap();
        assert_eq!(d.config, PathBuf::from("/h/.config/vaultdraw"));
        assert_eq!(d.state, PathBuf::from("/h/.local/state/vaultdraw"));
        let d = resolve_dirs_with(env(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "/x")]), false, None).unwrap();
        assert_eq!(d.config, PathBuf::from("/x/vaultdraw"));
        assert!(resolve_dirs_with(env(&[("VAULTDRAW_STATE_DIR", "rel"), ("HOME", "/h")]), false, None).is_err());
    }

    #[test]
    fn socket_length_is_checked() {
        assert!(InstancePaths::in_dir("/Users/me/.local/state/vaultdraw/run").check_socket_len().is_ok());
        assert!(InstancePaths::in_dir(format!("/{}", "x".repeat(120))).check_socket_len().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn private_dir_is_0700() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join("a/run");
        ensure_private_dir(&d).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755)).unwrap();
        ensure_private_dir(&d).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn private_dir_refuses_a_symlink_and_another_users_dir() {
        let t = tempfile::tempdir().unwrap();
        let real = t.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let link = t.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        // A symlinked runtime dir is never trusted (symlink_metadata is not a directory).
        assert!(ensure_private_dir(&link).is_err());
        // /usr (any root-owned directory) belongs to another user unless the tests run as root.
        if crate::peer::my_uid() != 0 {
            let e = ensure_private_dir(Path::new("/usr")).unwrap_err();
            assert_eq!(e.kind(), std::io::ErrorKind::PermissionDenied);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_socket_at_the_length_limit_binds_on_this_system() {
        // 103 bytes is the portable cap (macOS 104 with the NUL, Linux 108): it must bind everywhere.
        let t = tempfile::tempdir().unwrap();
        let base = t.path().to_str().unwrap().len();
        let leaf = "s".repeat(MAX_SOCKET_PATH - base - 1);
        let p = InstancePaths { socket: t.path().join(&leaf), ..InstancePaths::in_dir(t.path()) };
        assert_eq!(p.socket.as_os_str().len(), MAX_SOCKET_PATH);
        assert!(p.check_socket_len().is_ok());
        let l = std::os::unix::net::UnixListener::bind(&p.socket).unwrap();
        assert!(std::os::unix::net::UnixStream::connect(&p.socket).is_ok());
        drop(l);
    }
}
