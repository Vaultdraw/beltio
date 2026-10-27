//! The method catalogue: names, JSON Schemas and which roles may call them by default.
//! `rpc.discover` returns this list; `tests/fixtures/api-v1.json` is its golden copy (a test
//! fails on any removed method or changed schema; additions regenerate the file with
//! `UPDATE_GOLDEN=1 cargo test -p vaultdraw-protocol`).

use serde_json::{json, Value};
use std::sync::OnceLock;

pub const RPC_DISCOVER: &str = "rpc.discover";
pub const RPC_HELLO: &str = "rpc.hello";
pub const APP_STATUS: &str = "app.status";
pub const APP_FOCUS: &str = "app.focus";
pub const APP_OPEN: &str = "app.open";
pub const URI_HANDLE: &str = "uri.handle";
pub const COMMAND_LIST: &str = "command.list";
pub const COMMAND_RUN: &str = "command.run";
pub const PLUGIN_COMMANDS: &str = "plugin.commands";
pub const PLUGIN_RUN: &str = "plugin.run";
pub const VAULT_INFO: &str = "vault.info";
pub const VAULT_OPEN: &str = "vault.open";
pub const VAULT_LIST: &str = "vault.list";
pub const VAULT_SEARCH: &str = "vault.search";
pub const VAULT_LINKS: &str = "vault.links";
pub const VAULT_TAGS: &str = "vault.tags";
pub const FILE_READ: &str = "file.read";
pub const FILE_WRITE: &str = "file.write";
pub const FILE_OPEN: &str = "file.open";
pub const FILE_CREATE: &str = "file.create";
pub const FILE_MOVE: &str = "file.move";
pub const FILE_TRASH: &str = "file.trash";
pub const EXPORT_RENDER: &str = "export.render";
pub const EXPORT_SPOOL: &str = "export.spool";
pub const TAB_LIST: &str = "tab.list";
pub const TAB_FOCUS: &str = "tab.focus";
pub const TAB_CLOSE: &str = "tab.close";
pub const CONFIG_GET: &str = "config.get";
pub const CONFIG_SET: &str = "config.set";
pub const APP_QUIT: &str = "app.quit";
pub const EVENTS_SUBSCRIBE: &str = "events.subscribe";
pub const EVENTS_UNSUBSCRIBE: &str = "events.unsubscribe";
pub const SCENE_READ: &str = "scene.read";
pub const SCENE_GET: &str = "scene.get";
pub const SCENE_SELECTION: &str = "scene.selection";
pub const SCENE_APPLY: &str = "scene.apply";
pub const SCENE_CREATE: &str = "scene.create";

/// Connection roles (a connection declares one with `rpc.hello`; default `cli`).
pub mod roles {
    pub const CLI: &str = "cli";
    /// `vaultdraw://` URIs and forwarded launches: the most limited role.
    pub const URI: &str = "uri";
    /// `vaultdraw mcp` (C7, gated by the AI master switch; refused until then).
    pub const MCP: &str = "mcp";
    pub const ALL: [&str; 3] = [CLI, URI, MCP];
}

/// One method of the control API.
#[derive(Debug, Clone)]
pub struct MethodSpec {
    pub name: &'static str,
    pub summary: &'static str,
    pub params: Value,
    pub result: Value,
    /// Roles allowed by default (config `[control] roles.<role>` may narrow further).
    pub roles: &'static [&'static str],
    /// Answered by the app's window (WebView bridge), not by Rust alone.
    pub window: bool,
    /// The AI tool that exposes this method to the `mcp` role (`None`: not an AI tool).
    pub mcp: Option<McpTool>,
    /// Name and shape may still change; left out of the golden file.
    pub experimental: bool,
}

/// How a method appears to AI clients (`vaultdraw mcp`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McpTool {
    pub name: &'static str,
    /// The tool changes the drawing or the vault.
    pub writes: bool,
}

impl MethodSpec {
    /// Whether `role` may call this method by default: the declared roles, plus `mcp` for
    /// every method that has an AI tool.
    pub fn allows(&self, role: &str) -> bool {
        self.roles.contains(&role) || (role == roles::MCP && self.mcp.is_some())
    }

