//! `vaultdraw profile list|use|new|duplicate|delete`: local file operations on the config
//! folder (no app needed). A running app sees the change through its config watcher.

use super::emit;
use crate::cli::{Cli, ProfileAction};
use crate::error::Fail;
use serde_json::json;
use std::io::{BufRead, IsTerminal, Write};
use vaultdraw_core::config::{active_profile, create_profile, delete_profile, list_profiles, resolve_dirs_with, use_profile, Dirs, DEFAULT_PROFILE};

fn dirs() -> Result<Dirs, Fail> {
    resolve_dirs_with(|k| std::env::var_os(k), cfg!(windows), None).map_err(|e| Fail::cli(e.message))
}

fn fail(e: vaultdraw_core::error::NativeError) -> Fail {
    Fail::cli(e.message)
}

pub fn run(cli: &Cli, action: &ProfileAction) -> Result<(), Fail> {
    let dirs = dirs()?;
    match action {
        ProfileAction::List => {
            let active = active_profile(&dirs);
            let names = list_profiles(&dirs);
            emit(cli.json, &json!({ "active": active.as_deref().unwrap_or(DEFAULT_PROFILE), "profiles": names }), || {
                let mark = |n: &str, on: bool| format!("{} {n}", if on { "*" } else { " " });
                let mut lines = vec![mark(DEFAULT_PROFILE, active.is_none())];
                lines.extend(names.iter().map(|n| mark(n, active.as_deref() == Some(n))));
                lines.join("\n")
            });
            Ok(())
        }
        ProfileAction::Use { name } => {
            use_profile(&dirs, Some(name)).map_err(fail)?;
            emit(cli.json, &json!({ "active": name }), || format!("using profile {name}"));
            Ok(())
        }
        ProfileAction::New { name, from } => {
            create_profile(&dirs, name, from.as_deref()).map_err(fail)?;
            emit(cli.json, &json!({ "created": name }), || format!("created profile {name} (switch with `vaultdraw profile use {name}`)"));
            Ok(())
        }
        ProfileAction::Duplicate { name, new_name } => {
            create_profile(&dirs, new_name, Some(name)).map_err(fail)?;
            emit(cli.json, &json!({ "created": new_name, "from": name }), || format!("copied {name} to {new_name}"));
            Ok(())
        }
        ProfileAction::Delete { name, yes } => {
            if !*yes && !confirm(name) {
                return Err(Fail::cli(format!("not deleted: run `vaultdraw profile delete {name} --yes` to delete it and its files")));
            }
            delete_profile(&dirs, name).map_err(fail)?;
            emit(cli.json, &json!({ "deleted": name }), || format!("deleted profile {name}"));
            Ok(())
        }
    }
}

/// Asks on a terminal; without one the answer is no (scripts pass `--yes`).
fn confirm(name: &str) -> bool {
    if !std::io::stdin().is_terminal() {
        return false;
    }
    eprint!("Delete profile {name} and its files? [y/N] ");
    let _ = std::io::stderr().flush();
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line).is_ok() && matches!(line.trim(), "y" | "Y" | "yes")
}
