//! The control link's byte stream: a Unix domain socket on macOS and Linux, a named pipe on
//! Windows. Both expose the same small surface (`connect`, `Listener::bind`/`accept`, a `Stream`
//! with `try_clone`, timeouts and `shutdown`), so the client, the server and the tests never name
//! the platform type. On Unix these are plain aliases: nothing changes there.
//!
//! On Windows the `socket` path from [`crate::dirs::InstancePaths`] is only an identity: the pipe
//! is named `vaultdraw-<hash of the path>`, so one runtime folder (one user, one test rig) is one pipe.

#[cfg(unix)]
pub use std::os::unix::net::{UnixListener as Listener, UnixStream as Stream};

/// Connects to the control link for `path`.
#[cfg(unix)]
pub fn connect(path: &std::path::Path) -> std::io::Result<Stream> {
    Stream::connect(path)
}

/// Binds the control link for `path` (any stale socket file is removed by the caller).
#[cfg(unix)]
pub fn bind(path: &std::path::Path) -> std::io::Result<Listener> {
    Listener::bind(path)
}

/// The pipe name for a socket path: stable, short and made of characters a pipe name allows.
pub fn pipe_name(path: &std::path::Path) -> String {
    // FNV-1a over the path text; the folder is per user, so two users never share a name.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in path.to_string_lossy().to_lowercase().replace('\\', "/").bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("vaultdraw-{h:016x}")
}

#[cfg(windows)]
pub use win::{bind, connect, Listener, Stream};

#[cfg(windows)]
mod win {
    use interprocess::local_socket::{
        traits::{Listener as _, Stream as _},
        GenericNamespaced, ListenerOptions, Stream as Pipe, ToNsName,
    };
    use std::io::{self, Read, Write};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Bytes pumped from a blocking pipe read by a helper thread, so a read can time out
    /// (a synchronous pipe read cannot be interrupted).
    struct Pump {
        rx: Receiver<io::Result<Vec<u8>>>,
        rest: Vec<u8>,
        eof: bool,
    }

    /// One end of the pipe. Clones share it (`&Pipe` reads and writes).
    pub struct Stream {
        io: Arc<Pipe>,
        read_timeout: Arc<Mutex<Option<Duration>>>,
        pump: Arc<Mutex<Option<Pump>>>,
        closed: Arc<AtomicBool>,
    }

    impl Stream {
        fn new(pipe: Pipe) -> Self {
            Self {
                io: Arc::new(pipe),
                read_timeout: Arc::default(),
                pump: Arc::default(),
                closed: Arc::default(),
            }
        }

        pub fn try_clone(&self) -> io::Result<Self> {
            Ok(Self {
                io: self.io.clone(),
                read_timeout: self.read_timeout.clone(),
                pump: self.pump.clone(),
                closed: self.closed.clone(),
            })
        }

        pub fn set_read_timeout(&self, t: Option<Duration>) -> io::Result<()> {
            *lock(&self.read_timeout) = t;
            Ok(())
        }

        /// A pipe write cannot time out here; a stuck peer only blocks its own writer thread.
        pub fn set_write_timeout(&self, _t: Option<Duration>) -> io::Result<()> {
            Ok(())
        }

