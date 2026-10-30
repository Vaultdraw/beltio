# Plugin API change log

The history of `@vaultdraw/api` (the types), the manifest and the `vaultdraw-plugin` tool. The API follows [semantic versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0 on; [stability.md](../docs/stability.md) says what that promises. The app's own change log is `CHANGELOG.md` at the repository root.

## 1.1.0

An addition for the official AI assistant plugin. Nothing a 1.0 plugin uses changes.

### Added

- **`ctx.net`** (permission `net`, `@experimental`): `request(...)` sends a request from the app, not the page (the page's content policy allows no `fetch`) and streams the answer. https only, or http to this computer; no private address; no redirects; Offline mode blocks other computers and still allows this computer. `auth` adds a stored secret as a header, so the page never holds it.
- **`ctx.secret`** (permission `secret`, `@experimental`): `set`, `has`, `delete` for secrets such as API keys. There is no read-back.
- Errors of `ctx.net` carry the codes listed on its members (`NETWORK_DISABLED`, `NETWORK_TIMEOUT`, `PRIVATE_ADDRESS`, `SECRET_MISSING`, `ABORTED` and others); the `PluginErrorCode` type is unchanged.
- The permission names `net` and `secret` are no longer reserved.

## 1.2.0

### Added

- **`ctx.text.fold(text)`** (`@experimental`, since 1.2.0): folds text the way the app's search does (lower case, accents and look-alikes removed, `ß` to `ss`). A plugin that filters names compares folded strings instead of copying the fold. The official graph plugin uses it. Needs `min_api = "1.2.0"`.

## 1.0.0

The API is frozen after an audit of every exported name (the audit is in the project notes; its table has 250 type members, 13 manifest keys, 7 permissions, 6 events and 6 commands, none removed).

### Changed

- **API level 1.** `ctx.host.api.level` is `1` and `plugin.toml` says `api = 1`. A manifest with `api = 0` still loads, with a warning in the plugin log and in `vaultdraw-plugin check` (`api-deprecated`), until API 2.0.
- `MethodsApi.register(name, …)` is `register(id, …)`. Types only.
- The note parse stand-in used by the mock host and the browser test host now shares the app's tag grammar and `alt|size` parser (`#fff` is a tag, `#ff00aa` is not; `![[a.png|caption|300x200]]` keeps alt and both sizes), so plugin tests see what the app sees.

### Added

- **`min_api`** in `plugin.toml`: the oldest API revision the plugin needs, such as `"1.2.0"`. An app with an older revision refuses the plugin and says why in the plugin list. `vaultdraw-plugin check` reports `min-api-invalid`.
- **`PluginApiError` and `PluginErrorCode`**: the error the API throws and the codes it uses are now public types.
- **`@experimental`**: `ctx.thumbnails`, `ctx.vault.graph` and `ctx.vault.table` are outside the promise and may change in a minor release.
- The surface guard: `sdk/api/etc/api-surface.d.ts` is pinned by a test that needs a version bump to change.

### Deprecated (removed in 2.0)

- `ToastOptions.action`: use `actions`. The plugin log warns once per plugin.
- `PluginManifestInfo.dir`: an internal path.
- `api = 0` in `plugin.toml`: use `api = 1`.

## 0.37.0 and earlier

API 0.x was experimental. Each revision is listed under "Plugin API" in the app's [CHANGELOG](../../CHANGELOG.md).
