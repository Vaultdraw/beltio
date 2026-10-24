//! Linux: tells the desktop that Vaultdraw opens `vaultdraw://` links and `.excalidraw` /
//! `.excalidrawlib` files, for installs that no package registers (AppImage, a binary copied
//! to a folder). Only the palette command `links.registerHandlers` starts it, after the user
//! confirmed a dialog that lists the exact files.
//!
//! Safety rules, each with a test:
//! - writes only two fixed files under the user's data folder (`~/.local/share`), never
//!   system-wide, and takes no path from the caller,
//! - never replaces a file that is not ours (ours has the "Managed by Vaultdraw" marker),
//! - the program path is quoted for the `.desktop` format and refused when it has control
//!   characters (no injected keys),
//! - runs only `update-desktop-database`, `update-mime-database` and
//!   `xdg-mime default vaultdraw.desktop x-scheme-handler/vaultdraw` (the link scheme only;
//!   file types stay with whatever the user already uses: they appear in "Open With"),
//! - the generating code is plain text and runs on every OS, so it is unit-tested on macOS;
//!   only the command is Linux-only. Verified on a real Linux desktop in the Linux step.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::{err, Result};

const DESKTOP_TEMPLATE: &str = include_str!("../../linux/vaultdraw.desktop");
const MIME_XML: &str = include_str!("../../linux/vaultdraw-mime.xml");
pub(crate) const MARKER: &str = "Managed by Vaultdraw";
const DESKTOP_NAME: &str = "vaultdraw.desktop";
const MIME_NAME: &str = "vaultdraw.xml";

/// What exists at a target path now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum State {
    /// Nothing there: will be created.
    New,
    /// Already ours with the same text: nothing to do.
    Same,
    /// Ours with different text (for example the program moved): will be rewritten.
    Update,
    /// Not ours: left alone.
    Foreign,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct FilePlan {
    pub path: String,
    pub state: State,
    #[serde(skip)]
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Plan {
    pub files: Vec<FilePlan>,
    /// Commands run afterwards, best effort (shown to the user in the dialog).
    pub commands: Vec<String>,
}

/// A program path as the `Exec` key wants it: quoted, with the characters the format reserves
/// escaped. Control characters (a newline would start a new key) are refused.
pub(crate) fn exec_value(program: &str) -> Result<String> {
    if program.is_empty() || !Path::new(program).is_absolute() {
        return Err(err("INVALID_PATH", "The program path must be absolute"));
    }
    if program.chars().any(char::is_control) {
        return Err(err("INVALID_PATH", "The program path has control characters"));
    }
    let mut out = String::from("\"");
    for c in program.chars() {
        // Desktop Entry spec: inside quotes, `"`, backtick, `$` and `\` are escaped with `\`
        // (and the string escape layer doubles the backslash). `%` is doubled for field codes.
        match c {
            '"' | '`' | '$' => {
                out.push_str("\\\\");
                out.push(c);
            }
            '\\' => out.push_str("\\\\\\\\"),
            '%' => out.push_str("%%"),
            c => out.push(c),
        }
    }
    out.push('"');
    Ok(out)
}

pub(crate) fn desktop_text(program: &str) -> Result<String> {
    Ok(DESKTOP_TEMPLATE.replace("{{exec}}", &exec_value(program)?))
}

/// Where the user's data lives: `$XDG_DATA_HOME` when absolute, else `$HOME/.local/share`.
pub(crate) fn data_home(xdg: Option<&str>, home: Option<&str>) -> Result<PathBuf> {
    if let Some(x) = xdg.filter(|x| Path::new(x).is_absolute()) {
        return Ok(PathBuf::from(x));
    }
    match home.filter(|h| Path::new(h).is_absolute()) {
        Some(h) => Ok(Path::new(h).join(".local/share")),
        None => Err(err("NOT_FOUND", "Cannot find your data folder (HOME is not set)")),
    }
}

fn state_of(path: &Path, text: &str) -> Result<State> {
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::New),
        Err(e) => Err(crate::ioerr(e)),
        // A symlink or folder is never ours to replace.
        Ok(m) if !m.is_file() => Ok(State::Foreign),
        Ok(_) => {
            let now = std::fs::read(path).map_err(crate::ioerr)?;
            let now = String::from_utf8_lossy(&now);
            Ok(if now == text {
                State::Same
            } else if now.contains(MARKER) {
                State::Update
            } else {
                State::Foreign
            })
        }
    }
}

