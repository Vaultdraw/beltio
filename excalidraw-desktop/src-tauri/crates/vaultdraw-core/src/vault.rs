//! The open-vault value shared by the app and the CLI: root, handle, read-only flag, the
//! cross-process lock and the mutation guard that serializes writes.

use crate::error::{err, Result};
use crate::lock::VaultLock;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct Vault {
    pub root: PathBuf,
    pub handle: String,
    pub read_only: bool,
    pub lock: Option<Arc<VaultLock>>,
    pub mutation: Mutex<()>,
}

impl Vault {
    pub fn new(root: PathBuf, handle: String, read_only: bool, lock: Option<Arc<VaultLock>>) -> Self {
        Vault { root, handle, read_only, lock, mutation: Mutex::new(()) }
    }
}

#[inline]
pub fn mutation_guard(v: &Vault) -> Result<std::sync::MutexGuard<'_, ()>> {
    v.mutation.lock().map_err(|_| err("INTERNAL", "Vault mutation state unavailable"))
}
#[inline]
pub fn writable(v: &Vault) -> Result<()> {
    if v.read_only {
        Err(err("READ_ONLY", "This vault is open read-only because it is not writable or another app instance owns its lock"))
    } else {
        Ok(())
    }
}
