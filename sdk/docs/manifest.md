<!-- Generated from plugin.schema.json by sdk/api/scripts/gen-manifest-docs.mjs. Do not edit. -->

# plugin.toml reference

Every key of a plugin manifest, with its limits. Generated from `sdk/api/plugin.schema.json`, the file editors read for completion and hover help.

## Example

```toml
id = "hello-command"
name = "Hello"
version = "0.1.0"
api = 0
min_app = "0.1.0"
main = "main.js"
description = "Says hello"
author = "you"
activation = []
dev = false

[[contributes.commands]]
id = "hello"
title = "Hello: say hello"
keys = ["Mod+Alt+H"]
when = ["vaultOpen"]
palette = true

[[contributes.panels]]
id = "notes"
title = "Notes"
icon = "note"
group = "top"

[[contributes.settings]]
key = "greeting"
type = "string"
title = "Greeting"
default = "Hello"
```

## Editor completion

Taplo (Even Better TOML in VS Code, and the Neovim and Helix language servers) reads a schema named on the first line of the file:

```toml
#:schema ./plugin.schema.json
```

The path is relative to the manifest. The `vaultdraw-plugin init` templates ship `plugin.schema.json` next to `plugin.toml`. Without that file, copy it from `sdk/api/plugin.schema.json`.

## Top-level keys

| Key | Type | Required | Default | Limits | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | string | yes |  | `^[a-z0-9][a-z0-9-]{1,38}$` | Unique id. 2 to 39 characters of a-z, 0-9 and -, not starting with -. Full command ids are "<id>.<command id>". |
| `name` | string | yes |  | not blank; 1 to 200 chars | Display name. 1 to 200 characters, not blank. |
| `version` | string | yes |  | semantic version | The plugin's own semantic version, for example 1.0.0. |
| `api` | `0` | yes |  |  | The plugin API level this plugin targets. The app refuses any level it does not implement. Level 0 is experimental. |
| `min_app` | string | no |  | semantic version | Optional. Semantic version of the oldest Vaultdraw app that can run the plugin. Older apps refuse it. |
| `main` | string | yes |  | `^(?!(?:.*/)?\.\.?(?:/\|$))[^/\\:\u0000]+(?:/[^/\\:\u0000]+)*$`; 1 to 260 chars | Relative path of the ESM bundle inside the plugin folder, with / separators. No .., no ., no empty segment, no leading /, no backslash, no colon. At most 260 bytes. |
| `description` | string | no |  | 0 to 1000 chars | Optional. One line about the plugin. At most 1000 characters. |
| `author` | string | no |  | 0 to 1000 chars | Optional. Who made the plugin. At most 1000 characters. |
| `activation` | list of strings | no |  | items: `"onStartupFinished"` | Optional. By default a plugin loads on first use: one of its commands runs or one of its panels opens. List "onStartupFinished" to also activate it on an idle callback after startup. No other event exists. |
| `dev` | boolean | no | `false` |  | Optional. true makes the app reload the plugin when its files change. `vaultdraw-plugin dev` adds it to the installed copy. A packaged plugin must not set it to true (error dev-true). |

Tables named `x-*` are free for tools and ignored by the app and the CLI. Any other unknown key is an error (`unknown-key`).

## `[[contributes.commands]]`

Palette commands, written as [[contributes.commands]]. At most 200. A command declared in plugin.toml. Bind its handler with ctx.commands.register in activate().

| Key | Type | Required | Default | Limits | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | string | yes |  | `^[A-Za-z][A-Za-z0-9_-]{0,63}$` | Short id, unique among the plugin's commands. Letters, digits, `-` and `_`, starting with a letter, at most 64 characters. The full id is "<plugin id>.<id>". |
| `title` | string | yes |  | not blank; 1 to 200 chars | Shown in the palette. 1 to 200 characters, not blank. |
| `keys` | list of strings | no |  |  | Optional default chords in config notation, for example "Mod+Alt+H". An empty list means none. Users can rebind them. |
| `when` | list of strings | no |  |  | Optional. Built-in or namespaced context keys that must hold for the command to be available, for example "vaultOpen". |
| `palette` | boolean | no | `true` |  | Optional, default true. false hides the command from the command palette. |

## `[[contributes.panels]]`

Side panels, written as [[contributes.panels]]. At most 20. A panel declared in plugin.toml. Bind its React component with ctx.panels.register in activate().

| Key | Type | Required | Default | Limits | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | string | yes |  | `^[A-Za-z][A-Za-z0-9_-]{0,63}$` | Short id, unique among the plugin's panels. Same rule as a command id. The full id is "<plugin id>.<id>". |
| `title` | string | yes |  | not blank; 1 to 200 chars | Shown on the panel and its activity-bar button. 1 to 200 characters, not blank. |
| `icon` | string | no |  |  | Optional. A built-in icon name. |
| `group` | one of | no | `"top"` | `"top"`, `"bottom"` | Optional, default "top". Where the button sits in the activity bar. |

## `[[contributes.settings]]`

Settings the plugin declares, written as [[contributes.settings]]. At most 100. A setting the plugin declares. Values live in [plugin.<id>] tables of config.toml, or in the vault's settings.toml for vault scope. A stored value outside min and max, or of the wrong type, reads as the default.

| Key | Type | Required | Default | Limits | Description |
| --- | --- | --- | --- | --- | --- |
| `key` | string | yes |  | at least 1 char | The setting's name inside the plugin. Unique among its settings. |
| `type` | one of | yes |  | `"bool"`, `"int"`, `"number"`, `"string"`, `"select"`, `"color"` | bool: true or false. int: whole number. number: any finite number. string: text. select: one of options. color: a color string. |
| `title` | string | yes |  |  | Label in Settings, Plugins. |
| `description` | string | no |  |  | Optional. Help text under the label. |
| `default` | string or number or boolean | yes |  |  | The value used when nothing is stored. It must fit type, min, max and options. |
| `min` | number | no |  |  | Optional. Lowest allowed value of an int or number setting. |
| `max` | number | no |  |  | Optional. Highest allowed value of an int or number setting. |
| `options` | list of tables | no |  |  | select only. The choices, as inline tables with value and label. |
| `scope` | list of strings | no |  | items: `"global"`, `"vault"` | Optional. The layers that may hold a value. Default: both global and vault. |

Each entry of `options` is an inline table:

| Key     | Type   | Required | Default | Limits | Description                 |
| ------- | ------ | -------- | ------- | ------ | --------------------------- |
| `value` | string | yes      |         |        | The stored value.           |
| `label` | string | yes      |         |        | The text shown to the user. |

## Rules that live in code

A schema cannot express these. `vaultdraw-plugin check` and the app enforce them:

- `plugin.toml` is at most 64 KB (`manifest-too-large`).
- Command ids are unique within the plugin, and so are panel ids (`contribution-duplicate`).
- The file named by `main` exists (`main-missing`).
- A packaged manifest does not set `dev = true` (`dev-true`).
- `min_app` is not lower than the first app version with the API the code uses (`min-app-low`, a warning).
- The plugin id does not collide with another installed plugin.
- A `select` setting's `default` is one of its `options`, and every `default` fits its `type`, `min` and `max`. The settings registry reports problems on the Plugins page.

Every check code is listed in the [reference](reference.md#check-codes).
