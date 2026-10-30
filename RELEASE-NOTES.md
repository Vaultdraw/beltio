# Vaultdraw 0.2.0

Plugins, Markdown notes and Obsidian vaults, backup, libraries, profiles, Linux builds, and a round of data-safety fixes. Your drawings stay plain `.excalidraw` files in a folder you own.

## Read first

1. **Upgrading with plugins.** Every plugin you added yourself asks for review once before it runs again ("Needs review"; a notice at launch has a **Review** button). Approve it in Settings, Plugins. Official plugins stay on.
2. **Theme or plugin downloads from your own server.** Downloads now go only to GitHub (`github.com`, `raw.githubusercontent.com`, `api.github.com`, `codeload.github.com`). If you set `themes.index_url`, `plugins.registry_url` or install themes from another host, add it by hand to `config.toml`: `network.allowed_hosts = ["themes.example.org"]`. Settings cannot set this key, and the two list addresses are read from `config.toml` only.
3. **Auto-export and old export files.** Auto-export now changes only the files it wrote itself. Exports made by an earlier version are not recorded, so they are not updated: delete an old export once and the next save makes it again.
4. **Search index rebuild.** The first launch after the update rebuilds the search index once, in the background (it now handles Japanese and Korean text with separate marks). Search results may be incomplete for a short time on a large vault.
5. **Browse community plugins starts empty.** The list (`Vaultdraw/plugin-registry`) is published but has no plugins yet; add yours by pull request (see `sdk/docs/registry.md`).
6. **The macOS build is unsigned.** First open: right-click, Open, or System Settings, Privacy & Security, Open Anyway.

## What is new

- **Plugin platform (API 0.37.0).** Plugins add commands, panels, tab kinds, canvas tools, shapes and importers, and load only when used. A permission prompt gates each plugin, and ids of official plugins cannot be reused. Official plugins: graph, gallery, formula, mermaid, PDF import, Markdown import, table, favourites and auto-export (off until enabled).
- **Markdown and Obsidian.** `.md` notes open in a tab with a reading view that follows Obsidian (line breaks, `%%comments%%`, footnotes, callouts, tasks, embeds) and a CodeMirror editor (optional Vim keys). Obsidian vaults open in place; **Import Obsidian vault...** converts notes, links, images, tables and `.excalidraw.md` drawings in your theme and font, writes an import report, and can re-import a note later. Markdown mode types headings, `**bold**` and `` `code` `` on the canvas. Limits: bold words inside a sentence stay regular (one text, one font), and a drawing embedded in a note is a link, not a picture.
- **Network on by default, with one Offline mode.** No permission prompts: themes, plugin lists and web pictures just work, with safety checks (public http or https addresses only, size limits). **Settings, General, Offline mode** (or `network.offline = true`) turns every internet feature off. Once per launch a quiet check tells you if a newer release exists (`updates.check_on_startup`).
- **Files and menus.** Notes and Obsidian drawings rename, move and trash from the file tree; folders with files go to the Trash; a drawing renamed outside the app keeps its tab; every dialog uses one frame; any key can be rebound; SVG pictures can keep their colours in dark mode (`appearance.invert_svg_in_dark`).
- **Backup and restore.** `Vault: Back up vault...` writes a zip of your drawings, notes and attachments in the background.
- **Several libraries, profiles, focus mode.** Each `.excalidrawlib` is its own section; named profiles layer settings, keys and theme; `view.focusMode` hides everything but the canvas.
- **Synced folders.** Conflict copies from iCloud Drive, Dropbox, Syncthing and OneDrive show a badge and can be compared with the original.
- **Control and AI.** `vaultdraw mcp` (off until `ai.enabled`), `scene.*` commands that work on drawings not on screen, plugin commands from the CLI.
- **Linux (x86_64 and arm64).** `.deb` and AppImage, custom title bar, PDF import, the hang watchdog, the `vaultdraw` command. On a vault past the inotify limit the watcher polls (`files.watch_poll_ms`) and tells you once.
- **Faster and lighter.** Speculative open on press, idle-time memory release (`memory.*`), an opt-in low-memory canvas (`memory.low_memory_canvas`), a 19 KB formula plugin load. Full list in [CHANGELOG.md](CHANGELOG.md).

## Data safety and security fixes

- Quitting (Cmd+Q), closing the window and switching vault write every open note first.
- Renaming or moving a drawing onto a name that differs only by accent or Unicode form can no longer replace another file. Saving never replaces a read-only or Finder-locked drawing, and it keeps tags and permissions.
- Read-only drawing files open in view mode with a banner and **Save a copy**.
- Repeated failed saves keep one recovery copy per drawing, so recovery storage no longer fills up.
- Saves wait for a rename or move in progress; no false "Drawing changed on disk".
- Creating drawings works on exFAT and FAT drives.
- Auto-export never overwrites or deletes an image it did not write; removed exports go to the Trash.
- Exported SVGs embed only image data, never a web address from the drawing.
- Theme names with invisible or text-direction characters are refused; uninstalling a theme keeps files you added.
- Deleting a profile moves it to `profiles/.removed/`; deleting a library twice keeps both copies.
- A folder deleted or renamed outside the app no longer lingers in the tree; a drawing that cannot be closed no longer freezes the window.
- `vaultdraw://cmd` links run only an allow list of safe commands.
- A community plugin cannot take an official plugin's id or a built-in command group name; a plugin never run before always asks.

## Downloads

Built from one commit, after the packaged smoke passed (see `BUILT-FROM.txt`). Check files against `SHA256SUMS`.

| File | Platform |
| --- | --- |
| `Vaultdraw_0.2.0_universal.dmg` | macOS, Apple Silicon and Intel |
| `Vaultdraw_0.2.0_amd64.deb`, `Vaultdraw_0.2.0_amd64.AppImage` | Linux x86_64 |
| `Vaultdraw_0.2.0_arm64.deb`, `Vaultdraw_0.2.0_aarch64.AppImage` | Linux arm64 |
| `SHA256SUMS` | checksums for all files |

## Known limits

- The macOS build is unsigned (see above). Linux builds are new and are smoke-launched under a virtual display, not on every desktop.
- Plugins and the plugin API are experimental. No automatic update.
- Memory: everyday use (3 small drawings, packaged, foreground, quiet machine) peaks at about 470 MB in total and idles near 250 MB. Most of the peak is WebKit's display buffers for the editor canvases; `memory.low_memory_canvas = true` lowers the peak to about 365 MB, at about 60 instead of 120 frames per second while panning. A 5,000-drawing vault peaks above 1 GB; most of it is WebKit buffers and it varies by about 250 MB from run to run.