    pub fn to_json(&self) -> Value {
        let mut effective: Vec<&str> = self.roles.to_vec();
        if self.allows(roles::MCP) && !effective.contains(&roles::MCP) {
            effective.push(roles::MCP);
        }
        let mut v = json!({
            "name": self.name,
            "summary": self.summary,
            "params": self.params,
            "result": self.result,
            "roles": effective,
            "window": self.window,
        });
        if let Some(t) = &self.mcp {
            v["mcp"] = json!({"tool": t.name, "writes": t.writes});
        }
        if self.experimental {
            v["experimental"] = json!(true);
        }
        v
    }
}

/// The AI tool of a method, if it has one (one table, so the list is easy to audit).
fn mcp_tool(method: &str) -> Option<McpTool> {
    let (name, writes) = match method {
        APP_STATUS => ("vaultdraw_status", false),
        VAULT_LIST => ("list_drawings", false),
        VAULT_SEARCH => ("search_vault", false),
        SCENE_READ => ("read_drawing", false),
        SCENE_SELECTION => ("get_selection", false),
        SCENE_APPLY => ("edit_drawing", true),
        SCENE_CREATE => ("create_drawing", true),
        _ => return None,
    };
    Some(McpTool { name, writes })
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": true})
}

const CLI_ONLY: &[&str] = &[roles::CLI];
const CLI_URI: &[&str] = &[roles::CLI, roles::URI];

/// Params for methods that take a file target: `path` (exact, vault-relative) or `file`
/// (link-style name); neither is required at schema level, the method needs one of them.
fn target(extra: Value) -> Value {
    let mut props = json!({"path": {"type": "string"}, "file": {"type": "string"}});
    if let (Some(p), Some(e)) = (props.as_object_mut(), extra.as_object()) {
        p.extend(e.clone());
    }
    obj(props, &[])
}

fn spec(name: &'static str, summary: &'static str, params: Value, result: Value, roles: &'static [&'static str], window: bool) -> MethodSpec {
    MethodSpec { name, summary, params, result, roles, window, mcp: None, experimental: false }
}

fn scene_element() -> Value {
    obj(
        json!({"id": {"type": "string"}, "type": {"type": "string"}, "x": {"type": "number"}, "y": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}}),
        &["id", "type"],
    )
}

