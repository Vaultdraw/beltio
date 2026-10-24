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
permissions = ["vault.read", "vault.write"]   # optional, default []
```

| Permission | Consent line | Gates |
| --- | --- | --- |
| `vault.read` | Read the drawings in your vault | Reading drawings other than the open one (arrives with the vault API) |
| `vault.write` | Create drawings in your vault | Writing files, which have no undo (arrives with the vault API) |

At most 8, no duplicates. An unknown name is a manifest error, so an older app refuses a plugin that needs a newer one. The names `net`, `secret` and `control` are reserved for later and are refused today. `ctx.manifest.permissions` returns the list.

Since API 0.3.0 the app checks them in its native layer: every native call of the plugin API goes through one gateway (`plugin_call`), which looks the method up in a fixed list, then refuses (`code: "PERMISSION"`) a call whose permission your `plugin.toml` does not declare or the user has not confirmed. The vault API that uses `vault.read` and `vault.write` comes next; `ctx.storage` needs no permission. Declaring them now means your plugin's consent line will not change when it does.

## What you see

1. **Enable:** the dialog lists each permission as one line, under a reminder that it is what the plugin says, not a limit.
2. **Update adds a write permission:** the plugin loads nothing and Settings → Plugins shows "Needs review: new permission …" with a **Review** button. Allow it and the plugin loads.
3. **Update adds only a read permission:** the plugin loads, a toast says what it can now do, and the record is updated.
4. **Bundled plugins** declare the same permissions and need no prompt.
5. **Uninstall** removes the record.

Editing `pluginsEnabled` by hand does not skip this: a plugin whose declared permissions are not covered by the record stays off until you confirm it on the Plugins page.

## Checking them

`vaultdraw-plugin check` validates the list (codes `permission-unknown`, `permission-reserved`, `permission-duplicate`, `permission-too-many`, `permission-invalid`). See the [manifest reference](manifest.md#top-level-keys).