        /// Stops further writes and reads on every clone (the peer notices when the process ends
        /// or drops its end; a named pipe has no half-close).
        pub fn shutdown(&self, _how: std::net::Shutdown) -> io::Result<()> {
            self.closed.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn start_pump(&self) -> Pump {
            let (tx, rx) = channel();
            let io = self.io.clone();
            std::thread::spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let n = (&*io).read(&mut buf);
                    let stop = !matches!(n, Ok(k) if k > 0);
                    let item = n.map(|k| buf[..k].to_vec());
                    if tx.send(item).is_err() || stop {
                        break;
                    }
                }
            });
            Pump { rx, rest: Vec::new(), eof: false }
        }

        fn read_inner(&self, out: &mut [u8]) -> io::Result<usize> {
            if self.closed.load(Ordering::SeqCst) {
                return Ok(0);
            }
            let timeout = *lock(&self.read_timeout);
            let mut pump = lock(&self.pump);
            if pump.is_none() && timeout.is_none() {
                drop(pump);
                return (&*self.io).read(out);
            }
            let p = pump.get_or_insert_with(|| self.start_pump());
            if p.rest.is_empty() && !p.eof {
                let got = match timeout {
                    Some(t) => p.rx.recv_timeout(t),
                    None => p.rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                };
                match got {
                    Ok(Ok(bytes)) if bytes.is_empty() => p.eof = true,
                    Ok(Ok(bytes)) => p.rest = bytes,
                    Ok(Err(e)) => return Err(e),
                    Err(RecvTimeoutError::Timeout) => {
                        return Err(io::Error::new(io::ErrorKind::TimedOut, "the app did not answer in time"))
                    }
                    Err(RecvTimeoutError::Disconnected) => p.eof = true,
                }
            }
            let n = out.len().min(p.rest.len());
            out[..n].copy_from_slice(&p.rest[..n]);
            p.rest.drain(..n);
            Ok(n)
        }

        fn write_inner(&self, data: &[u8]) -> io::Result<usize> {
            if self.closed.load(Ordering::SeqCst) {
                return Err(io::Error::new(io::ErrorKind::BrokenPipe, "connection closed"));
            }
            (&*self.io).write(data)
        }
    }

    impl Read for Stream {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            self.read_inner(out)
        }
    }
    impl Read for &Stream {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            self.read_inner(out)
        }
    }
    impl Write for Stream {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.write_inner(data)
        }
        fn flush(&mut self) -> io::Result<()> {
            (&*self.io).flush()
        }
    }
    impl Write for &Stream {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.write_inner(data)
        }
        fn flush(&mut self) -> io::Result<()> {
            (&*self.io).flush()
        }
    }

    pub struct Listener(interprocess::local_socket::Listener);

    impl Listener {
        pub fn accept(&self) -> io::Result<(Stream, ())> {
            Ok((Stream::new(self.0.accept()?), ()))
        }
        pub fn incoming(&self) -> impl Iterator<Item = io::Result<Stream>> + '_ {
            std::iter::repeat_with(move || self.accept().map(|(s, _)| s))
        }
    }

    pub fn bind(path: &Path) -> io::Result<Listener> {
        let name = super::pipe_name(path).to_ns_name::<GenericNamespaced>()?;
        Ok(Listener(ListenerOptions::new().name(name).create_sync()?))
    }

    pub fn connect(path: &Path) -> io::Result<Stream> {
        let name = super::pipe_name(path).to_ns_name::<GenericNamespaced>()?;
        Ok(Stream::new(Pipe::connect(name)?))
    }
}

#[cfg(test)]
mod tests {
    use super::pipe_name;
    use std::path::Path;

    #[test]
    fn pipe_names_are_stable_distinct_and_pipe_safe() {
        let a = pipe_name(Path::new("/r/one/ctl.sock"));
        assert_eq!(a, pipe_name(Path::new("/r/one/ctl.sock")));
        assert_ne!(a, pipe_name(Path::new("/r/two/ctl.sock")));
        // Windows folder spelling: case and separator do not change the name.
        assert_eq!(pipe_name(Path::new(r"C:\Users\Me\run\ctl.sock")), pipe_name(Path::new("c:/users/me/run/ctl.sock")));
        assert!(a.starts_with("vaultdraw-") && a.len() == "vaultdraw-".len() + 16);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::time::Duration;

    /// A named pipe carries a line both ways, a read times out when nothing arrives, and a
    /// missing pipe reads as "not running".
    #[test]
    fn pipe_round_trip_timeout_and_missing() {
        let path = std::path::PathBuf::from(format!(r"C:\vd-test-{}\ctl.sock", std::process::id()));
        assert_eq!(connect(&path).err().map(|e| e.kind()), Some(std::io::ErrorKind::NotFound));
        let l = bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut line = String::new();
            BufReader::new(s.try_clone().unwrap()).read_line(&mut line).unwrap();
            s.write_all(format!("echo {line}").as_bytes()).unwrap();
            std::thread::sleep(Duration::from_millis(400));
        });
        let mut c = connect(&path).unwrap();
        c.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        let mut r = BufReader::new(c.try_clone().unwrap());
        let mut buf = String::new();
        c.write_all(b"hi\n").unwrap();
        r.read_line(&mut buf).unwrap();
        assert_eq!(buf, "echo hi\n");
        let err = r.read_line(&mut String::new()).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        server.join().unwrap();
    }
}
