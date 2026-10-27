//! One handler per subcommand. Each prints its own output and returns a `Fail` on error.

mod app;
mod diag;
mod events;
mod export;
mod files;
mod launch;
mod scene;
mod tabs;
mod uri;

use crate::cli::{Cli, CmdAction, CmdArgs, Command, ConfigAction};
use crate::error::Fail;
use crate::rpc::{request_line, resolve_socket, Rpc};
use crate::{backend, render, snapshot};
use clap::CommandFactory;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use vaultdraw_protocol::{methods, API_LEVEL, API_MIN};

pub(super) fn emit(json: bool, value: &Value, human: impl FnOnce() -> String) {
    if json {
        println!("{}", serde_json::to_string(value).unwrap_or_default());
    } else {
        println!("{}", human());
    }
}

pub fn run(cli: &Cli) -> Result<(), Fail> {
    match &cli.command {
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            shell.generate(&mut cmd, &mut std::io::stdout());
            Ok(())
        }
        Command::Man => clap_mangen::Man::new(Cli::command()).render(&mut std::io::stdout()).map_err(|e| Fail::cli(e.to_string())),
        Command::Status => request(cli, methods::APP_STATUS, None, |v| render::status(v), true),
        Command::Methods => request(cli, methods::RPC_DISCOVER, None, |v| render::methods(v), false),
        Command::Version => version(cli),
        Command::Raw => raw(cli),
        Command::Cmd(args) => cmd(cli, args),
        Command::Ls { dir, recursive } => files::ls(cli, dir.as_deref(), *recursive),
        Command::Search { query, limit } => files::search(cli, query, *limit),
        Command::Open { target, new_tab, wait } => files::open(cli, target, *new_tab, *wait),
        Command::New { path, from } => files::new(cli, path, from.as_deref()),
        Command::Cat { target } => files::cat(cli, target),
        Command::Write { target, expected_revision, create } => files::write(cli, target, expected_revision.as_deref(), *create),
        Command::Mv { from, to } => files::mv(cli, from, to),
        Command::Trash { target } => files::trash(cli, target),
        Command::Export(args) => export::run(cli, args),
        Command::Links { target, backlinks } => files::links(cli, target, *backlinks),
        Command::Tags => files::tags(cli),
        Command::Scene { action } => scene::run(cli, action),
        Command::Mcp => crate::mcp::run(cli),
        Command::Tabs => tabs::list(cli),
        Command::Tab { action } => tabs::run(cli, action),
        Command::Config { action: ConfigAction::Check { strict } } => diag::config_check(cli, *strict),
        Command::Config { action: ConfigAction::Schema } => diag::config_schema(),
        Command::Config { action } => app::config(cli, action),
        Command::Doctor => diag::doctor(cli),
        Command::Events { topic } => events::stream(cli, topic),
        Command::Uri { url } => uri::run(cli, url),
        Command::Launch { safe } => launch::run(cli, *safe),
        Command::Quit => app::quit(cli),
        Command::Vault { action } => app::vault(cli, action.as_ref()),
    }
}

/// The connection settings of this invocation.
pub(super) fn rpc(cli: &Cli) -> Result<Rpc, Fail> {
    Ok(Rpc::new(resolve_socket(cli.socket.as_deref())?, cli.timeout))
}

/// Params of a file target: `{path}` for anything with a `/` or a `.excalidraw` suffix, else
/// `{file}` (a link-style name); `--path` / `--file` force either. One place, every command.
pub(super) fn target(cli: &Cli, t: &str) -> serde_json::Map<String, Value> {
    let by_path = cli.force_path || (!cli.force_file && (t.contains('/') || t.ends_with(vaultdraw_core::DRAWING_EXT)));
    let mut m = serde_json::Map::new();
    m.insert(if by_path { "path" } else { "file" }.into(), json!(t));
    m
}

/// Prints one line to stdout and flushes; false when the reader is gone (closed pipe).
pub(super) fn out_line(s: &str) -> bool {
    let mut o = std::io::stdout().lock();
    writeln!(o, "{s}").and_then(|()| o.flush()).is_ok()
}

/// Send one request and print its result. `status_json` makes "not running" print
/// `{"running":false}` in `--json` mode (the exit code stays 3).
pub(super) fn request(cli: &Cli, method: &str, params: Option<Value>, human: impl Fn(&Value) -> String, status_json: bool) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(method, params));
        return Ok(());
    }
    let rpc = Rpc::new(resolve_socket(cli.socket.as_deref())?, cli.timeout);
    match rpc.call(method, params) {
        Ok(v) => {
            emit(cli.json, &v, || human(&v));
            Ok(())
        }
        Err(f) => {
            if status_json && cli.json && f.not_running() {
                println!("{}", json!({"running": false}));
            }
            Err(f)
        }
    }
}

