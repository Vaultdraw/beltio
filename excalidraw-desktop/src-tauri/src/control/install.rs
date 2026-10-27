//! "Install the `vaultdraw` command": a symlink to the CLI binary shipped next to the app (a copy from an AppImage).

use std::path::{Path, PathBuf};

const SYSTEM_TARGET: &str = "/usr/local/bin/vaultdraw";

/// How the command is put in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    /// A symlink to the CLI next to the app (macOS bundle, `.deb`, any fixed install).
    Link,
    /// A copy of the CLI. An AppImage runs from a mount point that changes on every launch, so a
    /// symlink into it would be dead after the app quits.
    Copy,
}

/// The decision: copy when the app runs from an AppImage (`$APPIMAGE` names the file), else link.
pub(crate) fn link_or_copy(appimage: Option<&Path>) -> Mode {
    match appimage {
        Some(p) if !p.as_os_str().is_empty() => Mode::Copy,
        _ => Mode::Link,
    }
}

/// What `install_cli_report` did.
pub(crate) struct Installed {
    pub path: PathBuf,
    pub mode: Mode,
}

impl Installed {
    /// A line for the user; says so when the command is a copy (it will not follow app updates).
    pub fn message(&self) -> String {
        match self.mode {
            Mode::Link => format!("Installed 'vaultdraw' command at {}", self.path.display()),
            Mode::Copy => format!(
                "Installed 'vaultdraw' command at {} as a copy (the AppImage mounts somewhere new on every start); run Install again after updating the app",
                self.path.display()
            ),
        }
    }
}

/// Installs the bundled CLI into `~/.local/bin` (or `/usr/local/bin` when `system`).
pub(crate) fn install_cli_report(system: bool) -> crate::Result<Installed> {
    let exe = std::env::current_exe().map_err(crate::ioerr)?;
    let src = exe.parent().map(|d| d.join("vaultdraw")).ok_or_else(|| crate::err("NOT_FOUND", "Cannot locate the app directory"))?;
    let target = if system {
        PathBuf::from(SYSTEM_TARGET)
    } else {
        let home = std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute());
        home.ok_or_else(|| crate::err("INVALID_PATH", "$HOME is not set"))?.join(".local/bin/vaultdraw")
    };
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    let mode = link_or_copy(appimage.as_deref());
    install_with(&src, &target, mode)?;
    Ok(Installed { path: target, mode })
}

pub(crate) fn install_with(src: &Path, target: &Path, mode: Mode) -> crate::Result<()> {
    if !src.exists() {
        return Err(crate::err(
            "NOT_FOUND",
            format!("The vaultdraw command line tool is not part of this build (expected {}); it ships in the packaged app", src.display()),
        ));
    }
    let done = match mode {
        Mode::Link => link(src, target),
        Mode::Copy => copy(src, target),
    };
    done.map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            let cmd = if mode == Mode::Copy { "cp" } else { "ln -sf" };
            crate::err(
                "READ_ONLY",
                format!("No permission to write {}. Run in a terminal: sudo {cmd} '{}' {}", target.display(), src.display(), target.display()),
            )
        } else if e.kind() == std::io::ErrorKind::AlreadyExists {
            crate::err("CONFLICT", format!("{} already exists and is not ours; remove it first", target.display()))
        } else {
            crate::ioerr(e)
        }
    })
}

#[cfg(test)]
pub(crate) fn install_link(src: &Path, target: &Path) -> crate::Result<()> {
    install_with(src, target, Mode::Link)
}

#[cfg(unix)]
fn link(src: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    match std::fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => std::fs::remove_file(target)?,
        Ok(_) => return Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    std::os::unix::fs::symlink(src, target)
}

