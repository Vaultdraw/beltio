# Favourites

Bookmarks for drawings, notes and single elements, in your own order. Official, bundled, on by default, and it loads only when you use it.

| Do this | Result |
| --- | --- |
| Activity bar Favourites | the side panel, in your order |
| Right-click a drawing or note (or its tab), Favourite: add or remove | adds it, or removes it when listed |
| `Mod+Alt+J` in an open drawing | the same for the open drawing |
| Select an element, then `Favourites: Add or remove the selected element` (palette or canvas menu) | bookmarks that element or frame; opening it selects and scrolls to it |
| `Favourites: Open favourite 1` … `9` (palette; bind keys under `[hotkeys]`) | opens the Nth favourite |
| In the panel: click or `Enter` | open |
| `Alt+Up` / `Alt+Down`, or drag | reorder |
| `F2` or double-click | rename the label (empty brings back the file name) |
| `Delete` or the x button | remove |

## Where it is stored

Per vault, in `.excalidraw-vault/settings.toml`, in the plugin's own table. You can edit it by hand:

```toml
[favourites]
items = [
  { path = "Projects/Plan.excalidraw", label = "The plan" },
  { path = "Projects/Plan.excalidraw", element = "Ab12Cd", label = "Budget frame" },
]
```

The order of `items` is the order in the panel. At most 200 entries.

## Renames and moves

While the plugin is loaded, renaming or moving a file or folder in Vaultdraw updates its favourites, and deleting removes them. The plugin loads when you first use it in a session (panel, key, menu or command). A rename made before that, or outside Vaultdraw, is not followed: edit the path in `settings.toml`, or remove the entry and add it again.

## Off

Turn it off in Settings, Plugins (`plugins.disabled = ["favourites"]`): the panel, the commands and the code go away, and nothing runs. The list stays in `settings.toml`.
