//! The read methods without an app: the same core functions the app's control server calls,
//! producing the same JSON as the RPC method (so every renderer and `--json` is shared).

use crate::cli::Cli;
use crate::error::{Fail, EXIT_CLI, EXIT_REFUSED};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Instant;
use vaultdraw_core::config::Dirs;
use vaultdraw_core::links;
use vaultdraw_core::scene_project;
use vaultdraw_core::ops::target::{self, native_err, Need};
use vaultdraw_core::ops::{config_ops, vault_ops};
use vaultdraw_core::search::{store, Index, IndexState, IndexStatus, Scope, SearchResponse, TagsResponse};
use vaultdraw_core::lock::{LockRegistry, ReadOnlyReason};
use vaultdraw_core::{vault_path, Vault, META_DIR};
use vaultdraw_protocol::{codes, methods, RpcError};


fn rpc_fail(e: RpcError) -> Fail {
    crate::error::Fail::from(vaultdraw_protocol::client::CallError::Rpc(e))
}

/// A core error as the failure the app would have reported (exit 2, its code as tag); a
/// missing vault is a CLI-side problem (exit 1).
fn native_fail(e: vaultdraw_core::NativeError) -> Fail {
    if e.code == codes::NO_VAULT {
        Fail::new(EXIT_CLI, e.message, codes::NO_VAULT)
    } else {
        rpc_fail(native_err(e))
    }
}

fn to_json(v: impl Serialize) -> Result<Value, Fail> {
    serde_json::to_value(v).map_err(|e| Fail::cli(e.to_string()))
}

fn opt_str<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, Fail> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(rpc_fail(RpcError::invalid_params(format!("{key} must be a string")))),
    }
}

/// `--vault` / `$VAULTDRAW_VAULT` / recent-vault, as a lock-free [`Vault`]. It is not flagged
/// read-only (the app reports `readOnly: false` for a normal vault); headless reads never write.
pub fn open_vault(cli: &Cli) -> Result<Vault, Fail> {
    let root = vault_path::resolve(cli.vault.as_deref()).map_err(native_fail)?;
    let handle = store::vault_id(&root);
    Ok(Vault::new(root, handle, false, None))
}

pub fn dirs() -> Result<Dirs, Fail> {
    vaultdraw_core::config::resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map_err(native_fail)
}

fn index(v: &Vault) -> Result<Index, Fail> {
    let state: PathBuf = dirs()?.state;
    vaultdraw_core::search::load_or_build(&v.root, &store::snapshot_path(&state, &v.root)).map_err(native_fail)
}

/// The index with its link graph built (needed by `links` and `{file}` name targets).
fn index_with_links(v: &Vault) -> Result<Index, Fail> {
    let mut i = index(v)?;
    i.ensure_links();
    Ok(i)
}

fn status(v: &Vault, i: &Index) -> IndexStatus {
    let (indexed, total) = i.counts();
    IndexStatus { handle: v.handle.clone(), state: IndexState::Ready, indexed: indexed as u32, total: total as u32 }
}

fn ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

