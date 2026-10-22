//! `vaultdraw`: a thin client over the control socket. Exit codes: 0 ok, 1 CLI error,
//! 2 the app refused, 3 app not running (or not ready), 4 protocol mismatch.

mod backend;
mod cli;
mod commands;
mod error;
mod headless;
mod render;
mod rpc;
mod snapshot;

use clap::error::ErrorKind;
use clap::Parser;

fn main() {
    let cli = match cli::Cli::try_parse() {
        Ok(c) => c,
        Err(e) => {
            // clap exits 2 on usage errors; the contract reserves 2 for "the app refused".
            let ok = matches!(e.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion);
            let _ = e.print();
            std::process::exit(if ok { 0 } else { error::EXIT_CLI });
        }
    };
    if let Err(f) = commands::run(&cli) {
        eprintln!("{f}");
        std::process::exit(f.exit);
    }
}
