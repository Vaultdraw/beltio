//! Argument definitions (clap derive).

use clap::{Args, Parser, Subcommand};
use clap_complete::Shell;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "vaultdraw", version, about = "Control a running Vaultdraw from the command line", propagate_version = true)]
pub struct Cli {
    /// Print stable JSON (the raw result) instead of human text
    #[arg(long, global = true)]
    pub json: bool,
    /// Control socket path (default: $VAULTDRAW_SOCKET, else the instance's socket)
    #[arg(long, global = true, value_name = "PATH")]
    pub socket: Option<PathBuf>,
    /// Vault folder for offline (headless) reads; with a running app it must be the app's vault
    #[arg(long, global = true, value_name = "PATH")]
    pub vault: Option<PathBuf>,
    /// Read the vault directly, never through the app (refused while the app is running)
    #[arg(long, global = true)]
    pub offline: bool,
    /// Print the JSON-RPC request line instead of sending it
    #[arg(long, global = true)]
    pub print_request: bool,
    /// Seconds to wait for the app's reply
    #[arg(long, global = true, value_name = "SECS", default_value_t = 30)]
    pub timeout: u64,
    /// Treat target arguments as exact vault-relative paths
    #[arg(long = "path", global = true, conflicts_with = "force_file")]
    pub force_path: bool,
    /// Treat target arguments as link-style file names
    #[arg(long = "file", global = true)]
    pub force_file: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Is the app running: version, vault, active drawing
    Status,
    /// CLI and API versions (plus the app's, when it is running)
    Version,
    /// List every method of the control API
    Methods,
    /// Send JSON-RPC lines from stdin and print the reply lines (debugging)
    Raw,
    /// Palette commands: list them, run one
    Cmd(CmdArgs),
    /// List drawings and folders (folders first, trailing /)
    Ls {
        /// Folder, vault-relative (default: the vault root)
        dir: Option<String>,
        #[arg(short, long)]
        recursive: bool,
    },
    /// Search the vault (names, text, tags)
    Search {
        query: String,
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
    },
    /// Open a drawing in the window
    Open {
        /// Path (contains / or ends in .excalidraw) or link-style name
        target: String,
        #[arg(long)]
        new_tab: bool,
        /// Block until the drawing's tab is closed (or the app quits)
        #[arg(long)]
        wait: bool,
    },
    /// Create a drawing, optionally from a scene file (or - for stdin)
    New {
        path: String,
        #[arg(long, value_name = "FILE")]
        from: Option<String>,
    },
    /// Print a drawing's scene JSON
    Cat { target: String },
    /// Write a scene from stdin (refuses when the drawing changed since it was read)
    Write {
        target: String,
        /// Fail with CONFLICT unless the drawing is at this revision
        #[arg(long, value_name = "R", conflicts_with = "create")]
        expected_revision: Option<String>,
        /// Create only: fail when the drawing exists
        #[arg(long)]
        create: bool,
    },
    /// Move or rename a drawing or folder (a trailing / on <to> means into that folder)
    Mv { from: String, to: String },
    /// Move a drawing to the trash
    Trash { target: String },
    /// Outgoing links of a drawing, or its backlinks
    Links {
        target: String,
        #[arg(long)]
        backlinks: bool,
    },
    /// Every tag in the vault with its drawing count
    Tags,
    /// List open tabs
    Tabs,
    /// Focus or close a tab
    Tab {
        #[command(subcommand)]
        action: TabAction,
    },
    /// Read or change the app's config
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Stream app events as NDJSON (snapshot first, then changes)
    Events {
        /// Topics: vault, file, tab, config, command (default all)
        #[arg(long, value_delimiter = ',', value_name = "TOPICS")]
        topic: Vec<String>,
    },
    /// Quit the app (same save barrier as Cmd+Q)
    Quit,
    /// Show the open vault, or open another
    Vault {
        #[command(subcommand)]
        action: Option<VaultAction>,
    },
    /// Print a shell completion script
    Completions {
        #[arg(value_enum)]
        shell: CompletionShell,
    },
    /// Print the vaultdraw(1) man page
    #[command(hide = true)]
    Man,
}

#[derive(Args, Debug)]
#[command(args_conflicts_with_subcommands = true, subcommand_required = false, arg_required_else_help = true)]
pub struct CmdArgs {
    #[command(subcommand)]
    pub action: Option<CmdAction>,
    /// Command id to run (short form of `cmd run <id>`)
    #[arg(value_name = "ID")]
    pub id: Option<String>,
}

#[derive(Subcommand, Debug)]
pub enum CmdAction {
    /// List palette commands (works without the app, from its snapshot)
    List {
        /// One command id per line (for shell completion)
        #[arg(long)]
        ids: bool,
    },
    /// Run a palette command by id
    Run {
        #[arg(value_name = "ID")]
        id: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum TabAction {
    /// Focus a tab by id or 1-based index
    Focus { id: String },
    /// Close a tab by id or file target
    Close { id: String },
}

#[derive(Subcommand, Debug)]
pub enum ConfigAction {
    /// Print a value by dotted key (the whole config without a key)
    Get { key: Option<String> },
    /// Set a value (parsed as JSON, else taken as a string)
    Set { key: String, value: String },
    /// Print the config file path (no app needed)
    Path,
}

#[derive(Subcommand, Debug)]
pub enum VaultAction {
    /// Name, path and read-only flag of the open vault
    Info,
    /// Open a vault folder in the window
    Open { path: PathBuf },
}

#[derive(clap::ValueEnum, Clone, Copy, Debug)]
pub enum CompletionShell {
    Bash,
    Zsh,
    Fish,
    Elvish,
    Nushell,
}

impl CompletionShell {
    pub fn generate(self, cmd: &mut clap::Command, out: &mut dyn std::io::Write) {
        let name = "vaultdraw";
        match self {
            Self::Bash => clap_complete::generate(Shell::Bash, cmd, name, out),
            Self::Zsh => clap_complete::generate(Shell::Zsh, cmd, name, out),
            Self::Fish => clap_complete::generate(Shell::Fish, cmd, name, out),
            Self::Elvish => clap_complete::generate(Shell::Elvish, cmd, name, out),
            Self::Nushell => clap_complete::generate(clap_complete_nushell::Nushell, cmd, name, out),
        }
    }
}
