# Permissions

A plugin lists in `plugin.toml` what it does to your files. The app shows the list when you enable the plugin and keeps a record of what you agreed to.

**A permission is a declaration, not a sandbox.** Plugins run inside the app with full access, and a plugin that skips the SDK can reach anything the app can. Only install plugins you trust.

## What it does and does not do

| It does | It does not |
| --- | --- |
| Lists, in plain words, what a plugin says it does to your files | Stop a hostile plugin |
| Shows the list in the enable dialog | Ask on every call (there are no prompts at run time) |
| Keeps one record of what you confirmed, in `plugin-consent.json` in the state folder | Give you a per-permission off switch: raw calls would bypass it, so it would be a false control |
| Holds a plugin back when an update adds a **write** permission, until you confirm | Cover scene edits: they have undo, so `ctx.scene.batch` needs no permission |
| Gives the registry (later) something to check declared against used |  |

## Declare them

```toml
permissions = ["vault.read", "vault.write", "folders.import"]   # optional, default []
```

| Permission | Consent line | Gates |
| --- | --- | --- |
| `vault.read` | Read the drawings in your vault | Listing folders, reading drawings other than the open one, and the `vault.changed` event |
| `vault.write` | Create drawings in your vault | Creating drawings. Files have no undo, so creating one needs this permission |
| `folders.import` | Read a folder you pick and write into a destination you pick | `ctx.folders` (since 0.9.0): listing and reading a folder the user chose in a dialog, and create-only writes into a new vault or a folder of the open vault. The source is never written |

At most 8, no duplicates. An unknown name is a manifest error, so an older app refuses a plugin that needs a newer one. The names `net`, `secret` and `control` are reserved for later and are refused today. `ctx.manifest.permissions` returns the list.

Since API 0.3.0 the app checks them in its native layer: every native call of the plugin API goes through one gateway (`plugin_call`), which looks the method up in a fixed list, then refuses (`code: "PERMISSION"`) a call whose permission your `plugin.toml` does not declare or the user has not confirmed. `ctx.storage` needs no permission.

## Which calls need which permission

| Call                                          | Permission    | Since |
| --------------------------------------------- | ------------- | ----- |
| `ctx.vault.list(dir)`                         | `vault.read`  | 0.6.0 |
| `ctx.vault.readDrawing(path)`                 | `vault.read`  | 0.6.0 |
| `ctx.events.on("vault.changed", …)`           | `vault.read`  | 0.6.0 |
| `ctx.vault.createDrawing(path, ops)`          | `vault.write` | 0.6.0 |
| `ctx.vault.info()`                            | none          | 0.6.0 |
| `ctx.vault.graph.read()`, `graph.layout.load()` | `vault.read`  | 0.18.0 |
| `ctx.vault.graph.layout.save(bytes)`          | `vault.write` | 0.18.0 |
| `ctx.workspace.open(path)` and `activePath()` | none          | 0.6.0 |
| `ctx.importers.register(id, importer)`        | none          | 0.6.0 |
| `ctx.storage.global`                          | none          | 0.3.0 |
| `ctx.scene` (edits have undo)                 | none          | 0.1.0 |
| `ctx.markdown.parse(text, options)`           | none          | 0.8.0 |
| `ctx.pages.createDocument(options)`           | none (the drawing opens in the editor, as "New drawing") | 0.9.0 |
| `ctx.pages.buildScene(items, options)`        | none (no native call) | 0.9.0 |
| `ctx.scene.scrollTo(id)`                      | none          | 0.9.0 |
| `ctx.folders.pickSource(options)` and every `SourceFolder` call | `folders.import` | 0.9.0 |
| `ctx.folders.pickTarget(options)` and every `TargetFolder` call | `folders.import` | 0.9.0 |

A call that needs a permission your `plugin.toml` does not declare fails with `code: "PERMISSION"`. An importer runs on a file the user chose, so its input needs no permission; an importer that calls `ctx.vault` still needs the permission for that call.

## What you see

1. **Enable:** the dialog lists each permission as one line, under a reminder that it is what the plugin says, not a limit.
2. **Update adds a write permission:** the plugin loads nothing and Settings → Plugins shows "Needs review: new permission …" with a **Review** button. Allow it and the plugin loads.
3. **Update adds only a read permission:** the plugin loads, a toast says what it can now do, and the record is updated.
4. **Bundled plugins** declare the same permissions and need no prompt.
5. **Uninstall** removes the record.

Editing `pluginsEnabled` by hand does not skip this: a plugin whose declared permissions are not covered by the record stays off until you confirm it on the Plugins page.

None of `ctx.markdown`, `ctx.text`, `ctx.fonts` and `ctx.pages` needs a permission. Only `markdown.parse` makes a native call; the other three make none (`pages.createDocument` goes through the app's own "New drawing" path, not the gateway). `ctx.folders` is the one area gated by `folders.import`: its rows (`folders.pickSource`, `list`, `readText`, `readBytes`, `pickNewVault`, `vaultTarget`, `writeDrawing`, `copy`) run in the native layer, and a source handle has no write row.

## Checking them

`vaultdraw-plugin check` validates the list (codes `permission-unknown`, `permission-reserved`, `permission-duplicate`, `permission-too-many`, `permission-invalid`). See the [manifest reference](manifest.md#top-level-keys).
