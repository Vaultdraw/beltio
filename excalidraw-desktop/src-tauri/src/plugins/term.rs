//! Catches the polite termination signals (SIGTERM from a rebuild or logout, SIGINT, SIGHUP) so a
//! launch that is told to stop is not counted as a crash. SIGKILL (a hard force quit) cannot be
//! caught, so a launch killed that way inside the startup window still counts.
//!
//! Self-pipe design: the signal handler only writes one byte (async-signal-safe); a thread reads it
//! and runs the real work.
#[cfg(unix)]
mod imp {
    use std::sync::atomic::{AtomicI32, Ordering};

    static WRITE_FD: AtomicI32 = AtomicI32::new(-1);

    extern "C" fn on_signal(sig: libc::c_int) {
        let fd = WRITE_FD.load(Ordering::Relaxed);
        if fd >= 0 {
            let byte = sig as u8;
            // SAFETY: write(2) is async-signal-safe; the fd stays open for the process lifetime.
            unsafe {
                libc::write(fd, (&byte as *const u8).cast(), 1);
            }
        }
    }

    /// Runs `handle(signal)` on a helper thread whenever one of `signals` arrives.
    pub(crate) fn watch(signals: &[libc::c_int], handle: impl Fn(libc::c_int) + Send + 'static) -> bool {
        let mut fds = [0 as libc::c_int; 2];
        // SAFETY: plain syscalls on a fresh fd pair we own.
        unsafe {
            if libc::pipe(fds.as_mut_ptr()) != 0 {
                return false;
            }
            WRITE_FD.store(fds[1], Ordering::Relaxed);
            for &s in signals {
                libc::signal(s, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
            }
        }
        let read_fd = fds[0];
        std::thread::Builder::new()
            .name("plugins-term".into())
            .spawn(move || loop {
                let mut byte = 0u8;
                // SAFETY: reads one byte into a local buffer from our pipe.
                let n = unsafe { libc::read(read_fd, (&mut byte as *mut u8).cast(), 1) };
                if n == 1 {
                    handle(byte as libc::c_int);
                } else if n == 0 {
                    break;
                }
            })
            .is_ok()
    }

    /// Restores the default action and re-raises, so the process still ends the usual way.
    pub(crate) fn finish(sig: libc::c_int) {
        // SAFETY: resets one signal's disposition and raises it on this process.
        unsafe {
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_caught_signal_reaches_the_handler_thread() {
            let (tx, rx) = std::sync::mpsc::channel();
            assert!(watch(&[libc::SIGUSR2], move |s| {
                let _ = tx.send(s);
            }));
            unsafe { libc::raise(libc::SIGUSR2) };
            let got = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("signal delivered");
            assert_eq!(got, libc::SIGUSR2);
        }
    }
}

/// A launch told to stop politely is a clean launch.
pub(crate) fn install() {
    #[cfg(unix)]
    {
        let sigs = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP];
        imp::watch(&sigs, |sig| {
            crate::launch::mark_ok();
            imp::finish(sig);
        });
    }
}
