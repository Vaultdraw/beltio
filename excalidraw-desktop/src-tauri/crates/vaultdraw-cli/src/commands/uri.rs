//! `vaultdraw uri <url>`: hand a `vaultdraw://` link to the running app, as the OS would.

use super::{emit, rpc};
use crate::cli::Cli;
use crate::error::{Fail, EXIT_REFUSED};
use crate::rpc::request_line;
use serde_json::{json, Value};
use vaultdraw_core::uri;
use vaultdraw_protocol::methods::{self, roles};

pub fn run(cli: &Cli, url: &str) -> Result<(), Fail> {
    // The same parser the app uses: a bad link is refused here, before any connection.
    uri::parse(url).map_err(|e| Fail::new(EXIT_REFUSED, e.to_string(), "INVALID_URI"))?;
    let params = json!({ "url": url });
    if cli.print_request {
        println!("{}", request_line(methods::URI_HANDLE, Some(params)));
        return Ok(());
    }
    let rpc = rpc(cli)?;
    let mut client = rpc.connect()?;
    // The most limited role: it can hand over links and nothing else.
    rpc.call_on(&mut client, methods::RPC_HELLO, Some(json!({ "role": roles::URI, "client": "vaultdraw-cli" })))?;
    let v = rpc.call_on(&mut client, methods::URI_HANDLE, Some(params))?;
    emit(cli.json, &v, || human(&v));
    Ok(())
}

fn human(v: &Value) -> String {
    match v.get("status").and_then(Value::as_str) {
        Some("asking") => "asking: Vaultdraw is waiting for you to confirm".to_string(),
        Some("queued") => "queued: Vaultdraw will run it when its window is ready".to_string(),
        _ => "done".to_string(),
    }
}
