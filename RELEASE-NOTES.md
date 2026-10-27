# Vaultdraw 0.2.0

Plugins, Markdown notes and Obsidian vaults, Linux builds, and memory work. Your drawings stay plain `.excalidraw` files in a folder you own.

## What is new

- **Plugin platform.** Plugins (API 0.9.0) can add commands, panels, tab kinds, and read or convert folders. They load only when used. Official plugin: `markdown-import`.
- **Markdown and Obsidian.** `.md` notes open in a tab with a reading view and a CodeMirror editor (optional Vim keys), with revision-checked saves. Obsidian vaults open in place; **Import Obsidian vault...** converts notes, links, images and `.excalidraw.md` drawings into drawings, without touching the source.
- **Search, tags and links** cover notes; renaming a file rewrites the links that point at it.
- **Extensions you can turn off**, a bisect tool to find a problem extension, and a safe start.
- **Control and AI.** `vaultdraw mcp` (AI tools server, off until `ai.enabled`), `scene.*` commands, file associations, user commands, layout presets and focus mode, per-vault themes.
- **Linux (x86_64).** `.deb` and AppImage, custom title bar, PDF import, the hang watchdog, the `vaultdraw` command.
- **Faster and lighter.** Speculative open on press, idle-time memory release with keys (`memory.*`), speed trade-off keys. Full list in [CHANGELOG.md](CHANGELOG.md).

## Downloads

| File | Platform |
| --- | --- |
| `Vaultdraw_0.2.0_universal.dmg` | macOS, Apple Silicon and Intel |
| `SHA256SUMS` | checksums for all files |
| `Vaultdraw_0.2.0_amd64.deb` | Linux x86_64 (Debian, Ubuntu) |
| `Vaultdraw_0.2.0_amd64.AppImage` | Linux x86_64 |

## Known limits

- The macOS build is unsigned. First open: right-click, Open, or System Settings, Privacy & Security, Open Anyway.
- Linux arm64 is not built. The Linux builds are new: the Linux end-to-end run still has a few known failures (see the release checklist).
- Plugins and the plugin API are experimental. No automatic update.
- Memory: a typical session peaks near 550 MB in total, above the 400 MB goal.
