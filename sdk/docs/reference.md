# Plugin API reference

What a Vaultdraw plugin is, what it can call, and what the app does for it. The API is experimental (level 0).

## A plugin on disk

A plugin is a folder with two files:

```
~/.config/vaultdraw/plugins/hello-command/
  plugin.toml
  main.js        # one ESM bundle; default export = definePlugin({...})
```

The config folder is `~/.config/vaultdraw/`. Bundled plugins live in the app's `Resources/plugins/`. Install a plugin by copying its folder into `plugins/`, or with **Install from folder…** in Settings → Plugins.

## plugin.toml

The manifest sits next to `main.js`. It names the plugin and declares its commands, panels and settings, so the app can register them without loading any code.

```toml
id = "hello-command"        # 2 to 39 characters: a-z, 0-9, -
name = "Hello"
version = "0.1.0"           # semver
api = 0                     # API level this plugin targets
main = "main.js"            # relative path inside the folder

[[contributes.commands]]
id = "hello"                # the full id is "hello-command.hello"
title = "Hello: say hello"
keys = ["Mod+Alt+H"]        # optional default chords; [] = none
```

Every key, type and limit is in the generated [manifest reference](manifest.md). It comes from `sdk/api/plugin.schema.json`, which editors can use for completion. In short:

- Required: `id`, `name`, `version`, `api`, `main`. Optional: `min_app`, `description`, `author`, `activation`, `permissions`, `dev`.
- `plugin.toml` is at most 64 KB. A manifest has at most 200 commands, 20 panels and 100 settings.
- Unknown keys are errors, except tables named `x-*`, which are reserved for tools.
- `permissions` is a declaration of what the plugin does to your files, not a sandbox. See [permissions.md](permissions.md).
- Only the activation event `onStartupFinished` exists. `dev = true` makes the app reload the plugin when its files change; a packaged plugin must not set it.
- The settings entries have the shape of `SettingDecl` in `@vaultdraw/api`. The Rust side only checks that each has a `key` and a `type`. The app's settings registry validates the rest and reports problems on the Plugins page.

## Lifecycle

```mermaid
flowchart TD
  A[App first frame] --> B[Host lists plugins]
  B --> C{Enabled and compatible?}
  C -- no --> X[Nothing registered]
  C -- yes --> D[Stubs: commands, panels, settings]
  D --> E{First use?}
  E -- "command, panel or onStartupFinished" --> F[Load main.js]
  F --> G["activate(ctx)"]
  G --> H[Plugin runs]
  H --> I{"Disable, reload or quit"}
  I --> J["deactivate() then dispose ctx.subscriptions"]
```

1. After the app's first frame, the host asks Rust for the plugin list. The scan runs off the main thread and is cached by modification time.
2. For every **enabled**, compatible plugin the host registers stubs: commands (with keys and `when`) in the palette and keymap, panels in the activity bar, and declared settings. **No plugin code loads.** Disabled plugins register nothing.
3. **Activation** happens on first use: running one of its commands, opening one of its panels, or, if declared, `onStartupFinished` on an idle callback after startup. The first trigger waits for activation, then runs. A plugin activates once per session.
4. `activate(ctx)` binds handlers and components. Anything registered through `ctx` is disposed on disable, reload and quit, in reverse order. `deactivate()` has a 2 s timeout.
5. Errors are attributed to the plugin that caused them. 3 attributed errors in a session, or a failed activation, disable it. The disable is saved ("Disabled by Vaultdraw: reason") until the user re-enables it. A `dev = true` plugin is stopped for the session only: the disable is not saved, and the next reload (a file save) starts it again with a fresh error count.

Enabled plugins are listed in `config.toml`:

```toml
[plugins]
enabled = ["hello-command"]
```

Plugin settings values live in `[plugin.<id>]` tables: in `config.toml`, or in the vault's `settings.toml` for vault scope.

## main.js

```js
import { definePlugin } from "@vaultdraw/api"; // or export the object literal directly

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => {
      ctx.ui.toast(`${ctx.settings.get("greeting")} from a plugin`);
    });
  },
});
```