/// The live scene methods (window): read, get, selection, apply. Experimental until plugin step 4b.
fn scene_methods() -> Vec<MethodSpec> {
    let strings = json!({"type": "array", "items": {"type": "string"}});
    let experimental = |mut m: MethodSpec| {
        m.experimental = true;
        m
    };
    vec![
        experimental(spec(
            SCENE_READ,
            "Read the elements of the drawing on screen: scope (all, viewport, selection), type and id filters, paging",
            target(json!({
                "scope": {"type": "string", "enum": ["all", "viewport", "selection"]},
                "types": strings.clone(),
                "ids": strings.clone(),
                "limit": {"type": "integer", "minimum": 1, "maximum": 2000},
                "offset": {"type": "integer", "minimum": 0}
            })),
            obj(
                json!({
                    "path": {"type": ["string", "null"]},
                    "live": {"type": "boolean"},
                    "readOnly": {"type": "boolean"},
                    "version": {"type": "string"},
                    "total": {"type": "integer"},
                    "returned": {"type": "integer"},
                    "truncated": {"type": "boolean"},
                    "counts": {"type": "object"},
                    "elements": {"type": "array", "items": scene_element()},
                    "selection": strings.clone(),
                    "viewport": obj(
                        json!({"x": {"type": "number"}, "y": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}, "zoom": {"type": "number"}}),
                        &["x", "y", "width", "height", "zoom"],
                    )
                }),
                &["path", "live", "readOnly", "version", "total", "returned", "truncated", "counts", "elements", "selection", "viewport"],
            ),
            CLI_ONLY,
            true,
        )),
        experimental(spec(
            SCENE_GET,
            "Elements of the drawing on screen by id (1 to 100); ids that do not exist come back in missing",
            target(json!({"ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 100}})),
            obj(
                json!({"path": {"type": ["string", "null"]}, "version": {"type": "string"}, "elements": {"type": "array", "items": scene_element()}, "missing": strings.clone()}),
                &["path", "version", "elements", "missing"],
            ),
            CLI_ONLY,
            true,
        )),
        experimental(spec(
            SCENE_SELECTION,
            "The selected elements of the drawing on screen",
            target(json!({})),
            obj(
                json!({"path": {"type": ["string", "null"]}, "version": {"type": "string"}, "ids": strings, "elements": {"type": "array", "items": scene_element()}}),
                &["path", "version", "ids", "elements"],
            ),
            CLI_ONLY,
            true,
        )),
        experimental(spec(
            SCENE_APPLY,
            "Apply 1 to 500 scene operations to the drawing on screen as one undo step; ifVersion refuses when the drawing changed, dryRun only validates",
            target(json!({
                "ops": {"type": "array", "items": {"type": "object"}, "minItems": 1, "maxItems": 500},
                "ifVersion": {"type": "string"},
                "dryRun": {"type": "boolean"},
                "by": {"type": "string", "enum": ["cli", "mcp", "uri"]},
                "notify": {"type": "boolean"}
            })),
            obj(
                json!({
                    "path": {"type": ["string", "null"]},
                    "live": {"type": "boolean"},
                    "applied": {"type": "integer"},
                    "ids": {"type": "array", "items": {"type": "string"}},
                    "version": {"type": "string"},
                    "dryRun": {"type": "boolean"},
                    "valid": {"type": "boolean"}
                }),
                &["path", "live", "applied", "version"],
            ),
            CLI_ONLY,
            true,
        )),
        experimental(spec(
            SCENE_CREATE,
            "Create a new drawing from 1 to 500 scene operations in one step (no blank file is left behind when the operations are invalid); the path may omit .excalidraw",
            obj(json!({"path": {"type": "string"}, "ops": {"type": "array", "items": {"type": "object"}, "minItems": 1, "maxItems": 500}}), &["path", "ops"]),
            obj(json!({"path": {"type": "string"}, "applied": {"type": "integer"}, "ids": {"type": "array", "items": {"type": "string"}}, "version": {"type": "string"}, "revision": {}}), &["path", "applied"]),
            CLI_ONLY,
            false,
        )),
    ]
}

/// Plugin commands (window): list what plugins declare, run one. Nothing here loads a plugin
/// until a command runs.
fn plugin_methods() -> Vec<MethodSpec> {
    let command = obj(
        json!({"id": {"type": "string"}, "title": {"type": "string"}, "keys": {"type": "array", "items": {"type": "string"}}, "palette": {"type": "boolean"}}),
        &["id", "title"],
    );
    let plugin = obj(
        json!({
            "id": {"type": "string"}, "name": {"type": "string"}, "version": {"type": "string"},
            "enabled": {"type": "boolean"},
            "state": {"type": "string", "enum": ["idle", "loading", "active", "failed", "disabled"]},
            "commands": {"type": "array", "items": command}
        }),
        &["id", "name", "enabled", "state", "commands"],
    );
    vec![
        spec(
            PLUGIN_COMMANDS,
            "Installed plugins and the commands each declares, with whether the plugin is enabled and its state; plugin narrows to one id",
            obj(json!({"plugin": {"type": "string"}}), &[]),
            obj(json!({"plugins": {"type": "array", "items": plugin}}), &["plugins"]),
            CLI_ONLY,
            true,
        ),
        spec(
            PLUGIN_RUN,
            "Run a plugin's command by its full id (<plugin>.<command>); the plugin must be enabled (it loads on first use)",
            obj(json!({"id": {"type": "string"}}), &["id"]),
            obj(json!({"ran": {"type": "boolean"}, "id": {"type": "string"}, "plugin": {"type": "string"}}), &["ran", "id", "plugin"]),
            CLI_ONLY,
            true,
        ),
    ]
}

/// The C3 methods: vault, files, tabs, config, quit, events.
fn c3_methods() -> Vec<MethodSpec> {
    let none = obj(json!({}), &[]);
    let vault = json!({"name": {"type": "string"}, "path": {"type": "string"}, "readOnly": {"type": "boolean"}});
    let tab_item = obj(
        json!({"id": {"type": "string"}, "path": {"type": "string"}, "pinned": {"type": "boolean"}, "missing": {"type": "boolean"}, "active": {"type": "boolean"}, "dirty": {"type": "boolean"}}),
        &["id", "path"],
    );
    vec![
        spec(VAULT_INFO, "Name, path and read-only flag of the open vault", none.clone(), obj(vault.clone(), &["name", "path", "readOnly"]), CLI_ONLY, false),
        spec(VAULT_OPEN, "Open a vault folder (absolute path) in the window", obj(json!({"path": {"type": "string"}}), &["path"]), obj(vault, &["name", "path", "readOnly"]), CLI_ONLY, true),
        spec(
            VAULT_LIST,
            "List drawings and folders under dir (vault-relative, default the root), optionally recursive",
            obj(json!({"dir": {"type": "string"}, "recursive": {"type": "boolean"}}), &[]),
            obj(
                json!({"entries": {"type": "array", "items": obj(
                    json!({"path": {"type": "string"}, "name": {"type": "string"}, "kind": {"type": "string", "enum": ["drawing", "folder"]}, "modifiedAt": {"type": "integer"}, "size": {"type": "integer"}}),
                    &["path", "name", "kind"])}}),
                &["entries"],
            ),
            CLI_ONLY,
            false,
        ),
        spec(
            VAULT_SEARCH,
            "Search the vault (names, text, tags); each result has path plus the search hit fields",
            obj(json!({"query": {"type": "string"}, "limit": {"type": "integer"}}), &["query"]),
            obj(json!({"results": {"type": "array", "items": obj(json!({"path": {"type": "string"}, "score": {"type": "number"}}), &["path"])}}), &["results"]),
            CLI_ONLY,
            false,
        ),
        spec(
            VAULT_LINKS,
            "Outgoing links of a drawing, or its backlinks with backlinks=true (one of path or file)",
            target(json!({"backlinks": {"type": "boolean"}})),
            obj(
                json!({
                    "path": {"type": "string"},
                    "links": {"type": "array", "items": obj(json!({"path": {"type": "string"}, "target": {"type": "string"}, "resolved": {"type": "boolean"}}), &["target", "resolved"])},
                    "backlinks": {"type": "array", "items": obj(json!({"path": {"type": "string"}}), &["path"])}
                }),
                &["path"],
            ),
            CLI_ONLY,
            false,
        ),
        spec(
            VAULT_TAGS,
            "Every tag in the vault with its drawing count",
            none.clone(),
            obj(json!({"tags": {"type": "array", "items": obj(json!({"tag": {"type": "string"}, "count": {"type": "integer"}}), &["tag", "count"])}}), &["tags"]),
            CLI_ONLY,
            false,
        ),
        spec(
            FILE_READ,
            "Read a drawing: path, revision and the parsed scene (one of path or file)",
            target(json!({})),
            obj(json!({"path": {"type": "string"}, "revision": {}, "scene": {"type": "object"}}), &["path", "revision", "scene"]),
            CLI_ONLY,
            false,
        ),
        spec(
            FILE_WRITE,
            "Write a scene through the app's save path; expectedRevision null means create only (one of path or file)",
            target(json!({"scene": {"type": "object"}, "expectedRevision": {}})),
            obj(json!({"path": {"type": "string"}, "revision": {}}), &["path", "revision"]),
            CLI_ONLY,
            false,
        ),
        spec(
            FILE_OPEN,
            "Open a drawing in the window, optionally in a new tab (one of path or file)",
            target(json!({"newTab": {"type": "boolean"}})),
            obj(json!({"path": {"type": "string"}, "opened": {"type": "boolean"}}), &["path", "opened"]),
            CLI_URI,
            true,
        ),
        spec(
            FILE_CREATE,
            "Create a drawing (path may omit .excalidraw), optionally from a scene",
            obj(json!({"path": {"type": "string"}, "scene": {"type": "object"}}), &["path"]),
            obj(json!({"path": {"type": "string"}, "revision": {}}), &["path"]),
            CLI_ONLY,
            true,
        ),
        spec(
            FILE_MOVE,
            "Move or rename a drawing or folder; a trailing / on to means into that folder",
            obj(json!({"from": {"type": "string"}, "to": {"type": "string"}}), &["from", "to"]),
            obj(json!({"from": {"type": "string"}, "to": {"type": "string"}, "rewritten": {"type": "integer"}}), &["from", "to"]),
            CLI_ONLY,
            true,
        ),
        spec(
            FILE_TRASH,
            "Move a drawing to the trash (one of path or file)",
            target(json!({})),
            obj(json!({"path": {"type": "string"}, "trashed": {"type": "boolean"}}), &["path", "trashed"]),
            CLI_ONLY,
            true,
        ),
        spec(
            EXPORT_RENDER,
            "Render a drawing to PNG, SVG or PDF through the app window; bytes come back base64",
            obj(
                json!({
                    "path": {"type": "string"},
                    "file": {"type": "string"},
                    "format": {"type": "string", "enum": ["png", "svg", "pdf"]},
                    "scale": {"type": "number"},
                    "dark": {"type": "boolean"},
                    "background": {"type": "boolean"},
                    "pattern": {"type": "boolean"},
                    "embedScene": {"type": "boolean"},
                    "pageShaped": {"type": "boolean"},
                    "frame": {"type": "string"},
                    "padding": {"type": "number", "minimum": 0, "maximum": 200}
                }),
                &["format"],
            ),
            obj(
                json!({
                    "path": {"type": "string"},
                    "fileName": {"type": "string"},
                    "mime": {"type": "string", "enum": ["image/png", "image/svg+xml", "application/pdf"]},
                    "size": {"type": "integer"},
                    "bytes": {"type": "string"}
                }),
                &["path", "fileName", "mime", "size", "bytes"],
            ),
            CLI_ONLY,
            true,
        ),
        spec(
            EXPORT_SPOOL,
            "Like export.render, but the app writes the output to a spool file and returns its path (no size cap, no copy through the reply); the caller moves or deletes the file",
            obj(
                json!({
                    "path": {"type": "string"},
                    "file": {"type": "string"},
                    "format": {"type": "string", "enum": ["png", "svg", "pdf"]},
                    "scale": {"type": "number"},
                    "dark": {"type": "boolean"},
                    "background": {"type": "boolean"},
                    "pattern": {"type": "boolean"},
                    "embedScene": {"type": "boolean"},
                    "pageShaped": {"type": "boolean"},
                    "frame": {"type": "string"},
                    "padding": {"type": "number", "minimum": 0, "maximum": 200}
                }),
                &["format"],
            ),
            obj(
                json!({
                    "path": {"type": "string"},
                    "fileName": {"type": "string"},
                    "mime": {"type": "string", "enum": ["image/png", "image/svg+xml", "application/pdf"]},
                    "size": {"type": "integer"},
                    "spool": {"type": "string"}
                }),
                &["path", "fileName", "mime", "size", "spool"],
            ),
            CLI_ONLY,
            true,
        ),
        spec(
            TAB_LIST,
            "Open tabs and the active tab id",
            none.clone(),
            obj(json!({"tabs": {"type": "array", "items": tab_item}, "activeId": {"type": ["string", "null"]}}), &["tabs", "activeId"]),
            CLI_ONLY,
            true,
        ),
        spec(
            TAB_FOCUS,
            "Focus a tab by id, 1-based index, or file target",
            target(json!({"id": {"type": "string"}, "index": {"type": "integer"}})),
            obj(json!({"id": {"type": "string"}}), &["id"]),
            CLI_ONLY,
            true,
        ),
        spec(
            TAB_CLOSE,
            "Close a tab by id or file target",
            target(json!({"id": {"type": "string"}})),
            obj(json!({"closed": {"type": "boolean"}}), &["closed"]),
            CLI_ONLY,
            true,
        ),
        spec(
            CONFIG_GET,
            "Read a config value by dotted key, or the whole config when key is omitted",
            obj(json!({"key": {"type": "string"}}), &[]),
            obj(json!({"key": {"type": ["string", "null"]}, "value": {}}), &["value"]),
            CLI_ONLY,
            false,
        ),
        spec(
            CONFIG_SET,
            "Set config values (same changes as the settings UI)",
            obj(json!({"changes": {"type": "array", "items": obj(json!({"key": {"type": "string"}, "value": {}}), &["key", "value"])}}), &["changes"]),
            obj(json!({"changed": {"type": "integer"}}), &["changed"]),
            CLI_ONLY,
            false,
        ),
        spec(APP_QUIT, "Quit the app through the same save barrier as Cmd+Q", none.clone(), obj(json!({"quitting": {"type": "boolean"}}), &["quitting"]), CLI_ONLY, false),
        spec(
            EVENTS_SUBSCRIBE,
            "Subscribe this connection to event topics (default all); the reply is followed by events.snapshot, then events",
            obj(json!({"topics": {"type": "array", "items": {"type": "string", "enum": ["vault", "file", "tab", "config", "command"]}}}), &[]),
            obj(json!({"seq": {"type": "integer"}, "topics": {"type": "array", "items": {"type": "string"}}}), &["seq", "topics"]),
            CLI_ONLY,
            false,
        ),
        spec(EVENTS_UNSUBSCRIBE, "Stop receiving events on this connection", none, obj(json!({"unsubscribed": {"type": "boolean"}}), &["unsubscribed"]), CLI_ONLY, false),
    ]
}

/// Every method, in a stable order. Built once; every request looks methods up here.
pub fn catalogue() -> &'static [MethodSpec] {
    static CATALOGUE: OnceLock<Vec<MethodSpec>> = OnceLock::new();
    CATALOGUE.get_or_init(build_catalogue)
}

fn build_catalogue() -> Vec<MethodSpec> {
    let none = obj(json!({}), &[]);
    vec![
        MethodSpec {
            name: RPC_DISCOVER,
            summary: "API level, app version, every method with its schemas",
            params: none.clone(),
            result: obj(
                json!({"api": {"type": "integer"}, "apiMin": {"type": "integer"}, "app": {"type": "string"}, "methods": {"type": "array"}}),
                &["api", "apiMin", "app", "methods"],
            ),
            roles: &roles::ALL,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: RPC_HELLO,
            summary: "Declare this connection's role (cli, uri, mcp) and client name",
            params: obj(json!({"role": {"type": "string"}, "client": {"type": "string"}}), &["role"]),
            result: obj(json!({"api": {"type": "integer"}, "role": {"type": "string"}}), &["api", "role"]),
            roles: &roles::ALL,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: APP_STATUS,
            summary: "Is the app running: version, pid, open vault, active drawing, tabs",
            params: none.clone(),
            result: obj(
                json!({
                    "running": {"type": "boolean"},
                    "app": {"type": "string"},
                    "api": {"type": "integer"},
                    "pid": {"type": "integer"},
                    "vault": {"type": ["object", "null"], "properties": {"name": {"type": "string"}, "path": {"type": "string"}, "readOnly": {"type": "boolean"}}},
                    "activeDrawing": {"type": ["object", "null"], "properties": {"path": {"type": "string"}, "dirty": {"type": "boolean"}}},
                    "tabs": {"type": ["integer", "null"]},
                    "windowReady": {"type": "boolean"}
                }),
                &["running", "app", "api", "pid", "vault", "windowReady"],
            ),
            roles: CLI_ONLY,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: APP_FOCUS,
            summary: "Show and focus the app window",
            params: none.clone(),
            result: obj(json!({"focused": {"type": "boolean"}}), &["focused"]),
            roles: CLI_URI,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: APP_OPEN,
            summary: "Handle a launch forwarded from a second process: argv (files, vaultdraw:// URIs) and cwd",
            params: obj(json!({"argv": {"type": "array", "items": {"type": "string"}}, "cwd": {"type": "string"}}), &["argv"]),
            result: obj(json!({"handled": {"type": "integer"}}), &["handled"]),
            roles: CLI_URI,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: URI_HANDLE,
            summary: "Handle a vaultdraw:// link as if the OS had opened it: open and search run now; switching vault, new and cmd ask the user first (status asking); the reply never waits for a person",
            params: obj(json!({"url": {"type": "string"}}), &["url"]),
            result: obj(json!({"status": {"type": "string", "enum": ["done", "asking", "queued"]}}), &["status"]),
            roles: CLI_URI,
            window: false,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: COMMAND_LIST,
            summary: "Every palette command: id, title, category, keys, when clauses, available now",
            params: none.clone(),
            result: obj(
                json!({"commands": {"type": "array", "items": obj(json!({
                    "id": {"type": "string"}, "title": {"type": "string"}, "category": {"type": "string"},
                    "keys": {"type": "array", "items": {"type": "string"}}, "when": {"type": "array", "items": {"type": "string"}},
                    "available": {"type": "boolean"}
                }), &["id", "title", "category", "keys", "available"])}}),
                &["commands"],
            ),
            roles: CLI_ONLY,
            window: true,
            mcp: None,
            experimental: false,
        },
        MethodSpec {
            name: COMMAND_RUN,
            summary: "Run a palette command by id (same ids as [hotkeys]); prefix commands like drawing.open:<path> too",
            params: obj(json!({"id": {"type": "string"}}), &["id"]),
            result: obj(json!({"ran": {"type": "boolean"}, "id": {"type": "string"}}), &["ran", "id"]),
            roles: CLI_ONLY,
            window: true,
            mcp: None,
            experimental: false,
        },
    ]
    .into_iter()
    .chain(plugin_methods())
    .chain(c3_methods())
    .chain(scene_methods())
    .map(|mut m| {
        m.mcp = mcp_tool(m.name);
        m
    })
    .collect()
}

pub fn find(name: &str) -> Option<&'static MethodSpec> {
    catalogue().iter().find(|m| m.name == name)
}

