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
    /// Use this profile (a folder of settings in the config folder); see `vaultdraw profile list`
    #[arg(long, global = true, value_name = "NAME")]
    pub profile: Option<String>,
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
        /// Results to return, 1 to 200 (default 50)
        #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..=200))]
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
    /// Create a drawing, optionally from a scene file (or - for stdin); a blank drawing gets your [paper] and [page] defaults (the app's, read from config.toml)
    New {
        path: String,
        #[arg(long, value_name = "FILE")]
        from: Option<String>,
    },
    /// Print a drawing's scene JSON
    Cat { target: String },
    /// Write a scene from stdin (refuses when the drawing changed since it was read); works with the app closed
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
    /// Render a drawing (or, with --out-dir, every drawing in a folder) to PNG, SVG or PDF through the running app
    Export(ExportArgs),
    /// Outgoing links of a drawing, or its backlinks
    Links {
        target: String,
        #[arg(long)]
        backlinks: bool,
    },
    /// Every tag in the vault with its drawing count
    Tags,
    /// Read and edit the drawing on screen (live: needs the running app)
    Scene {
        #[command(subcommand)]
        action: SceneAction,
    },
    /// Run the AI tools server (MCP) on standard input and output; started by an AI client, off until AI is turned on in Vaultdraw
    Mcp,
    /// Plugin commands: list what plugins declare, run one
    Plugin {
        #[command(subcommand)]
        action: PluginAction,
    },
    /// List open tabs
    Tabs,
    /// Focus or close a tab
    Tab {
        #[command(subcommand)]
        action: TabAction,
    },
    /// Back the vault up to a zip (works without the app; the vault is only read)
    Backup {
        /// Folder for the zip (default: `[backup] folder` in config.toml); must be outside the vault
        #[arg(long, value_name = "DIR")]
        to: Option<PathBuf>,
        /// Also include the file history
        #[arg(long)]
        history: bool,
        /// Leave out the vault's settings.toml
        #[arg(long)]
        no_settings: bool,
    },
    /// Restore a backup into a NEW folder (refuses a folder that exists; nothing is overwritten)
    Restore { zip: PathBuf, dir: PathBuf },
    /// Profiles: named sets of settings to switch between (no app needed)
    Profile {
        #[command(subcommand)]
        action: ProfileAction,
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
    /// Hand a vaultdraw:// link to the running app, as the OS would (open and search run now; switching vault, new and cmd ask you first)
    Uri {
        /// For example vaultdraw://open?file=Graphs/BFS
        url: String,
    },
    /// One read-only report for bug reports: versions, paths, config, extensions, index, socket (no app needed)
    Doctor,
    /// Start Vaultdraw, or focus it when it runs. --safe starts with the built-in extensions and plugins off (a running app asks you first). The only command that starts the app
    Launch {
        /// Safe start: built-in extensions and plugins off; nothing in your config is changed
        #[arg(long)]
        safe: bool,
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

#[derive(Args, Debug)]
pub struct ExportArgs {
    /// A drawing (path with / or .excalidraw, or a link-style name); with --out-dir, a folder (. for the vault root)
    pub target: String,
    /// Output .png/.svg/.pdf file, an existing folder, or - for stdout (default: the drawing's name here)
    #[arg(short = 'o', long, value_name = "FILE")]
    pub out: Option<String>,
    /// png, svg or pdf (default: from the -o extension, which must agree, else png)
    #[arg(long, value_parser = ["png", "svg", "pdf"])]
    pub format: Option<String>,
    /// Scale factor (the app's default is 1; not for pdf)
    #[arg(long, value_name = "N")]
    pub scale: Option<f64>,
    /// Render with the dark theme (not for pdf)
    #[arg(long)]
    pub dark: bool,
    /// Leave the background out (transparent; not for pdf)
    #[arg(long)]
    pub no_background: bool,
    /// Leave the pattern background out
    #[arg(long)]
    pub no_pattern: bool,
    /// Embed the scene in the file (PNG and SVG can be opened back as drawings; not for pdf)
    #[arg(long)]
    pub embed_scene: bool,
    /// Export the page-shaped frame of the drawing (not for pdf)
    #[arg(long)]
    pub page: bool,
    /// Export only this frame, by element id, else by name (png and svg; wins over --page)
    #[arg(long, value_name = "ID|NAME")]
    pub frame: Option<String>,
    /// Space around the drawing in px, 0 to 200 (png and svg; default 10; a frame has none)
    #[arg(long, value_name = "PX", value_parser = clap::value_parser!(u32).range(0..=200))]
    pub padding: Option<u32>,
    /// Export every drawing of the folder TARGET (recursively) into DIR, keeping subfolders
    #[arg(long, value_name = "DIR", conflicts_with = "out")]
    pub out_dir: Option<String>,
    /// Overwrite an existing output file; write to a terminal stdout
    #[arg(long)]
    pub force: bool,
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
pub enum SceneAction {
    /// List the elements of the drawing on screen (id, type, position, size, text)
    Read {
        /// The drawing (path or link-style name); default: the drawing on screen
        target: Option<String>,
        /// Which elements: all, in the visible area, or selected
        #[arg(long, value_parser = ["all", "viewport", "selection"], value_name = "SCOPE")]
        scope: Option<String>,
        /// Only these element types, comma separated (rectangle, text, arrow ...)
        #[arg(long = "type", value_delimiter = ',', value_name = "TYPES")]
        types: Vec<String>,
        /// Only these element ids, comma separated
        #[arg(long = "id", value_delimiter = ',', value_name = "IDS")]
        ids: Vec<String>,
        /// Elements to return, 1 to 2000 (default 200)
        #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..=2000))]
        limit: Option<u32>,
        /// Elements to skip (paging), 0 or more
        #[arg(long, value_name = "N")]
        offset: Option<u32>,
    },
    /// Elements by id (1 to 100)
    Get {
        #[arg(required = true, num_args = 1.., value_name = "ID")]
        ids: Vec<String>,
        /// The drawing (path or link-style name); default: the drawing on screen
        #[arg(long = "in", value_name = "TARGET")]
        target: Option<String>,
    },
    /// The selected elements
    Selection {
        /// The drawing (path or link-style name); default: the drawing on screen
        target: Option<String>,
    },
    /// Create a new drawing from scene operations (a JSON array, or { "ops": [...] }); needs the app running, leaves no blank file when an operation is invalid
    Create {
        /// The new drawing's path (the .excalidraw ending is optional)
        path: String,
        /// Operations file, or - for stdin
        #[arg(long, value_name = "FILE", default_value = "-")]
        ops: String,
    },
    /// Apply scene operations (a JSON array, or { "ops": [...] }) as one undo step
    Apply {
        /// The drawing (path or link-style name); default: the drawing on screen
        target: Option<String>,
        /// Operations file, or - for stdin
        #[arg(long, value_name = "FILE", default_value = "-")]
        ops: String,
        /// Refuse with CONFLICT unless the drawing is still at this version (from scene read)
        #[arg(long, value_name = "V")]
        if_version: Option<String>,
        /// Validate the operations without changing the drawing
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum PluginAction {
    /// List installed plugins and their commands (needs the app: it knows which are enabled)
    Commands {
        /// Only this plugin (its id)
        plugin: Option<String>,
    },
    /// Run a plugin command by its full id (<plugin>.<command>); the plugin loads on first use
    Run { id: String },
    /// List the methods enabled plugins expose to programs (needs the app)
    Methods {
        /// Only this plugin (its id)
        plugin: Option<String>,
    },
    /// Call a plugin method: JSON in (an argument, or - for standard input), JSON out
    Call {
        /// The plugin's id
        plugin: String,
        /// The method's name (see `plugin methods`)
        method: String,
        /// Params as a JSON value, or - to read them from standard input (default: {})
        params: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub enum TabAction {
    /// Focus a tab by id, 1-based number, drawing name or file target
    Focus { id: String },
    /// Close a tab by id, 1-based number, drawing name or file target
    Close { id: String },
}

#[derive(Subcommand, Debug)]
pub enum ProfileAction {
    /// List the profiles and mark the active one
    List,
    /// Choose the profile the app uses (`default` = none); a running app switches at once
    Use { name: String },
    /// Create a profile, empty or copied from another (`default` copies your Settings changes)
    New {
        name: String,
        #[arg(long, value_name = "PROFILE")]
        from: Option<String>,
    },
    /// Copy a profile under a new name
    Duplicate { name: String, new_name: String },
    /// Delete a profile and its files (asks first unless --yes)
    Delete {
        name: String,
        #[arg(long, short)]
        yes: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum ConfigAction {
    /// Print a value by dotted key (the whole config without a key)
    Get {
        key: Option<String>,
        /// Also say where the value comes from (default, config.toml or overrides.toml)
        #[arg(long, requires = "key")]
        source: bool,
    },
    /// Set a value (parsed as JSON, else taken as a string)
    Set { key: String, value: String },
    /// Check every config file against the schema: file, line, column, did-you-mean (no app needed)
    Check {
        /// Also fail (exit 1) on warnings, such as unknown keys
        #[arg(long)]
        strict: bool,
    },
    /// Print the JSON Schema of config.toml, for editors (no app needed)
    Schema,
    /// Print the config file path (no app needed)
    Path {
        /// Print every layer: config.toml, then overrides.toml (Settings changes)
        #[arg(long)]
        all: bool,
    },
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

#[cfg(test)]
mod numeric_flag_tests {
    //! Family sweep (hunter C-1, 2026-10-30): every numeric flag states its range in its help and
    //! the parser refuses a value outside it, instead of clamping it silently later
    //! (`search --limit 0` returned one result).
    use super::Cli;
    use clap::{error::ErrorKind, Command, CommandFactory};

    /// Numeric flags whose range the app checks (with a plain-word error), not the parser.
    const CHECKED_BY_THE_APP: &[(&str, &str, &str)] = &[("export", "scale", "the app refuses values outside 1 to 3 (control/params.ts)")];

    fn walk(cmd: &Command, path: &mut Vec<String>, out: &mut Vec<(Vec<String>, String, String)>) {
        for a in cmd.get_arguments() {
            let numeric = a.get_value_names().is_some_and(|v| v.iter().any(|n| matches!(n.as_str(), "N" | "PX")));
            if numeric {
                let help = a.get_help().map(|h| h.to_string()).unwrap_or_default();
                out.push((path.clone(), a.get_id().to_string(), help));
            }
        }
        for sub in cmd.get_subcommands() {
            path.push(sub.get_name().to_string());
            walk(sub, path, out);
            path.pop();
        }
    }

    /// "1 to 200" → (1, 200); "0 or more" → (0, u32::MAX).
    fn range(help: &str) -> Option<(u64, u64)> {
        if help.contains("0 or more") {
            return Some((0, u64::from(u32::MAX)));
        }
        let w: Vec<&str> = help.split(|c: char| !c.is_ascii_alphanumeric()).filter(|s| !s.is_empty()).collect();
        w.windows(3).find_map(|t| match (t[0].parse::<u64>(), t[1], t[2].parse::<u64>()) {
            (Ok(a), "to", Ok(b)) => Some((a, b)),
            _ => None,
        })
    }

    fn kind(path: &[String], flag: &str, value: &str) -> ErrorKind {
        let mut args = vec!["vaultdraw".to_string()];
        args.extend(path.iter().cloned());
        args.push(format!("--{flag}"));
        args.push(value.to_string());
        match Cli::command().try_get_matches_from(args) {
            Ok(_) => ErrorKind::DisplayHelp, // stands for "accepted"
            Err(e) => e.kind(),
        }
    }

    #[test]
    fn every_numeric_flag_states_and_enforces_its_range() {
        let mut flags = Vec::new();
        walk(&Cli::command(), &mut Vec::new(), &mut flags);
        assert!(flags.len() >= 4, "the sweep found the numeric flags: {flags:?}");
        for (path, flag, help) in flags {
            let at = format!("vaultdraw {} --{flag}", path.join(" "));
            if CHECKED_BY_THE_APP.iter().any(|(c, f, _)| path.last().map(String::as_str) == Some(*c) && *f == flag) {
                continue;
            }
            let (lo, hi) = range(&help).unwrap_or_else(|| panic!("{at}: the help must state the range (\"1 to 200\" or \"0 or more\"), got {help:?}"));
            for ok in [lo, hi] {
                assert_ne!(kind(&path, &flag, &ok.to_string()), ErrorKind::ValueValidation, "{at} {ok} is in the stated range");
            }
            if lo > 0 {
                assert_eq!(kind(&path, &flag, &(lo - 1).to_string()), ErrorKind::ValueValidation, "{at} {} must be refused, not clamped", lo - 1);
            }
            if hi < u64::from(u32::MAX) {
                assert_eq!(kind(&path, &flag, &(hi + 1).to_string()), ErrorKind::ValueValidation, "{at} {} must be refused, not clamped", hi + 1);
            }
        }
    }
}