/// Like [`request`] for the read methods: the result comes from the app or, with no app
/// running, from the vault on disk (same JSON either way).
pub(super) fn read_request(cli: &Cli, method: &str, params: Option<Value>, human: impl Fn(&Value) -> String) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(method, params));
        return Ok(());
    }
    let v = backend::read(cli, &rpc(cli)?, method, params)?;
    emit(cli.json, &v, || human(&v));
    Ok(())
}

fn version(cli: &Cli) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(methods::APP_STATUS, None));
        return Ok(());
    }
    let app = resolve_socket(cli.socket.as_deref())
        .ok()
        .and_then(|s| Rpc::new(s, cli.timeout.min(5)).call(methods::APP_STATUS, None).ok());
    let cli_ver = env!("CARGO_PKG_VERSION");
    let value = json!({
        "cli": cli_ver, "api": API_LEVEL, "apiMin": API_MIN,
        "app": app.as_ref().map(|a| json!({"version": a.get("app"), "api": a.get("api")})),
    });
    emit(cli.json, &value, || {
        let mut out = format!("vaultdraw {cli_ver} (api {API_LEVEL})");
        match &app {
            Some(a) => out.push_str(&format!(
                "\nVaultdraw {} (api {})",
                a.get("app").and_then(Value::as_str).unwrap_or("?"),
                a.get("api").and_then(Value::as_u64).unwrap_or(0)
            )),
            None => out.push_str("\nVaultdraw is not running"),
        }
        out
    });
    Ok(())
}

fn cmd(cli: &Cli, args: &CmdArgs) -> Result<(), Fail> {
    match (&args.action, &args.id) {
        (Some(CmdAction::List { ids }), _) => cmd_list(cli, *ids),
        (Some(CmdAction::Run { id }), _) | (None, Some(id)) => {
            let params = Some(json!({ "id": id }));
            request(
                cli,
                methods::COMMAND_RUN,
                params,
                |v| {
                    let id = v.get("id").and_then(Value::as_str).unwrap_or("");
                    if v.get("ran").and_then(Value::as_bool) == Some(false) { format!("did not run {id}") } else { format!("ran {id}") }
                },
                false,
            )
        }
        (None, None) => Err(Fail::cli("missing command id (usage: vaultdraw cmd <id> | cmd list | cmd run <id>)")),
    }
}

fn cmd_list(cli: &Cli, ids: bool) -> Result<(), Fail> {
    if cli.print_request {
        println!("{}", request_line(methods::COMMAND_LIST, None));
        return Ok(());
    }
    let live = resolve_socket(cli.socket.as_deref()).and_then(|s| Rpc::new(s, cli.timeout).call(methods::COMMAND_LIST, None));
    let result = match live {
        Ok(v) => v,
        Err(f) if f.not_running() => {
            let list = snapshot::commands().map_err(|s| if s.not_running() { f } else { s })?;
            json!({ "commands": list })
        }
        Err(f) => return Err(f),
    };
    let list = result.get("commands").and_then(Value::as_array).cloned().unwrap_or_default();
    if ids {
        let mut out = std::io::stdout().lock();
        for c in &list {
            if let Some(id) = c.get("id").and_then(Value::as_str) {
                let _ = writeln!(out, "{id}");
            }
        }
    } else {
        emit(cli.json, &result, || render::commands(&list));
    }
    Ok(())
}

/// `vaultdraw raw`: each stdin line is sent as is (it must be JSON); reply lines are printed
/// until one with an id arrives (requests without an id, i.e. notifications, get no reply).
fn raw(cli: &Cli) -> Result<(), Fail> {
    let rpc = Rpc::new(resolve_socket(cli.socket.as_deref())?, cli.timeout);
    let mut client = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for (n, line) in stdin.lock().lines().enumerate() {
        let line = line.map_err(|e| Fail::cli(format!("cannot read stdin: {e}")))?;
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).map_err(|e| Fail::cli(format!("stdin line {}: invalid JSON: {e}", n + 1)))?;
        if cli.print_request {
            let _ = writeln!(out, "{}", serde_json::to_string(&req).unwrap_or_default());
            continue;
        }
        if client.is_none() {
            client = Some(rpc.connect()?);
        }
        let c = client.as_mut().expect("connected above");
        c.send(&req)?;
        if req.get("id").map_or(true, Value::is_null) {
            continue;
        }
        while let Some(reply) = c.read_line()? {
            let _ = out.write_all(&reply);
            let _ = out.write_all(b"\n");
            let is_reply = serde_json::from_slice::<Value>(&reply).is_ok_and(|v| v.get("method").is_none());
            if is_reply {
                break;
            }
        }
    }
    Ok(())
}
