# Changelog

All notable changes to Vaultdraw are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### New

- Images in Obsidian vaults: `./` and `../` image paths, images in table cells (`![[pic.png\|300]]`) and the images of `.excalidraw.md` drawings (read from `## Embedded Files`) now show when a note is read in place and land in the converted drawings. Images over 4 MB, of a type a drawing cannot hold (AVIF, BMP, ICO) or not found stay as boxes; the import's final message counts them.
- Import Obsidian vault…: pick an Obsidian vault folder and its notes become page-mode drawings in a folder of your vault (or in a new vault), with the folder structure kept. `[[links]]` are rewritten to point at the converted drawings (aliases and headings keep their label), `![[image.png]]` embeds the image, `.excalidraw.md` drawings (plain and compressed) become `.excalidraw`, other files are copied. The source folder is only read and nothing in the target is overwritten. Progress and cancel; per-file errors do not stop the import. Keys `obsidian_attachments`, `obsidian_links` and `obsidian_excalidraw` under `[plugin.markdown-import]`. See [Markdown import](docs/configuration.md#markdown-import).
- Markdown import: the official `markdown-import` plugin turns a `.md` file (Import file…, a drop on the canvas, or **Import: Markdown…**) into a page-mode drawing, laid out in a worker so the first page shows at once; long notes continue in parts of about 1,000 elements. Settings `font`, `font_size`, `page_size` and `part_elements` under `[plugin.markdown-import]`. It loads only when you import.
- Plugin API 0.9.0: `ctx.pages.createDocument` and `buildScene` (page-mode drawings from laid-out items), `ctx.scene.scrollTo`, and `ctx.folders` (pick a folder to read and a target to write, create-only, the source never written; permission `folders.import`, `convertDrawing` for Obsidian Excalidraw files). See `sdk/docs/reference.md`.
- Obsidian vaults in the file tree: `.md` notes are listed next to drawings (shown without the extension; open them with the notes extension), and Obsidian's `.excalidraw.md` drawings open read-only with a notice (both the plain and the compressed plugin formats; use Save a copy to edit one as a `.excalidraw` drawing). Folders and files whose name starts with a dot (`.obsidian`, `.trash`, `.git`) are never listed, indexed, watched or written, so opening a vault leaves it byte for byte as it was.
- Markdown notes in search, tags and links (the base for the Obsidian-vault work): `.md` files are indexed with their lines, `#tags` and frontmatter `tags:` (never from code), headings and links. In a note, `[[X]]`, `[[X|alias]]`, `[[X#Heading]]` and `![[image.png]]` resolve the way Obsidian does: `[[X]]` is `X.md`, a written extension wins (`[[X.excalidraw]]` is the drawing), and the shortest path breaks a tie. Drawing links keep their meaning. Renaming or moving a note or drawing rewrites the links in notes that point at it, through the guarded write (revision check, a copy in `.excalidraw-vault/note-history`, atomic replace). `.obsidian`, `.trash` and `.git` folders are not indexed. New keys `search.notes` (default `true`: notes open in a tab from the results) and `search.note_text_mb` (default `48`; past it a note keeps its name, headings, tags and links), read when the index starts.
- `read_note` and `write_note` (native commands, `readNote` and `writeNote` in the app): the one guarded way to read and change a Markdown note, with a revision check, a history copy and an atomic replace; a note edited elsewhere meanwhile gives a conflict and is never overwritten.
- Markdown notes: a `.md` file opens in a tab with a reading view (`[[links]]`, `![[embeds]]`, callouts, `#tags`, formulas, coloured code, front matter as properties; sanitised, no web images unless `notes.remote_images`) and a CodeMirror editor with optional Vim keys. Saving checks the revision, so a note changed outside the app is never overwritten. The `notes` extension (`[extensions] notes`) and `[notes]` keys (`open_in`, `vim`, `line_wrap`, `line_numbers`, `font_size`, `readable_width`, `autosave_ms`, `highlight_code`, `math`, `remote_images`), commands `notes.*`. See [Notes](docs/configuration.md#notes). Plugins get the tab kind hook (`sdk/docs/tab-kinds.md`).
- Linux: PDF import works (**Import: PDF…**, dropping a `.pdf` on the canvas, password-protected PDFs), rendered with poppler. The `.deb` depends on `libpoppler-glib8`; an AppImage needs the distribution's poppler-glib package. Nothing loads until the first import.
- Linux: one title bar instead of two. New `[window] decorations = "custom" | "native"` (default `custom`, Linux only, restart required, also Settings → Interface → **Window title bar**): `custom` removes the system title bar and the app header gets minimize, maximize and close buttons (drag to move, double-click to maximize); `native` keeps the system bar. Palette commands **Window: Minimize** (`window.minimize`) and **Window: Maximize or restore** (`window.toggleMaximize`). macOS is unchanged. See [Window title bar (Linux)](docs/configuration.md#window-title-bar-linux).
- Extension bisect: **Settings → Extensions → Find a problem extension** turns half of the extensions that are on (built-in ones and plugins) off and restarts; you answer "It still happens" or "It's gone" in a banner, and after a few restarts it names the one causing the problem and offers to turn it off. Your config is untouched until then; **Stop** ends it at any step. Also from the palette (`extensions.bisect.*`).
- Extensions: turn built-in features off in **Settings → Extensions**, with **Extensions: Toggle …** in the palette, or under `[extensions]` in `config.toml` (`search`, `links`, `tags`, `graph`, `library`, `templates`, `formula`, `mermaid`, `pdf-import`; all on by default). Off means not loaded: no commands, no panels, and the vault index does not start unless an extension needs it. Changes apply at once. Renaming still updates links while `links.update_on_rename` is on.
- Safe start: start with built-in extensions and plugins off by hand (`vaultdraw launch --safe`, `--safe`, `VAULTDRAW_SAFE=1`, or "Restart in safe start" in the command palette); a banner offers "Restart normally". `VAULTDRAW_NO_AUTO_SAFE=1` turns the crash counter off. See `docs/configuration.md`, sections Extensions and Safe start.
- Per-vault theme: a vault can keep its own colour theme, light or dark mode and accent colour in its `settings.toml` (`[appearance] theme`, `mode`, `accent_color`), set in Settings → Appearance with the **This vault** scope or with **Appearance: Use the current theme for this vault only** / **Use the global theme in this vault**. Theme and mode commands write where the value lives. Hotkeys stay global.
- Speed trade-offs as keys, all defaulting to today's behaviour: `memory.hidden_purge_s` (120) and `memory.idle_purge_s` (180) set when caches are freed (0 = never), `interface.thumbnail_cache_mb` (128) caps the thumbnail cache, and `[search]` `debounce_ms` (60), `max_drawings` (50, up to 200) and `max_snippets` (5, down to 1). Edits apply live; a bad value warns and keeps the default. Keys only, no Settings page. See `docs/configuration.md`.
- `vaultdraw mcp`: an AI tools server (Model Context Protocol) on standard input and output, for Claude Desktop, Claude Code, Cursor and other AI apps. Six tools: `vaultdraw_status`, `list_drawings`, `search_vault`, `read_drawing`, `get_selection` and `edit_drawing` (one undo step). It serves both the 2026-07-28 revision and the older `initialize` clients. Everything stays `DISABLED` until `ai.enabled` is on (and `ai.mcp_enabled`, default on), checked before every call, including reads with Vaultdraw closed; the tools list itself does not change, so a switch change needs no restart. `read_drawing`, `get_selection` and `edit_drawing` need the running app, which the command never starts. See `docs/mcp.md`.
- Hang watchdog: when the page stops answering, a native Wait / Quit dialog appears after WebKit's own 3 s plus `watchdog.grace_ms` (default 5000). macOS only for now. Turn it off with `[watchdog] enabled = false`, in Settings → Interface, or with **Hang watchdog: Turn on or off**; **Hang watchdog: Show the last hang** shows the last record. See `docs/configuration.md`, section Hang watchdog.
- Layout keys and focus mode: `[layout] header` and `footer` hide the header and Excalidraw's zoom, undo and help bar (also in Settings → Interface). Named presets, `[layout.presets.<name>]`, hide or show several parts at once (header, navigator, activity bar, tab strip, footer); focus mode is the built-in `focus` preset, **Layout: Focus mode** (Cmd/Ctrl+Shift+Enter). Each preset is a palette command, `layout.preset` picks one at launch, and toggles inside a preset apply to the session only. See [Layout and focus mode](docs/configuration.md#layout-and-focus-mode).
- User commands: `[commands.<name>] run = ["export.png", "file.revealInFinder"]` makes the palette command `user.<name>`, bindable in `[hotkeys]`. Steps run in order, each finishing first; the run stops with a notice at a step that can't run. No arguments or scripting. See [User commands](docs/configuration.md#user-commands).
- An AI switch, off by default: `ai.enabled` and, under it, `ai.mcp_enabled` (the AI tools interface, default `true`). Turning AI on in Settings → Control or with **AI: Toggle AI** first shows a warning about what an AI app you connect can read and where it sends it. The app checks both keys at every AI request, so turning AI off applies at once. A `config.toml` or `overrides.toml` that cannot be read counts as AI off. Settings → Control also has **Edit notices** (`control.notify_edits`). See `docs/configuration.md`, section AI.
- A full Vim-style key preset, `docs/presets/vim.toml`, to copy into `config.toml`: `gg` and `dd` in lists, `<leader>` groups for files, tabs, links, graph and tools, with group names. Vaultdraw never loads it, so it costs nothing and modal keys stay off. A test parses it with the real key parser and checks every command id.
- Excalidraw's action keys are commands: align, distribute, layer order, flip, group, lock, duplicate, copy and paste styles, font size, element link, grid, snap, zen mode, view mode, stats and the three zoom-to-fit keys are `canvas.*` commands with Excalidraw's defaults. Rebind or remove any of them in `[hotkeys]` or on the Hotkeys page; the palette shows your key. Nothing changes until you rebind.
- More click-only actions are commands: the file tree's row menu items (duplicate, reveal, save as template, show as grid, local graph, history, export as PNG, SVG or PDF, save a copy) act on the focused row as `list.*` commands, **Navigator: Clear search** clears the search box, and history (back to current, dismiss the git notice), the graph view (arrows, colour by, settings panel, reset display), the Tags section toggle, the global templates folder and the page notice's dismiss have commands. All have no default key and can be bound in `[hotkeys]`.
- Linux groundwork: a `tauri.linux.conf.json` that builds `.deb` and AppImage bundles without the macOS-only window settings, the command line sidecar built for Linux target triples, the bug report names your distribution from `/etc/os-release`, and the memory release also trims the glibc heap. Written and unit tested on macOS; not yet run on a Linux machine.
- File associations: **Open With** in Finder lists Vaultdraw for `.excalidraw` drawings and `.excalidrawlib` libraries (an alternate app: your default is not changed), and `open -a Vaultdraw file.excalidraw` or a second launch with a path works too. A file inside the open vault opens at once. A file from another vault you have used asks to switch. A file outside every vault asks: **Copy into vault** (never replaces a file), **Open its folder as a vault**, or Cancel. A library file asks to add its items to your library (all vaults) or the vault's library. Same off switch, limit and checks as links; `control.uri_enabled = false` covers files too. See `docs/uri-scheme.md`.
- Linux: `vaultdraw.desktop` and a MIME file are in `src-tauri/linux/`, and **Links: Register Vaultdraw for links and files (Linux)** installs them for AppImage and manual installs after you confirm a dialog listing the exact files. It writes only under your own `~/.local/share`, never replaces a file Vaultdraw did not create, and gives a default only to the `vaultdraw://` scheme. Not yet tried on a Linux desktop.
- `vaultdraw scene read`, `scene get`, `scene selection` and `scene apply` read and edit the drawing on screen while the app runs. One `apply` is one undo step; `--if-version` refuses when the drawing changed, and `--dry-run` only checks the operations. The `scene.*` methods are experimental.
- `[control] notify_edits` in `config.toml` (default `true`) shows a notice when a script or AI tool edits the drawing on screen. Set it to `false` to hide the notice. Read at each edit.
- `vaultdraw://` links from outside: `open` (a drawing, optionally in a vault and a new tab), `search`, `new` and `cmd` (one palette command), plus a bare link that focuses the window. Opening and searching run at once; switching vault, creating a drawing and running a command ask first in one dialog. Links never take absolute paths or `..`, never overwrite, never call back or use the network, and destructive commands are blocked. See `docs/uri-scheme.md`.
- `vaultdraw uri <url>` hands a link to the running app, and **Links: Open a vaultdraw:// link…** does the same from the palette.
- `[control]` in `config.toml` is now documented. New keys: `control.uri_enabled` (turn links from outside off) and `control.uri_allow` (what a link may do without asking). Both are read when a link arrives, so edits apply at once.
- `vaultdraw new <path>` now gives a blank drawing your `[paper]` and `[page]` defaults (pattern, page mode and size, paper theme, canvas colour, and the vault's paper style), the same as New drawing in the app, also when the app is closed. A parity test keeps the app and the command line in step.
- `vaultdraw config check` checks every config file (included files, `config.toml`, `overrides.toml`) and prints each problem with file, line and column and a "did you mean" for typos. It exits 1 on errors, and with `--strict` on warnings too; `--json` gives the report as JSON. In the app: **Config: Check config files** or **Check** in **Settings → General → Config files**. Works without the app, reads only. See [Checking your config](docs/configuration.md#checking-your-config).
- A JSON Schema of `config.toml`, generated from the app's key table: `vaultdraw config schema` prints it, and a `#:schema` first line gives completion and checks in editors that read it (taplo, Even Better TOML). Also in the source as `docs/config.schema.json`.
- `vaultdraw doctor` and **Config: Show debug info**: one read-only report for bug reports (versions, folders, config files and changed keys with their file, extensions, the vault's search index, the control socket). Creates and writes nothing, never uses the network.
- `[include]` in `config.toml`: `files = ["keys.toml", "machine/", "~/dotfiles/vaultdraw/colors.toml"]` pulls in other TOML files (or folders of them), so you can split a config or share part of it. Relative paths are against the including file, `~` works, includes can nest (8 deep), each file loads once, cycles are skipped with a warning, and the including file wins over what it includes; `overrides.toml` and vault settings still win over all. A missing or broken included file is a warning and the rest applies. Nothing is loaded automatically, files inside a vault and symlinks are refused, and an `[include]` in `overrides.toml` or a vault's `settings.toml` is ignored. The setting chips and `config get --source` name the included file, **Settings → General → Config files** lists each one with status and Open, and editing an included file reloads live. Costs nothing without an `[include]`. See [Including other files](docs/configuration.md#including-other-files).
- Settings no longer rewrites your `config.toml`. What you change in Settings, `vaultdraw config set` and the control API is saved to `overrides.toml` in the state folder (next to `state.json`) and wins over `config.toml`. Your file keeps its comments and layout, works as a dotfiles checkout, and stays the base layer, so nothing is migrated. A change that matches `config.toml` is not stored, and Reset to the default over a `config.toml` value stores the default. `overrides.toml` is safe to delete and reloads live; if it is broken, the banner names it, your last good settings stay, and Settings refuses to save until you fix or delete it. `[control] enabled` is read through both files. Older versions ignore `overrides.toml`. See [Layers](docs/configuration.md#layers).
- Settings shows where each value comes from. A chip beside a setting's name says `config.toml` or `overrides`; when Settings hides a different `config.toml` value, the note names it ("config.toml says 14") and **Reset to config.toml value** puts it back without touching your file. **Settings → General → Config files** lists both files with paths and status, an Open button each, Reload, and **Reset all Settings changes**. A `[keys.labels]` name set in `config.toml` carries a `config.toml` chip. See [Where a value comes from](docs/configuration.md#where-a-value-comes-from).
- New palette commands, rebindable, no default keys: `config.reload`, `config.openFile`, `config.openOverrides`, `config.openFolder` and `config.resetOverrides` (asks first, deletes only `overrides.toml`).
- `vaultdraw config get <key> --source` prints the value and the file it comes from (`20  (overrides.toml; config.toml says 14)`); `vaultdraw config path --all` lists both files.
- An invalid value is reported with the file it came from (`overrides.toml:` or `config.toml:`), and the Reload messages no longer name only `config.toml`.
- `config.toml` and a vault's `settings.toml` warn about keys they don't know: a typo such as `interface.zom`, or `stroke_colour` inside `[tools.arrow]`, is ignored and reported with the closest real key ("did you mean interface.zoom?") in a notice, the log and **Settings → General → Config file**, which now lists every current error and warning. Only that key is ignored; the rest of the file, including the tool's other keys, still applies.
- The configuration docs list every key with its default, accepted values and whether a vault can override it. The list is generated from the app's key table, so it can't fall out of date; this adds the keys that were missing, including all of `[tabs]` and `[history]`.
- A new `config.toml` lists every key, commented, including the new `[tags]`, `[history]` and `[plugins]` blocks.
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
- **Settings → Plugins** lists installed plugins. You can turn each one on or off, install one from a folder, reload or uninstall it, and edit the settings it declares. Each plugin shows its activation time and a memory estimate. A plugin that isn't bundled asks for consent before it runs.
- **Plugin safe mode:** after two launches in a row crash with plugins enabled, the next launch loads no plugins and says why. Holding Option at launch does the same. The palette commands **Plugins: Restart in safe mode** and **Restart normally** switch between the two.
- **Dev reload:** a plugin with `dev = true` in its `plugin.toml` reloads when its files change.
- Palette commands: **Plugins: Open plugin settings**, **Install from folder…** and **Reload plugin list**.
- New palette command **Plugins: Open plugins folder** (`plugins.openFolder`) shows the plugins folder in your file manager.
- Only the first 6 plugin panel buttons show in the activity bar. The palette or Settings → Interface shows the others.
- A plugin can declare `permissions` in `plugin.toml` (`vault.read`, `vault.write`). The enable dialog lists them in plain words, and the app remembers what you confirmed. An update that adds a write permission is switched off until you press **Review** in Settings → Plugins; an added read permission loads with a notice. A permission is a declaration, not a sandbox: plugins still run with full access. See `sdk/docs/permissions.md`.
- Plugin API 0.9.0: an arrow in `scene.batch` can bind to an element already on the canvas with `start`/`end: { id }` (a rectangle, ellipse, diamond, image or free text), as well as to one added in the same batch with `{ ref }`. The arrow is drawn between the outlines and bound as if you had drawn it, so moving the shape moves the arrow; one undo removes the arrow and both bindings. `vaultdraw scene apply` and the AI tools' `edit_drawing` share the same rules, so they accept `{ id }` too. See `sdk/docs/reference.md`.
- Plugin API 0.8.0: `ctx.markdown.parse` (the app's Markdown parser: a note's blocks, links, tags and stats), `ctx.text` (`measure` and `lineHeight`, the editor's text widths), `ctx.fonts.ensure` (load fonts before measuring) and `ctx.pages` (`geometry` and `flow`, page sizes and pagination). CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@lezer/common` and `@lezer/highlight`) is shared with plugins and loads on first import. See `sdk/docs/reference.md`.
- Plugin API 0.7.0: `scene.batch` (and importer results) can add images: `{ type: "image", width, height, image: { mime, bytes } }`. Pictures are hashed (SHA-1) and stored once; a batch that would take the drawing past 90% of its 32 MiB cap is refused with `TOO_LARGE`. Arrows cannot bind to images. See `sdk/docs/reference.md`.
- Plugin API 0.6.0: `ctx.vault` lists folders (`list`), reads drawings (`readDrawing`), creates drawings (`createDrawing`, create only) and shows the vault's name and read-only state (`info`). Reading needs `vault.read`, creating needs `vault.write`. See `sdk/docs/reference.md`.
- Plugin API 0.6.0: `ctx.workspace` opens a drawing (`open`, optionally in a new tab) and gives the open drawing's path (`activePath`). Both are free.
- Plugin API 0.6.0: plugins can import file types. `[[contributes.importers]]` in `plugin.toml` declares them, and `ctx.importers.register` handles them. The plugin loads only when a matching file is dropped on a drawing or picked in **Import: File…**. An import is one undo step. See `sdk/docs/importers.md`.
- Plugin API 0.6.0: `onDrop:<ext>` activation loads a plugin when a file with a declared extension arrives. It adds nothing an importer does not already do.
- Plugin API 0.6.0: the `vault.changed` event reports vault files that changed on disk, as vault-relative paths with a `rescan` flag. It needs `vault.read`.
- Plugin API 0.4.0: `scene.batch` ops can name new elements with `ref`; the result's `refs` maps each ref to its id. Arrows bind to shapes with `start` and `end: { ref }`, placed on the outlines (rectangle, ellipse, diamond, text). See `sdk/docs/reference.md`.
- Plugin API 0.4.0: the `group` op groups ids or `{ ref }` members (at least two). A label is grouped with its container. `createDrawing` takes groups and refs too.
- Plugin API 0.4.0: plugin data on elements (`data`, at most 4 KiB as JSON) is stored under the key `data_key` in `plugin.toml`, default `plugins.<id>`. Read it with `scene.dataOf(id)` or `scene.get(ids, { data: true })`. `ctx.manifest.dataKey` gives the key.
- Plugin API 0.4.0: `scene.get(ids, options)` returns more detail (groups, frame, label container, style, link, lock; points and data on request). `scene.dataOf(id)` and `scene.path()` are new.
- Plugin API 0.4.0: `scene.batch(ops, { path })` applies only if that drawing is still active; otherwise it refuses with `DRAWING_CHANGED`.
- Plugin API 0.4.0: new element properties `angle`, `strokeStyle`, `fillStyle`, `roundness`, `fontFamily`, `link` (`javascript:`, `data:`, `vbscript:` and `file:` refused) and `locked`.
- Plugin API 0.4.0: scene refusals carry a `code`: `NOT_FOUND`, `READ_ONLY`, `DRAWING_CHANGED` or `INVALID_ARGUMENT`. Plugins can check `ctx.host.has("scene.path")` for the 0.4.0 batch additions.
- New config key `plugins.scene_max_ops` (default 500, 1 to 1000) sets the most ops in one plugin `scene.batch`. It is read on every batch, so edits apply at once.
- `sdk/examples/flow-diagram` is an example plugin: a panel button and a command insert a connected flow (boxes, bound arrows, one group) in one undo step.
- **Import: Cancel** (`plugins.cancelImport`) stops a running plugin import. It has no default shortcut and can be rebound in `[hotkeys]`.
- **Import: File…** accepts the file types that plugins import, as well as PDFs and images.
- `plugins.importers` in `config.toml` chooses which plugin imports an extension when two plugins claim it, or turns plugin handling off for it with `""`. It reloads when edited. Settings → Plugins lists the clashes.
- `sdk/examples/text-import` is an example plugin: drop a `.txt` file and its text lands on the drawing in one undo step.

### Faster

- The search indexer lists each folder with one bulk directory read on macOS, the same read the file tree uses, instead of one file-system query per drawing: listing 3,000 drawings took about 20% less time in a unit benchmark. A drawing removed while a folder is being listed no longer matters: that folder is listed again one entry at a time.
- Opening a vault shows the file tree sooner on a slow CPU: the home pane now draws one frame after the tree, in the same place (about 10 ms sooner at 4x CPU slowdown). `interface.defer_home_pane = false` draws both together.
- `vaultdraw search` and the first in-app search on a vault with no index are faster on a 5,000-drawing vault: about 240 ms instead of 360 ms at background priority and 10 to 17% faster at normal priority, with 20 to 30% less CPU. The indexer now reads each drawing only up to its elements instead of the whole file with its embedded images, opens files relative to their folder, and reads on up to 8 threads. The index is still stored outside your vault and is still safe to delete.
- Switching between drawings is faster on a slow CPU: the editor now shows the new drawing in one render instead of two. On a 4x-throttled CPU, switching back and forth takes 6 to 12% less time (median) and 11% less at the slow end (95th percentile).
- Opening a vault is a few milliseconds faster on a slow CPU: adding the vault to the recent list no longer makes the settings be parsed and checked a second time.
- `interface.thumbnail_max_elements` in `config.toml` sets the biggest drawing that gets a thumbnail (default 8000, was a fixed 2,500). Changing it applies live.
- **Start file list** (Settings → General → Startup, `files.list_start`, default when idle): the walk of every vault folder that feeds Recent drawings, the file switcher, link suggestions and the move dialog no longer runs at vault open. The file tree still loads at once. "On first use" waits for the first of those.
- **Startup** settings (Settings → General): choose when the search index, link index and file history start: on open, when idle, or on first use (`search.start`, `links.start`, `history.start` in `config.toml`, live reload). Search and links default to when idle, so opening a vault no longer waits for indexing; history stays on open so every edit is versioned.

### Fixed

- An arrow or line no longer shows at the top-left corner (scene 0,0) while you drag it and jumps into place on release: the preview is now drawn where you started. A new end-to-end spec (`shapesMatrix`) draws every shape tool in every stroke style, width, roughness, fill, edge and arrowhead and checks it while dragging, after saving and reopening, in dark mode, zoomed, and in the SVG export.

- Library: an edit to `library.excalidrawlib` made outside the app now shows up live when your config folder is reached through a symlink (stowed dotfiles, a linked folder). The change event arrived under the real path and was dropped.

- `vaultdraw launch --safe` reaching an app whose window is still starting is no longer lost, and is asked only once. A normal restart no longer edits the app's own environment while it exits; the new process just starts without `VAULTDRAW_SAFE`.
- `control.uri_enabled` and `control.uri_allow` are now read through every config layer (included files, `config.toml`, `overrides.toml`), like `control.enabled`. Before, links read only `config.toml`, so turning links off from Settings or with `vaultdraw config set` did nothing. A broken `overrides.toml` now turns links off, as it does AI.
- Renaming a tag across the vault no longer shows an extra "Updated N links" message next to "Renamed #a to #b" when the rewrite finishes very fast.
- Drawings with more than 600 elements now get a thumbnail in the gallery, home, search and palette (up to 8,000 elements). Parsing, restoring, measuring and painting each run in short steps, so the app stays responsive while thumbnails draw.
- The activity bar disappears when every entry is hidden, instead of leaving an empty 36 px strip. Showing one entry again (Settings → Interface) brings it back.
- A plugin with `dev = true` is no longer switched off for good after three errors. It stops for the session, the disable is not saved, and the next save reloads it with a fresh error count.
- Dev reload now also works for plugins in symlinked folders and in temp folders on macOS (watched paths are canonicalised).
- An app started with both `VAULTDRAW_VAULT` and `VAULTDRAW_STATE_DIR` set opens only that vault and no longer reads or writes your own `recent-vault` (used by `dev --sandbox`; nothing changes when either variable is unset).

### Plugin SDK

- The mock host takes the app's op limit: `boot(manifest, plugin, { sceneMaxOps })` is `plugins.scene_max_ops` (1 to 1000, default 500), applied to `ctx.scene.batch`, imports and `ctx.vault.createDrawing` as in the app. Before, the mock always used 500. The in-repo kit takes the same option. The rules the app's host and the mock share (settings, scene ops, vault paths, importers, feature names) moved from `sdk/api/testing/` to `sdk/api/shared/`; `vaultdraw-plugin init` copies both folders.
- **API revision 0.3.0** (additions only): `ctx.storage.global`, a key-value store of JSON values per plugin (`get`, `set`, `delete`, `keys`), saved in the app's state folder, never in a vault. Nothing is read until first use; writes are batched and flushed before quit. New key `plugins.storage_limit_kb` (default 1024). Settings → Plugins shows each plugin's data size with **Delete data**, and **Plugins: Delete data of a plugin…** (`plugins.deleteData`) opens it; uninstalling keeps the data. Native plugin calls now go through one gateway that checks the declared and confirmed permissions (`PERMISSION`). The mock host and the in-repo kit have `storage` (`data`, `seed`, `setLimitKb`); `check --activate` skips `ctx.storage` with a warning.
- **API revision 0.2.0** (additions only): `ctx.host` (`app`, `api`, `has(feature)`), a read-only `ctx.theme` (`mode()`, `tokens()`, `onChange`), `ctx.manifest.permissions` and the manifest key `permissions`. Feature names for `has` are generated from the `@since` tags; the 41 theme token names are documented in `sdk/docs/theme-tokens.md`. The names `net`, `secret` and `control` are reserved as permissions. `check` reports `permission-*` codes; the mock host and the in-repo kit have `theme.set`.
- `sdk/api`: the `@vaultdraw/api` types package (types only, not published yet).
- `vaultdraw-plugin`: a command line tool with `check`, `init` and `dev`.
- `@vaultdraw/api/testing`: a mock host. `boot(manifest, plugin)` runs a plugin under vitest with a fake scene, event bus, settings and toasts, and enforces the app's rules. `VAULTDRAW_TEST_HOST=mock` runs the example tests on it. See `sdk/docs/testing.md`.
- `sdk/api/plugin.schema.json`: a JSON Schema of `plugin.toml` for editor completion, and a generated manifest reference (`sdk/docs/manifest.md`).
- `vaultdraw-plugin build`: bundles a TypeScript project into `dist/` with esbuild. The entry can be set under `[x-build]` in `plugin.toml`.
- `vaultdraw-plugin package`: checks, then writes `<id>-<version>.zip` (reproducible, flat layout) and a `.sha256` file.
- `vaultdraw-plugin check` accepts a `.zip`: it verifies the checksum, reads the archive strictly and checks the contents (new codes `zip-checksum`, `zip-invalid`, `zip-layout`). `main-missing` suggests `build` when the project has a source entry.
- TypeScript templates: `vaultdraw-plugin init <id> --template command|panel|scene`. `dev` builds a TypeScript project and mirrors `dist/`.
- Dev log: for a plugin with `dev = true`, the app appends its `ctx.log` lines and attributed errors to `<state dir>/plugin-logs/<id>.log` (capped at 1 MB). `vaultdraw-plugin dev` shows new lines, prefixed with `log |`.
- `create-vaultdraw-plugin`: a thin wrapper around `init --template command` (not published).
- `vaultdraw-plugin check --activate`: also runs `activate()` once in a dry host (a child process with a timeout) and reports declared commands or panels that are never bound, undeclared ones, unknown events, errors and endless activations.
- `vaultdraw-plugin dev --sandbox`: starts the app on a throwaway config, state and vault with the plugin enabled, and removes them on exit.
- Doc pages: `sdk/docs/testing.md` and `sdk/docs/packaging.md`.
- A manifest test corpus that pins what `plugin.toml` accepts and refuses.
- Two doc pages: `sdk/docs/reference.md` and `sdk/docs/getting-started.md`.
- A lint (D7): official plugins, built-in extensions and example plugins may import only the public API, never app or editor internals.

- **CSS snippets:** put your own `.css` files in the config folder's `snippets/` and turn each on in **Settings → Appearance → CSS snippets** or with `appearance.snippets` in `config.toml`. They apply after the theme, reload live, and never touch files or exports. Palette commands open the folder, reload, and toggle each snippet (rebindable).
### Changed

- Faster start: only eight built-in colour themes (Default, Noctalia, Catppuccin, Dracula, Gruvbox, Nord, Rosé Pine, Tokyo Night) ship in the startup code. The other built-ins load the moment you pick one, and a configured one loads before the first paint, so there is no flash. The theme code read at startup shrinks from 210 KB to 67 KB.

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
