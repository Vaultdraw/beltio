//! One app process per user: an exclusive flock on `<runtime>/instance.lock`, shared by the app
//! (which claims it) and the offline CLI (which only probes it to know no app is running).

use fs2::FileExt;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;
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
