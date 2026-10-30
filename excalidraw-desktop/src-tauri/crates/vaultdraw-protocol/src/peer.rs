//! Peer credentials of a Unix socket connection (the server refuses other users).

/// The effective user id of the process on the other end of `fd`.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd"))]
pub fn peer_uid(fd: std::os::fd::RawFd) -> std::io::Result<u32> {
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    // SAFETY: fd is a socket owned by the caller; uid/gid are valid out-pointers.
    if unsafe { libc::getpeereid(fd, &mut uid, &mut gid) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(uid)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn peer_uid(fd: std::os::fd::RawFd) -> std::io::Result<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: cred/len are valid out-pointers of the right size.
    let rc = unsafe {
        libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut libc::c_void, &mut len)
    };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(cred.uid)
}

/// This process's real user id.
#[cfg(unix)]
pub fn my_uid() -> u32 {
    // SAFETY: getuid has no preconditions.
    unsafe { libc::getuid() }
}

/// The other end's user id for a transport stream. Windows has no uid: the pipe's default
/// permissions already keep other users out, so a connected peer counts as this user (0).
#[cfg(unix)]
pub fn stream_peer_uid(s: &crate::transport::Stream) -> std::io::Result<u32> {
    use std::os::fd::AsRawFd;
    peer_uid(s.as_raw_fd())
}

#[cfg(windows)]
pub fn stream_peer_uid(_s: &crate::transport::Stream) -> std::io::Result<u32> {
    Ok(0)
}

#[cfg(windows)]
pub fn my_uid() -> u32 {
    0
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::fd::AsRawFd;

    #[test]
    fn socketpair_peer_is_me() {
        let (a, _b) = std::os::unix::net::UnixStream::pair().unwrap();
        assert_eq!(peer_uid(a.as_raw_fd()).unwrap(), my_uid());
    }

    #[test]
    fn accepted_connection_reports_the_connecting_user() {
        use std::os::unix::net::{UnixListener, UnixStream};
        let t = tempfile::tempdir().unwrap();
        let path = t.path().join("c.sock");
        let l = UnixListener::bind(&path).unwrap();
        let _c = UnixStream::connect(&path).unwrap();
        let (srv, _) = l.accept().unwrap();
        // The server's view (SO_PEERCRED on Linux, getpeereid on macOS) of a connecting process.
        assert_eq!(peer_uid(srv.as_raw_fd()).unwrap(), my_uid());
        // A uid that is not mine is what the server refuses.
        assert_ne!(peer_uid(srv.as_raw_fd()).unwrap(), my_uid().wrapping_add(1));
    }
}
