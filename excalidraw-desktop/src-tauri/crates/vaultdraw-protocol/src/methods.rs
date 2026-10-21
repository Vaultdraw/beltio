//! The method catalogue: names, JSON Schemas and which roles may call them by default.
//! `rpc.discover` returns this list; `tests/fixtures/api-v1.json` is its golden copy (a test
//! fails on any removed method or changed schema; additions regenerate the file with
//! `UPDATE_GOLDEN=1 cargo test -p vaultdraw-protocol`).

use serde_json::{json, Value};

pub const RPC_DISCOVER: &str = "rpc.discover";
pub const RPC_HELLO: &str = "rpc.hello";
pub const APP_STATUS: &str = "app.status";
pub const APP_FOCUS: &str = "app.focus";
pub const APP_OPEN: &str = "app.open";
pub const COMMAND_LIST: &str = "command.list";
pub const COMMAND_RUN: &str = "command.run";
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
pub const TAB_LIST: &str = "tab.list";
pub const TAB_FOCUS: &str = "tab.focus";
pub const TAB_CLOSE: &str = "tab.close";
pub const CONFIG_GET: &str = "config.get";
pub const CONFIG_SET: &str = "config.set";
pub const APP_QUIT: &str = "app.quit";
pub const EVENTS_SUBSCRIBE: &str = "events.subscribe";
pub const EVENTS_UNSUBSCRIBE: &str = "events.unsubscribe";

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
}

impl MethodSpec {
    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "summary": self.summary,
            "params": self.params,
            "result": self.result,
            "roles": self.roles,
            "window": self.window,
        })
    }
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
    MethodSpec { name, summary, params, result, roles, window }
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

/// Every method, in a stable order.
pub fn catalogue() -> Vec<MethodSpec> {
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
        },
        MethodSpec {
            name: RPC_HELLO,
            summary: "Declare this connection's role (cli, uri, mcp) and client name",
            params: obj(json!({"role": {"type": "string"}, "client": {"type": "string"}}), &["role"]),
            result: obj(json!({"api": {"type": "integer"}, "role": {"type": "string"}}), &["api", "role"]),
            roles: &roles::ALL,
            window: false,
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
        },
        MethodSpec {
            name: APP_FOCUS,
            summary: "Show and focus the app window",
            params: none.clone(),
            result: obj(json!({"focused": {"type": "boolean"}}), &["focused"]),
            roles: CLI_URI,
            window: false,
        },
        MethodSpec {
            name: APP_OPEN,
            summary: "Handle a launch forwarded from a second process: argv (files, vaultdraw:// URIs) and cwd",
            params: obj(json!({"argv": {"type": "array", "items": {"type": "string"}}, "cwd": {"type": "string"}}), &["argv"]),
            result: obj(json!({"handled": {"type": "integer"}}), &["handled"]),
            roles: CLI_URI,
            window: false,
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
        },
        MethodSpec {
            name: COMMAND_RUN,
            summary: "Run a palette command by id (same ids as [hotkeys]); prefix commands like drawing.open:<path> too",
            params: obj(json!({"id": {"type": "string"}}), &["id"]),
            result: obj(json!({"ran": {"type": "boolean"}, "id": {"type": "string"}}), &["ran", "id"]),
            roles: CLI_ONLY,
            window: true,
        },
    ]
    .into_iter()
    .chain(c3_methods())
    .collect()
}

pub fn find(name: &str) -> Option<MethodSpec> {
    catalogue().into_iter().find(|m| m.name == name)
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
            FILE_TRASH, TAB_LIST, TAB_FOCUS, TAB_CLOSE, CONFIG_GET, CONFIG_SET, APP_QUIT, EVENTS_SUBSCRIBE, EVENTS_UNSUBSCRIBE,
        ];
        for n in names {
            assert!(find(n).is_some(), "{n} missing from catalogue");
        }
        assert!(find(FILE_OPEN).unwrap().roles.contains(&roles::URI));
        assert!(!find(FILE_READ).unwrap().roles.contains(&roles::URI));
        assert!(find(TAB_LIST).unwrap().window && !find(FILE_READ).unwrap().window);
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
        let current: Value = json!({"api": crate::API_LEVEL, "methods": catalogue().iter().map(MethodSpec::to_json).collect::<Vec<_>>()});
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
