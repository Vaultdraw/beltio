# Manifest corpus

`plugin.toml` files shared by the Rust app and the `vaultdraw-plugin check` command. Rust is the authority; the CLI must agree.

- `ok/`: manifests that are valid.
- `bad/`: one manifest per check code, each breaking exactly one rule.

## Header

Every file starts with two comment lines.

| Line | Meaning |
| --- | --- |
| `# code: <code>` | The CLI error code the file must produce. `none` for `ok/` files. |
| `# rust: ok` | `manifest::parse` accepts it. |
| `# rust: <text>` | `manifest::parse` fails, and the error contains this text (case-insensitive). |
| `# rust: compat <text>` | `parse` succeeds, `manifest::compatibility(m, "0.1.0")` returns a problem containing this text. |

## Codes

| Code | Trigger |
| --- | --- |
| `toml-parse` | Not valid TOML. |
| `unknown-key` | Unknown top-level key. |
| `missing-key` | A required key is absent (`id`, `name`, `version`, `api`, `main`). |
| `id-invalid` | Plugin id breaks `^[a-z0-9][a-z0-9-]{1,38}$`. |
| `name-invalid` | Empty name. |
| `version-invalid` | Not a semantic version. |
| `min-app-invalid` | `min_app` is not a semantic version. |
| `main-path-invalid` | `main` is not a safe relative path. |
| `api-unsupported` | `api` is not the supported level. |
| `activation-unknown` | Unknown activation event, including `onDrop:<ext>` when no importer declares `<ext>`. |
| `permission-invalid` | `permissions` is not a list of strings. |
| `permission-unknown` | A permission name that does not exist. |
| `permission-reserved` | `net`, `secret` or `control`: reserved for later. |
| `permission-duplicate` | The same permission twice. |
| `permission-too-many` | More than 8 permissions. |
| `data-key-invalid` | `data_key` is not lower case letters, digits, `_` and `-` in parts joined by `.` (at most 64 characters) |
| `data-key-reserved` | `data_key` names another plugin's key: keys under `plugins.` must be `plugins.<own id>`. |
| `contribution-id-invalid` | Command or panel id has a bad shape. |
| `contribution-duplicate` | Two commands share an id. |
| `title-invalid` | Empty command or panel title. |
| `setting-invalid` | A setting has no `key` or `type`. |
| `too-many` | More than 200 commands (also 20 panels, 100 settings, 8 importers, 8 status bar items, 8 views, 16 menu items, 8 toolbar buttons). |
| `contribution-invalid` | Among others: a status bar item with an `align` other than `left` or `right`, or a menu item with an unknown `surface`. |
| `toolbar-command-unknown` | A toolbar button whose `command` is not one of the plugin's commands. |
| `menu-command-unknown` | A menu item whose `command` is not one of the plugin's commands. |
| `status-command-unknown` | A status bar item whose `command` is not one of the plugin's commands. |
| `importer-extension-invalid` | An importer extension that is not lower case letters and digits with dots between parts (no leading dot, at most 32 bytes), or is repeated. |
| `importer-extension-reserved` | An importer extension the app handles itself (`png`, `pdf`, `json`, `excalidraw`, ...). |
| `view-extension-invalid` | A view extension that is not a lower case name ending in `.md` with a name before it (`kanban.md`), is one the app owns (`md`, `markdown`, `excalidraw.md`), or is repeated. |
| `manifest-too-large` | Over 64 KB. |
| `dev-true` | `dev = true` in a packaged manifest. Rust accepts it; `check` reports it. |

## Adding a rule

A new manifest rule means a new corpus file, with both headers. The Rust test (`manifest_corpus_*` in `src-tauri/src/plugins/tests.rs`) and the CLI test both walk these folders.