These bare imports resolve inside the app, to one shared copy (through an import map): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@vaultdraw/api`. Everything else must be bundled into `main.js`, or loaded with a relative import from the plugin folder.

## API

The types below are shortened. The full, commented source is `sdk/api/src/`, and `sdk/api/etc/api-surface.d.ts` is the snapshot of every public declaration.

```ts
interface Disposable {
  dispose(): void;
}

interface Plugin {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>; // 2 s timeout
}
function definePlugin(plugin: Plugin): Plugin; // identity

interface PluginContext {
  readonly manifest: {
    id: string;
    version: string;
    dir: string;
    permissions: readonly ("vault.read" | "vault.write")[]; // since 0.2.0
  };
  readonly commands: {
    /** Bind the handler of a command declared in plugin.toml (short id). */
    register(id: string, run: () => void | Promise<void>): Disposable;
    /** Run any command by full id (built-in or plugin). */
    execute(fullId: string): Promise<void>;
  };
  readonly panels: {
    /** Provide the React component of a panel declared in plugin.toml (short id). */
    register(id: string, component: React.ComponentType): Disposable;
    open(id: string): void;
    close(id: string): void;
  };
  readonly settings: {
    get<T = unknown>(key: string): T; // effective value (vault > global > default)
    set(key: string, value: unknown): Promise<void>;
    onChange(key: string, cb: (value: unknown) => void): Disposable;
  };
  readonly ui: { toast(message: string): void };
  readonly scene: {
    elements(): readonly SceneElement[]; // frozen snapshot; [] when no drawing is open
    onChange(
      cb: (e: { reason: "edit" | "switch"; path: string | null }) => void,
    ): Disposable; // at most once per frame; pan, zoom and selection don't fire
    useScene<T>(
      select: (els: readonly SceneElement[]) => T,
      isEqual?: (a: T, b: T) => boolean,
    ): T; // React hook for panels
    batch(ops: readonly SceneOp[]): Promise<{ ids: string[] }>; // all or nothing, ONE undo step
    viewportCenter(): { x: number; y: number };
  };
  readonly events: {
    on<K extends keyof AppEventMap>(
      name: K,
      cb: (payload: Readonly<AppEventMap[K]>) => void,
    ): Disposable;
  };
  readonly host: {
    // since 0.2.0
    readonly app: string; // the app version
    readonly api: { level: 0; revision: string }; // for example { level: 0, revision: "0.2.0" }
    has(feature: string): boolean; // "theme.tokens", "scene.batch", "drawing.saved"
  };
  readonly theme: {
    // since 0.2.0, read only
    mode(): "light" | "dark";
    tokens(): Readonly<Record<ThemeTokenName, string>>; // CSS strings, see theme-tokens.md
    onChange(
      cb: (e: { mode: "light" | "dark"; themeId: string }) => void,
    ): Disposable;
  };
  readonly storage: {
    // since 0.3.0: JSON values, saved on this computer
    readonly global: {
      get<T extends Json = Json>(key: string): Promise<T | undefined>;
      set(key: string, value: Json): Promise<void>;
      delete(key: string): Promise<void>;
      keys(): Promise<string[]>;
    };
  };
  readonly log: {
    debug(...a: unknown[]): void;
    info(...a: unknown[]): void;
    warn(...a: unknown[]): void;
    error(...a: unknown[]): void;
  };
  /** Push anything disposable; disposed in reverse order on disable, reload and quit. */
  readonly subscriptions: Disposable[];
  setTimeout(fn: () => void, ms: number): Disposable;
  setInterval(fn: () => void, ms: number): Disposable;
}
```

Notes:

- `ctx.ui.toast(m)` shows "<plugin name>: m". Don't add your name yourself. The same message while it is still showing refreshes that toast instead of stacking a second one.
- A stored setting value outside a declared `min` / `max`, or of the wrong type, reads as the default and is reported as a settings problem. `ctx.settings.set` rejects such a value.
- `ctx.scene.batch` rejects when no drawing is open, when the drawing is read-only, or when an op is invalid. The error carries the problems in `issues` (`SceneOpIssue[]`: op index, key, message).
- Events are delivered in order, on a microtask. Paths are vault-relative.
- `ctx.host.has(name)` asks for a feature, not a version (like `has('nvim-0.9')` in Neovim). Names are a `ctx` member (`"theme"`), a member of one (`"theme.tokens"`) or an app event (`"drawing.saved"`). Unknown names give `false`. The list is generated from the `@since` tags (`sdk/api/testing/features.ts`).
- `ctx.theme.tokens()` returns what the document shows now, as CSS strings: some are `rgba(...)` colours or shadows, not only `#rrggbb`. The table is frozen and is as of the last theme change (a CSS snippet that edits `--vault-*` by itself is not seen); read it again after `onChange`. The 41 names are API; each is described in [theme-tokens.md](theme-tokens.md).
- `ctx.host` and `ctx.theme` are built on first read, and nothing listens to theme changes until you call `onChange`. A plugin that never touches them pays nothing.
- `ctx.storage.global` keeps data between runs, like Obsidian's `loadData`/`saveData` with VS Code's `globalState` interface. It is one JSON object per plugin in the app's state folder (`plugin-data/<id>/data.json`), the same in every vault, never inside a vault and not part of your config files.
  - Values are JSON (`null`, booleans, finite numbers, strings, arrays, plain objects); `get` returns a fresh copy. A key is 1 to 256 characters.
  - The whole object is limited to `plugins.storage_limit_kb` (1024 KiB by default, 64 to 16384). A `set` past it rejects with `code: "QUOTA"` and changes nothing; a bad key or value rejects with `code: "INVALID_ARGUMENT"`.
  - Nothing is read until the first call. Writes reach the disk 600 ms after the last change (at most 2 s), are skipped when nothing changed, and are flushed when the plugin is disabled or reloaded and before the app quits.
  - An unreadable file is renamed `data.json.bad`; the plugin starts empty and the user sees one notice.
  - Uninstalling keeps the data. Settings → Plugins shows its size with a **Delete data** button, and **Plugins: Delete data of a plugin…** (`plugins.deleteData`) goes there.

