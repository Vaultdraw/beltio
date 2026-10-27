/**
 * Built-in extensions: optional features that ship with the app and can be
 * turned off under `[extensions]` in config.toml. Off means not created: the
 * feature's hooks register no handler, listener or timer, its hosts are not
 * mounted, and its commands are not offered (no handler = not offered).
 *
 * Pure data, always loaded (a few hundred bytes). Longer text for the
 * Settings page lives in `extensionsText.ts`, loaded with that page.
 *
 * History and thumbnails have switches already (`history.enabled`,
 * `interface.thumbnails`); they are shown on the page but have no key here.
 * Ids use the plugin id grammar and are reserved for official use.
 */

export const EXTENSION_IDS = [
  "search",
  "links",
  "tags",
  "graph",
  "library",
  "templates",
  "formula",
  "mermaid",
  "pdf-import",
  "notes",
] as const;

export type ExtensionId = typeof EXTENSION_IDS[number];

/** The preference field that stores each switch. */
export const EXTENSION_FIELDS = {
  search: "extSearch",
  links: "extLinks",
  tags: "extTags",
  graph: "extGraph",
  library: "extLibrary",
  templates: "extTemplates",
  formula: "extFormula",
  mermaid: "extMermaid",
  "pdf-import": "extPdfImport",
  notes: "extNotes",
} as const;

export type ExtensionField = typeof EXTENSION_FIELDS[ExtensionId];

export interface BuiltinExtension {
  id: ExtensionId;
  /** Shown in the palette ("Extensions: Toggle <title>") and on the page. */
  title: string;
  /** "builtin" = core workflow; "official" = optional extra that ships with the app. */
  kind: "builtin" | "official";
  defaultOn: boolean;
}

export const BUILTIN_EXTENSIONS: readonly BuiltinExtension[] = [
  { id: "search", title: "Full-text search", kind: "builtin", defaultOn: true },
  { id: "links", title: "Links", kind: "builtin", defaultOn: true },
  { id: "tags", title: "Tags", kind: "builtin", defaultOn: true },
  { id: "graph", title: "Graph view", kind: "builtin", defaultOn: true },
  { id: "library", title: "Library", kind: "builtin", defaultOn: true },
  { id: "templates", title: "Templates", kind: "builtin", defaultOn: true },
  // Owner, 2026-10-24: the official extras stay on by default (no change for 0.1.x users).
  { id: "formula", title: "Formulas", kind: "official", defaultOn: true },
  {
    id: "mermaid",
    title: "Mermaid to Excalidraw",
    kind: "official",
    defaultOn: true,
  },
  { id: "pdf-import", title: "PDF import", kind: "official", defaultOn: true },
  { id: "notes", title: "Markdown notes", kind: "official", defaultOn: true },
];

export const isExtensionId = (v: unknown): v is ExtensionId =>
  typeof v === "string" && (EXTENSION_IDS as readonly string[]).includes(v);

export const extensionInfo = (id: ExtensionId): BuiltinExtension =>
  BUILTIN_EXTENSIONS.find((e) => e.id === id)!;
