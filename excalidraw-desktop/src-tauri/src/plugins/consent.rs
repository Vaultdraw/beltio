//! `<state dir>/plugin-consent.json`: `{ "<id>": ["vault.read", ...] }`, the permissions the user confirmed.
//!
//! A permission is a declaration and a consent record, not a sandbox: the host loads a plugin
//! only while its declared permissions are covered by what was confirmed (writes need a review).
use super::manifest::{is_valid_id, is_write_permission};
use crate::{err, ioerr, read_bounded, write_atomic, Result};
use serde::Serialize;
use std::{collections::BTreeMap, fs, path::Path};

const FILE: &str = "plugin-consent.json";
const MAX_BYTES: u64 = 1024 * 1024;

pub(crate) type Record = BTreeMap<String, Vec<String>>;

/// How a plugin's declared permissions compare with what the user confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReviewState {
    /// Everything declared was confirmed (or nothing is declared, or the plugin is bundled).
    Ok,
    /// Only read permissions were added: the plugin loads and the user is told once.
    Notice,
    /// A write permission was added: the plugin stays off until the user confirms.
    Review,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Review {
    pub state: ReviewState,
    /// Declared permissions that are not in the confirmed set.
    pub added: Vec<String>,
}

impl Review {
    pub(crate) fn ok() -> Self {
        Review { state: ReviewState::Ok, added: Vec::new() }
    }
}

/// Compares `declared` with the confirmed set (`None` = never confirmed). Bundled plugins need no prompt.
pub(crate) fn review(declared: &[String], confirmed: Option<&Vec<String>>, bundled: bool) -> Review {
    if bundled {
        return Review::ok();
    }
    let added: Vec<String> =
        declared.iter().filter(|p| !confirmed.is_some_and(|c| c.contains(p))).cloned().collect();
    let state = if added.is_empty() {
        ReviewState::Ok
    } else if added.iter().any(|p| is_write_permission(p)) {
        ReviewState::Review
    } else {
        ReviewState::Notice
    };
    Review { state, added }
}

/// Tolerant reader: a missing or corrupt file means nothing was confirmed (corrupt is logged).
pub(crate) fn load(state_dir: &Path) -> Record {
    let path = state_dir.join(FILE);
    let bytes = match read_bounded(&path, MAX_BYTES) {
        Ok(b) => b,
        Err(e) => {
            if e.code != "NOT_FOUND" {
                eprintln!("plugin-consent.json unreadable, treating nothing as confirmed: {}", e.message);
            }
            return Record::new();
        }
    };
    serde_json::from_slice::<Record>(&bytes).unwrap_or_else(|e| {
        eprintln!("plugin-consent.json is corrupt, treating nothing as confirmed: {e}");
        Record::new()
    })
}

fn save(state_dir: &Path, record: &Record) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(record).map_err(|e| err("INTERNAL", e.to_string()))?;
    bytes.push(b'\n');
    fs::create_dir_all(state_dir).map_err(ioerr)?;
    write_atomic(&state_dir.join(FILE), &bytes)
}

/// Records `declared` as confirmed for `id` (replacing the old set, so a shrunk set shrinks the record).
pub(crate) fn confirm(state_dir: &Path, id: &str, declared: &[String]) -> Result<()> {
    if !is_valid_id(id) {
        return Err(err("INVALID_ARGUMENT", "Invalid plugin id"));
    }
    let _guard = crate::config::write_guard()?;
    let mut record = load(state_dir);
    if record.get(id).map(Vec::as_slice) == Some(declared) {
        return Ok(());
    }
    record.insert(id.to_string(), declared.to_vec());
    save(state_dir, &record)
}

/// Drops the record of `id` (uninstall).
pub(crate) fn forget(state_dir: &Path, id: &str) -> Result<()> {
    let _guard = crate::config::write_guard()?;
    let mut record = load(state_dir);
    if record.remove(id).is_none() {
        return Ok(());
    }
    save(state_dir, &record)
}

/// Drops confirmed permissions the plugin no longer declares, so adding one back later is asked again.
pub(crate) fn prune(state_dir: &Path, id: &str, declared: &[String]) -> Result<()> {
    let _guard = crate::config::write_guard()?;
    let mut record = load(state_dir);
    let Some(old) = record.get(id) else { return Ok(()) };
    let kept: Vec<String> = old.iter().filter(|p| declared.contains(p)).cloned().collect();
    if kept.len() == old.len() {
        return Ok(());
    }
    record.insert(id.to_string(), kept);
    save(state_dir, &record)
}
