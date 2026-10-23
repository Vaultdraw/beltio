# Getting started with plugins

Five minutes from `init` to a toast in the Vaultdraw window. You need Node 22 or newer and the Vaultdraw app.

> **Not on npm yet.** The `vaultdraw-plugin` command is not published. Run it from a clone of this repo as `node <repo>/sdk/cli/bin/vaultdraw-plugin.mjs ...`. `npx vaultdraw-plugin` does not work today.

The steps below use a shell variable so the commands stay short:

```bash
VP="node /path/to/vaultdraw/sdk/cli/bin/vaultdraw-plugin.mjs"
```

## 1. Create a plugin

```bash
$VP init my-hello
```

```
Created /…/my-hello from the hello-command example.

Next steps:
  cd my-hello
  vaultdraw-plugin dev .
```

(That last line shows the short name; use your `$VP` form.) The folder has five files:

| File | What it is |
| --- | --- |
| `plugin.toml` | The manifest: id, one command (`Hello: say hello`) and one setting (`greeting`) |
| `main.js` | The code. Registers the command and shows a toast |
| `vaultdraw-api.d.ts` | The API types, copied in. Nothing to install |
| `jsconfig.json` | Points your editor at those types, so `ctx.` completes and mistakes are underlined |
| `README.md` | Three lines on the dev loop |

The id must be 2 to 39 characters of `a-z`, `0-9` and `-`. `init --example focus-timer` or `--example stamp` starts from another example.

## 2. Install it with `dev`

```bash
cd my-hello
$VP dev .
```

```
Installed my-hello in ~/.config/vaultdraw/plugins/my-hello
In Vaultdraw: Cmd+P, Plugins: Reload plugin list; then Settings, Plugins, enable the plugin. After that, saves reload it by itself.
Watching /…/my-hello. Press Ctrl+C to stop.
```

`dev` copies the folder into `plugins/` in the config folder and watches your folder. It adds `dev = true` to the installed copy only, so the host reloads the plugin on each save. Add `--once` to copy and exit.

Do these once, in the app:

1. Press **Cmd+P** and run **Plugins: Reload plugin list**.
2. Open **Settings, Plugins** and switch **My Hello** on.
3. A plugin that is not bundled shows an Unverified badge. The first time you enable it, a consent prompt appears, because plugins run with full access. Allow it.
4. Press **Cmd+P** and run **Hello: say hello** (or press Cmd+Alt+Shift+H). A toast says `Hello, Vaultdraw!`.

Not sure where the files went? Run **Plugins: Open plugins folder** from the palette.

## 3. Change the greeting

The text comes from the `greeting` setting. Its default is in `plugin.toml`, and `main.js` reads it with `ctx.settings.get("greeting")`. Edit the default:

```toml
default = "Howdy"
```

Save. `dev` prints a line when it copies; the host reloads the plugin; run the command again for `Howdy, Vaultdraw!`. You can also change the value in Settings, Plugins, which then wins over the default.

Saving `main.js` works the same way. Each reload keeps the old module in memory until the app restarts, so restart now and then in a long session.

## 4. Check it

```bash
$VP check .
```

```
Checked my-hello: no problems found.
```

`--json` prints the same result for scripts:

```json
{ "schemaVersion": 1, "ok": true, "errors": [], "warnings": [] }
```

With a problem (here `api = 9`), the output is `error: Plugin API 9 is not supported (this version of the app implements 0) [api-unsupported] (plugin.toml)` and `Checked my-hello: 1 error, 0 warnings.` In JSON, each finding has `code`, `message` and `file`.

| Exit code | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| 0         | No errors (warnings do not change this)                          |
| 1         | Findings (errors) or a refusal                                   |
| 2         | Usage or environment error, such as `Folder not found: nonexist` |

Every finding code is listed in the [reference](reference.md).

## 5. What next

- **Examples** in `sdk/examples/`: `focus-timer` (a panel, timers and an int setting), `stamp` (commands that put a sticky note or a small flow on the open drawing), plus `event-logger`, `word-count` and `testing`.
- **Reference:** [reference.md](reference.md) covers the manifest, the whole `ctx` API, the lifecycle and every check code.
- **Errors:** use `ctx.log`, not `console.*`, which is not attributed to your plugin. A command declared but not bound in `activate()` fails with a toast. Errors are attributed to your plugin. A `dev` plugin that errors out is stopped for the session only, and the next save starts it again with a fresh count.
- **Keep your own config untouched:** `$VP dev --print-env` prints a throwaway config and state folder as `VAULTDRAW_CONFIG_DIR=...` and `VAULTDRAW_STATE_DIR=...`. Start the app with those two variables set and run `dev` with the same variables (or `--config-dir <dir>`). `dev` then writes there, not to `~/.config/vaultdraw/`.

## Limits

- Tested on macOS only.
- The CLI is not published to npm yet.
- The plugin API is level 0 and experimental. It can change in a minor release, with changes listed in the CHANGELOG.
- Testing a plugin without the app is planned, not built.
- This page does not say where `ctx.log` output appears in the app; see the reference.
