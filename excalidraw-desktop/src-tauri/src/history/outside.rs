//! Outside changes: watcher paths against the staged identity ("Before outside change"),
//! `history_snapshot_bytes` (M15, Minor 14) and the pre-rewrite state of link updates (D-R2).
//!
//! The command and watcher threads only queue (and, for the two commands, write one scratch
//! file); every decision is made on the worker thread. Contract frozen at the H3 skeleton
//! (PLAN-H3.md §3).
use super::{
    lineage,
    names::Reason,
    staging,
    worker::{Core, Msg, Staged},
    writer::{self, RealBackend},
    SnapshotOutcome, VaultHistory,
};
use crate::{err, ioerr, Result};
use sha2::{Digest, Sha256};
use std::{io::Write, sync::mpsc, time::Duration};

const SNAPSHOT_WAIT: Duration = Duration::from_secs(20);

fn is_drawing(p: &str) -> bool {
    vaultdraw_core::filekind::is_drawing_name(p)
}

/// Watcher batch of vault paths (runs on the watcher thread: must only queue work, ≤ 20 µs/path).
pub(super) fn watched(vh: &VaultHistory, entries: &[String]) {
    if !vh.has_worker || !vh.flags.history_on() {
        return;
    }
    let drawings: Vec<String> = entries.iter().filter(|p| is_drawing(p)).cloned().collect();
    if !drawings.is_empty() {
        vh.inbox.send(Msg::Watched(drawings));
    }
}

/// Raw scene bytes from the frontend (staging off, or a conflict reload discarding edits).
pub(super) fn snapshot_bytes(vh: &VaultHistory, path: &str, reason: &str, revision: &str, body: &[u8]) -> Result<SnapshotOutcome> {
    let reason = match reason {
        "before-outside-change" => Reason::BeforeOutside,
        "discarded-edits" => Reason::DiscardedEdits,
        _ => return Err(err("INVALID_ARGUMENT", "Unknown snapshot reason")),
    };
    let hex64 = revision.len() == 64 && revision.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !hex64 || hex::encode(Sha256::digest(body)) != revision {
        return Err(err("REVISION_MISMATCH", "The bytes do not match the revision"));
    }
    if !vh.has_worker || vh.flags.read_only.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(SnapshotOutcome { id: None, skipped: Some("read-only".into()) });
    }
    writer::ensure_plain_dir(&vh.staged_dir)?;
    let temp = staging::temp_path(&vh.staged_dir, "xs-");
    let written = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).and_then(|mut f| f.write_all(body));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(ioerr(e));
    }
    let (tx, rx) = mpsc::channel();
    // The worker deletes `temp` in every case (a stop before it ran leaves it for the startup scan).
    vh.inbox.send(Msg::SnapshotBytes { path: path.to_string(), reason, revision: revision.to_string(), temp, ack: tx });
    rx.recv_timeout(SNAPSHOT_WAIT).map_err(|_| err("IO_ERROR", "History did not answer in time"))?
}

/// Links are about to rewrite `path` (closed drawing): keep its current state if history lacks it.
/// Runs on the links job thread, before the rewrite's mutation guard: clone + send only.
pub(super) fn before_rewrite(vh: &VaultHistory, path: &str) {
    if !vh.has_worker || !vh.flags.history_on() {
        return;
    }
    vh.ensure_loaded();
    // A drawing without a lineage has no history to complete; a pending state (worker side) still counts.
    let clone = if vh.flags.should_stage() && vh.read_index().has_lineage(path) { staging::clone_live_temp(&vh.staged_dir, &vh.root, path) } else { None };
    vh.inbox.send(Msg::BeforeRewrite { path: path.to_string(), clone });
}

enum Verdict {
    Same,
    Different,
    Missing,
    Unknown,
}

/// Live file against its staged state: size first (the clone has the committed size), then mtime
/// (`clonefile` keeps it on APFS), then a hash only when size is equal but mtime is not.
fn compare(vh: &VaultHistory, core: &mut Core<RealBackend>, path: &str, st: &Staged) -> Verdict {
    let Ok(md) = std::fs::symlink_metadata(vh.root.join(path)) else { return Verdict::Missing };
    if !md.is_file() {
        return Verdict::Missing;
    }
    let Some((size, mtime)) = core.staged_identity(st, path) else { return Verdict::Unknown };
    if md.len() != size {
        return Verdict::Different;
    }
    if mtime.is_some() && md.modified().ok() == mtime {
        return Verdict::Same;
    }
    match lineage::sha_of_file(vh, path) {
        Some(sha) if sha == st.rev => Verdict::Same,
        Some(_) => Verdict::Different,
        None => Verdict::Unknown,
    }
}

fn file_exists(vh: &VaultHistory, path: &str) -> bool {
    std::fs::symlink_metadata(vh.root.join(path)).is_ok_and(|m| m.is_file())
}

/// Worker: a watcher batch. Drawings with staged state are compared with their clone (a
/// difference versions the clone as "Before outside change"); everything else only feeds the
/// lineage checks (trash re-attach, orphans, relink). A drawing without a clone and without a
/// lineage costs one hash-map miss (M2: a 500-file pull versions only drawings with clones).
pub(super) fn apply_watched(vh: &VaultHistory, core: &mut Core<RealBackend>, paths: &[String]) {
    if !core.on() {
        return;
    }
    let now = core.clock_ms();
    let orphans = lineage::has_orphans(vh);
    for p in paths {
        if let Some(st) = core.staged_state(p) {
            match compare(vh, core, p, &st) {
                Verdict::Same | Verdict::Unknown => continue,
                Verdict::Different => {
                    core.version_staged(p, Reason::BeforeOutside);
                    continue;
                }
                // Gone from disk: the pending state's clone is its last copy.
                Verdict::Missing => {
                    if st.pending {
                        core.version_pending(p, Reason::Leave);
                    }
                }
            }
        }
        let (visible, hidden) = {
            let g = vh.read_index();
            let visible = g.has_lineage(p);
            (visible, !visible && !g.all_lineages_for(p).is_empty())
        };
        if !visible && !hidden {
            if orphans && !core.tracks.contains_key(p.as_str()) && file_exists(vh, p) {
                core.want_relink = true;
            }
            continue;
        }
        if hidden {
            if file_exists(vh, p) {
                lineage::reattach_at(vh, core, p, now);
            }
        } else if orphans || !file_exists(vh, p) {
            lineage::recheck_path(vh, core, p, now);
        }
    }
}