### Scene and event types

```ts
type SceneElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "freedraw"
  | "image"
  | "frame"
  | "other";

interface SceneElement {
  // all readonly
  id: string;
  type: SceneElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
}

interface NewElement {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  points?: [number, number][];
}

type SceneOp =
  | { op: "add"; element: NewElement }
  | { op: "update"; id: string; props: Partial<Omit<NewElement, "type">> }
  | { op: "delete"; id: string };

type AppEventMap = {
  "vault.opened": { name: string };
  "drawing.opened": { path: string };
  "drawing.saved": { path: string };
  "drawing.renamed": { from: string; to: string };
  "drawing.deleted": { path: string };
};
```

`SceneElement` is a plain copy, never a live Excalidraw element. It leaves out version, nonce, index, seed, bindings and bound elements.

### Batch rules

| Rule              | Limit                                                 |
| ----------------- | ----------------------------------------------------- |
| Ops per batch     | at most 500                                           |
| Numbers           | finite, within ±1e7                                   |
| `width`, `height` | 1 to 1e6                                              |
| `text`            | at most 10 000 characters; required for text adds     |
| `fontSize`        | 1 to 1000                                             |
| `strokeWidth`     | 0 to 100                                              |
| `opacity`         | 0 to 100                                              |
| Colours           | hex (3, 4, 6 or 8 digits), CSS names or `transparent` |

- `text` on a shape becomes its bound label.
- Adds without `x` / `y` are centred as a group on the viewport.
- Ids come back in op order (labels excluded). The app always generates ids.
- A `delete` wins over updates of the same id.
- Any unknown property rejects the whole batch.

## Rules for plugin code

