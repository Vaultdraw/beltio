# Status bar, views, menus and layout

Plugins can add small pieces of interface. Each is declared in `plugin.toml`, so the app registers it without loading any plugin code, and each is free until you use it. Added in API 0.10.0 and later.

| Surface | Declare | Fill | Since |
| --- | --- | --- | --- |
| [Status bar item](#status-bar) | `[[contributes.status_bar]]` | `ctx.statusBar.set` | 0.10.0 |
| [View of a note type](#views) | `[[contributes.views]]` | `ctx.views.register` | 0.11.0 |
| [Context menu item](#context-menus) | `[[contributes.menus]]` | `ctx.menus.target` | 0.12.0 |
| [Opening a panel or view](#layout) | none | `ctx.views.open` | 0.13.0 |

## Status bar

A thin bar at the bottom of the window. It exists only while at least one item has text, and the user can switch it off (`plugins.status_bar = false`, or the palette command **Toggle plugin status bar**).

```toml
[[contributes.commands]]
id = "toggle-seconds"
title = "Clock: toggle seconds"

[[contributes.status_bar]]
id = "clock"                  # short id, unique in the plugin
title = "Clock"               # names the item; the default tooltip
align = "right"               # "left" or "right" (default "right")
priority = 10                 # higher sits nearer the left edge (default 0)
command = "toggle-seconds"    # optional: runs on click, so it is also a palette command
```

```ts
ctx.statusBar.set("clock", { text: "09:05", tooltip: "Click for seconds", tone: "muted" });
ctx.statusBar.clear("clock");
const handle = ctx.statusBar.show("clock", { text: "Busy" }); // handle.dispose() clears it
```

- **Text only.** `text` is cut at 80 characters, whitespace is collapsed, and empty text hides the item. `tone` is `normal`, `muted`, `warn` or `error` and uses the theme's colours.
- **Cheap to update.** `set` with the same text, tooltip and tone does nothing, so calling it on a timer is fine. Keep the timer in `ctx.setInterval` so disabling the plugin stops it.
- **Clean-up.** Disabling, reloading or uninstalling the plugin removes its items.
- **Limits.** At most 8 items per plugin. A `command` must be one the plugin declares. An id that is not declared is refused and logged.
- **Activation.** The item is empty until the plugin runs. Add `activation = ["onStartupFinished"]` for an item that should show from launch, or set it when one of the plugin's commands first runs.

Example: [`sdk/examples/status-clock`](../examples/status-clock/plugin.toml). In tests, `plugin.statusBar()` lists the shown items and `plugin.clickStatusBar(id)` clicks one.

## Views

A view shows one kind of note in the main pane, in a tab, instead of the Markdown note view. A note belongs to a view when its name ends in one of the view's `extensions`, for example `groceries.checklist.md` for `checklist.md`.

```toml
permissions = ["vault.read", "vault.write"]   # what the view's file access needs

[[contributes.views]]
id = "checklist"                 # short id, unique in the plugin
title = "Checklist"
extensions = ["checklist.md"]    # each ends in ".md" with a name before it
```

```ts
import { createElement as h } from "react";

ctx.views.register("checklist", ({ path, file, openPath }) => {
  // file.read() -> { text, revision }; file.write(text, revision) -> { revision }
  return h("p", null, path);
});
```

- **Lazy.** The app claims the names when the plugin is enabled and loads nothing. The plugin loads when the first matching tab is shown. A plugin view wins over the built-in note view for its names.
- **Props.** `path` is the vault-relative path. `openPath(path, { target })` opens another file in the current or a new tab. `file` reads and saves the note.
- **Guarded file access.** `file.read()` needs `vault.read`; `file.write()` needs `vault.write`. Without the permission the call rejects with a `PERMISSION` error. A write passes the revision the view read: if the file changed on disk since (an edit in another program), it is refused with `CONFLICT` and nothing is overwritten, so a view should reload. Each save keeps the previous text in the vault's file history, like the note view.
- **Names.** Only notes (`.md`) are vault files a view can show for now, so every extension ends in `.md` with a name before it (`kanban.md`). `md`, `markdown` and `excalidraw.md` belong to the app. Two views cannot claim the same name in one plugin; if two plugins claim it, the one enabled first wins.
- **Errors.** A view that throws while rendering shows "This plugin view crashed." and the error is attributed to the plugin.
- **Notes off.** Notes appear in the file tree while the notes extension is on; turn it off and the note files are not listed, so views have nothing to open.

Example: [`sdk/examples/checklist-view`](../examples/checklist-view/plugin.toml). In tests, `plugin.notes.seed(path, text)` puts a note on the fake disk and `plugin.openView(path)` opens it in its view.

## Context menus

A plugin adds an item to the right-click menu of a file row in the navigator, a tab, or the canvas. The item runs one of the plugin's commands, so it is also in the palette and can be given a key.

```toml
[[contributes.commands]]
id = "where"
title = "Menu demo: where was I chosen?"

[[contributes.menus]]
surface = "tree"                 # "tree", "tab" or "canvas"
command = "where"                # a command this plugin declares
title = "Where was I chosen?"    # optional; default: the command's title
kinds = ["drawing", "note"]      # optional, tree only; default: all rows (drawing, note, folder)
```

```ts
ctx.commands.register("where", () => {
  const t = ctx.menus.target(); // { surface, path, kind?, at? } or null
  ctx.ui.toast(t ? `${t.surface}: ${t.path}` : "Not from a menu");
});
```

| Surface | Where | `target()` |
| --- | --- | --- |
| `tree` | a file or folder row (right-click or "More actions") | `path` of the row, `kind` of `drawing`, `note`, `folder` or `other` |
| `tab` | a tab | `path` of the tab (null for the home tab) |
| `canvas` | the drawing's right-click menu | `path` of the open drawing, `at` the click in scene coordinates |

- **Lazy.** The app adds the items without loading the plugin; it loads when an item is chosen. With no plugin item a menu is exactly as before.
- **`target()`** answers only while the command that a menu item started is running. From the palette or a key it returns null, so handle both.
- **Order.** Plugin items come last, after a separator, in the order plugins registered. A surface and command pair appears once per plugin; at most 16 items per plugin.
- **No title clash check.** Two plugins can add items with the same text; the menu shows both.

Example: [`sdk/examples/menu-demo`](../examples/menu-demo/plugin.toml). In tests, `plugin.menuItems(surface, kind)` lists the items and `plugin.chooseMenuItem(surface, title, target)` chooses one.

## Layout

A plugin can ask the app to show one of its panels or views. There are two places: the **side** area (panels) and the **main pane** (views, as tabs).

```ts
// A panel declared with [[contributes.panels]]: opens in the side area, like ctx.panels.open.
await ctx.views.open("timer");

// A view declared with [[contributes.views]]: opens the note in the main pane, in a tab.
await ctx.views.open("checklist", { path: "Lists/groceries.checklist.md", newTab: true });
```

- **Panel or view.** The id is the short id from `plugin.toml`. A panel id opens the panel (same as `ctx.panels.open`). A view id needs `path`, a note the view claims; the note opens in the current tab, or a new one with `newTab: true`.
- **Errors.** `INVALID_ARGUMENT` for an id that is neither, or a path the view does not claim; `INVALID_PATH` for a bad path; `NO_VAULT` when no vault is open; `IO_ERROR` when the app could not open it (views need tabs turned on).
- **The user stays in control.** Panels also have a palette command (`Toggle <title> panel`), and every file opens through the normal tab rules. Call `open` from a command so the user chose it; do not open views at startup.
- **Command.** The example's `Checklist: open the list` is a palette command that calls `ctx.views.open`.

In tests, `plugin.openPanelIds()` lists the open panels and `plugin.workspace.opened()` lists the notes opened in the main pane.
