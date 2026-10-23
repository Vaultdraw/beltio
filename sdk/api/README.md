# @vaultdraw/api

Types of the Vaultdraw plugin API. Not published yet (`private`).

The package has no runtime of its own except `definePlugin` (an identity function) and `SHARED_SPECIFIERS`. The app serves the real `@vaultdraw/api` to plugins at runtime.

## Use

```ts
import { definePlugin } from "@vaultdraw/api";

export default definePlugin({
  activate(ctx) {
    ctx.commands.register("hello", () => ctx.ui.toast("Hello"));
  },
});
```

## Layout

| File | Contents |
| --- | --- |
| `src/plugin.ts` | `Plugin`, `PluginContext`, `definePlugin` |
| `src/commands.ts`, `panels.ts`, `settings.ts`, `scene.ts`, `events.ts` | One area each |
| `src/manifest.ts` | What `plugin.toml` contributes |
| `src/specifiers.ts` | `SHARED_SPECIFIERS`: bare modules a plugin may import |
| `etc/api-surface.d.ts` | Snapshot of the public declarations |

Every member has a `@since` tag with the API revision that added it.

## Changing the API

The test `test/surface.test.ts` fails on any change to the public declarations. If the change is intended, regenerate the snapshot and commit it:

```sh
UPDATE_API_SURFACE=1 npx vitest run sdk/api/test/surface.test.ts
```

The app imports these types type-only, and its context factory is typed `PluginContext`, so `tsc` fails if the two drift.
