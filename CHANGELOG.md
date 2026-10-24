# Changelog

All notable changes to Vaultdraw are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### New

- `vaultdraw new <path>` now gives a blank drawing your `[paper]` and `[page]` defaults (pattern, page mode and size, paper theme, canvas colour, and the vault's paper style), the same as New drawing in the app, also when the app is closed. A parity test keeps the app and the command line in step.
- The gallery grid and the graph view keys are commands too: `gallery.*` (move, open, parent, close, paging) and `graph.*` (move, open, hints, filter, local, depth, fit, zoom, close). Same default keys as before, listed in the palette and Hotkeys page, rebindable in `[hotkeys]`, and active only while that view has focus. `graph.fit` now has the default key `0` in the graph.
- Deleting images gives their memory back. Image data of deleted images is released once no undo or redo step can restore it, about 20 seconds after you stop editing. Saved drawings are unchanged. `memory.free_unused_images` turns it off, `memory.undo_steps` (default 1000, 10 to 10000) sets how many undo steps a drawing keeps, and `Memory: Free unused images` does it on demand. Both keys are in Settings → Interface → Memory.
- File tree keys: `j`/`k` move, `h`/`l` close and open folders, `Enter` opens, `r` renames, `a`/`A` create, `d` deletes, `m` moves, `g`/`G` jump, `Esc` goes back to the canvas. **Mod+Alt+F** focuses the tree.
- The same `list.*` commands drive the Tags list, the Links panel and the Settings page list, so every panel key is in the palette and can be changed in Settings → Hotkeys or `[hotkeys]`. They apply only while a list has focus, never on the canvas or in a text field.
- `vaultdraw export <drawing>` renders a drawing to PNG, SVG or PDF through the running app, with the same result as **Export** in the file tree. It writes the file under the drawing's name in the current folder, to `-o <file>` or `-o <folder>`, or to stdout with `-o -`. It never replaces an existing file unless you pass `--force`. Options: `--format`, `--scale`, `--dark`, `--no-background`, `--no-pattern`, `--embed-scene` and `--page`. PDF takes only `--no-pattern`. Exports run in the background, so you can keep drawing.
- `vaultdraw export <folder> --out-dir <dir>` exports every drawing of a folder (`.` for the whole vault) into `<dir>`, keeping its subfolders. A drawing that fails is reported and the others still export; the exit code is then 2.
- `vaultdraw export --frame <id or name>` exports one frame, and `--padding <px>` sets the space around the drawing (0 to 200, PNG and SVG).
- Key sequences: a `[hotkeys]` value can be several chords, such as `"g g"` or `"<leader> f f"`, with Vim names (`<C-x>`, `<CR>`, `<Esc>`) and a `<leader>` key (default `Backslash`). Nothing is bound by default. Options live in a new `[keys]` table (`leader`, `timeout_ms`, `cancel_after_ms`, `which_key`, `which_key_delay_ms`, `which_key_position`) and `[keys.labels]` names groups; both reload live. The docs include a copyable Vim-style example.
- Settings → Hotkeys has a **Key group names** section for `[keys.labels]`: add, rename or remove the names which-key shows for a group. The config writer now handles the nested `[keys.labels]` table and quoted sequence keys such as `"<leader> f f"`, keeping your comments and order. Existing configs keep working.
- A which-key popup lists what can follow a half-typed sequence. It loads only when a sequence is used. **Keys: show which-key** and **Keys: cancel pending sequence** are in the palette.
- Settings → Hotkeys has a **Sequence** button that records a sequence chord by chord. A key that is the start of another command's sequence shows a `prefix` warning.
- The tool keys (`R`, `E`, `A`, `Q` and the rest) are now commands, `tool.rectangle`, `tool.eraser` and so on, with the same default keys. They can be rebound, removed or turned into sequences in Settings → Hotkeys or `[hotkeys]`.
- `vaultdraw export` no longer sends the image through the control channel as base64. The app writes it to a spool file in 4 MiB pieces and the command moves it to the destination, so big exports no longer hit the 32 MiB limit and the command itself stays at a few MB of memory (32 MiB export: 95 MB -> 3 MB peak). The no-overwrite rule is unchanged.

### Faster

- `vaultdraw search` and the first in-app search on a vault with no index are faster on a 5,000-drawing vault: about 240 ms instead of 360 ms at background priority and 10 to 17% faster at normal priority, with 20 to 30% less CPU. The indexer now reads each drawing only up to its elements instead of the whole file with its embedded images, opens files relative to their folder, and reads on up to 8 threads. The index is still stored outside your vault and is still safe to delete.
- `interface.thumbnail_max_elements` in `config.toml` sets the biggest drawing that gets a thumbnail (default 8000, was a fixed 2,500). Changing it applies live.

### Fixed

- Renaming a tag across the vault no longer shows an extra "Updated N links" message next to "Renamed #a to #b" when the rewrite finishes very fast.
- Drawings with more than 600 elements now get a thumbnail in the gallery, home, search and palette (up to 8,000 elements). Parsing, restoring, measuring and painting each run in short steps, so the app stays responsive while thumbnails draw.
- The activity bar disappears when every entry is hidden, instead of leaving an empty 36 px strip. Showing one entry again (Settings → Interface) brings it back.

## [0.1.2] - 2026-10-23

### New

- New logo and app icon: a folder with a pencil and a pen, drawn in Excalidraw's sketch style, with the name in Excalifont. The welcome screen shows it too, in light and dark mode.
- Help links inside the app: website, documentation, keyboard shortcuts, what's new, check for updates, source code, and license and credits.
- Report a bug and Request a feature open a GitHub issue that is already filled in with a template and your Vaultdraw and macOS versions (no file paths or vault names).
- The links are in a new **Help** menu, in the command palette as `Help: …` commands (rebindable like every command), and on a new **Settings → About** page that shows the version.
- The welcome screen has links to the website, the docs and bug reports.

### Known limitations

- The build is still unsigned, so the first open needs **right-click → Open** or **System Settings → Privacy & Security → Open Anyway**. If the `vaultdraw` command stops with `Killed: 9`, run `xattr -dr com.apple.quarantine /Applications/Vaultdraw.app`.
- macOS only, no automatic update yet, and plugins are experimental (as in 0.1.1).

## [0.1.1] - 2026-10-22

First public release. Vaultdraw is an offline, local-first vault for Excalidraw drawings: pick a folder, and your drawings are ordinary `.excalidraw` files you own. No accounts, no cloud, no telemetry.

### New

**Vault and files**

- Pick any folder on your computer as a vault; drawings and folders are real files and directories.
- File tree beside the canvas to create, rename, duplicate, move and delete drawings and folders.
- Drag and drop in the file tree, and drop Finder files onto the canvas.
- Autosave with atomic writes, plus crash recovery for unsaved work.
- Changes made outside the app are picked up without losing your unsaved edits.
- Navigator sorting by name or modified date, with folders first and numbers sorted naturally ("Drawing 2" before "Drawing 10").
- Optional confirmation before moving a drawing to the Trash, and a default folder for new drawings.
- New folder option in a folder's menu.
- Open several drawings in tabs, with pinning, drag to reorder, and per-vault tab restore.
- Activity bar for the main panels, which you can reorder or hide.
- Gallery view of a folder with thumbnails, and thumbnails for recent drawings on the home screen.
- Visible History, Graph and Library entry points in the header, canvas menu and drawing menus.
- Reveal the crash-recovery folder from the command palette.

**Templates**

- Vault templates in a `Templates` folder and global templates shared by all vaults.
- Template picker with a search box and thumbnails, opened with Cmd/Ctrl+Option+N.
- Save any drawing as a template for this vault or for all vaults.

**Editor and canvas**

- Page mode: draw on simulated paper (A3, A4, A5, B5, Letter, Legal, iPad, Phone or a custom size), in portrait or landscape, as separate sheets or one continuous page. Export the pages as one PDF, or as whole-page PNG or SVG.
- Notebook backgrounds for drawings: plain, grid, ruled lines (with a margin line), dots, graph paper and isometric, with a default for new drawings and a choice per drawing.
- Paper themes for page mode: Normal, Old school (ruled and with a red margin) and Match current theme.
- Insert Mermaid diagrams and LaTeX formulas, both converted offline.
- Import PDF pages as images to annotate them, rendered natively on macOS; password-protected PDFs can be unlocked in the import dialog.
- Drop a PDF on the canvas to open the import dialog.
- Tool defaults: each drawing tool (rectangle, diamond, ellipse, arrow, line, text) can start with its own style, and remembers the last style you used until you quit.
- Text you create by double-clicking, pasting or labelling a shape uses the Text tool's style.
- Drawings can keep their own style choices, with a "Use default" option to go back.
- Pen presets, a configurable laser pointer, and a highlighter.
- Personal and vault libraries that keep their items between sessions, with named items and search.
- Export image dialog for PNG or SVG at 1x, 2x or 3x, with or without background, dark mode, embedded scene or selection only.
- Copy PNG or SVG to the clipboard from the export dialog or the right-click menu; on macOS the image goes to the native clipboard.
- Import file on the canvas right-click menu places images at the point you clicked.

**Search, links and tags**

- Full-text vault search across drawing names, folder paths, text, shape and arrow labels, frame names and formulas.
- Search results grouped by drawing with highlighted snippets; jump straight to the matching element.
- Search ignores case, accents and character width, and finds Chinese, Japanese and Korean text.
- Search index kept outside the vault, rebuilt automatically, and safe to delete.
- Wiki-style links: type `[[Name]]` or `[[Name|label]]` in any text, with an autocomplete list while typing.
- Links are drawn in the accent colour and underlined, with a hover preview of the linked drawing.
- Cmd+click a link to open it, or use link hints (Shift+F) to open one from the keyboard.
- Shape links: attach a drawing to any shape and open it by Cmd+clicking the shape.
- Backlinks panel with backlinks, outgoing links and unlinked mentions.
- Renaming or moving a drawing updates the links that point to it, and a notice reports what changed.
- Drawing shortcuts: give any drawing its own key.
- Graph view of every drawing and link, plus a local graph of the drawings near the open one, with search and filters.
- Tags: a Tags panel, tag chips in the file tree, a tag filter in search, `#` autocomplete, and renaming a tag across the whole vault.

**Themes and appearance**

- Colour themes for the app and the drawing board, each with light and dark variants, plus Light, Dark and System modes.
- Built-in themes including Dracula, Tokyo Night, Catppuccin, Everforest, Gruvbox, Nord, Rosé Pine and Solarized.
- Themes use the Noctalia palette format, so existing Noctalia palettes work; add your own as JSON files in the config folder.
- Sync canvas with theme: recolours the on-screen canvas to match the theme, while saved files and exports keep standard colours.
- Accent colour that replaces the theme's primary colour, adjusted for contrast when needed.
- Whole-app interface zoom from 50 to 200 percent.

**Settings and hotkeys**

- Settings page with sections and search, in the style of Obsidian.
- Plain-text configuration in `config.toml` in a config folder (`~/.config/vaultdraw` on macOS and Linux), edited by hand or in Settings, and reloaded live.
- Comments in `config.toml` are kept when you change a setting in Settings.
- Typos never break the app: the last good settings stay in use and a banner names the line that failed.
- Per-vault settings in `.excalidraw-vault/settings.toml`, with a Global / This vault switch for each setting.
- Hotkeys page to view, add, change and reset the key for every command, with conflict warnings and a key recorder.

**Command palette**

- Cmd/Ctrl+P opens a drawing by name; Cmd/Ctrl+Shift+P runs any command.
- Fuzzy matching, so `vdg` finds `vault-design`; recently used items come first.
- Every feature is a palette command, including themes, modes, settings pages, export, templates and insert actions.
- Tab narrows to a family of commands, and Cmd/Ctrl+Enter runs a command without closing the palette.

**Plugins (experimental)**

- Plugin host for drawing panels and commands from folders in the config folder, enabled through `config.toml`.
- A plugin that crashes is switched off and reported, without affecting the rest of the app.

**Command line `vaultdraw`**

- Install the `vaultdraw` command from the command palette, into your PATH or into `/usr/local/bin`.
- Offline commands to list, read, search, write, create and move drawings, and to show links, tags and settings.
- Commands for a running app: open a drawing and wait for it, list and run app commands, switch tabs, and quit.
- Shell completions and a manual page; `vaultdraw --help` lists everything.

**History and recovery**

- File history keeps earlier versions of each drawing, including versions saved before an outside change or a command-line write.
- History panel with a timeline, previews, thumbnails and highlights of what changed since a version.
- Restore a version as a copy, export it as `.excalidraw`, or create named checkpoints.
- History settings control how many versions are kept and when old ones are cleared.
- Delete a drawing's history, or exclude it from git when the vault is a git repository.

### Improved

- Faster startup and vault opening; features such as settings, history, graph, PDF import and formulas load only when you first use them.
- Lower memory use: caches are cleared when macOS reports memory pressure or when the app has been hidden for a while, and closed editors release their canvas memory.
- Large vaults stay responsive: the search index and link index build in the background, and long folder lists scroll smoothly.
- Saving and opening large drawings is faster on Apple Silicon.
- Smooth zooming and panning, with frames drawn at the display's refresh rate (up to 120 Hz on ProMotion displays).
- The command palette and Settings open instantly, even in large vaults.
- Tab switching is smooth, and switching back to a tab restores its undo history.
- Designed to run well on low-end Macs, with idle drawings using little memory and background work kept small.

### Fixed

- A vault stays writable after the window reloads; if a vault is read-only, the reason is shown and you can try again.
- Moving, renaming or trashing an open folder no longer shows it as missing.
- Undo no longer reaches back into a previous drawing after switching to another one.
- Pen colours and opacity no longer leak into the next tool.
- Text created by double-click or paste takes the Text tool's style.
- Dark-mode SVG images show their colours correctly on macOS.
- Library previews show formulas and images in the on-screen colours.
- Page 1 in page mode sits below the floating toolbar.
- Right-click Reload menu is hidden in release builds, while text fields keep their normal menu.
- The Ctrl-based save, settings and search shortcuts keep working on macOS.

### Known limitations

- The build is unsigned, so the first open needs **right-click → Open** or **System Settings → Privacy & Security → Open Anyway** (see the README).
- Memory: with a typical vault the app peaks around 420 MB while opening drawings (the goal is under 400 MB). Idle use is about 215 MB. Bringing the peak down is the focus of the next release.
- macOS only for now. Windows and Linux builds are not part of this release.
- Plugins are experimental and their interface may change.
- There is no automatic update yet. Check the [GitHub releases](https://github.com/Vaultdraw/vaultdraw/releases) page for new versions.

[0.1.2]: https://github.com/Vaultdraw/vaultdraw/releases/tag/v0.1.2
[0.1.1]: https://github.com/Vaultdraw/vaultdraw/releases/tag/v0.1.1
