# Status bar, views, menus and layout

Plugins can add small pieces of interface. Each is declared in `plugin.toml`, so the app registers it without loading any plugin code, and each is free until you use it. Added in API 0.10.0 and later.

| Surface | Declare | Fill | Since |
| --- | --- | --- | --- |
| [Status bar item](#status-bar) | `[[contributes.status_bar]]` | `ctx.statusBar.set` | 0.10.0 |
| [View of a note type](#views) | `[[contributes.views]]` | `ctx.views.register` | 0.11.0 |
| [Context menu item](#context-menus) | `[[contributes.menus]]` | `ctx.menus.target` | 0.12.0 |
| [Toolbar button](#toolbar) | `[[contributes.toolbar]]` | none | 0.14.0 |
| [Canvas tool](#canvas-tools) | `[[contributes.tools]]` | `ctx.tools.register` | 0.15.0 |
| [Custom shape](#custom-shapes) | `[[contributes.shapes]]` | `ctx.shapes.register` | 0.16.0 |
| [Opening a panel or view](#layout) | none | `ctx.views.open` | 0.13.0 |
| [Overlay over the drawing area](#overlays) | none | `ctx.overlays.open` | 0.17.0 |
| [Full-screen presentation](reference.md#ctxpresent-and-ctxscenefitto-since-0290) | none | `ctx.present.start` | 0.29.0 |

## Migration (0.9.0 to 0.25.0)

Everything here is additive: a plugin written for 0.9.0 runs unchanged. To use a surface in a plugin that must also run on an older app, ask for the feature and fall back:

```ts
if (ctx.host.has("statusBar")) ctx.statusBar.set("clock", { text });
```

| Revision | Adds | Ask with |
| --- | --- | --- |
| 0.10.0 | status bar items | `ctx.host.has("statusBar")` |
| 0.11.0 | views | `ctx.host.has("views")` |
| 0.12.0 | context menu items | `ctx.host.has("menus")` |
| 0.13.0 | `ctx.views.open` | `ctx.host.has("views.open")` |
| 0.14.0 | toolbar buttons | `min_app` only (manifest table, no runtime call) |
| 0.15.0 | canvas tools | `ctx.host.has("tools")` |
| 0.16.0 | custom shapes | `ctx.host.has("shapes")` |
| 0.17.0 | overlays | `ctx.host.has("overlays")` |
| 0.18.0 | `ctx.vault.graph` (graph bytes, layout) | `ctx.host.has("vault.graph")` |
| 0.19.0 | `ctx.vault.table` (own vault settings table) | `ctx.host.has("vault.table")` |
| 0.20.0 | `ctx.thumbnails`, `ctx.workspace.useFolder`, command `repeat` | `ctx.host.has("thumbnails")` |
| 0.21.0 | `ctx.workspace.openShortcut` | `ctx.host.has("workspace.openShortcut")` |
| 0.22.0 | `ctx.methods`, `[[contributes.methods]]`, permission `control` | `ctx.host.has("methods")` |
| 0.23.0 | `ctx.diagrams.mermaidToElements` (the editor's Mermaid converter, as scene ops) | `ctx.host.has("diagrams")` |
| 0.24.0 | `ctx.math` (TeX renderer), `ctx.scene.selection`, `ctx.scene.currentStrokeColor`, modal overlays | `ctx.host.has("math")` |
| 0.25.0 | `scene.batch` `update` can change an image's picture in place (`image` prop); `ctx.shapes.update` and the formula plugin keep the element id | `ctx.host.revision >= "0.25.0"` |
| 0.26.0 | `ctx.pdf`, permission `pdf`, `ctx.scene.placePages`, `ctx.scene.sizeBytes`, `batch` options `pageCount` and `reveal`, `.pdf` importers | `ctx.host.has("pdf")` |
| 0.27.0 | `ctx.vault.exports` (`render`, `move`, `remove`): SVG and PNG exports of drawings, written into the vault | `ctx.host.has("vault.exports")` |
| 0.28.0 | `ctx.clipboard` (`readText`, `onPaste`), permission `clipboard`, activation `onPaste`, `ctx.scene.currentTextStyle()`, toast action buttons (`ctx.ui.toast(message, { action })`) | `ctx.host.has("clipboard")` |
| 0.31.0 | `ctx.network` (`askImages`, `fetchImage`), permission `network.images`: download the pictures of web pages after the user allows it | `ctx.host.has("network")` |
| 0.30.0 | one notice design for plugins: `ctx.ui.toast` options `detail`, `progress` (bar and count), `actions` (up to two buttons), `id` (update in place), `kind` | `ctx.host.revision >= "0.30.0"` |
| 0.32.0 | page items: `group` (one editor group per name, across appends), `strong` lines | `ctx.host.revision >= "0.32.0"` |
| 0.34.0 | page item tones `heading1` to `heading6` (the theme's colour per heading level) and the fill `bar` (a quote's left bar); theme tokens `--vault-md-*` (the theme's Markdown colours) | `ctx.host.revision >= "0.34.0"` |
| 0.35.0 | `ctx.vault.trashDrawing` (a drawing to the Trash after a History version; `onlyIfUntouched`); `replaceDrawing` may resolve `{ skipped: "unknown" }` | `ctx.host.has("vault.trashDrawing")` |

An older app refuses a `plugin.toml` with a table it does not know (`status_bar`, `views`, `menus`, `toolbar`, `tools`, `shapes`, `methods`), so set `min_app` to the app version that ships the revision you use; `vaultdraw-plugin check` warns when it is lower.

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

## Overlays

An overlay is a view that covers the whole drawing area, like the graph or the gallery: the editor stays loaded but frozen and hidden behind it, so closing is instant. There is nothing to declare in `plugin.toml`; a command the user ran opens it.

```ts
import { createElement as h } from "react";

ctx.commands.register("toggle", () => {
  const shown = ctx.overlays.open(
    ({ close }) => h("button", { onClick: close }, "Close"),
    { onClose: () => ctx.log.info("closed") },
  );
  // shown.isOpen, shown.close(), shown.dispose()
});
```

- **One at a time.** Opening an overlay closes the previous one, and the app's own graph or gallery (opening those closes the overlay).
- **Closing.** `close()` (also passed to the component), `dispose()`, opening a drawing or tab, or the plugin stopping. `onClose` runs once, whichever way.
- **Errors.** A component that throws shows "This plugin overlay crashed." and the error is attributed to the plugin.
- **Free until used.** The app loads no code and adds no element until an overlay opens. Keys and a toolbar button come from the plugin's commands and `[[contributes.toolbar]]`.
- **Dialogs (since 0.24.0).** `ctx.overlays.open(component, { modal: true })` is a dialog instead of a cover: the drawing stays visible and usable behind it, and the component draws its own scrim and frame (the app's `vault-modal-backdrop vd-dialog-scrim` classes give the look of its own dialogs). The official formula plugin's insert and edit dialog is one.
- **Focus.** The app focuses the drawing when the overlay closes. Handle Escape and keys inside your component.

Example: [`sdk/examples/overlay-demo`](../examples/overlay-demo/plugin.toml). In tests, `plugin.overlay()` returns the open overlay (`null` when none): `render()` mounts it and `close()` closes it.

## Thumbnails and folders

For a view or overlay that shows drawings (a gallery), two hooks give the app's data. Call them while rendering a component the plugin gave the app.

```ts
const { Thumb } = ...; // your component
function Tile({ path }) {
  const t = ctx.thumbnails.use(path, "visible"); // { status: "loading" | "ready" | "none", url }
  return t.url ? h("img", { src: t.url }) : h("span", null, path);
}
const entries = ctx.workspace.useFolder("Notes"); // [{ path, name, kind }] or undefined while loading
```

- **Shared and free.** Thumbnails come from the app's one service (shared cache and render queue), so a plugin adds no memory. `ctx.thumbnails.useEnabled()` is false when the user turned thumbnails off; `useDarkClass()` gives the container class that fits dark themes.
- **Folders.** `useFolder` lists a folder in the navigator's sort order without the templates folder, loads it if needed and updates when it changes. Since 0.20.0.

## Toolbar

A plugin adds a button to a strip over the canvas (top right, under the app's toolbar). A click runs one of the plugin's commands, so the action is also in the palette and can be given a key.

```toml
[[contributes.commands]]
id = "count"
title = "Count clicks"

[[contributes.toolbar]]
command = "count"
title = "Count clicks"          # tooltip; default: the command's title
icon = "M12 5v14M5 12h14"       # SVG path data, 24 by 24 grid; default: first letter of the title
priority = 0                    # higher first
```

- **Zero cost.** The strip exists only while a plugin declares a button, and the plugin loads on the first click.
- **Icons are path data,** never markup: letters, digits, spaces and `. , + -`, at most 1000 characters. The app draws it with the theme's text colour.
- **Limits.** At most 8 buttons per plugin, one per command.
- **User control.** `plugins.toolbar = false` hides the strip; the palette command `Toggle plugin toolbar` does the same.

Example: [`sdk/examples/toolbar-demo`](../examples/toolbar-demo/plugin.toml).

## Canvas tools

A plugin adds a tool that gets the pointer on the canvas. Each tool has a toolbar button (pressed while the tool is chosen) and a palette command, `Tool: <title>`, which can be given a key and toggles the tool.

```toml
[[contributes.tools]]
id = "box"
title = "Box"
icon = "M5 5h14v14H5z"     # SVG path data, as for toolbar buttons
cursor = "crosshair"       # crosshair (default), default, pointer, grab or text
```

```js
ctx.tools.register("box", {
  pointerDown(p) { /* p.x, p.y in scene coordinates; p.shiftKey, p.altKey, p.modKey */ },
  pointerMove(p) { /* while the pointer is down, at most once per frame */ },
  async pointerUp(p) { await ctx.scene.batch([ /* ops */ ]); },
  cancel() { /* another tool was chosen, or the plugin was turned off */ },
});
```

- **Zero cost.** Nothing is attached until a plugin tool is first chosen; the plugin loads then. Move and release listeners exist only while the pointer is down.
- **One use.** Like Excalidraw's own tools, a plugin tool goes back to selecting after one gesture unless the tool lock is on.
- **Drawing.** Draw with `ctx.scene.batch` (one undo step). A tool is refused in a read-only drawing.
- **Limits.** At most 8 tools per plugin. Tools use Excalidraw's built-in custom tool, so nothing changes in the editor package.

Example: [`sdk/examples/tool-demo`](../examples/tool-demo/plugin.toml). In tests, `plugin.tool("box")` returns `down`, `move`, `up` and `cancel`.

## Custom shapes

A plugin adds a shape it draws itself. The command `Insert shape: <title>` and a toolbar button add it to the open drawing in one undo step.

```toml
[[contributes.shapes]]
id = "badge"
title = "Badge"
icon = "M12 3l2.5 5.5L20 9z"   # for the toolbar button, as for tools
width = 120                     # size of a new shape (8 to 4000), default 160 by 100
height = 120
```

```js
ctx.shapes.register("badge", {
  defaults: { label: "New" },
  render(props, { width, height }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">...</svg>`;
  },
});
await ctx.shapes.insert("badge", { label: "Hi" }, { x: 0, y: 0 }); // resolves to the element id
await ctx.shapes.update(id, { label: "Done" });                    // draws again, same element (since 0.25.0)
```

- **The file does not change.** A shape is an ordinary image element (an SVG picture) with the shape name and its props as the plugin's element data (at most 4 KiB). Without the plugin the drawing opens and shows the last picture; with it, `update` draws the shape again on the same element: the id, stacking order, groups, bound arrows and lock stay (before 0.25.0 it replaced the element).
- **Safe.** `render` returns one SVG document of at most 200 KiB. It is drawn as an image, so it never runs script or loads anything.
- **Not live.** A shape is drawn when you insert or update it, not on every frame. A resize scales the picture; call `update` to draw it at the new size.
- **Limits.** At most 8 shapes per plugin.

Example: [`sdk/examples/shape-demo`](../examples/shape-demo/plugin.toml). In tests, `plugin.insertShape("badge")` runs the insert command and `plugin.scene` shows the result.

## Math

`ctx.math` is the TeX renderer, since 0.24.0. One plugin provides it, the official `formula` plugin; the notes view and any other plugin call it.

```ts
const r = await ctx.math.render({ source: String.raw`\int_0^1 x^2\,dx`, display: true, color: "#1e1e1e" });
if (r === null) ctx.ui.toast("The formula plugin is off");
else if (r.ok) use(r.svg, r.width, r.height);
else ctx.log.warn(r.error);

// A plugin that has its own renderer provides it:
ctx.math.provide(async (req) => ({ ok: true, svg, width, height }));
```

- **`render` resolves to `null`** when no plugin provides a renderer (the formula plugin is off). Show the TeX source then; the app's notes view does.
- **Lazy.** Nothing loads until the first render. With the formula plugin on, the first call from the notes view starts it; MathJax runs in a worker the plugin stops after five idle minutes.
- **`provide`** makes the plugin the renderer; the latest provider wins and stopping the plugin removes it.
- Also new in 0.24.0: `ctx.scene.selection()` (ids of the selected elements) and `ctx.scene.currentStrokeColor()` (the colour a new element gets).

In tests, `plugin.renderMath(request)` calls `ctx.math.render`, `plugin.scene.select(ids)` selects, and `plugin.scene.strokeColor(c)` sets the stroke colour.