/// Answers `method` from the vault on disk.
pub fn call(cli: &Cli, method: &str, params: Option<Value>) -> Result<Value, Fail> {
    let params = params.unwrap_or(Value::Null);
    match method {
        methods::CONFIG_GET => return config_ops::get(&dirs()?, &params).map_err(rpc_fail),
        methods::CONFIG_SET => return config_ops::set(&dirs()?, &params).map_err(rpc_fail),
        _ => {}
    }
    let v = open_vault(cli)?;
    match method {
        methods::VAULT_INFO => Ok(vault_ops::info(&v)),
        methods::VAULT_LIST => {
            let dir = opt_str(&params, "dir")?.unwrap_or("");
            let recursive = params.get("recursive").and_then(Value::as_bool).unwrap_or(false);
            vault_ops::list(&v, dir, recursive).map_err(rpc_fail)
        }
        methods::VAULT_SEARCH => search(&v, &params),
        methods::VAULT_TAGS => {
            let (i, t) = (index(&v)?, Instant::now());
            let summary = i.tag_summary();
            to_json(TagsResponse { summary, status: status(&v, &i), took_ms: ms(t) })
        }
        methods::VAULT_LINKS => {
            let i = index_with_links(&v)?;
            let path = resolve(&v, &i, &params)?;
            to_json(links::links_of(&i, &path))
        }
        methods::FILE_READ => {
            let path = file_path(&v, &params)?;
            vault_ops::read(&v, &path).map_err(rpc_fail)
        }
        methods::SCENE_READ | methods::SCENE_GET => {
            if !names_a_drawing(&params) {
                return Err(Fail::new(crate::error::EXIT_NOT_RUNNING, "Vaultdraw is not running: the drawing on screen needs it (name a drawing to read it from disk)", "NOT_RUNNING"));
            }
            let path = file_path(&v, &params)?;
            let read = vault_ops::read(&v, &path).map_err(rpc_fail)?;
            let scene = &read["scene"];
            let out = if method == methods::SCENE_READ { scene_project::read(&path, scene, v.read_only, &params) } else { scene_project::get(&path, scene, &params) };
            out.map_err(rpc_fail)
        }
        _ => Err(Fail::cli(format!("{method} cannot run without the app"))),
    }
}

/// A `path` or `file` target in the params (otherwise the drawing on screen is meant).
pub fn names_a_drawing(params: &Value) -> bool {
    ["path", "file"].iter().any(|k| params.get(k).is_some_and(|v| !v.is_null()))
}

/// The checked vault-relative path of the drawing the params name. A `{path}` needs no index;
/// only a link-style name does.
fn file_path(v: &Vault, params: &Value) -> Result<String, Fail> {
    if params.get("path").is_some_and(|p| !p.is_null()) {
        target::resolve(&v.root, params, Need::File, &|_| None).map_err(rpc_fail)
    } else {
        resolve(v, &index_with_links(v)?, params)
    }
}

fn resolve(v: &Vault, i: &Index, params: &Value) -> Result<String, Fail> {
    target::resolve(&v.root, params, Need::File, &|name| links::resolve_name(i, name)).map_err(rpc_fail)
}

fn search(v: &Vault, params: &Value) -> Result<Value, Fail> {
    let query = opt_str(params, "query")?.ok_or_else(|| rpc_fail(RpcError::invalid_params("query is required")))?;
    let limit = params.get("limit").and_then(Value::as_u64).map(|n| n.min(u64::from(u32::MAX)) as u32);
    let limit = vaultdraw_core::search::checked_limit(query, limit).map_err(native_fail)?;
    let i = index(v)?;
    let t = Instant::now();
    let (results, total) = i.query(query, Scope::All, limit);
    to_json(SearchResponse { query: query.to_string(), results, total_matches: total as u32, status: status(v, &i), took_ms: ms(t) })
}

/// The failure for a vault that cannot be locked for writing.
fn lock_fail(reason: Option<ReadOnlyReason>, pid: Option<u32>) -> Fail {
    let reason = reason.unwrap_or(ReadOnlyReason::LockUnavailable);
    let message = match (reason, pid) {
        (ReadOnlyReason::LockedByOtherProcess, Some(p)) => format!("vault is locked by pid {p} (is Vaultdraw running?)"),
        (ReadOnlyReason::LockedByOtherProcess, None) => "vault is locked by another process (is Vaultdraw running?)".to_string(),
        (ReadOnlyReason::NotWritable, _) => "vault folder is not writable".to_string(),
        (ReadOnlyReason::LockUnavailable, _) => "vault lock unavailable (network or sync folder?)".to_string(),
    };
    Fail::new(EXIT_REFUSED, message, codes::READ_ONLY).with_data(json!({"reason": reason, "holderPid": pid}))
}

