//! `vaultdraw backup` and `vaultdraw restore`: local file work through `vaultdraw_core::backup`,
//! no app needed. The vault is only read; restore only ever creates a new folder.

use super::emit;
use crate::cli::Cli;
use crate::error::Fail;
use serde_json::json;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use vaultdraw_core::backup::{self, BackupOptions, BackupSettings, Progress};
use vaultdraw_core::config::{read_merged_config, resolve_dirs_with};
use vaultdraw_core::vault_path;

static INTERRUPTED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
fn on_interrupt() {
    use std::sync::atomic::Ordering;
    extern "C" fn handler(_: libc::c_int) {
        INTERRUPTED.store(true, Ordering::Relaxed);
    }
    unsafe {
        libc::signal(libc::SIGINT, handler as usize);
        libc::signal(libc::SIGTERM, handler as usize);
    }
}
#[cfg(not(unix))]
fn on_interrupt() {}

fn fail(e: vaultdraw_core::error::NativeError) -> Fail {
    Fail::cli(e.message)
}

fn settings() -> BackupSettings {
    let dirs = resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None);
    BackupSettings::from_json(&dirs.map(|d| read_merged_config(&d)).unwrap_or(serde_json::Value::Null))
}

fn line(cli: &Cli) -> impl FnMut(&Progress) + '_ {
    let mut last = "";
    move |p: &Progress| {
        if !cli.json && last != p.phase {
            eprintln!("{}…", p.phase);
            last = p.phase;
        }
    }
}

pub fn backup(cli: &Cli, to: Option<&Path>, history: bool, no_settings: bool) -> Result<(), Fail> {
    let root = vault_path::resolve(cli.vault.as_deref()).map_err(fail)?;
    let cfg = settings();
    let dest = to.map(Path::to_path_buf).or(cfg.folder.clone()).ok_or_else(|| Fail::cli("no folder: pass --to <dir> or set [backup] folder in config.toml"))?;
    let opts = BackupOptions { settings: cfg.options.settings && !no_settings, history: cfg.options.history || history };
    on_interrupt();
    let r = backup::create(&root, &dest, opts, &INTERRUPTED, &mut line(cli)).map_err(fail)?;
    emit(cli.json, &json!({ "path": r.path, "files": r.files, "bytes": r.bytes, "zipBytes": r.zip_bytes }), || {
        format!("backed up {} files ({} bytes) to {}", r.files, r.bytes, r.path.display())
    });
    Ok(())
}

pub fn restore(cli: &Cli, zip: &Path, dir: &Path) -> Result<(), Fail> {
    on_interrupt();
    let r = backup::restore(zip, dir, &INTERRUPTED, &mut line(cli)).map_err(fail)?;
    emit(cli.json, &json!({ "path": r.path, "files": r.files, "bytes": r.bytes }), || {
        format!("restored {} files ({} bytes) into {}; open that folder as a vault in the app", r.files, r.bytes, r.path.display())
    });
    Ok(())
}