/// What registering would do, without doing it.
pub(crate) fn plan(data_home: &Path, program: &str) -> Result<Plan> {
    let desktop = data_home.join("applications").join(DESKTOP_NAME);
    let mime = data_home.join("mime/packages").join(MIME_NAME);
    let dtext = desktop_text(program)?;
    let files = vec![
        FilePlan { state: state_of(&desktop, &dtext)?, path: desktop.to_string_lossy().into_owned(), text: dtext },
        FilePlan { state: state_of(&mime, MIME_XML)?, path: mime.to_string_lossy().into_owned(), text: MIME_XML.to_string() },
    ];
    let commands = vec![
        format!("update-desktop-database {}", data_home.join("applications").display()),
        format!("update-mime-database {}", data_home.join("mime").display()),
        format!("xdg-mime default {DESKTOP_NAME} x-scheme-handler/vaultdraw"),
    ];
    Ok(Plan { files, commands })
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct Report {
    pub written: Vec<String>,
    pub skipped: Vec<String>,
    /// Helper programs that were missing or failed (the files are still in place).
    pub notes: Vec<String>,
}

/// Writes the planned files (new or ours only) and runs the helper programs. `run` is the
/// process runner (injected so tests never start anything).
pub(crate) fn apply(plan: &Plan, run: &dyn Fn(&str, &[&str]) -> std::result::Result<(), String>) -> Result<Report> {
    let mut report = Report { written: vec![], skipped: vec![], notes: vec![] };
    for f in &plan.files {
        let path = Path::new(&f.path);
        // Decided again now: the state may have changed since the dialog.
        match state_of(path, &f.text)? {
            State::Same => report.skipped.push(format!("{} (already up to date)", f.path)),
            State::Foreign => report.skipped.push(format!("{} (not created by Vaultdraw, left alone)", f.path)),
            s @ (State::New | State::Update) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(crate::ioerr)?;
                }
                if s == State::New {
                    crate::write_atomic_new(path, f.text.as_bytes())?;
                } else {
                    crate::write_atomic(path, f.text.as_bytes())?;
                }
                report.written.push(f.path.clone());
            }
        }
    }
    if !report.written.is_empty() {
        for cmd in &plan.commands {
            let mut parts = cmd.split(' ');
            let program = parts.next().unwrap_or_default();
            let args: Vec<&str> = parts.collect();
            if let Err(e) = run(program, &args) {
                report.notes.push(format!("{program}: {e}"));
            }
        }
    }
    Ok(report)
}

fn run_program(program: &str, args: &[&str]) -> std::result::Result<(), String> {
    match std::process::Command::new(program).args(args).status() {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("exited with {s}")),
        Err(e) => Err(e.to_string()),
    }
}

/// The program to write into `Exec`: the AppImage file when running from one, else this binary.
fn program() -> Result<String> {
    if let Some(p) = std::env::var_os("APPIMAGE").filter(|p| Path::new(p).is_absolute()) {
        return Ok(p.to_string_lossy().into_owned());
    }
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(crate::ioerr)
}

fn home_dirs() -> Result<PathBuf> {
    data_home(std::env::var("XDG_DATA_HOME").ok().as_deref(), std::env::var("HOME").ok().as_deref())
}

/// The dialog's text: what would be written, and what runs. Writes nothing.
#[tauri::command]
pub(crate) async fn links_handlers_plan() -> Result<Plan> {
    if !cfg!(target_os = "linux") {
        return Err(err("UNSUPPORTED", "Registering link and file handlers is for Linux; macOS registers them from the app bundle"));
    }
    plan(&home_dirs()?, &program()?)
}

/// Writes the files after the user confirmed the dialog. Takes no argument: it can only write
/// the two fixed files.
#[tauri::command]
pub(crate) async fn links_handlers_apply() -> Result<Report> {
    if !cfg!(target_os = "linux") {
        return Err(err("UNSUPPORTED", "Registering link and file handlers is for Linux"));
    }
    let p = plan(&home_dirs()?, &program()?)?;
    tauri::async_runtime::spawn_blocking(move || apply(&p, &run_program))
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?
}

#[cfg(test)]
mod tests;
