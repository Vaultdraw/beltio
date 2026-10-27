# Mermaid

Mermaid diagram text to Excalidraw shapes. Official, bundled, on by default; it loads only when something calls it.

| Part | Where it lives |
| --- | --- |
| Mermaid to Excalidraw dialog, the More tools entry, the palette entry, pasting Mermaid text | the editor, shown while this plugin is on |
| `mermaid.to_drawing` method | this plugin (`vaultdraw plugin call mermaid to_drawing`, AI apps through MCP while AI is on) |
| the converter chunk | loads on first use, never at startup |

Turn it off in Settings, Extensions (`[extensions] mermaid = false`) or with `plugins.disabled`: the dialog, the menu entries, paste conversion and the method go away, and the converter never loads.

`to_drawing` takes `{ "text": "graph LR; A-->B", "path": "optional/new.excalidraw" }`. With `path` it creates that drawing; without it, it draws on the drawing on screen as one undo step.
