# Status bar, views, menus and layout

Plugins can add small pieces of interface. Each is declared in `plugin.toml`, so the app registers it without loading any plugin code, and each is free until you use it. Added in API 0.10.0 and later.

| Surface | Declare | Fill | Since |
| --- | --- | --- | --- |
| [Status bar item](#status-bar) | `[[contributes.status_bar]]` | `ctx.statusBar.set` | 0.10.0 |

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
