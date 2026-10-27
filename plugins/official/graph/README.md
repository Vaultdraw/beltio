# Graph

The vault's link graph: drawings, tags and links as a map you can pan, zoom and walk with the keyboard.

Official plugin, on by default. Switch it off under **Settings → Extensions → Graph view** (or `[extensions] graph = false` in `config.toml`): nothing of it loads, and its commands disappear.

- Opens over the drawing area (`ctx.overlays`); the editor stays loaded behind it.
- Commands `graph.*` and their keys are the ones the app always had (see `docs/configuration.md`, "Graph view").
- Settings are per vault, in `<vault>/.excalidraw-vault/settings.toml` under `[graph]` (`ctx.vault.table`).
- Reads the graph as bytes (`ctx.vault.graph`), so 50k notes cost one binary call. The layout runs in a worker and is cached per vault.