1. Use `ctx.setTimeout`, `ctx.setInterval` and `ctx.subscriptions` instead of raw timers and listeners. Then disabling a plugin leaves nothing running.
2. Never block. A command handler whose synchronous part takes over 50 ms is recorded as slow. Keep work async or chunked.
3. `console.*` is not attributed to your plugin. Use `ctx.log` (see [Logging](#logging)).
4. Keep `main.js` small. The host loads it only on first use, so unused plugins cost nothing, and a small bundle activates faster.

## What the host adds for you

- **Panels.** Every declared panel gets a palette command `<pluginId>.panel.<panelId>` ("Toggle <title> panel") and an activity-bar button `<pluginId>.<panelId>`. Panels open in a right-hand column. The panel's code loads, and the plugin activates, the first time it opens. A render error shows "This plugin panel crashed." and counts as a plugin error. Only the first 6 plugin panel buttons show in the activity bar by default.
- **Timing.** Command handlers are timed (the synchronous part). Over 50 ms is "slow". The `performance` marks `vaultdraw:plugin:<id>:load` and `:activate` are emitted for the perf harness. Settings → Plugins shows activation time, with a "slow" badge for slow activations.
- **Missing handler.** A command declared in `plugin.toml` but not bound in `activate()` fails with an attributed error and a toast. The same holds for a declared panel that is never registered.

## Installing, enabling, safe mode

- **Settings → Plugins** lists installed plugins. Each row has an enable switch (a plugin that isn't bundled asks for consent first, because it runs with full access), an Unverified badge, "Needs app ≥ X", "Disabled by Vaultdraw: reason" with Re-enable, Active / Not loaded, the activation time, a memory estimate, Open folder, Reload (active or dev plugins) and Uninstall (user plugins). **Install from folder…** copies a folder into `~/.config/vaultdraw/plugins/`. It does not enable it.
- **Palette commands:**

  | Command                       | Id                        |
  | ----------------------------- | ------------------------- |
  | Plugins: Open plugin settings | `plugins.openSettings`    |
  | Plugins: Install from folder… | `plugins.installFolder`   |
  | Plugins: Reload plugin list   | `plugins.reloadList`      |
  | Plugins: Open plugins folder  | `plugins.openFolder`      |
  | Plugins: Restart in safe mode | `plugins.restartSafeMode` |
  | Plugins: Restart normally     | `plugins.restartNormally` |

- **Safe mode** loads no plugins at all. The Plugins page still lists them. Start it by holding Option at launch (macOS) or with **Restart in safe mode**. It also starts by itself after 2 launches in a row that crashed with plugins enabled. A launch counts as OK 10 s after the host starts, or on a clean quit.
- **Dev loop:** put `dev = true` in `plugin.toml`, install the folder and enable it. Saving `main.js` or `plugin.toml` reloads the plugin: dispose, import again with a fresh `?t=` URL, then activate if it was active. Symlinked and temp folders work (watched paths are canonicalised). Each reload keeps the old module in memory (about 6 times its size) until the app restarts, and a hint is logged every 20 reloads. `vaultdraw-plugin dev` wraps this loop (see below).

## Logging

`ctx.log.debug`, `info`, `warn` and `error` record a line for your plugin. The host also records every error attributed to the plugin and every declared-setting problem, as `warn` or `error` lines.

| Plugin | What happens to a line |
| --- | --- |
| `dev = true` | Appended to `<state dir>/plugin-logs/<id>.log` |
| other | Kept in memory only (the last 100 lines); no file, and the app has no log view |

Dev log details:

- Each line is `<ISO time> [<level>] <text>`, for example `2026-10-24T04:00:00.000Z [info] text`. Text is cut at 4000 characters.
- The app sends lines in batches, about every 250 ms.
- The file is capped at 1 MB. When an append would pass the cap, only the newest 256 KB are kept (from a line start), then the append goes on.
- The state folder is `$VAULTDRAW_STATE_DIR`, else `$XDG_STATE_HOME/vaultdraw`, else `~/.local/state/vaultdraw` (on Windows `%LOCALAPPDATA%\Vaultdraw`). A relative override is an error.
- `vaultdraw-plugin dev` prints the log path and new lines of the dev log, prefixed with `log |`.

## Testing a plugin without the app

`boot` from `@vaultdraw/api/testing` runs a plugin in memory under vitest, with a fake scene, event bus and settings. In this repo, `vitest.config.mts` maps that import to the in-repo host kit by default and to the mock (`sdk/api/testing`) when `VAULTDRAW_TEST_HOST=mock`. See [testing.md](testing.md) for the members, fake timers, what the mock does and does not do, and the conformance run against the real host. The examples in `sdk/examples/*/main.test.ts` show it in use.

- A plugin with no command or panel to trigger activation needs `activation = ["onStartupFinished"]` to be active after `boot`.
- `flush()` works with and without fake timers.

## Versioning

1. **Two numbers.** The **API level** is `api = 0` in the manifest. The host refuses a plugin that names another level. The **API revision** is the version of the `@vaultdraw/api` package, `0.N.P`. Its `package.json` has `vaultdraw.minApp`, the first app version that shipped that revision.
2. **v0 is experimental.** Additions are optional members, tagged `@since` with the revision that added them.
3. **Changes and removals** happen only in a minor revision. They are listed under "Plugin API" in the [CHANGELOG](../../CHANGELOG.md), they show as a diff of `sdk/api/etc/api-surface.d.ts`, and they keep the old form for one release when that is cheap.
4. **`min_app` is the author's choice.** `vaultdraw-plugin check` warns when it is lower than what the code uses.
5. **Ask, don't compare versions:** `ctx.host.api.revision` is there to show, and `ctx.host.has(feature)` is how a plugin decides what to use.
6. **Real guarantees** (deprecation windows, an N-1 shim) begin at 1.0.

## The `vaultdraw-plugin` tool

`vaultdraw-plugin` is the developer command line tool. Exit codes: 0 ok, 1 findings or refusal, 2 usage or environment error.

| Command | What it does | Docs |
| --- | --- | --- |
| `check <dir\|file.zip> [--json] [--activate [--timeout <ms>]]` | Static checks of a folder or a zip; `--activate` also runs `activate()` once in a dry host (folder only) | below |
| `init <id> [--example <name> \| --template command\|panel\|scene] [--dir <parent>]` | A JavaScript plugin from an example, or a TypeScript project from a template | [getting-started.md](getting-started.md), [testing.md](testing.md#typescript-projects) |
| `build [dir] [--watch]` | Bundle a TypeScript project into `dist/` | [packaging.md](packaging.md) |
| `package <dir> [--out <dir>] [--json]` | Check, then write a reproducible zip and its `.sha256` file | [packaging.md](packaging.md) |
| `dev <dir> [--config-dir <dir>] [--once] [--print-env]` | Copy the plugin into the plugins folder on each save; show the dev log | [getting-started.md](getting-started.md) |
| `dev <dir> --sandbox [--app <path>]` | Start the app on a throwaway config, state and vault, with the plugin enabled; remove them on exit | [getting-started.md](getting-started.md#the-sandbox) |

The templates are `.tpl` files in `sdk/cli/templates/`; `init` strips the suffix and replaces `__ID__` and `__NAME__`. A manifest can name its build entry in an `x-build` table (`entry = "src/main.ts"`).

### `check` codes

`vaultdraw-plugin check <dir|file.zip>` prints each finding with its code. `--json` prints them as JSON. It exits 1 when there is any error. Warnings do not change the exit code.

| Code | Kind | Meaning |
| --- | --- | --- |
| `plugin-toml-missing` | error | No `plugin.toml` in the folder |
| `manifest-too-large` | error | `plugin.toml` is over 64 KB |
| `toml-parse` | error | Not valid TOML |
| `unknown-key` | error | A key the manifest doesn't have (top level, `contributes`, a command, a panel) |
| `missing-key` | error | A required key is missing |
| `id-invalid` | error | Plugin id breaks `^[a-z0-9][a-z0-9-]{1,38}$` |
| `name-invalid` | error | `name` is not 1 to 200 characters |
| `version-invalid` | error | `version` is not semver |
| `min-app-invalid` | error | `min_app` is not semver |
| `main-path-invalid` | error | `main` is not a relative path inside the folder |
| `api-unsupported` | error | `api` is not a level the app implements (0) |
| `text-invalid` | error | `description` or `author` is too long or not text, or `dev` is not true or false |
| `activation-unknown` | error | `activation` is not a list, or names an event other than `onStartupFinished` |
| `permission-invalid` | error | `permissions` is not a list of strings |
| `permission-unknown` | error | A permission name that does not exist |
| `permission-reserved` | error | `net`, `secret` or `control`: reserved for later |
| `permission-duplicate` | error | The same permission twice |
| `permission-too-many` | error | More than 8 permissions |
| `dev-true` | error | `dev = true` in a plugin you ship; `vaultdraw-plugin dev` adds it to the installed copy |
| `contribution-invalid` | error | A `contributes` entry has the wrong shape or type |
| `contribution-id-invalid` | error | A command or panel id breaks the id rule |
| `contribution-duplicate` | error | Two commands or two panels share an id |
| `title-invalid` | error | A command or panel title is not 1 to 200 characters |
| `setting-invalid` | error | A setting has no string `key` and `type` |
| `too-many` | error | More than 200 commands, 20 panels or 100 settings |
| `main-missing` | error | The file named by `main` doesn't exist. When the folder has `src/main.ts`, `src/main.tsx` or `dist/plugin.toml`, the hint says to run `vaultdraw-plugin build` first (or check `dist/`) |
| `imports-unshared` | error | `main.js` (or a file it imports) imports a bare module the app doesn't provide; bundle it |
| `import-missing` | warning | A relative import points to a file that isn't in the plugin folder |
| `bundle-large` | warning | `main` is over 100 KB |
| `min-app-low` | warning | `min_app` is lower than the first app version with the API the code uses (best effort: it looks for `ctx.<area>` in the code) |
| `readme-missing` | warning | No `README.md` |
| `zip-checksum` | error | Zip only: the file does not match its `.sha256` file, or that file holds no checksum |
| `zip-invalid` | error | Zip only: the archive breaks the strict reader's rules (see [packaging.md](packaging.md#check-a-zip)) |
| `zip-layout` | error | Zip only: `plugin.toml` is inside a single top folder instead of at the zip root |

With `--activate`, the codes below are added (only when the static checks found no errors). `activate-unsupported`, `activate-threw-after-skip`, `activate-timer-error`, `deactivate-threw` and `dispose-threw` are warnings.

| Code | Kind | Meaning |
| --- | --- | --- |
| `activate-load-failed` | error | `main` could not be loaded (a syntax error, or an error at the top level) |
| `activate-no-default` | error | `main` has no default export with an `activate(ctx)` function |
| `activate-threw` | error | `activate()` threw or rejected |
| `activate-timeout` | error | `activate()` did not finish in time (default 5000 ms; `--timeout <ms>`, 100 to 60000) |
| `activate-crashed` | error | The dry run ended without a result |
| `activate-unbound-command` | error | A declared command is never bound with `ctx.commands.register` |
| `activate-unbound-panel` | error | A declared panel is never registered with `ctx.panels.register` |
| `activate-undeclared-command` | error | `activate()` binds a command `plugin.toml` does not declare (the app refuses it) |
| `activate-undeclared-panel` | error | The same for a panel |
| `activate-unknown-event` | error | `ctx.events.on` names an event the app does not have |
| `activate-bad-call` | error | `register` was called without an id and a function or component |
| `activate-unsupported` | warning | The plugin used something that needs the running app (`ctx.scene`, `ctx.host`, `ctx.theme`, `ctx.commands.execute`, `ctx.panels.open`, `ctx.settings.set`); it was skipped |
| `activate-threw-after-skip` | warning | `activate()` threw after a skipped call; the dry run cannot tell whether the plugin is wrong, so declared commands are not compared |
| `activate-timer-error`, `deactivate-threw`, `dispose-threw` | warning | A timer callback, `deactivate()` or a `dispose()` threw |

`--activate` runs your plugin's code in a child process with your rights (the app does the same), so use it only on plugins you trust. The CLI prints a note before it runs. The child gets a minimal environment (no tokens), and the timeout (which covers loading and `activate()`, not `deactivate()`) stops loops. It needs Node 22.15 or newer. The shared modules (`react`, `@vaultdraw/api` and the others the app provides) are stubs in this run, so panel components are not rendered; use the [mock host](testing.md) for behaviour tests.
