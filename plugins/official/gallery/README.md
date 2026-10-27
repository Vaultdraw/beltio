# Gallery

A grid of drawing thumbnails for a folder, driven from the keyboard. Official, bundled, on by default, and it loads only when you open it.

| Do this | Result |
| --- | --- |
| Activity bar Gallery, or `Mod+Alt+E` | the grid for the open drawing's folder; again closes it |
| Folder menu, Show as grid | the grid for that folder |
| Arrow keys or `H` `J` `K` `L`, `Home`, `End`, `PageUp`, `PageDown` | move |
| `Enter` or a click | open a drawing or enter a folder |
| `Backspace` | parent folder (the folder you left is selected) |
| `Escape` | close |

Every key is a command (`gallery.left`, `gallery.open`, ...) you can rebind under `[hotkeys]`. Turn the plugin off in Settings, Extensions (`plugins.enabled`): the entry, the commands and the code go away. Thumbnails themselves come from the app's thumbnail service (`interface.thumbnails`), so the gallery adds no cache.
