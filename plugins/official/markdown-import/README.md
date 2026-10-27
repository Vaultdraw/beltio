# Markdown import

Turns a Markdown note into a page-mode drawing, and an Obsidian vault into a Vaultdraw vault. Official, bundled, on by default, and it loads only when you use it.

## Use it

| Do this | Result |
| --- | --- |
| Import file… (canvas menu or palette), pick a `.md` | `Note (imported).excalidraw` opens in page mode |
| Drop a `.md` on the canvas | the same; it never replaces the open drawing |
| Import: Markdown from clipboard | the clipboard text, as `Clipboard (imported).excalidraw` |
| Import Obsidian vault… | pick a vault folder; its notes become drawings in a folder of this vault |
| Import Obsidian vault into a new vault… | the same, into a new vault |

Long notes are split into parts of about 1,000 elements: `Note (imported, part 2).excalidraw`. Import: Cancel stops either import.

## Commands

Every command is in the palette (Cmd+P) and has no default key; bind them in `[hotkeys]`.

`Import: Markdown…`, `Import: Markdown from clipboard`, `Import: Markdown with the Document font`, `Markdown: Next heading`, `Markdown: Previous heading`, `Import: Show timings`, `Import Obsidian vault…`, `Import Obsidian vault into a new vault…`.

## Settings

`[plugin.markdown-import]` in `config.toml`, or Settings, Plugins. Changes apply to the next import.

| Key | Default | Meaning |
| --- | --- | --- |
| `font` | `default` | `default` (your drawing font) or `document` |
| `font_size` | `16` | body text size |
| `page_size` | `a4` | page size of the drawing |
| `part_elements` | `1000` | elements per drawing before a long note splits |
| `obsidian_attachments` | `true` | copy the images and files notes use |
| `obsidian_links` | `drawing` | `drawing` keeps `[[links]]` as links, `text` leaves plain text |
| `obsidian_excalidraw` | `true` | convert `.excalidraw.md` drawings |

## Turn it off

Remove `markdown-import` from `plugins.enabled` (Settings, Plugins), or set `enabled = []`. Setting `md = ""` under `plugins.importers` keeps the plugin but stops it claiming `.md` files.

## Build

`node build.mjs` writes `dist/` (the app build and the end-to-end build run it). The worker is bundled to a string and injected into `main.js`, because the app's content security policy allows a worker only from a `blob:` URL.
