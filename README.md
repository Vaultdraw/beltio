# Vaultdraw

An offline, local-first vault for [Excalidraw](https://github.com/excalidraw/excalidraw) drawings, a bit like Obsidian but for whiteboards.

You pick a folder on your computer as your vault. Folders are real directories and drawings are ordinary `.excalidraw` files, so you own your data: back it up, sync it or move it however you like. There are no accounts, no cloud and no telemetry.

## Install

Download `Vaultdraw_0.1.1_universal.dmg` from the [GitHub Releases page](https://github.com/Vaultdraw/vaultdraw/releases), open it and drag Vaultdraw to Applications. The build is universal and runs natively on Apple Silicon and Intel Macs. To verify the download, run `shasum -a 256 -c SHA256SUMS` in the folder you saved it to (optional).

### First open

Vaultdraw isn't signed with an Apple Developer certificate yet, so macOS may say it can't verify the developer or that the app "cannot be opened". The source is open to inspect. To open it the first time, either:

- Right-click (or Control-click) Vaultdraw in Applications, choose **Open**, then **Open** again; or
- Try to open it once, then go to **System Settings → Privacy & Security**, scroll to the message about Vaultdraw and click **Open Anyway**.

If macOS reports the app as "damaged", run this in Terminal and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/Vaultdraw.app
```

### Command line

Open the command palette (Cmd/Ctrl+Shift+P) and run **Install 'vaultdraw' command in PATH**, or **Install 'vaultdraw' command in /usr/local/bin** to choose that location. Then check it works:

```bash
vaultdraw --version
vaultdraw --help     # lists the commands for drawings, search, links, tags, settings and tabs
```

### Build from source

See [Development](#development) below.

## Features

- File tree beside the Excalidraw canvas: create, rename, duplicate, move and delete drawings and folders
- Autosave with atomic writes and crash recovery
- Detects changes made outside the app without losing unsaved edits
- Export image dialog (Shift+Cmd+E): PNG or SVG at 1x, 2x or 3x, with or without background, dark mode, embedded scene and selection only. The last-used scale, background and embed setting are remembered. Exports always use the drawing's own colours, even with "Sync canvas with theme" on
- Copy PNG or SVG to the clipboard, from the export dialog or the right-click menu. On macOS the image goes to the native clipboard
- Page mode: draw on simulated pages (A4, Letter, tablet, custom, ...) with vertical scrolling, separate sheets or one continuous page, and export them as a PDF with one page per page
- Import PDF pages as images to annotate them (offline, native rendering), from the palette, the main menu or by dropping a PDF
- Insert Mermaid diagrams from the main menu or More tools. Conversion runs fully offline, with no AI
- Works fully offline (fonts and assets are bundled)
- Keyboard first: Cmd/Ctrl+P opens any drawing by name, Cmd/Ctrl+Shift+P runs any command (every editor action and every Vaultdraw feature), with customisable hotkeys (Settings → Hotkeys)
- Plain-text config folder, editable by hand or in Settings, reloaded live
- Colour themes in Noctalia format, nine built in, light and dark (in progress)

## Configuration

All settings live in one folder, like kitty, Ghostty or Zed:

| OS | Config folder | Machine state |
| --- | --- | --- |
| macOS, Linux | `$XDG_CONFIG_HOME/vaultdraw`, else `~/.config/vaultdraw` | `$XDG_STATE_HOME/vaultdraw/state.json`, else `~/.local/state/vaultdraw/state.json` |
| Windows | `%APPDATA%\Vaultdraw` | `%LOCALAPPDATA%\Vaultdraw\state.json` |

```
vaultdraw/
├── config.toml   your settings
└── themes/       colour themes
```

`config.toml` is created on first launch (with comments explaining each key). The keys and their defaults:

```toml
[appearance]
theme = "Default"            # a built-in theme or one in themes/
mode = "system"              # light | dark | system
sync_canvas = false          # canvas follows the theme's colours
canvas_background = "#ffffff" # for new drawings when sync_canvas is off
accent_color = ""            # "#rrggbb" replaces the theme's primary colour; "" = the theme's own

[editor]                     # defaults for new elements
font_family = 5              # 5 Excalifont, 6 Nunito, 8 Comic Shanns, 1 Virgil, 2 Helvetica, 3 Cascadia
font_size = 20
stroke_color = "#1e1e1e"
background_color = "transparent"
fill_style = "solid"         # solid | hachure | cross-hatch
stroke_width = 2
roughness = 1                # 0 architect, 1 artist, 2 cartoonist

[paper]
style = "plain"             # plain | grid | lines | dots | graph | isometric
spacing = 0                 # 5 to 200 (0 = the style's own)
color = ""                  # "#rrggbb"; "" = automatic
opacity = 1                 # 0.1 to 1
major_every = 0             # grid and graph: a stronger line every N, 1 to 20 (0 = the style's own)
margin_line = true          # ruled lines: draw the margin line

[page]                       # page mode for new drawings; see "Page mode"
mode = "normal"              # normal (infinite canvas) | page
layout = "separate"          # separate (sheets with a gap) | continuous (one long page)
size = "a4"                  # a3 | a4 | a5 | b5 | letter | legal | tablet | tabletLarge | phone | custom
orientation = "portrait"     # portrait | landscape
width = 0                    # custom size in px, 100 to 5000 (0 = unset)
height = 0
paper_theme = "normal"       # normal | old_school | match

[saving]
autosave_delay_ms = 500      # idle time before an edit is written to disk

[interface]
zoom = 100                   # whole-app zoom, 50 to 200 percent

[navigator]
sort = "name_asc"            # name_asc | name_desc | modified_desc | modified_asc

[files]
confirm_delete = true        # ask before moving to Trash
new_drawing_folder = ""      # relative to the vault root; "" = next to the open drawing
templates_folder = "Templates" # vault folder holding templates, relative to the vault root

[tools.arrow]                # default style of one tool; see "Tool defaults"
stroke_color = "#f08c00"     # set only the keys you want; others keep the current style
stroke_width = 3
stroke_style = "dotted"
```

- **Settings and the file stay in sync.** Changing something in Settings updates `config.toml` and keeps your comments and layout. Editing the file updates the app.
- **Live reload.** Saved changes apply immediately, no restart needed. Delete a line to go back to its default.
- **Typos are safe.** If the file can't be parsed, the app keeps the last good settings and shows a banner such as `config.toml line 7: <error>`. A value of the wrong type falls back to its default and is reported the same way.
- **Settings → Open config folder** opens the folder; **Reload** re-reads it.

`state.json` holds machine state (recent vaults, navigator width, expanded folders, last-used image export options). It is not meant for hand editing.

### Settings reference

Everything here can be changed in **Settings** (Cmd/Ctrl+,) or by editing `config.toml`.

- **Accent colour** (Appearance, `appearance.accent_color`). Replaces the theme's primary colour in both light and dark mode, using a picker or a hex value. If the colour would be hard to read against the theme, it is nudged until it is, and Settings shows "Adjusted for contrast" with the colour actually used. **Reset** (or an empty value) goes back to the theme's own.
- **Interface zoom** (Interface, `interface.zoom`). Scales the whole window from 50 % to 200 %. **Cmd/Ctrl+Shift + `+`**, **`-`** and **`0`** step by 10 and reset to 100 %. Plain **Cmd/Ctrl + `+`**, **`-`** and **`0`** still zoom the canvas, as in Excalidraw.
- **Navigator sort order** (Interface, `navigator.sort`, also the sort button in the navigator toolbar). Four orders: name A to Z, name Z to A, modified new to old, modified old to new. Folders always come first; the order applies within folders and within drawings. Names compare ignoring case and by number, so "Drawing 2" comes before "Drawing 10".
- **Confirm before delete** (Files, `files.confirm_delete`). On by default. Turn it off and "Move to Trash" acts immediately. It only affects moving to Trash, which can be undone from the OS trash.
- **Default folder for new drawings** (Files, `files.new_drawing_folder`). A path relative to the vault root, for example `Sketches/Inbox`. It is created if it doesn't exist. Empty (the default) puts a new drawing next to the open drawing.

#### Per-vault settings

Navigator sort order, the default folder for new drawings, the templates folder, the paper style and each tool's default style can differ per vault. Those rows have a **This vault** switch:

- **On:** the value is saved in `<vault>/.excalidraw-vault/settings.toml`, starting from the value currently in effect. Edits go there.
- **Off:** the key is removed from that file and the global value applies again.

The file lives inside the vault, so it travels with it when you copy, sync or back up the folder. Precedence is per-vault value, then `config.toml`, then the default. Like `config.toml` it is plain TOML, reloads live, keeps your comments, and a bad value is ignored with a notice while the rest still applies.

```toml
# <vault>/.excalidraw-vault/settings.toml
[navigator]
sort = "modified_desc"

[files]
new_drawing_folder = "Sketches/Inbox"
```

### Themes

A theme sets the colours of the whole app: the file tree, header, Settings and Excalidraw's toolbars, menus and dialogs. Every theme has a dark and a light variant, so theme and mode are chosen separately, in **Settings → Appearance** or in `config.toml`:

```toml
[appearance]
theme = "Tokyo Night"   # theme name, case-insensitive
mode = "system"         # light | dark | system (follows the OS)
sync_canvas = true      # canvas follows the theme too
```

**Built-in themes:** Default, Dracula, Tokyo Night, Catppuccin, Everforest, Gruvbox, Nord, Rosé Pine, Solarized. If `theme` names a theme that doesn't exist, Vaultdraw uses Default and shows a warning.

#### Adding a theme

Themes use the [Noctalia](https://github.com/noctalia-dev/noctalia-colorschemes) palette format, so existing Noctalia palettes work unchanged. Put the `.json` file in `themes/` inside the config folder (`~/.config/vaultdraw/themes/` on macOS and Linux), in either layout:

```
themes/
├── Midnight.json          a single file
└── Paper/
    └── Paper.json         a folder, as Noctalia ships them
```

The file or folder name is the theme's name: `theme = "Midnight"` selects `Midnight.json`. A theme in `themes/` with the same name as a built-in one replaces it.

A theme needs only three colours per variant (background, text, accent); everything else is derived:

```json
{
  "dark": {
    "mSurface": "#1b1d2b",
    "mOnSurface": "#d8dae8",
    "mPrimary": "#82aaff"
  },
  "light": {
    "mSurface": "#f6f6fa",
    "mOnSurface": "#2b2d3a",
    "mPrimary": "#3b6fd8"
  }
}
```

You can also leave out `light` or `dark` entirely; the missing variant is generated from the other one. Whatever colours a theme uses, Vaultdraw adjusts them where needed so text stays readable.

The full set of roles, all optional except the first three:

| Role | Colours in Vaultdraw |
| --- | --- |
| `mSurface` | Canvas and app background; base of the sidebar, header and menus |
| `mOnSurface` | Text and icons; black and grey strokes on a synced canvas |
| `mPrimary` | Accent: selected items and tools, buttons, links, focus rings, selection outline |
| `mOnPrimary` | Text and icons on accent-coloured buttons |
| `mSurfaceVariant` | Tint of the sidebar and header |
| `mOnSurfaceVariant` | Secondary (muted) text |
| `mError` | Errors and delete actions; red on a synced canvas |
| `mSecondary`, `mTertiary` | Extra accents, used for palette colours on a synced canvas |
| `mShadow` | Shadows under menus and dialogs |
| `mOnSecondary`, `mOnTertiary`, `mOnError`, `mOutline`, `mHover`, `mOnHover` | Accepted for Noctalia compatibility; derived if missing |
| `terminal` | Optional ANSI colours: green and yellow set success and warning; all of them feed the canvas palette when synced |

Optional top-level `name` and `author` fields are for display only.

#### Sync canvas with theme

With `sync_canvas = true` (**Sync canvas with theme** in Settings), the canvas is recoloured on screen: its background becomes the theme's background, and the pencil, stroke and fill colours from Excalidraw's palette become matching theme colours. This only changes what you see. Saved drawings and PNG/SVG exports keep Excalidraw's standard colours, so they look the same for anyone who opens them. With it off, the canvas renders as in regular Excalidraw.

Themes are data only: colour values, no code.

## Hotkeys

Every Vaultdraw command has a key you can change. Open **Settings → Hotkeys** (Cmd/Ctrl+,).

The page lists all commands with their keys as chips. Type in the filter to narrow by command name or key. The **⌨** button records keys: press a key combination and the list shows every command bound to it. The chips **All**, **Assigned**, **Customised**, **Unassigned** and **Conflicts** filter the list (Conflicts appears only when there is one).

- **+** records a new key for a command. A command can have several.
- **×** on a key removes it. **↺** resets the command to its defaults.
- While recording, **Backspace** clears the key and **Esc** cancels.
- Keys the system or the app menu owns (Cmd+Q, Cmd+W, Cmd+Tab, Cmd+C/X/V/Z/A and similar) are refused, with the reason shown.
- A key used by two commands, or by one of Excalidraw's own shortcuts, is shown in red with what it clashes with. It is allowed, and Vaultdraw's binding wins.

### Defaults

`Mod` is Cmd on macOS and Ctrl on Windows and Linux. A dash means no key by default.

| Command id | What it does | macOS | Windows / Linux |
| --- | --- | --- | --- |
| `file.save` | Save drawing | ⌘S, ⇧⌘S, ⌃S | Ctrl+S, Ctrl+Shift+S |
| `settings.open` | Open settings | ⌘,, ⌃, | Ctrl+, |
| `navigator.focusSearch` | Search vault | ⇧⌘F, ⌃⇧F | Ctrl+Shift+F |
| `view.zoomIn` | Zoom in (interface) | ⇧⌘=, ⇧⌘Num + | Ctrl+Shift+=, Ctrl+Shift+Num + |
| `view.zoomOut` | Zoom out (interface) | ⇧⌘-, ⇧⌘Num - | Ctrl+Shift+-, Ctrl+Shift+Num - |
| `view.zoomReset` | Reset interface zoom | ⇧⌘0, ⇧⌘Num 0 | Ctrl+Shift+0, Ctrl+Shift+Num 0 |
| `palette.files` | Go to drawing (palette, files mode) | ⌘P | Ctrl+P |
| `palette.commands` | Show all commands (palette, commands mode) | ⇧⌘P, ⌘/ | Ctrl+Shift+P, Ctrl+/ |
| `vault.newDrawing` | New drawing | ⌘N | Ctrl+N |
| `vault.newFromTemplate` | Templates: New drawing from template | ⌥⌘N, ⌃⌥N | Ctrl+Alt+N |
| `view.toggleNavigator` | Toggle navigator | ⌘\  | Ctrl+\  |
| `vault.switch` | Open another vault | — | — |
| `file.revealInFinder` | Reveal drawing in Finder | — | — |
| `file.duplicate` | Duplicate drawing | — | — |
| `appearance.toggleMode` | Toggle light/dark mode | — | — |
| `settings.openHotkeys` | Settings: Hotkeys | — | — |

Every other palette entry with a fixed name (Mode: Dark, Paper: Grid, Settings: Files, Export: PNG, Sort: …, Rename drawing, …) is listed on the Hotkeys page too, unassigned by default.

Canvas zoom is Excalidraw's own: **Cmd/Ctrl + `+`**, **`-`** and **`0`**. Interface zoom adds Shift.

### The `[hotkeys]` table

Settings writes to `config.toml`, and you can edit it by hand. Only your changes are stored, as a list of keys per command id:

```toml
[hotkeys]
# add a second key (list the default too, or it is replaced)
"file.save" = ["Mod+S", "Alt+S"]

# unassign: an empty list
"vault.newDrawing" = []

# change a key
"view.toggleNavigator" = ["Mod+B"]
```

Ids contain dots, so quote them. Delete a line to go back to the default. Edits apply as soon as the file is saved, with no restart.

Keys are modifiers plus one key, joined with `+`: `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`. `Mod` means Cmd on macOS and Ctrl elsewhere, so one file works on both. The key is the physical key (`KeyboardEvent.code`) without the `Key` or `Digit` prefix: `N`, `0`, `Comma`, `Equal`, `Backslash`, `F2`, `ArrowUp`, `Numpad0`. These aliases are accepted too: `Cmd`, `CmdOrCtrl`, `Option`, `Esc`, `Plus`, `=`, `,`, `Digit0`, `KeyN`.

Mistakes never break the app. They show as a warning banner in Settings and the rest of the file still applies:

- An unknown command id is kept in the file and reported (it may belong to a newer version).
- A key that can't be parsed is ignored.
- A value that isn't a list keeps the command's defaults.
- An older `"palette.quickSwitcher"` entry still works: it sets the Cmd+P (files) key, unless `"palette.files"` is set too. Cmd+Shift+P and Cmd+/ in it are ignored, because they now open commands mode. Changing the key in Settings replaces the old line.

### Command palette

One palette with two modes, as in VS Code:

- **Cmd/Ctrl+P** goes to a drawing: it lists drawings only, recent ones first.
- **Cmd/Ctrl+Shift+P** (also **Cmd/Ctrl+/**, Excalidraw's palette key) runs a command. The input starts with `>` and lists commands only, recent ones first.
- Typing `>` at the start switches to commands, and deleting it switches back to drawings. Pressing the shortcut of the mode you are in closes the palette; pressing the other one switches mode.

Type a few letters, in order and not necessarily next to each other (`vdg` finds `vault-design`). Commands whose name starts with what you typed come first, then things you used recently, then the best fuzzy matches.

- **Up/Down** move, **Enter** opens or runs and puts focus back on the canvas, **Esc** closes.
- **Cmd/Ctrl+Enter** runs a command and keeps the palette open (handy for toggles such as Toggle grid).
- **Tab** (or **→** at the end of the text) narrows to a family: on "Theme: Dracula" it shows every `Theme: …` entry.
- With nothing typed, each mode lists what you used recently first (drawings and commands keep separate lists).

Commands mode lists Excalidraw's editor actions (tools, align, group, layers, flip, lock, grid, zen mode, canvas background, export image, clear canvas, …) with their shortcuts, and every Vaultdraw feature as a direct entry: `Theme: <name>`, `Mode: Light/Dark/System`, `Sync canvas with theme: On/Off`, `Paper: <style>`, `Pen: <name>`, `Insert: <library item>`, `Settings: <page>`, `Export: PNG/SVG`, `Save a copy`, `Templates: …`, `Sort: …`, new drawing or folder, rename, move, trash and more. Entries that can't run right now (nothing selected, read-only vault, no drawing open) are hidden.

Excalidraw's separate command palette is not used.

## Notebook backgrounds

A drawing can sit on paper: plain, grid, ruled lines (optionally with a margin line), dots, graph paper (minor and major lines) or isometric dots. The pattern is saved with the drawing and is anchored to it, so it zooms and scrolls with the content. Lines that would be too close together to read are hidden.

- **Default for new drawings.** **Settings → Appearance → Background Pattern** sets the style and its tuning (spacing, colour, opacity, major lines, margin line), with a live preview. The style can be stored per vault. In `config.toml` the same settings are the `[paper]` table (see Configuration).
- **Per drawing.** Choose **Paper** in the canvas main menu to change the open drawing's style, or **Paper settings…** to tune it. **Use app default** returns the drawing to the app default. **Make app default** uses the drawing's pattern for new drawings. Changing the default does not change existing drawings.
- **In the file.** The pattern is stored as `appState.viewBackgroundPattern`. Drawings without it, such as older files, open plain. excalidraw.com opens these files with a plain background, and saving there drops the pattern.
- **Display and export.** On screen the pattern follows dark mode and **Sync canvas with theme**. Exports use Excalidraw's standard colours. The export dialog has a **Background pattern** switch, shown only for drawings with a pattern; it needs **Background** on.

## Page mode

A drawing can be an infinite canvas (Normal) or simulated paper (Page), like a notes app: the pages are a fixed width, you scroll vertically, and the view always fits the page width.

- **Layouts.** **Separate pages** are fixed-size sheets stacked with a gap; drawing near the end of the last page adds a new one. **Continuous** is one long page of fixed width that grows downward as you fill it.
- **Sizes.** A3, A4, A5, B5, Letter, Legal, iPad 11-inch and 13-inch, Phone, or a custom width and height in pixels; portrait or landscape.
- **Outside the page is off limits.** You can't start a stroke, drag, resize or paste outside the pages, and with separate pages a shape stays on its page. Sideways panning is locked; PageUp/PageDown jump between pages. A drawing switched to page mode keeps everything it had: content outside the pages stays visible but can't be edited there, and **Fit content to page** moves it in.
- **Paper themes.** **Normal** is clean white paper, **Old school** is warm cream paper with blue ruled lines and a red margin (a plain drawing becomes ruled; pick another paper style afterwards if you prefer), and **Match current theme** follows the app theme on screen, like **Sync canvas with theme**. The paper style itself (lines, grid, dots, ...) is the drawing's background pattern (see Notebook backgrounds).
- **Export.** **Export: PDF** (command palette, or **Export as PDF…** in a drawing's navigator menu) writes one PDF page per page, fully offline; a continuous page is split at the page size. PNG and SVG export the content as before; the export dialog's **Page shape** switch exports whole pages instead.
- **Defaults and per drawing.** **Settings → Page** sets the mode, layout, size, orientation and paper theme of new drawings (the `[page]` table in `config.toml`). The canvas main menu's **Page** row opens the drawing's page setup, with **Make app default**. The setup is saved in the drawing (`appState.pageSetup`), so it reopens the same; other Excalidraw apps open the file as a normal canvas.
- **Keyboard.** Every action is a palette command and can get a key on the Hotkeys page: `Page mode: On/Off/Toggle`, `Page layout: Continuous/Separate pages`, `Page size: A4` (every size), `Page orientation: Portrait/Landscape`, `Paper theme: Normal/Old school/Match current theme`, `Page setup…`, `Fit content to page`, `Next page`/`Previous page` (PageDown/PageUp) and `Export: PDF`.

## Tool defaults

Each drawing tool can start with its own style, so a dotted, orange, 3 px arrow is always one keypress away. Tools: rectangle, diamond, ellipse, arrow, line and text. The pen keeps its own saved presets (`[pens]`) and the laser its own look (`[laser]`); all of them are edited on one page, **Settings → Tools**.

- **Picking the tool applies its default.** Only the keys you set apply; everything else keeps the editor's current style. Every tool also remembers the style you last used it with until you quit (across drawings and vaults), like FigJam: set the arrow to dashed red, draw a rectangle, and the arrow is dashed red again. Saved defaults are where every launch starts, and saving or resetting a tool's default (or changing it in Settings) clears that tool's memory. Leaving a tool puts the shared style back, so an arrow's orange never leaks into the next rectangle.
- **Text is styled however you create it.** The Text tool's style (the one it last used, else its default) also applies to text you create without picking it: double-clicking the canvas, Enter on a selected shape or arrow (labels stay centred), and pasted text. Editing existing text never restyles it, and sticky notes keep their own look. With no Text default set, such text uses the editor's current style as before.
- **Settings → Tools** has a tab per tool (rectangle, diamond, ellipse, arrow, line, text, pen, laser), and a dot marks the tools you have customised. Each tab shows a live preview and one row per value. Every value has a **Default** choice that unsets it, **Reset** removes the tool's defaults, and **This vault** stores the tool's style in the vault (the vault's table replaces the global one; an empty vault table means "no defaults for this tool here"). The **Pen** tab picks a saved pen and edits it (add, remove, reset to the built-in pens); the **Laser** tab sets its colour, size, fade time and tail length. The palette commands `Settings: Tools` and `Settings: Pens & laser` (which opens the Pen tab) open the page.
- **From the canvas.** In the command palette (Cmd/Ctrl+Shift+P): `Tool defaults: Save current style for Arrow` takes the style of a selected arrow, or the current style when none is selected. `Tool defaults: Save current style for this tool` does the same for the active tool or the selected shape, and `Tool defaults: Reset Arrow` removes them. Both act on this vault when the tool has a vault style (turn **This vault** off to inherit the global one again), otherwise on `config.toml`. Each command can get a key on the Hotkeys page.
- **In the files.** One table per tool in `config.toml` or `<vault>/.excalidraw-vault/settings.toml`:

  ```toml
  [tools.arrow]
  stroke_color = "#f08c00"
  stroke_width = 3            # px, 0.5 to 40
  stroke_style = "dotted"     # solid | dashed | dotted
  end_arrowhead = "triangle"  # none | arrow | bar | circle | triangle | diamond | ... (and _outline variants)
  ```

  | Key | Tools | Values |
  | --- | --- | --- |
  | `stroke_color`, `background_color` | all (background: not arrow or text) | a colour like `"#f08c00"` or `"transparent"` |
  | `fill_style` | rectangle, diamond, ellipse, line | `hachure`, `cross-hatch`, `solid`, `zigzag` |
  | `stroke_width` | all but text | px, 0.5 to 40 |
  | `stroke_style` | all but text | `solid`, `dashed`, `dotted` |
  | `roughness` | all but text | 0 architect, 1 artist, 2 cartoonist |
  | `roundness` | rectangle, diamond, line | `sharp`, `round` |
  | `opacity` | all | 1 to 100 |
  | `arrow_type`, `start_arrowhead`, `end_arrowhead` | arrow | `sharp`/`round`/`elbow`; an arrowhead name or `none` |
  | `font_family`, `font_size`, `text_align` | text | a font id (as `[editor]`), 4 to 400, `left`/`center`/`right` |

  An unknown key or bad value turns that tool's defaults off and shows a notice naming the key. Nothing is written into your drawings: new elements simply get the style.

## Search

Search finds text inside every drawing in the vault. Type in the search box at the top of the navigator, or press Cmd+Shift+F (Ctrl+Shift+F on Windows and Linux) to move there.

It searches drawing names and folder paths, text elements, labels inside shapes and arrows, and frame names. Text inside library items is not searched.

Results are grouped by drawing, with up to five highlighted snippets under each one. Use Up and Down to move, Enter to open the selected row, and Escape to clear the search. Clicking a snippet opens the drawing, zooms to that element and selects it. For a label, the shape or arrow it belongs to is selected.

Matching rules:

- Case, accents and character width are ignored: `cafe` finds `Café`, and full-width letters find ASCII.
- A term can match inside a word, so `graph` finds `Dijkstra graphs`.
- Every word you type must appear in the drawing, but the words can be in different elements.
- Chinese, Japanese and Korean text is searched as written, without spaces between words.

The index is stored outside the vault, in the state folder (`~/.local/state/vaultdraw/index/` by default; `VAULTDRAW_STATE_DIR` changes the folder). Nothing is written into your vault. The index is rebuilt automatically when it is missing or damaged, and it is safe to delete. When a large vault is indexed for the first time, the status line shows progress, such as "Indexing 1,234 of 5,000 drawings…", and results cover only the drawings indexed so far.

## Links and backlinks

Link drawings to each other, as in a wiki. A link is plain text in the drawing, so it stays readable in any editor, and the drawing keeps working when you copy it elsewhere.

### Writing links

Type `[[Name]]` in any text: free text, shape labels or arrow labels. Use `[[Name|label]]` to show a different label. Matching ignores case and accents. When two drawings share a name, use the path: `[[Graphs/BFS]]`.

Typing `[[` in a text element opens a list of drawings that narrows as you type:

| Key | Action |
| --- | --- |
| ↑ ↓, or Ctrl+N / Ctrl+P | Choose a drawing |
| Enter or Tab | Insert the link |
| `\|` | Start a label |
| Esc | Close the list |

The last row, **Create 'x'**, makes a new drawing in the default folder for new drawings. Cmd+clicking an unresolved link offers the same. Set `links.autocomplete = false` to turn the list off.

### How links look

On the canvas, a `[[link]]` is drawn in the link colour and underlined, still in the drawing's font. The brackets stay, dimmed, so the text keeps exactly the size and wrapping it has on excalidraw.com. In `[[Name|label]]`, the label is emphasised and `Name|` is dimmed. A link to a drawing that doesn't exist yet is fainter, with a dashed underline, like the hollow dots in the graph view. The file still stores plain `[[Name]]` text, and exports (PNG, SVG, clipboard, PDF) show the plain text, as excalidraw.com does.

The colour is the theme's accent by default. Set `links.color` to a hex colour such as `"#1971c2"` to choose your own; it follows dark mode and canvas sync like any other colour. `links.style_links = false` draws links as plain text.

Hover over a link for a moment to see a preview of the linked drawing: its name, folder and a thumbnail. It disappears when you move away, click or scroll. Set `links.hover_preview` to `"modifier"` to show it only while the open modifier (Cmd) is held, as in Obsidian's editing view, or to `"off"`.

### Shape links

Select a shape and press ⌥⌘K (**Links: Link selection to drawing…**) to pick a drawing. The shape stores `[[Name]]` in its link field, and Cmd+clicking the shape opens the drawing. Set `links.shape_link_format = "vaultdraw-url"` to store a `vaultdraw://open?file=…` link instead. Vaultdraw also reads relative paths such as `./x.excalidraw`, so drawings made with the Obsidian Excalidraw plugin work.

### Opening links

- **Cmd+click** a `[[link]]` or a linked shape. Holding the modifier underlines every link. The modifier is set by `links.open_modifier`: `mod` (default), `alt`, `ctrl` or `shift`.
- **Keyboard:** ⌥⌘↵ opens the link of the selected element. ⌥⌘← and ⌥⌘→ go back and forward.
- **Link hints:** Shift+F shows a letter on every visible link. Type the letters to open one, as in Vimium. The letters come from `links.hint_chars`.

### Backlinks panel

⌥⌘B shows or hides the backlinks panel at the bottom of the navigator. It has two tabs:

- **Backlinks** lists the drawings that link to the open drawing, with a snippet of each link.
- **Outgoing** lists the links in the open drawing. Links to drawings that don't exist yet have a **Create** button.

A collapsed **Unlinked mentions** section finds text that matches the drawing's name but isn't linked. It is computed only when you expand it.

| Key | Action |
| --- | --- |
| j / k or ↑ ↓ | Move |
| Enter or o | Open the drawing at the linking element |
| Tab | Switch tabs |
| h / l | Collapse / expand |
| g / G | First / last row |

### Renaming and moving

Renaming or moving a drawing or folder inside Vaultdraw also updates the links that point to it, in every drawing. A toast reports the result, for example "Updated 3 links in 2 drawings". The `links.update_on_rename` setting controls this:

| Value | Behaviour |
| --- | --- |
| `true` (default) | Update links automatically |
| `false` | Leave links unchanged |
| `"ask"` | Ask first. Vaultdraw also asks when a rename would make other links point to a different drawing |

Files changed on disk during the update are skipped, never overwritten.

### Link format

`links.new_link_format` sets the form Vaultdraw writes for new links: `"shortest"` (default), `"relative"` or `"absolute"`. With `"shortest"`, a bare name is used when it is unique in the vault, and the path from the vault root otherwise.

### Drawing shortcuts

Give a drawing its own key with **Assign hotkey to this drawing**, or in **Settings → Hotkeys → Drawing shortcuts → Add drawing shortcut…**. The key is stored in `[hotkeys]`:

```toml
[hotkeys]
"drawing.open:Folder/Name.excalidraw" = ["Mod+Alt+1"]
```

### Commands

All of these are in the Cmd+Shift+P palette, and each can be rebound on the Hotkeys page or in `[hotkeys]`:

| Command | macOS | Windows / Linux |
| --- | --- | --- |
| Links: Link selection to drawing… | ⌥⌘K | Ctrl+Alt+K |
| Links: Insert link… | — | — |
| Links: Open link under selection | ⌥⌘↵ | Ctrl+Alt+Enter |
| Links: Toggle backlinks panel | ⌥⌘B | Ctrl+Alt+B |
| Links: Go back | ⌥⌘← | Ctrl+Alt+← |
| Links: Go forward | ⌥⌘→ | Ctrl+Alt+→ |
| Links: Copy link to this drawing | — | — |
| Links: Show link hints | Shift+F | Shift+F |
| Links: Assign hotkey to this drawing | — | — |
| Links: Toggle link styling | — | — |
| Links: Toggle link hover preview | — | — |

### Settings

All of these can be set in **Settings → Links** or in `config.toml`. The values shown are the defaults:

```toml
[links]
new_link_format = "shortest"       # shortest | relative | absolute
shape_link_format = "wikilink"     # wikilink ([[Name]]) | vaultdraw-url
open_modifier = "mod"              # mod | alt | ctrl | shift
update_on_rename = true            # true | false | "ask"
autocomplete = true                # the list that opens on [[
hint_chars = "asdfghjkl"           # letters used by Shift+F hints
style_links = true                 # draw [[links]] in the link colour, underlined
color = "accent"                   # accent (theme) | "#rrggbb"
hover_preview = "always"           # always | modifier | off
```

### Notes

- **excalidraw.com** reads `[[links]]` as plain text, and shape links show the normal link icon. Nothing is lost when a file is saved there.
- **Speed.** Links cost nothing until you use them. The link index is built on first use, off the UI thread. Link styling is painted into the same cached bitmap Excalidraw already keeps for each text element, so panning and zooming cost the same with or without it.

## Graph view

⌘⌥G (**Graph: Open graph view**) shows every drawing as a dot and every link as a line, over the canvas. Esc, or ⌘⌥G again, returns to the drawing you left, at the same zoom and position. ⌘⌥L opens the **local graph**: the open drawing and the drawings within 1–3 links of it.

You can also open it with the mouse: the **Graph view** button in the navigator toolbar (its tooltip shows the current key), **Graph view** in the canvas main menu, or **Open local graph** in a drawing's ⋯ menu in the navigator, which opens that drawing and shows its local graph. All three run the same commands as the keys, so they follow your rebinding.

Each dot is labelled with the drawing's name, and dots with more links are bigger. Drawings in the same top-level folder share a colour. Tags are dots too (turn them off with **Graph: Toggle tags**), and links to drawings that don't exist yet are hollow dots. Hover a dot to light up its links and neighbours and fade the rest. A card shows its name, folder, link counts and the shortcut assigned to it.

The graph is alive: it spreads out when it opens and settles within a few seconds. Drag a dot and its neighbours follow on springs. Let go and it rejoins the layout. Scroll or pinch to zoom around the pointer. Drag the background to pan, and flick to let it glide.

| Key | Action |
| --- | --- |
| h j k l or ← ↓ ↑ → | Move to the nearest dot in that direction |
| Enter, or click | Open the drawing and close the graph |
| F | Show a letter on every visible dot. Type the letters to open one |
| / | Filter by name. `path:Folder` and `tag:#x` also work. Dots that don't match are dimmed |
| Shift+L | Switch between global and local |
| 1 2 3 | Local graph depth |
| 0, + and - | Fit, zoom in, zoom out |
| Esc | Close |

**Graph: Toggle orphans**, **Toggle tags**, **Toggle unresolved links** and **Fit graph to view** are in the command palette (⌘⇧P) and on the Hotkeys page, with no default key. Every graph command can be rebound.

The settings button in the graph's toolbar opens colour groups, display (arrows, label fade, dot size, line thickness) and forces (centre, repel, link strength, link distance). They are stored per vault in `<vault>/.excalidraw-vault/settings.toml` under `[graph]`, and only values that differ from the default are written:

```toml
# <vault>/.excalidraw-vault/settings.toml
[graph]
show_orphans = false
colour_by = "mono"
local_depth = 3
```

The layout runs in the background, off the main thread, and is saved, so the graph reopens in the same shape. It blooms out of its saved shape each time. Once the layout settles, the graph uses no CPU. The saved layout lives in Vaultdraw's own state folder, never inside your vault, and the graph costs nothing until you first open it.

## PDF import

**Import: PDF…** (command palette, or **Import PDF…** in the canvas main menu) turns PDF pages into image elements in the open drawing, so you can annotate them. Dropping a `.pdf` on the canvas opens the same dialog.

- **Dialog.** Shows the file name, page count and a page range (`all`, `1-5, 8, 10-`), and warns when a large import won't fully fit. Enter imports, Escape cancels. Progress reads "Rendering page n of N"; cancelling leaves the drawing untouched.
- **Result.** One undo step. Pages are locked so annotating doesn't drag them (unlock with **Unlock all**). In a normal drawing they go in a column below the existing content; in page mode each PDF page goes on its own drawing page after the last page with content.
- **Offline and plain.** Pages are rendered natively by macOS (CoreGraphics), one at a time, and stored as ordinary image files in the drawing, so it still opens on excalidraw.com. The PDF itself isn't copied into the vault.
- **Size limits.** Drawings are capped at 32 MiB. Large PDFs get a lower resolution (a decoded-pixel budget keeps memory low), and when a drawing would get too big the import stops and says how many pages it imported. Password-protected PDFs are refused with a message.
- **Settings.** **Settings → Files** (PDF Import rows), or the `[pdf_import]` table in `config.toml`: `max_side` (longest side in pixels, default 1440), `format` (`jpeg` or `png`), `quality` (JPEG, default 0.85), `lock_pages` (default true), `warn_pages` (default 50) and `pixel_budget_mp` (default 60).

## Templates

A template is an ordinary `.excalidraw` file, so any drawing can become one, and a template can be opened and edited like any other drawing.

- **Vault templates** live in `Templates/` at the vault root. Change the folder in **Settings → Files → Templates Folder** (`files.templates_folder`). Like the other per-vault settings, it is stored in `<vault>/.excalidraw-vault/settings.toml` when set for that vault.
- **Global templates** live in `templates/` inside the config folder (`~/.config/vaultdraw/templates/` on macOS and Linux). All vaults share them.

To start a drawing from a template, use **New from template…** in the header, the button in an empty vault, or Cmd+Option+N (Ctrl+Alt+N on Windows and Linux). The picker has a search box with thumbnails for each template. Use the arrow keys to move and Enter to create the drawing. A new drawing gets fresh element ids, so it never shares ids with its template, and it keeps the template's canvas background.

To make a template, choose **Save as template…** in a drawing's ⋯ menu, then pick **This vault** or **All vaults**.

Templates are left out of the Recent list. They still appear in the navigator, where you can open and edit them.

## Repository layout

| Path | What it is |
| --- | --- |
| `excalidraw-desktop/` | The Vaultdraw desktop app (Tauri 2 + React) |
| `excalidraw-desktop/src-tauri/` | Rust backend: filesystem access, file watcher, recovery |
| `packages/excalidraw/` | The Excalidraw editor |
| `packages/{common,element,math,utils,fractional-indexing,laser-pointer}` | Editor building blocks |

## Development

Requires Node 18+, Yarn 1 and the [Rust/Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
yarn install
yarn start               # run the desktop app in dev mode
yarn desktop:build       # build the packaged app
yarn desktop:test        # desktop unit tests
yarn test:typecheck      # TypeScript
yarn test:app            # all unit tests (editor + desktop)
yarn --cwd excalidraw-desktop test:e2e   # Playwright browser tests
```

### Adding a command

Every feature registers its actions so they show in the palette and on the Hotkeys page:

1. Add an entry (metadata only: `id`, `title`, `category`, `keys`, `when`) to `COMMANDS` in `excalidraw-desktop/src/commands/commands.ts`, or to `editorCommands.ts` if the open editor owns it. Name choices `"Family: Choice"` so Tab can narrow to the family.
2. Bind the handler: app-shell actions in `useAppCommands.ts`; anything else with `registerCommandHandlers({ [id]: run })` while it is mounted.
3. Entries that depend on data (one per theme, pen, library item) are a provider: `registerPaletteProvider({ id, items: () => [...] })` from `src/palette/registry.ts`. `items()` runs only when commands mode opens.

## License and credits

Vaultdraw is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw) and is released under the MIT License. See [LICENSE](LICENSE). Vaultdraw is not affiliated with or endorsed by Excalidraw.
