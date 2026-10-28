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
Dev log: ~/.local/state/vaultdraw/plugin-logs/my-hello.log (new lines are shown here)
```

`dev` copies the folder into `plugins/` in the config folder and watches your folder. It adds `dev = true` to the installed copy only, so the host reloads the plugin on each save. Add `--once` to copy and exit. In a TypeScript project (a source entry such as `src/main.ts` and no `main.js`), `dev` builds into `dist/` first and keeps `dist/` in sync.

Do these once, in the app:

1. Press **Cmd+P** and run **Plugins: Reload plugin list**.
2. Open **Settings, Plugins** and switch **My Hello** on.
3. A plugin that is not bundled shows an Unverified badge. The first time you enable it, a consent prompt appears, because plugins run with full access. Allow it. A plugin you have not confirmed stays off, even if `plugins.enabled` lists it, and shows "Needs review". A plugin cannot reuse an official plugin's id unless it sets `dev = true`.
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
- **Dev log:** see [below](#the-dev-log).
- **Errors:** use `ctx.log`, not `console.*`, which is not attributed to your plugin. A command declared but not bound in `activate()` fails with a toast. Errors are attributed to your plugin. A `dev` plugin that errors out is stopped for the session only, and the next save starts it again with a fresh count.
- **Keep your own config untouched:** use the [sandbox](#the-sandbox) (`dev --sandbox`), or by hand: `$VP dev --print-env` prints a throwaway config and state folder as `VAULTDRAW_CONFIG_DIR=...` and `VAULTDRAW_STATE_DIR=...`. Start the app with those two variables set and run `dev` with the same variables (or `--config-dir <dir>`). `dev` then writes there, not to `~/.config/vaultdraw/`. By hand, the app still opens your own recent vault; the sandbox does not.
- **Does it activate?** `$VP check . --activate` also runs `activate()` once in a dry host and reports commands or panels that are declared but never bound (see the [reference](reference.md#check-codes)).

## The sandbox

`$VP dev . --sandbox` starts the app on a throwaway copy of everything, so a buggy plugin cannot touch your settings or drawings:

```
Sandbox: /tmp/vds-aB3dEf (removed when you stop)
Vault:   /tmp/vds-aB3dEf/vault
```

It makes `/tmp/vds-xxxxxx/` with `config/` (a `config.toml` that enables your plugin), `state/` and `vault/` with one drawing, copies the plugin in, starts the app, keeps copying on each save and removes the folder when the app closes or you press Ctrl+C. The app is found with `--app <path>` (the binary, or the `.app` bundle on macOS), then `$VAULTDRAW_APP`, then `/Applications/Vaultdraw.app` (macOS).

- **Your vault stays closed.** The app is started with `VAULTDRAW_CONFIG_DIR`, `VAULTDRAW_STATE_DIR` and `VAULTDRAW_VAULT` set to the sandbox. When both `VAULTDRAW_VAULT` and `VAULTDRAW_STATE_DIR` are set, the app opens only that vault folder and never reads or writes your own `recent-vault`. (`VAULTDRAW_VAULT` alone, for example exported as a default for the offline CLI, changes nothing in the app window.)
- **App version.** The app must have plugin support (0.1.2 or newer) and be at least `min_app`; otherwise `dev` stops and says so. Older apps ignore `VAULTDRAW_VAULT`, which is why the version is checked first.
- **Same machine, two apps.** The web view's storage is shared with your normal app, so avoid running the sandbox and your normal Vaultdraw at the same time.
- **Limit.** The web view's own storage (window size, a few remembered UI choices) is still the normal one; it holds no vault, config or plugin data.
- `--sandbox` cannot be combined with `--config-dir` or `--once`.

## The dev log

For a plugin with `dev = true` (which `dev` sets on the installed copy), the app appends its `ctx.log` lines and the errors attributed to it to `<state dir>/plugin-logs/<id>.log`. A line looks like this:

```
2026-10-24T04:00:00.000Z [info] text
```

`dev` prints the log path and shows new lines as they arrive, prefixed with `log |`. Only lines written after `dev` starts are shown. Nothing is written for a plugin without `dev = true`. The file is capped at 1 MB; past that, the newest 256 KB are kept.

The state folder is `$VAULTDRAW_STATE_DIR`, else `$XDG_STATE_HOME/vaultdraw`, else `~/.local/state/vaultdraw`. With `dev --print-env` it is the throwaway folder it prints.

## TypeScript

To write the plugin in TypeScript, start from a template with `init --template command|panel|scene`, build with `vaultdraw-plugin build`, and test with vitest. `npm create vaultdraw-plugin <id>` runs `init --template command` (it is a thin wrapper and is not published either).

- [testing.md](testing.md): test a plugin without the app, using the mock host.
- [packaging.md](packaging.md): `build`, `package`, and the zip layout.

## Limits

- Tested on macOS only.
- The CLI is not published to npm yet.
- The plugin API is level 0 and experimental. It can change in a minor release, with changes listed in the CHANGELOG.
- `ctx.log` lines go to a file only for `dev = true` plugins (the dev log). The app has no log view, and it writes nothing for other plugins.
