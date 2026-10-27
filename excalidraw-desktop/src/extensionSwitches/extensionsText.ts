/**
 * Text for Settings → Extensions, loaded with that page only (the always-loaded
 * registry keeps just ids and titles).
 */
import type { ExtensionId } from "./registry";

export interface ExtensionText {
  description: string;
  /** What changes when it is off, if that is not obvious. */
  offNote?: string;
}

export const EXTENSION_TEXT: Record<ExtensionId, ExtensionText> = {
  search: {
    description:
      "Search inside drawings from the file tree and the palette. Off: file names only.",
  },
  links: {
    description:
      "[[Links]] between drawings: the links dock, autocomplete, link styling, hints and back/forward.",
    offNote:
      "Renaming still updates links while “Update links on rename” is on (Links settings).",
  },
  tags: {
    description:
      "#tags in text: the tags pane, tag chips, tag search and rename.",
  },
  graph: {
    description: "Graph view of the drawings and the links between them.",
  },
  library: {
    description:
      "The library sidebar, saved per vault, and inserting library items from the palette.",
  },
  templates: {
    description: "New drawing from a template, and saving a drawing as one.",
  },
  formula: {
    description:
      "Insert and edit LaTeX formulas as images, and render $…$ in notes.",
    offNote:
      "Existing formulas stay as images, they just can't be edited; notes show the TeX source.",
  },
  mermaid: {
    description: "Turn Mermaid diagram code into Excalidraw shapes.",
  },
  "pdf-import": {
    description: "Import PDF pages into a drawing as images.",
  },
  notes: {
    description:
      "Open Markdown notes (.md) in a tab: a reading view with [[links]], callouts and formulas, and a CodeMirror editor.",
    offNote:
      "Notes in the vault stay as files; a .md opens in your default app.",
  },
};
