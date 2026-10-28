//! `vaultdraw launch [--safe]`: start the app, or hand the request to the running one.
//! The only command that starts the app; every other one needs it running or reads the vault
//! on disk.

use super::{emit, rpc};
use crate::cli::Cli;
use crate::error::Fail;
use crate::rpc::request_line;
use serde_json::json;
use std::process::{Command, Stdio};
use vaultdraw_protocol::methods::{self, roles};

/// The app binary on Linux and Windows (macOS starts the bundle by name).
const APP_BINARY: &str = "excalidraw-vault";
/// Overrides where the app is (a path to the binary, or the bundle name on macOS).
const ENV_APP: &str = "VAULTDRAW_APP";

/// Program and arguments that start the app.
fn start_command(safe: bool, profile: Option<&str>, macos: bool, app: Option<&str>) -> (String, Vec<String>) {
    let flag = |mut v: Vec<String>| {
        if safe {
            v.push("--safe".into());
        }
        if let Some(p) = profile {
            v.push("--profile".into());
            v.push(p.into());
        }
        v
    };
    if macos {
        // `--args` passes the rest to the app itself.
        let mut v = vec!["-a".to_string(), app.unwrap_or("Vaultdraw").to_string()];
        if safe || profile.is_some() {
            v.push("--args".into());
        }
        ("open".into(), flag(v))
    } else {
        (app.unwrap_or(APP_BINARY).to_string(), flag(Vec::new()))
    }
}

pub fn run(cli: &Cli, safe: bool) -> Result<(), Fail> {
    let argv: Vec<&str> = if safe { vec!["--safe"] } else { vec![] };
    let params = json!({ "argv": argv, "cwd": std::env::current_dir().ok() });
    if cli.print_request {
        println!("{}", request_line(methods::APP_OPEN, Some(params)));
        return Ok(());
    }
    let rpc = rpc(cli)?;
    match rpc.connect() {
        Ok(mut client) => {
            // Running: it focuses its window and, for --safe, asks the user before restarting.
            rpc.call_on(&mut client, methods::RPC_HELLO, Some(json!({ "role": roles::URI, "client": "vaultdraw-cli" })))?;
            rpc.call_on(&mut client, methods::APP_OPEN, Some(params))?;
            emit(cli.json, &json!({"started": false}), || {
                if safe { "Vaultdraw is running: it will ask you to confirm the safe start".into() } else { "Vaultdraw is running".into() }
            });
            Ok(())
        }
        Err(f) if f.not_running() => {
            let app = std::env::var(ENV_APP).ok().filter(|v| !v.is_empty());
            let (program, args) = start_command(safe, cli.profile.as_deref(), cfg!(target_os = "macos"), app.as_deref());
            Command::new(&program)
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| Fail::cli(format!("cannot start Vaultdraw with {program}: {e} (set {ENV_APP} to the app)")))?;
            emit(cli.json, &json!({"started": true, "safe": safe}), || if safe { "starting Vaultdraw in safe start".into() } else { "starting Vaultdraw".into() });
            Ok(())
        }
        Err(f) => Err(f),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_opens_the_bundle_and_passes_the_flag_after_args() {
        assert_eq!(start_command(false, None, true, None), ("open".to_string(), vec!["-a".to_string(), "Vaultdraw".into()]));
        let (p, a) = start_command(true, None, true, None);
        assert_eq!((p.as_str(), a), ("open", ["-a", "Vaultdraw", "--args", "--safe"].map(String::from).to_vec()));
        assert_eq!(start_command(true, None, true, Some("/Apps/V.app")).1[1], "/Apps/V.app");
    }

    #[test]
    fn other_systems_run_the_binary_with_the_flag() {
        assert_eq!(start_command(false, Some("work"), false, None).1, vec!["--profile", "work"]);
        assert_eq!(start_command(false, Some("work"), true, None).1, vec!["-a", "Vaultdraw", "--args", "--profile", "work"]);
        assert_eq!(start_command(true, None, false, None), (APP_BINARY.to_string(), vec!["--safe".to_string()]));
        assert_eq!(start_command(false, None, false, Some("/opt/v")), ("/opt/v".to_string(), vec![]));
    }
}
