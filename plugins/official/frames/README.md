# Frames

A Frames panel and full-screen presentation. Each frame of a drawing is a slide. Official, bundled, on by default, and it loads only when you use it.

| Do this | Result |
| --- | --- |
| Activity bar Frames | the panel: the drawing's frames in slide order |
| Click a frame (or `Enter`) | zooms the view to it |
| Drag a row, or `Alt+Up` / `Alt+Down` | reorders the slides |
| `F2` or double-click | renames the frame (empty brings back "Frame N") |
| `Present` button, or `Frames: Present from the current frame` (`Mod+Alt+P`) | full-screen show from the selected frame, else the frame in view |
| `Frames: Present from the first frame` (palette) | the same from slide 1 |
| `Right`, `Down`, `Space`, `PageDown` | next slide |
| `Left`, `Up`, `Shift+Space`, `PageUp` | previous slide |
| `Home` / `End` | first / last slide |
| `L` | laser pointer on or off |
| `Esc` | ends the show (`Frames: End the presentation`; leaving focus mode ends it too) |

While presenting, the app's chrome is hidden the way focus mode hides it (`[focus] hide`), the drawing is read-only, and frame outlines and names are not drawn. A row of dots at the bottom shows where you are; click a dot to jump.

## Order

The order is saved on each frame in the drawing's own data (`customData.frames.order`), so the file still opens in Excalidraw and nothing else changes. Frames without a saved order follow the numbered ones in reading order (top to bottom, left to right in each row).

## Settings (`[plugin.frames]`)

| Key | Default | Meaning |
| --- | --- | --- |
| `transition` | `"none"` | `"none"` or `"fade"` between slides |
| `background` | `""` | a colour behind every slide; empty keeps the drawing's own |
| `show_progress` | `true` | the dot strip at the bottom |

Every command can be rebound under `[hotkeys]`, for example `"frames.next" = ["Enter"]`.

## Off

Turn it off in Settings, Plugins (`plugins.disabled = ["frames"]`): the panel, the commands and the code go away. The saved order stays in the drawing.
