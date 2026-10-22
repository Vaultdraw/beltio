//! One app process per user: an exclusive flock on `<runtime>/instance.lock`, shared by the app
//! (which claims it) and the offline CLI (which only probes it to know no app is running).

use fs2::FileExt;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;
use std::time::Duration;
use vaultdraw_protocol::dirs::InstancePaths;

pub enum Claim {
    Held(File),
    Busy,
}

fn contended(e: &io::Error) -> bool {
    e.raw_os_error() == fs2::lock_contended_error().raw_os_error()
}

/// Opens `instance.lock` (creating it) and tries to lock it exclusively.
pub fn try_claim(paths: &InstancePaths) -> io::Result<Claim> {
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&paths.lock)?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(Claim::Held(file)),
        Err(e) if contended(&e) => Ok(Claim::Busy),
        Err(e) => Err(e),
    }
}

/// [`try_claim`], retried while the lock is `Busy`: the offline CLI's `app_live` probe holds it for
/// a few microseconds, which must not make a starting app think another app owns it. Makes at most
/// `tries` attempts (at least one), sleeping `step` between them.
pub fn claim_with_retries(paths: &InstancePaths, tries: u32, step: Duration) -> io::Result<Claim> {
    let mut claim = try_claim(paths)?;
    for _ in 1..tries {
        if matches!(claim, Claim::Held(_)) {
            break;
        }
        std::thread::sleep(step);
        claim = try_claim(paths)?;
    }
    Ok(claim)
}

/// True when some process holds `<runtime_dir>/instance.lock` (a live app). Never creates the
/// file and releases a probe lock immediately. A missing lock file means no app has run there;
/// any other failure to probe counts as live, so a headless caller does not race a running app.
pub fn app_live(runtime_dir: &Path) -> bool {
    let lock = InstancePaths::in_dir(runtime_dir).lock;
    let file = match OpenOptions::new().read(true).open(&lock) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return false,
        Err(_) => return true,
    };
    match file.try_lock_exclusive() {
        Ok(()) => {
            let _ = FileExt::unlock(&file);
            false
        }
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_claim_sees_the_lock_held() {
        let t = tempfile::tempdir().unwrap();
        let paths = InstancePaths::in_dir(t.path());
        let Claim::Held(first) = try_claim(&paths).unwrap() else { panic!("first claim must win") };
        assert!(matches!(try_claim(&paths).unwrap(), Claim::Busy));
        drop(first);
        assert!(matches!(try_claim(&paths).unwrap(), Claim::Held(_)));
    }

    #[test]
    fn claim_with_retries_outlasts_a_brief_probe_lock() {
        let t = tempfile::tempdir().unwrap();
        let paths = InstancePaths::in_dir(t.path());
        let Claim::Held(held) = try_claim(&paths).unwrap() else { panic!() };
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            drop(held);
        });
        let claim = claim_with_retries(&paths, 10, Duration::from_millis(20)).unwrap();
        assert!(matches!(claim, Claim::Held(_)), "the lock freed after ~30 ms must be won");
        releaser.join().unwrap();
    }

    #[test]
    fn claim_with_retries_stays_busy_while_the_lock_is_held() {
        let t = tempfile::tempdir().unwrap();
        let paths = InstancePaths::in_dir(t.path());
        let Claim::Held(_held) = try_claim(&paths).unwrap() else { panic!() };
        assert!(matches!(claim_with_retries(&paths, 3, Duration::from_millis(5)).unwrap(), Claim::Busy));
        assert!(matches!(claim_with_retries(&paths, 0, Duration::from_millis(5)).unwrap(), Claim::Busy), "0 tries still tries once");
    }

    #[test]
    fn app_live_follows_the_lock_and_never_creates_it() {
        let t = tempfile::tempdir().unwrap();
        assert!(!app_live(t.path()), "no lock file: no app");
        assert!(!t.path().join("instance.lock").exists(), "probe must not create the file");
        let paths = InstancePaths::in_dir(t.path());
        let Claim::Held(held) = try_claim(&paths).unwrap() else { panic!() };
        assert!(app_live(t.path()));
        drop(held);
        assert!(!app_live(t.path()), "released lock: free again");
        // The probe itself must not leave the lock held.
        assert!(matches!(try_claim(&paths).unwrap(), Claim::Held(_)));
    }
}