/// `rpc.discover` result for an app version.
pub fn discover(app_version: &str) -> Value {
    json!({
        "api": crate::API_LEVEL,
        "apiMin": crate::API_MIN,
        "app": app_version,
        "methods": catalogue().iter().map(MethodSpec::to_json).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c3_methods_are_catalogued() {
        let names = [
            VAULT_INFO, VAULT_OPEN, VAULT_LIST, VAULT_SEARCH, VAULT_LINKS, VAULT_TAGS, FILE_READ, FILE_WRITE, FILE_OPEN, FILE_CREATE, FILE_MOVE,
            FILE_TRASH, EXPORT_RENDER, EXPORT_SPOOL, TAB_LIST, TAB_FOCUS, TAB_CLOSE, CONFIG_GET, CONFIG_SET, APP_QUIT, EVENTS_SUBSCRIBE, EVENTS_UNSUBSCRIBE,
        ];
        for n in names {
            assert!(find(n).is_some(), "{n} missing from catalogue");
        }
        assert!(find(FILE_OPEN).unwrap().roles.contains(&roles::URI));
        assert!(!find(FILE_READ).unwrap().roles.contains(&roles::URI));
        assert!(find(TAB_LIST).unwrap().window && !find(FILE_READ).unwrap().window);
    }

    /// The `uri` role (links, forwarded launches) reaches only focus, open, file.open and uri.handle:
    /// a link can never call a write, trash, command or config method through its role.
    #[test]
    fn security_uri_role_reaches_only_the_link_methods() {
        let mut allowed: Vec<_> = catalogue().into_iter().filter(|m| m.roles.contains(&roles::URI)).map(|m| m.name).collect();
        allowed.sort();
        assert_eq!(allowed, [APP_FOCUS, APP_OPEN, FILE_OPEN, RPC_DISCOVER, RPC_HELLO, URI_HANDLE]);
        let m = find(URI_HANDLE).unwrap();
        assert!(m.roles.contains(&roles::CLI) && !m.window);
    }

    /// The `mcp` role reaches exactly these methods and tools (C7a keeps the role closed; this pins
    /// what opening it would expose).
    #[test]
    fn security_mcp_role_reaches_only_the_pinned_tools() {
        let mut allowed: Vec<_> = catalogue().iter().filter(|m| m.allows(roles::MCP)).map(|m| m.name).collect();
        allowed.sort();
        assert_eq!(allowed, [APP_STATUS, RPC_DISCOVER, RPC_HELLO, SCENE_APPLY, SCENE_CREATE, SCENE_READ, SCENE_SELECTION, VAULT_LIST, VAULT_SEARCH]);
        let mut tools: Vec<_> = catalogue().iter().filter_map(|m| m.mcp.map(|t| (t.name, m.name, t.writes))).collect();
        tools.sort();
        assert_eq!(
            tools,
            [
                ("create_drawing", SCENE_CREATE, true),
                ("edit_drawing", SCENE_APPLY, true),
                ("get_selection", SCENE_SELECTION, false),
                ("list_drawings", VAULT_LIST, false),
                ("read_drawing", SCENE_READ, false),
                ("search_vault", VAULT_SEARCH, false),
                ("vaultdraw_status", APP_STATUS, false),
            ]
        );
        // Only the apply tool writes; scene.get has no tool and stays CLI only.
        assert!(!find(SCENE_GET).unwrap().allows(roles::MCP));
        assert!(!find(SCENE_APPLY).unwrap().allows(roles::URI));
    }

    #[test]
    fn to_json_lists_effective_roles_and_optional_keys() {
        let status = find(APP_STATUS).unwrap().to_json();
        assert_eq!(status["roles"], json!(["cli", "mcp"]));
        assert_eq!(status["mcp"], json!({"tool": "vaultdraw_status", "writes": false}));
        assert!(status.get("experimental").is_none());
        let hello = find(RPC_HELLO).unwrap().to_json();
        assert_eq!(hello["roles"], json!(["cli", "uri", "mcp"]));
        assert!(hello.get("mcp").is_none());
        let apply = find(SCENE_APPLY).unwrap().to_json();
        assert_eq!((apply["experimental"].clone(), apply["window"].clone()), (json!(true), json!(true)));
        assert_eq!(apply["roles"], json!(["cli", "mcp"]));
        let tags = find(VAULT_TAGS).unwrap().to_json();
        assert!(tags.get("mcp").is_none() && tags.get("experimental").is_none());
    }

    /// Cost of the per-request lookup (`find`) against building the table, which every request
    /// paid before the `OnceLock`.
    #[test]
    fn catalogue_lookup_benchmark() {
        use std::time::Instant;
        let pct = |mut v: Vec<std::time::Duration>| {
            v.sort();
            (v[v.len() / 2], v[v.len() * 95 / 100])
        };
        let mut found = Vec::new();
        for _ in 0..2000 {
            let t = Instant::now();
            let m = std::hint::black_box(find(std::hint::black_box(SCENE_APPLY)));
            found.push(t.elapsed());
            assert!(m.is_some());
        }
        let mut built = Vec::new();
        for _ in 0..200 {
            let t = Instant::now();
            std::hint::black_box(build_catalogue());
            built.push(t.elapsed());
        }
        let (f50, f95) = pct(found);
        let (b50, b95) = pct(built);
        eprintln!("methods::find (OnceLock): p50 {f50:?} p95 {f95:?}; building the catalogue once: p50 {b50:?} p95 {b95:?}");
        assert!(f95 < std::time::Duration::from_millis(5), "lookup too slow: {f95:?}");
    }

    #[test]
    fn names_are_unique_and_namespaced() {
        let all = catalogue();
        let mut names: Vec<_> = all.iter().map(|m| m.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len());
        assert!(all.iter().all(|m| m.name.split_once('.').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())));
    }

    /// Old properties all kept unchanged; params may not require more, results may not promise less.
    fn additive(old: &Value, new: &Value, is_params: bool) -> bool {
        let props = |v: &Value| v["properties"].as_object().cloned().unwrap_or_default();
        let req = |v: &Value| -> Vec<String> {
            v["required"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
        };
        let (op, np) = (props(old), props(new));
        let kept = op.iter().all(|(k, v)| np.get(k) == Some(v));
        let (or, nr) = (req(old), req(new));
        let required_ok = if is_params { nr.iter().all(|r| or.contains(r)) } else { or.iter().all(|r| nr.contains(r)) };
        kept && required_ok && old["type"] == new["type"]
    }

    /// The golden API description: no method may disappear or change; additions update it.
    #[test]
    fn api_v1_golden() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/api-v1.json");
        // Experimental methods (scene.*) may still change shape: they stay out of the golden file.
        let current: Value = json!({"api": crate::API_LEVEL, "methods": catalogue().iter().filter(|m| !m.experimental).map(MethodSpec::to_json).collect::<Vec<_>>()});
        let pretty = serde_json::to_string_pretty(&current).unwrap() + "\n";
        let golden: Option<Value> = std::fs::read_to_string(&path).ok().map(|t| serde_json::from_str(&t).unwrap());
        if let Some(golden) = &golden {
            for old in golden["methods"].as_array().unwrap() {
                let name = old["name"].as_str().unwrap();
                let now = current["methods"].as_array().unwrap().iter().find(|m| m["name"] == name);
                let now = now.unwrap_or_else(|| panic!("method {name} was removed (breaking change: bump API_LEVEL)"));
                assert!(additive(&old["params"], &now["params"], true), "{name}.params changed (only additive changes within an API level)");
                assert!(additive(&old["result"], &now["result"], false), "{name}.result changed (only additive changes within an API level)");
            }
        }
        if std::env::var_os("UPDATE_GOLDEN").is_some() || golden.is_none() {
            std::fs::write(&path, pretty).unwrap();
        } else {
            assert_eq!(golden.unwrap(), current, "api-v1.json is stale: rerun with UPDATE_GOLDEN=1");
        }
    }
}
