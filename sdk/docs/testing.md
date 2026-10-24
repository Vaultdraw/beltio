# Testing a plugin

Test your plugin under vitest with no app running. `boot` starts it in memory against a mock host: a fake scene, event bus, settings and toasts.

> **Status.** `@vaultdraw/api/testing` is not on npm yet (like `vaultdraw-plugin`). `init --template` copies the kit into your project as `vaultdraw/testing/`, and the template's `tsconfig.json` and `vitest.config.ts` map `@vaultdraw/api/testing` to it. In this repo, the vitest alias points the same import at the in-repo host kit (see [Same tests, real host](#same-tests-real-host)). The calls below are the same in all three.

## A first test

```ts
import { afterEach, expect, it } from "vitest";
import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import plugin from "./src/main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

it("says hello", async () => {
  p = await boot(
    {
      id: "hello-command",
      name: "Hello",
      contributes: {
        commands: [{ id: "hello" }],
        settings: [
          {
            key: "greeting",
            type: "string",
            title: "Greeting",
            default: "Hello",
          },
        ],
      },
    },
    plugin,
  );
  await p.run("hello");
  expect(p.toasts()).toEqual(["Hello: Hello, Vaultdraw!"]);
});
```

1. `boot(manifest, plugin)` registers the declared commands, panels and settings. It loads no plugin code, like the app.
2. `p.run("hello")` runs the command by its short id. The plugin activates on the first run.
3. `p.toasts()` returns the messages as the user would see them, with the plugin name prefix.
4. `dispose()` in `afterEach` removes everything the test created.

The manifest argument takes `id` and what your test needs: `name` (default: the id), `version` (default `0.1.0`), `dir`, `activation`, `dev` and `contributes`. Commands and panels may be bare `{ id }`; their title defaults to the id. A parsed `plugin.toml` fits too. The examples in `sdk/examples/*/main.test.ts` read their own `plugin.toml` with `readExample`.

## What a booted plugin offers

| Member | What it does |
| --- | --- |
| `info` | The manifest after defaults: `id`, `name`, `version`, `permissions`, `contributes` |
| `run(shortId)` | Runs a command like the palette does; resolves when the handler is done |
| `openPanel(shortId)` | Renders a panel; returns a view with `unmount()` (a Testing Library `RenderResult` fits). Needs `react`, `react-dom` and `@testing-library/react` installed |
| `toasts()` | Messages of the visible toasts. The host adds the prefix; equal messages are shown once |
| `timers()` | How many timers the plugin has scheduled |
| `log()` | The plugin's `ctx.log` lines and attributed errors, as `{ level, text }`. Keeps the last 100 |
| `setSetting(key, value, scope?)` | Writes a setting; `false` when the declaration refuses it |
| `scene` | A fake editor: `setElements`, `emitChange`, `switchTo`, `readOnly`, `batches`, `live()` |
| `events.emit(name, payload)` | Emits an app event such as `drawing.saved` |
| `theme.set({ mode, themeId, tokens })` | Changes what `ctx.theme` reports and notifies `onChange`. Until a test sets `tokens`, the mock's `tokens()` fails with "not set up in this test" |
| `flush()` | Lets timers, microtasks and one animation frame run, and React settle |
| `disable()` | Like the user disabling it: `deactivate()` runs, everything registered is disposed |
| `dispose()` | `disable()` plus removing what the kit made. Call it after every test |

The fake scene starts with one open, empty, writable drawing. `scene.batches` has one entry per `ctx.scene.batch` write, so one entry is one undo step. `emitChange()` bumps every element version, so it signals nothing in an empty scene. `switchTo(null)` closes the drawing, and `ctx.scene.batch` then rejects; `readOnly(true)` makes it reject too.

```ts
p.scene.setElements([{ type: "text", x: 0, y: 0, text: "hello world" }]);
const view = await p.openPanel("stats");
p.scene.emitChange();
await p.flush();
p.events.emit("drawing.saved", { path: "a.excalidraw" });
```

## Fake timers

Use vitest's fake timers for anything that waits. The plugin's `ctx.setTimeout` and `ctx.setInterval` follow them, and `timers()` counts them.

```ts
vi.useFakeTimers();
await p.run("start");
await vi.advanceTimersByTimeAsync(120_000);
expect(p.toasts()).toEqual(["Focus timer: Focus session done"]);
expect(p.timers()).toBe(0);
```

Put `vi.useRealTimers()` in `afterEach`. `flush()` works with and without fake timers. The `focus-timer` example tests timers, a panel and a setting this way.

## What the mock does and does not do

| It does | It does not |
| --- | --- |
| Enforce the real rules: setting bounds and types, toast prefix and de-duplication, disposal order, scene op validation, the 3-error disable, declared-only commands and panels | Run the real editor. `ctx.scene` talks to the fake scene |
| Run `onStartupFinished` activation during `boot` | Run other plugins or built-in commands: `ctx.commands.execute` works only for this plugin's own commands |
| Fail clearly when your test skipped a step | Guess for you |
| Count timers and log lines | Measure speed |

Anything the mock does not provide fails with a message that starts `not set up in this test:`. It never returns an empty result instead. Examples: `ctx.commands.execute` of a command that is not the plugin's own, `openPanel` or `ctx.scene.useScene` without the React packages, and `openPanel` for a panel the manifest does not declare. Declare it or install the package first.

A plugin with no command or panel to trigger activation needs `activation = ["onStartupFinished"]` to be active after `boot`.

## Same tests, real host

The example tests also run against the real host of this repo. That is a conformance check: the mock and the real host must give the same answers.

| Environment                | Selects               |
| -------------------------- | --------------------- |
| default                    | the real in-repo host |
| `VAULTDRAW_TEST_HOST=mock` | the mock host         |

```bash
VAULTDRAW_TEST_HOST=mock npx vitest run
```

Write your tests against the `TestPlugin` type only, and they run on both.

## TypeScript projects

```bash
vaultdraw-plugin init my-plugin --template command   # or panel, scene
cd my-plugin
npm install
npm test            # vitest, on the mock
npm run build       # esbuild into dist/
npm run package     # my-plugin-0.1.0.zip
```

`init --template` writes a TypeScript project: `plugin.toml`, `src/main.ts` (`main.tsx` for `panel`), `src/main.test.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts` and `README.md`. The `vaultdraw/` folder holds the API types and the test kit, copied from the SDK. `package.json` has `"type": "module"` and the scripts `dev`, `build`, `check` (runs `check dist`), `test` and `package` (runs `package dist`). The id must be valid (2 to 39 characters of `a-z`, `0-9`, `-`), and the target folder must be empty or missing. The build and the zip are in [packaging.md](packaging.md).

## Check the manifest and the bundle

`vaultdraw-plugin check <dir>` runs the static checks. `--json` prints the result for scripts and CI:

```json
{ "schemaVersion": 1, "ok": true, "errors": [], "warnings": [] }
```

Each finding is `{ code, message, file }`. The exit code is 0 without errors, 1 with findings. The codes are in the [reference](reference.md#check-codes).
