# Tab kinds

A tab kind shows a file type in its own view instead of the Excalidraw editor. The built-in `notes` extension uses one for `.md` files. This is a small host hook, not the full plugin tab API (manifest-declared kinds and kind-owned toolbars come later).

## How it works

1. A kind registers with `registerTabKind` (`src/tabs/tabKinds.ts`): an id, a cheap `matches(path)` check and a `load()` that returns the view.
2. A tab whose path matches shows the view. The editor is closed for that tab, as for the home tab, and no drawing is opened.
3. The view chunk loads on the first tab of that kind. Nothing is registered or loaded until the extension is on.

| Field | Meaning |
| --- | --- |
| `id` | `<pluginId>.<kind>`, unique; a duplicate throws |
| `pluginId` | owner, for the Extensions list |
| `matches(path)` | pure and cheap; the first registered kind wins a tie |
| `load()` | dynamic import of a component taking `{ path, openPath }` |

A kind never claims `.excalidraw` files: drawings stay drawings.

## View props

- `path`: vault-relative path of the file in the tab.
- `openPath(path, { target })`: opens another vault file in the current (`"current"`) or a new (`"new"`) tab, through the normal opening rules.

A failed `load()` shows an error message in the pane instead of a blank one.
