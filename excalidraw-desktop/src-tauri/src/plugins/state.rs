//! `<state dir>/plugins-state.json`: `{ "hostDisabled": { "<id>": "<reason>" } }`.
use super::manifest::is_valid_id;
use crate::{err, ioerr, read_bounded, write_atomic, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

const FILE: &str = "plugins-state.json";
const MAX_BYTES: u64 = 1024 * 1024;
const MAX_REASON: usize = 500;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    host_disabled: BTreeMap<String, String>,
}

/// Tolerant reader: a missing or corrupt file is an empty state (corrupt is logged).
pub(crate) fn load(state_dir: &Path) -> BTreeMap<String, String> {
    let path = state_dir.join(FILE);
    let bytes = match read_bounded(&path, MAX_BYTES) {
        Ok(b) => b,
        Err(e) => {
            if e.code != "NOT_FOUND" {
                eprintln!("plugins-state.json unreadable, using empty state: {}", e.message);
            }
            return BTreeMap::new();
        }
    };
    serde_json::from_slice::<State>(&bytes).map(|s| s.host_disabled).unwrap_or_else(|e| {
        eprintln!("plugins-state.json is corrupt, using empty state: {e}");
        BTreeMap::new()
    })
}

/// Sets (`Some`) or clears (`None`) the host-disabled reason for `id`.
pub(crate) fn set_host_disabled(state_dir: &Path, id: &str, reason: Option<String>) -> Result<()> {
    if !is_valid_id(id) {
        return Err(err("INVALID_ARGUMENT", "Invalid plugin id"));
    }
    let _guard = crate::config::write_guard()?;
    let mut map = load(state_dir);
    let changed = match reason {
        Some(r) => map.insert(id.to_string(), r.chars().take(MAX_REASON).collect()).as_deref() != Some(&r),
        None => map.remove(id).is_some(),
    };
    if !changed {
        return Ok(());
    }
    let mut bytes = serde_json::to_vec_pretty(&State { host_disabled: map }).map_err(|e| err("INTERNAL", e.to_string()))?;
    bytes.push(b'\n');
    fs::create_dir_all(state_dir).map_err(ioerr)?;
    write_atomic(&state_dir.join(FILE), &bytes)
}