/// Copies `src` to `target` (0755) through a temp file and an atomic rename, so a running
/// `vaultdraw` is never half-written. A symlink or an earlier binary copy is replaced; any other
/// regular file (a script of the user's) is not.
#[cfg(unix)]
fn copy(src: &Path, target: &Path) -> std::io::Result<()> {
    use std::io::Read;
    use std::os::unix::fs::PermissionsExt;
    let dir = target.parent().ok_or_else(|| std::io::Error::other("no parent directory"))?;
    std::fs::create_dir_all(dir)?;
    match std::fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => {}
        Ok(m) if m.is_file() => {
            let mut magic = [0u8; 4];
            let is_elf = std::fs::File::open(target).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && &magic == b"\x7fELF";
            if !is_elf {
                return Err(std::io::ErrorKind::AlreadyExists.into());
            }
        }
        Ok(_) => return Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let tmp = dir.join(format!(".vaultdraw.tmp.{}", std::process::id()));
    let result = (|| {
        std::fs::copy(src, &tmp)?;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        std::fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(not(unix))]
fn copy(_src: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("installing the command is only supported on macOS and Linux"))
}

#[cfg(not(unix))]
fn link(_src: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("installing the command is only supported on macOS and Linux"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn creates_replaces_and_refuses_regular_files() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("vaultdraw");
        std::fs::write(&src, "bin").unwrap();
        let target = t.path().join("bin/vaultdraw");
        install_link(&src, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), src);
        // An old symlink (e.g. to a moved app) is replaced.
        let other = t.path().join("other");
        std::fs::write(&other, "x").unwrap();
        std::fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink(&other, &target).unwrap();
        install_link(&src, &target).unwrap();
        assert_eq!(std::fs::read_link(&target).unwrap(), src);
        // A regular file is never overwritten.
        std::fs::remove_file(&target).unwrap();
        std::fs::write(&target, "mine").unwrap();
        assert_eq!(install_link(&src, &target).unwrap_err().code, "CONFLICT");
        assert_eq!(std::fs::read(&target).unwrap(), b"mine");
    }

    #[test]
    fn missing_source_is_not_found() {
        let t = tempfile::tempdir().unwrap();
        let e = install_link(&t.path().join("nope"), &t.path().join("l")).unwrap_err();
        assert_eq!(e.code, "NOT_FOUND");
    }

    #[test]
    fn permission_denied_gives_the_sudo_command() {
        if vaultdraw_protocol::peer::my_uid() == 0 {
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("vaultdraw");
        std::fs::write(&src, "bin").unwrap();
        let dir = t.path().join("ro");
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
        let e = install_link(&src, &dir.join("vaultdraw")).unwrap_err();
        assert_eq!(e.code, "READ_ONLY");
        assert!(e.message.contains("sudo ln -sf '"), "{}", e.message);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn appimage_copies_everything_else_links() {
        assert_eq!(link_or_copy(None), Mode::Link);
        assert_eq!(link_or_copy(Some(Path::new(""))), Mode::Link);
        assert_eq!(link_or_copy(Some(Path::new("/home/me/Vaultdraw.AppImage"))), Mode::Copy);
    }

    fn fake_elf(path: &Path, tail: &str) {
        let mut b = b"\x7fELF".to_vec();
        b.extend_from_slice(tail.as_bytes());
        std::fs::write(path, b).unwrap();
    }

    #[test]
    fn copy_is_executable_atomic_and_replaces_symlink_or_old_binary() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("mount/vaultdraw");
        std::fs::create_dir_all(src.parent().unwrap()).unwrap();
        fake_elf(&src, "v2");
        let target = t.path().join("home/.local/bin/vaultdraw");
        install_with(&src, &target, Mode::Copy).unwrap();
        assert!(!target.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(std::fs::read(&target).unwrap(), std::fs::read(&src).unwrap());
        // An old binary copy (an earlier app version) is replaced; no temp file is left behind.
        fake_elf(&src, "v3");
        install_with(&src, &target, Mode::Copy).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), std::fs::read(&src).unwrap());
        let names: Vec<_> = std::fs::read_dir(target.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("vaultdraw")]);
        // A dead symlink left by a previous mode is replaced by the copy itself, not followed.
        std::fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink("/tmp/.mount_gone/usr/bin/vaultdraw", &target).unwrap();
        install_with(&src, &target, Mode::Copy).unwrap();
        assert!(target.symlink_metadata().unwrap().file_type().is_file());
    }

    #[test]
    fn copy_never_overwrites_a_users_script() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("vaultdraw");
        fake_elf(&src, "x");
        let target = t.path().join("bin/vaultdraw");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
        assert_eq!(install_with(&src, &target, Mode::Copy).unwrap_err().code, "CONFLICT");
        assert_eq!(std::fs::read(&target).unwrap(), b"#!/bin/sh\necho mine\n");
    }

    #[test]
    fn message_says_when_it_is_a_copy() {
        let copy = Installed { path: "/h/.local/bin/vaultdraw".into(), mode: Mode::Copy };
        assert!(copy.message().contains("as a copy"));
        let link = Installed { path: "/h/.local/bin/vaultdraw".into(), mode: Mode::Link };
        assert!(!link.message().contains("copy"));
    }
}
