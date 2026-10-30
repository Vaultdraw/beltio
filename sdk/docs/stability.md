# API stability: what 1.0 promises

The plugin API is frozen at 1.0. A plugin written for 1.0 keeps working on every 1.x app. This page says what is frozen, how it changes, and what a plugin author does about it.

## What is covered

| Covered | Where it is pinned |
| --- | --- |
| Every name, signature and type in `@vaultdraw/api` | `sdk/api/etc/api-surface.d.ts`, checked by a test |
| Every key of `plugin.toml`, the permission names and what each permission allows | `sdk/api/plugin.schema.json`, [manifest.md](manifest.md), [permissions.md](permissions.md) |
| The app events (`vault.opened`, `drawing.saved` and the others) and their payloads | the same snapshot |
| The error codes (`PluginErrorCode`) a call may reject with | the same snapshot |
| `vaultdraw-plugin`: commands, options, exit codes and the `--json` shape | [reference.md](reference.md#the-vaultdraw-plugin-tool) |

Not covered:

- **`@experimental` areas.** `ctx.text.fold`, `ctx.thumbnails`, `ctx.vault.graph` and `ctx.vault.table` were built for one official plugin each. They may change or go in a minor release. The tag is in the types.
- **Wording and layout** of toasts, dialogs and the plugin list, timing, and the order of events between different kinds.
- **The list of `check` codes and of error codes.** A minor release may add one: keep a default branch.
- **Anything not in the types or these docs.** If you reach it by another route, it is yours to keep working.

## Version numbers

| Number | Where | Meaning |
| --- | --- | --- |
| API level | `api = 1` in `plugin.toml`, `ctx.host.api.level` | Changes only in a major release |
| API revision | `ctx.host.api.revision`, the version of `@vaultdraw/api` | Semver: patch, minor, major |

- **Patch** (1.0.1): a fix. No type changes.
- **Minor** (1.1.0): an addition (a new member, event, manifest key, permission or error code) or a deprecation. Nothing a 1.0 plugin uses stops working.
- **Major** (2.0.0): removals and incompatible changes. The only release that can remove a deprecated name.

The revision follows the API, not the app: several app releases can ship one revision. `sdk/api/package.json` has `vaultdraw.minApp`, the first app version with the current revision.

## Deprecation

1. A name is tagged `@deprecated` in the types with its replacement, and listed in the [API change log](../api/CHANGELOG.md).
2. The host warns once per plugin and session in the plugin log (`deprecated: …`), and `vaultdraw-plugin check` warns where it can see the use.
3. The name keeps working for the rest of that major version.
4. It is removed in the next major release, and the change log says so.

Today: `ToastOptions.action` (use `actions`), `ctx.manifest.dir`, and `api = 0` in `plugin.toml` (use `api = 1`).

## Saying what your plugin needs

| Key | Says | Older app |
| --- | --- | --- |
| `api = 1` | The level it was written for | Refused when the level is newer than the app's |
| `min_api = "1.2.0"` | The oldest revision with what it uses | Refused: "Needs plugin API ≥ 1.2.0" |
| `min_app = "0.4.0"` | The oldest app | Refused: "Needs app ≥ 0.4.0" |

Compare the revision as a semantic version (major first): `1.0.0` is newer than `0.37.0` although its minor is smaller. Prefer asking the app at run time: `ctx.host.has("scene.batch")` is true when the member exists, and your plugin can fall back. Use `min_api` when there is no sensible fallback. `vaultdraw-plugin check` warns when `min_app` is lower than the code needs.

A plugin from a newer API never loads half-way: the plugin list shows it as not compatible, with the reason, and nothing runs.

## How the promise is kept

- A test pins the public declarations. Any change to an exported name or signature fails until `sdk/api/etc/api-surface.d.ts` is updated with `UPDATE_API_SURFACE=1`.
- The update refuses to run unless `sdk/api/package.json` has a new version, and refuses a removal or a changed signature unless the major version rose (declarations tagged `@experimental` excepted).
- The version must have an entry in the [API change log](../api/CHANGELOG.md), and must equal the revision the app reports (`ctx.host.api.revision`).

## Naming rules

A new name follows the existing ones, so the surface stays predictable.

| Rule | Example |
| --- | --- |
| `plugin.toml` keys and the types that mirror them use snake_case | `status_bar`, `timeout_ms`, `min_api` |
| Runtime members use camelCase | `ctx.scene.batch`, `ctx.statusBar` |
| An area is a noun on `ctx`; it registers things with `register(id, …)` | `ctx.commands.register` |
| `use…` members are React hooks and only work while rendering | `ctx.scene.useScene` |
| Reads that need the disk or the app's workers return a promise; reads of state already in memory are synchronous | `vault.list()` and `scene.elements()` |
| An area costs nothing until a plugin reads it | all of them |