/// `file.write` / `file.create` on disk, under the vault lock (held until the process exits).
/// Same core write as the server; the previous content is staged for the app's history first.
/// A `file.write` without `expectedRevision` means "unchanged since now" (read under the lock).
pub fn write_call(cli: &Cli, method: &str, params: &Value) -> Result<Value, Fail> {
    let root = vault_path::resolve(cli.vault.as_deref()).map_err(native_fail)?;
    let outcome = LockRegistry::default().acquire(&root, &format!("{META_DIR}.lock"));
    let Some(lock) = outcome.lock else { return Err(lock_fail(outcome.reason, outcome.holder_pid)) };
    let v = Vault::new(root.clone(), store::vault_id(&root), false, Some(lock));
    match method {
        methods::FILE_WRITE => file_write(&v, params),
        methods::FILE_CREATE => file_create(&v, params),
        _ => Err(Fail::cli(format!("{method} cannot run without the app"))),
    }
}

fn scene_of(params: &Value) -> Result<&Value, Fail> {
    params.get("scene").filter(|s| s.is_object()).ok_or_else(|| rpc_fail(RpcError::invalid_params("scene must be a drawing object")))
}

fn file_write(v: &Vault, params: &Value) -> Result<Value, Fail> {
    let path = if params.get("path").is_some_and(|p| !p.is_null()) {
        target::resolve(&v.root, params, Need::Nothing, &|_| None).map_err(rpc_fail)?
    } else {
        resolve_nothing(v, params)?
    };
    let scene = scene_of(params)?;
    let current = vaultdraw_core::drawing_revision_at(&v.root, &path).map_err(native_fail)?;
    let expected: Option<String> = if params.get("expectedRevision").is_none() {
        current.clone()
    } else {
        vault_ops::expected_revision(params).map_err(rpc_fail)?.map(str::to_string)
    };
    // Stage only a write that will go ahead (the revision check passes), before the replace.
    if current.is_some() && current == expected {
        stage(v, &path);
    }
    let (revision, _len) = vault_ops::write(v, &path, scene, expected.as_deref()).map_err(rpc_fail)?;
    Ok(json!({"path": path, "revision": revision}))
}

fn resolve_nothing(v: &Vault, params: &Value) -> Result<String, Fail> {
    target::resolve(&v.root, params, Need::Nothing, &|name| index_with_links(v).ok().and_then(|i| links::resolve_name(&i, name))).map_err(rpc_fail)
}

/// Copies the current bytes into the app's staging area; never fails the write.
fn stage(v: &Vault, path: &str) {
    if let Ok(d) = dirs() {
        let _ = vaultdraw_core::staging::stage_before_overwrite(&d.state, &v.root, path);
    }
}

fn file_create(v: &Vault, params: &Value) -> Result<Value, Fail> {
    let path = target::resolve(&v.root, params, Need::Nothing, &|_| None).map_err(rpc_fail)?;
    let blank: Value;
    let scene = match params.get("scene") {
        // The app's `[paper]` / `[page]` defaults (and the vault's paper style), as the app applies them.
        None | Some(Value::Null) => {
            // An unresolvable config folder only means no defaults to read: still create the drawing.
            let config_dir = dirs().map(|d| d.config).unwrap_or_default();
            blank = vaultdraw_core::new_drawing::blank_scene(&config_dir, &v.root);
            &blank
        }
        Some(_) => scene_of(params)?,
    };
    let full = vaultdraw_core::safe_path(&v.root, &path, true).map_err(native_fail)?;
    if !full.parent().is_some_and(std::path::Path::is_dir) {
        return Err(rpc_fail(RpcError::app(codes::NOT_FOUND, "The folder does not exist").with("path", path)));
    }
    vault_ops::write(v, &path, scene, None).map_err(rpc_fail)?;
    Ok(json!({"path": path}))
}
