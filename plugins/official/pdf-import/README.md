# PDF import

Import the pages of a PDF as pictures in the open drawing. Official, bundled, on by default, and it loads only when you import.

| Do this | Result |
| --- | --- |
| Palette, **Import: PDF…** | pick a file, choose the pages, import |
| Drop a PDF on the canvas, or **Import file…** | the same dialog |

The pages go in as locked pictures, below the content (or on the next pages in page mode), as one undo step. The page range (`all`, or `1-5, 8, 10-`), the resolution, format, quality, page warning and pixel budget come from `[pdf_import]` in `config.toml`. Rendering is native (PDFKit on macOS, poppler on Linux), so the plugin holds no renderer.

Turn it off in Settings, Extensions (`[extensions] pdf-import = false`): the command, the picker entry and the code go away. Drawings that already hold imported pages are unaffected: they are plain pictures.
