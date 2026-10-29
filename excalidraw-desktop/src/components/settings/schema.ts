/**
 * Every row in Settings, declared once. The sidebar, the pages and the
 * search all read this list; the controls themselves live in
 * `pages/*.tsx`, keyed by the same `id`.
 *
 * Pure data (no React) so tests and later phases (hotkeys, per-vault
 * settings) can import it without rendering anything.
 */

import { withoutShortcuts } from "../../commands/shortcutText";
import {
  HISTORY_SETTINGS_PAGES,
  HISTORY_SETTINGS_SCHEMA,
} from "../../history/historySettingsSchema";
import { SERVICES_SETTINGS_SCHEMA } from "../../services/servicesSettingsSchema";
import { TABS_SETTINGS_SCHEMA } from "../../tabs/tabsSettingsSchema";
import { LAYOUT_SETTINGS_SCHEMA } from "../../layout/layoutSettingsSchema";
import { WATCH_SETTINGS_SCHEMA } from "../../watch/watchSettingsSchema";
import { SPECULATIVE_SETTINGS_SCHEMA } from "../../speculative/speculativeSettingsSchema";
import { MEMORY_SETTINGS_SCHEMA } from "../../memory/memorySettingsSchema";
import { SYNC_SETTINGS_SCHEMA } from "../../sync/syncSettingsSchema";
import {
  STYLE_KEY_LABELS,
  TOOL_DEFAULT_TOOLS,
  TOOL_LABELS,
  TOOL_STYLE_KEYS,
  toolConfigKey,
} from "../../toolDefaults/toolStyles";

export type SettingsPageId =
  | "general"
  | "appearance"
  | "page"
  | "interface"
  | "drawing"
  | "tools"
  | "files"
  | "links"
  | "history"
  | "hotkeys"
  | "extensions"
  | "plugins"
  | "control"
  | "about";

export interface SettingsPage {
  id: SettingsPageId;
  label: string;
  /** Sidebar group heading: one of SETTINGS_GROUPS. */
  group: typeof SETTINGS_GROUPS[number];
  /** Short text shown above the page's settings. */
  intro?: string;
  /** data-testid of the page body (e2e). */
  testId?: string;
}

/**
 * Sidebar order. A page with no available settings is not shown; Hotkeys is
 * a custom page backed by the single "hotkeys-list" row.
 */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "general", label: "General", group: "App" },
  { id: "appearance", label: "Appearance", group: "App" },
  { id: "page", label: "Page", group: "App" },
  { id: "interface", label: "Interface", group: "App" },
  { id: "drawing", label: "Drawing", group: "App" },
  {
    id: "tools",
    label: "Tools",
    group: "App",
    intro: "Default style of each tool, your pens and the laser.",
    testId: "tool-defaults-page",
  },
  { id: "hotkeys", label: "Hotkeys", group: "App" },
  { id: "files", label: "Files", group: "Vault" },
  { id: "links", label: "Links", group: "Vault" },
  ...HISTORY_SETTINGS_PAGES,
  {
    id: "extensions",
    label: "Extensions",
    group: "Extensions",
    intro:
      "Built-in features you can turn off. Off means not loaded: no memory, no work. Changes apply at once.",
  },
  { id: "plugins", label: "Plugins", group: "Extensions" },
  { id: "control", label: "Control", group: "Advanced" },
  { id: "about", label: "About", group: "Advanced" },
];

/** Sidebar groups, in order (Obsidian's "Options" / "Core plugins"; VS Code's tree). */
export const SETTINGS_GROUPS = [
  "App",
  "Vault",
  "Extensions",
  "Advanced",
] as const;

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = "appearance";

/** Sections of the Tools page, in tab order: styled tools, then pen and laser. */
export const TOOLS_SECTIONS = [...TOOL_DEFAULT_TOOLS, "pen", "laser"] as const;
export type ToolsSection = typeof TOOLS_SECTIONS[number];

export const TOOLS_SECTION_LABELS: Record<ToolsSection, string> = {
  ...TOOL_LABELS,
  pen: "Pen",
  laser: "Laser",
};

/** Where Settings opens: a page, or one section of the Tools page. */
export type SettingsTarget = SettingsPageId | `tools:${ToolsSection}`;

export const parseSettingsTarget = (
  target: SettingsTarget,
): { page: SettingsPageId; section?: ToolsSection } => {
  const [page, section] = target.split(":") as [
    SettingsPageId,
    ToolsSection | undefined,
  ];
  return section ? { page, section } : { page };
};

export interface SettingSchema {
  id: string;
  page: SettingsPageId;
  label: string;
  /** Static description: shown on the row and matched by search. */
  description: string;
  /** Extra search terms (synonyms, config keys, old tab names). */
  keywords: readonly string[];
  /** Dotted config.toml key, when the setting is stored there. */
  configKey?: string;
  /** Can be overridden per vault (shows the "This vault" badge). */
  perVault?: boolean;
  /** Tools page section this row belongs to (search opens it there). */
  section?: ToolsSection;
  /** Section label shown above this row and the rows after it (page view). */
  heading?: string;
}

export const SETTINGS_SCHEMA: readonly SettingSchema[] = [
  // ---- General ----
  {
    id: "profile",
    page: "general",
    label: "Profile",
    description:
      "A profile is a folder of settings, keys and extensions layered over your config file. Switch, make, copy or delete one; the default is your plain config file.",
    keywords: ["profiles", "switch", "workspace", "config", "keys", "theme"],
  },
  {
    id: "backup",
    page: "general",
    label: "Backup",
    description:
      "Write a zip of this vault (drawings, notes, attachments) to a folder you pick, checked after writing. Restore puts a backup into a new folder and never overwrites anything. Schedule it in the backup section of your config file.",
    keywords: ["backup", "restore", "archive", "zip", "export"],
  },
  {
    id: "config-file",
    page: "general",
    label: "Config file",
    description:
      "Your config file is yours to edit by hand. What you change in Settings is saved apart and wins over it. Changes apply live.",
    keywords: [
      "config.toml",
      "overrides.toml",
      "toml",
      "reload",
      "open config folder",
      "file",
    ],
  },
  {
    id: "network-enabled",
    page: "general",
    label: "Network access",
    description:
      "Master switch. Off blocks every download. Vaultdraw never connects in the background; it only connects when you ask.",
    keywords: [
      "network",
      "internet",
      "offline",
      "online",
      "download",
      "privacy",
    ],
    configKey: "network.enabled",
    heading: "Network",
  },
  {
    id: "network-themes",
    page: "general",
    label: "Allow downloading themes",
    description:
      "Lets Install theme fetch a theme from the address or GitHub repo you give. Asked once, the first time you install one.",
    keywords: ["network", "theme", "download", "install", "consent", "allow"],
    configKey: "network.allow_themes",
  },
  {
    id: "network-plugins",
    page: "general",
    label: "Allow the community plugins list",
    description:
      "Lets Browse list and download community plugins. Asked once, the first time you open Browse.",
    keywords: [
      "network",
      "plugin",
      "extension",
      "browse",
      "download",
      "registry",
      "consent",
      "allow",
    ],
    configKey: "network.allow_plugins",
  },

  // ---- Appearance ----
  {
    id: "mode",
    page: "appearance",
    label: "Mode",
    description: "Light, dark, or follow macOS.",
    keywords: ["dark", "light", "system", "theme", "colour scheme", "color"],
    configKey: "appearance.mode",
    perVault: true,
  },
  {
    id: "sync-canvas",
    page: "appearance",
    label: "Sync canvas with theme",
    description:
      "Recolour the drawing background and default stroke to match the theme. On screen only: files and exports keep standard colours.",
    keywords: ["canvas", "colour", "color", "theme", "match"],
    configKey: "appearance.sync_canvas",
  },
  {
    id: "canvas-background",
    page: "appearance",
    label: "Default canvas background",
    description: "Background colour for new drawings.",
    keywords: ["canvas", "background", "colour", "color", "new drawing"],
    configKey: "appearance.canvas_background",
  },
  {
    id: "accent-colour",
    page: "appearance",
    label: "Accent",
    description:
      "Overrides the theme's primary colour. The first swatch is the theme's own.",
    keywords: ["accent", "colour", "color", "primary", "highlight", "brand"],
    configKey: "appearance.accent_color",
    perVault: true,
  },
  {
    id: "paper",
    page: "appearance",
    label: "Canvas pattern",
    description:
      "Background pattern drawn behind every drawing: grid, ruled lines, dots, graph or isometric. Each drawing can change it from the canvas menu.",
    keywords: [
      "paper",
      "grid",
      "lines",
      "ruled",
      "dots",
      "graph",
      "isometric",
      "notebook",
      "background",
      "pattern",
    ],
    configKey: "paper.style",
    perVault: true,
  },
  {
    id: "colour-theme",
    page: "appearance",
    label: "Colour theme",
    description:
      "Colours for the whole app. Every theme works in light and dark mode.",
    keywords: ["color", "theme", "palette", "noctalia", "skin"],
    configKey: "appearance.theme",
    perVault: true,
  },
  {
    id: "install-theme",
    page: "appearance",
    label: "Install themes",
    description:
      "Ten themes are built in. Browse the community themes, or download one from a URL or a GitHub repo, then update or remove them here.",
    keywords: [
      "theme",
      "install",
      "download",
      "github",
      "url",
      "update",
      "remove",
      "uninstall",
      "browse",
      "community",
      "repo",
      "palette",
    ],
  },
  {
    id: "themes-folder",
    page: "appearance",
    label: "Themes folder",
    description:
      "Drop Noctalia palettes (.json) here; they appear above automatically.",
    keywords: ["theme", "folder", "noctalia", "json", "custom", "import"],
  },
  {
    id: "css-snippets",
    page: "appearance",
    label: "CSS snippets",
    description:
      "Your own .css files from the snippets folder, applied after the theme. On screen only: files and exports are unchanged.",
    keywords: ["css", "snippet", "style", "custom", "stylesheet", "tweak"],
    configKey: "appearance.snippets",
  },
  {
    id: "theme-max-size",
    page: "appearance",
    label: "Largest theme file",
    description:
      "Downloads bigger than this are refused. Theme files are a few KiB.",
    keywords: ["theme", "install", "size", "limit", "kib", "download"],
    configKey: "themes.max_install_kb",
  },

  {
    id: "theme-previews",
    page: "appearance",
    label: "Theme preview images",
    description:
      "The theme browser downloads a small preview image for each theme you scroll to. Off shows colour swatches only.",
    keywords: ["theme", "browse", "preview", "image", "download"],
    configKey: "themes.previews",
  },
  {
    id: "theme-index-ttl",
    page: "appearance",
    label: "Refresh the themes list",
    description:
      "How long the theme browser keeps its list before fetching it again. 0 fetches every time it opens.",
    keywords: ["theme", "browse", "list", "cache", "refresh", "hours"],
    configKey: "themes.index_ttl_hours",
  },

  // ---- Page ----
  {
    id: "page-mode",
    page: "page",
    label: "Default mode for new drawings",
    description:
      "Normal is the infinite canvas; Pages simulates sheets of paper with vertical scrolling. Each drawing can switch from the canvas menu.",
    keywords: ["page", "pages", "paper", "canvas", "infinite", "new drawing"],
    configKey: "page.mode",
  },
  {
    id: "page-layout",
    page: "page",
    label: "Layout",
    description:
      "Continuous is one long page that grows downward; Separate pages are fixed-size sheets with a gap, and a new one is added at the end.",
    keywords: ["page", "continuous", "separate", "sheets", "roll", "scroll"],
    configKey: "page.layout",
  },
  {
    id: "page-size",
    page: "page",
    label: "Page size",
    description:
      "A3, A4, A5, B5, Letter, Legal, tablet and phone sizes, or a custom width and height in pixels.",
    keywords: [
      "page",
      "size",
      "a4",
      "a3",
      "a5",
      "b5",
      "letter",
      "legal",
      "tablet",
      "phone",
      "custom",
      "width",
      "height",
    ],
    configKey: "page.size",
  },
  {
    id: "page-orientation",
    page: "page",
    label: "Orientation",
    description: "Portrait or landscape pages.",
    keywords: ["page", "portrait", "landscape", "rotate"],
    configKey: "page.orientation",
  },
  {
    id: "page-paper-theme",
    page: "page",
    label: "Paper theme",
    description:
      "Normal is clean white paper; Old school is yellowed paper with blue lines and a red margin; Match current theme follows the app theme.",
    keywords: [
      "page",
      "paper",
      "theme",
      "old school",
      "cream",
      "yellow",
      "match",
    ],
    configKey: "page.paper_theme",
  },

  // ---- Interface ----
  {
    id: "interface-zoom",
    page: "interface",
    label: "Interface zoom",
    description:
      "Scales the whole window. Zoom in ({{key:view.zoomIn}}), zoom out ({{key:view.zoomOut}}) and reset ({{key:view.zoomReset}}) also work.",
    keywords: ["zoom", "scale", "magnify", "size", "cmd shift plus minus"],
    configKey: "interface.zoom",
  },
  {
    id: "show-tag-chips",
    page: "interface",
    label: "Show tag chips in the file tree",
    description: "Show a drawing's #tags as small chips after its name.",
    keywords: ["tag", "tags", "chip", "label", "navigator", "tree", "hashtag"],
    configKey: "interface.show_tag_chips",
  },
  {
    id: "notice-seconds",
    page: "interface",
    label: "Error notices stay for",
    description:
      "Seconds an error notice stays before it closes by itself. 0 keeps it until you dismiss it.",
    keywords: [
      "notice",
      "error",
      "toast",
      "alert",
      "message",
      "dismiss",
      "seconds",
    ],
    configKey: "interface.notice_seconds",
  },
  {
    id: "thumbnails",
    page: "interface",
    label: "Show drawing thumbnails",
    description:
      "Preview images of drawings on the home screen, in search results and in the palette.",
    keywords: ["thumbnail", "preview", "image", "gallery", "grid", "cache"],
    configKey: "interface.thumbnails",
  },
  {
    id: "activity-bar",
    page: "interface",
    label: "Activity bar",
    description:
      "Show the icon bar on the left edge for Library, History, Graph and other panels.",
    keywords: ["activity", "bar", "ribbon", "icons", "sidebar", "toolbar"],
    configKey: "interface.activity_bar",
    perVault: true,
  },
  {
    id: "activity-bar-entries",
    page: "interface",
    label: "Activity bar entries",
    description:
      "Choose which entries the activity bar shows and in what order. Hidden entries stay available in the command palette.",
    keywords: [
      "activity",
      "bar",
      "reorder",
      "hide",
      "order",
      "entries",
      "icons",
      "activity_bar_order",
      "activity_bar_hidden",
    ],
    configKey: "interface.activity_bar_order",
    perVault: true,
  },
  {
    id: "sort-order",
    page: "interface",
    label: "Navigator sort order",
    description: "How folders and drawings are ordered in the file navigator.",
    keywords: [
      "sort",
      "order",
      "name",
      "modified",
      "navigator",
      "files",
      "a-z",
    ],
    configKey: "navigator.sort",
    perVault: true,
  },

  // ---- Drawing ----
  {
    id: "font-family",
    page: "drawing",
    label: "Default font family",
    description: "Font used when typing text in new drawings.",
    keywords: ["font", "text", "typeface", "excalifont", "drawing defaults"],
    configKey: "editor.font_family",
  },
  {
    id: "font-size",
    page: "drawing",
    label: "Default font size",
    description: "Initial text size for new text elements.",
    keywords: ["font", "text", "size", "drawing defaults"],
    configKey: "editor.font_size",
  },
  {
    id: "stroke-color",
    page: "drawing",
    label: "Default stroke colour",
    description: "Colour of lines and shape outlines.",
    keywords: ["colour", "line", "outline", "stroke", "drawing defaults"],
    configKey: "editor.stroke_color",
  },
  {
    id: "background-fill",
    page: "drawing",
    label: "Default background fill",
    description: "Colour inside shapes.",
    keywords: ["colour", "fill", "background", "shape", "drawing defaults"],
    configKey: "editor.background_color",
  },
  {
    id: "fill-style",
    page: "drawing",
    label: "Default fill style",
    description: "Shading and texture pattern for shape backgrounds.",
    keywords: ["hachure", "cross-hatch", "solid", "fill", "drawing defaults"],
    configKey: "editor.fill_style",
  },
  {
    id: "stroke-width",
    page: "drawing",
    label: "Default stroke width",
    description: "Line thickness for shapes, lines, and arrows.",
    keywords: ["thickness", "line", "thin", "bold", "drawing defaults"],
    configKey: "editor.stroke_width",
  },
  {
    id: "roughness",
    page: "drawing",
    label: "Default roughness",
    description: "Hand-drawn sketch intensity.",
    keywords: ["sloppiness", "architect", "artist", "cartoonist", "sketch"],
    configKey: "editor.roughness",
  },
  {
    id: "markdown-typing",
    page: "drawing",
    heading: "Markdown",
    label: "Markdown mode in new drawings",
    description:
      "Type # and a space at the start of a line to make a heading. Each drawing can turn it on or off with the Markdown button at the bottom.",
    keywords: ["markdown", "heading", "title", "typing", "#", "obsidian"],
    configKey: "markdown.typing",
  },
  {
    id: "markdown-h1-size",
    page: "drawing",
    label: "Heading 1 size",
    description: "How much bigger than the text a heading 1 is.",
    keywords: ["markdown", "heading", "h1", "size", "font"],
    configKey: "markdown.h1_size",
  },
  {
    id: "markdown-h2-size",
    page: "drawing",
    label: "Heading 2 size",
    description: "How much bigger than the text a heading 2 is.",
    keywords: ["markdown", "heading", "h2", "size", "font"],
    configKey: "markdown.h2_size",
  },
  {
    id: "markdown-h3-size",
    page: "drawing",
    label: "Heading 3 size",
    description: "How much bigger than the text a heading 3 is.",
    keywords: ["markdown", "heading", "h3", "size", "font"],
    configKey: "markdown.h3_size",
  },
  {
    id: "markdown-h4-size",
    page: "drawing",
    label: "Heading 4 size",
    description: "How much bigger than the text a heading 4 is.",
    keywords: ["markdown", "heading", "h4", "size", "font"],
    configKey: "markdown.h4_size",
  },
  {
    id: "markdown-h5-size",
    page: "drawing",
    label: "Heading 5 size",
    description: "How much bigger than the text a heading 5 is.",
    keywords: ["markdown", "heading", "h5", "size", "font"],
    configKey: "markdown.h5_size",
  },
  {
    id: "markdown-h6-size",
    page: "drawing",
    label: "Heading 6 size",
    description: "How much bigger than the text a heading 6 is.",
    keywords: ["markdown", "heading", "h6", "size", "font"],
    configKey: "markdown.h6_size",
  },
  {
    id: "markdown-block-gap",
    page: "drawing",
    label: "Space below a heading",
    description:
      "Space between a heading and the text box Enter starts below it, in lines.",
    keywords: ["markdown", "heading", "gap", "spacing", "enter"],
    configKey: "markdown.block_gap",
  },

  // ---- Tools: pen and laser (page was "Pens & laser") ----
  {
    id: "pen-presets",
    page: "tools",
    section: "pen",
    label: "Pen presets",
    description:
      "Saved pens for freehand drawing. Select one from the pen bar, or with {{key:pen.select1}} to {{key:pen.select9}} (change these keys on the Hotkeys page).",
    keywords: [
      "pen",
      "pens",
      "highlighter",
      "marker",
      "brush",
      "pressure",
      "smoothing",
      "opacity",
      "freedraw",
      "Alt+1",
      "tools",
    ],
    configKey: "pens.presets",
  },
  {
    id: "laser-color",
    page: "tools",
    section: "laser",
    label: "Laser colour",
    description: "Colour of the laser pointer trail.",
    keywords: [
      "laser",
      "pointer",
      "trail",
      "presentation",
      "color",
      "colour",
      "pens & laser",
    ],
    configKey: "laser.color",
  },
  {
    id: "laser-size",
    page: "tools",
    section: "laser",
    label: "Laser size",
    description: "Thickness of the laser pointer trail in pixels.",
    keywords: ["laser", "pointer", "trail", "presentation", "thickness"],
    configKey: "laser.size",
  },
  {
    id: "laser-fade",
    page: "tools",
    section: "laser",
    label: "Laser fade time",
    description: "How long the laser trail takes to fade out, in milliseconds.",
    keywords: ["laser", "pointer", "trail", "presentation", "decay", "ms"],
    configKey: "laser.decay_ms",
  },
  {
    id: "laser-length",
    page: "tools",
    section: "laser",
    label: "Laser tail length",
    description: "Number of trail points over which the tail tapers off.",
    keywords: ["laser", "pointer", "trail", "presentation", "tail"],
    configKey: "laser.length",
  },

  // ---- Tools: default style per tool (page was "Tool defaults") ----
  ...TOOL_DEFAULT_TOOLS.map(
    (tool): SettingSchema => ({
      id: `tool-${tool}`,
      page: "tools",
      section: tool,
      label: TOOL_LABELS[tool],
      description: `Default style for new ${TOOL_LABELS[
        tool
      ].toLowerCase()} elements.`,
      keywords: [
        tool,
        "tool",
        "tools",
        "tool defaults",
        "default style",
        "style",
        "stroke",
        "colour",
        "color",
        // Every key's label and config name ("sloppiness", "stroke_width").
        ...TOOL_STYLE_KEYS[tool].flatMap((key) => [
          STYLE_KEY_LABELS[key].toLowerCase(),
          key,
        ]),
        ...(tool === "arrow" ? ["arrowhead", "arrow type", "elbow"] : []),
        ...(tool === "text" ? ["font", "font size", "align"] : []),
      ],
      configKey: toolConfigKey(tool),
      perVault: true,
    }),
  ),

  // ---- Files ----
  {
    id: "vault-folder",
    page: "files",
    label: "Vault folder",
    description: "Where this vault lives on disk.",
    keywords: ["vault", "folder", "path", "reveal", "storage", "location"],
  },
  {
    id: "autosave",
    page: "files",
    label: "Autosave delay",
    description:
      "Wait this long after the last edit before writing to disk. Writes are atomic.",
    keywords: ["save", "autosave", "delay", "debounce", "ms", "storage"],
    configKey: "saving.autosave_delay_ms",
  },
  {
    id: "confirm-delete",
    page: "files",
    label: "Confirm before trashing",
    description: "Ask before moving a drawing or folder to the Trash.",
    keywords: ["delete", "trash", "confirm", "ask", "dialog"],
    configKey: "files.confirm_delete",
  },
  {
    id: "new-drawing-folder",
    page: "files",
    label: "New drawings go to",
    description: "Leave empty to create next to the open drawing.",
    keywords: ["default folder", "location", "new drawing", "inbox", "folder"],
    configKey: "files.new_drawing_folder",
    perVault: true,
  },
  {
    id: "templates-folder",
    page: "files",
    label: "Templates folder",
    description:
      "Vault-level templates. Global ones live in the config folder.",
    keywords: ["templates", "template", "folder", "location"],
    configKey: "files.templates_folder",
    perVault: true,
  },
  {
    id: "pdf-max-side",
    page: "files",
    label: "PDF import resolution",
    description:
      "Longest side, in pixels, of an imported PDF page. Large imports are lowered automatically to stay within the pixel budget.",
    keywords: ["pdf", "import", "resolution", "size", "pixels", "quality"],
    configKey: "pdf_import.max_side",
  },
  {
    id: "pdf-format",
    page: "files",
    label: "PDF import image format",
    description:
      "JPEG is much smaller; PNG is lossless but uses far more of the drawing size limit.",
    keywords: ["pdf", "import", "jpeg", "png", "format", "image"],
    configKey: "pdf_import.format",
  },
  {
    id: "pdf-quality",
    page: "files",
    label: "PDF import JPEG quality",
    description: "JPEG quality for imported pages (0.5 to 1).",
    keywords: ["pdf", "import", "jpeg", "quality", "compression"],
    configKey: "pdf_import.quality",
  },
  {
    id: "pdf-lock-pages",
    page: "files",
    label: "Lock imported PDF pages",
    description:
      "Lock pages so annotating does not drag them. Right-click the canvas and choose Unlock all to edit them.",
    keywords: ["pdf", "import", "lock", "pages", "annotate"],
    configKey: "pdf_import.lock_pages",
  },
  {
    id: "pdf-warn-pages",
    page: "files",
    label: "PDF page count warning",
    description: "Warn before importing a PDF with more pages than this.",
    keywords: ["pdf", "import", "warn", "pages", "limit"],
    configKey: "pdf_import.warn_pages",
  },
  {
    id: "pdf-pixel-budget",
    page: "files",
    label: "PDF import pixel budget",
    description:
      "Total megapixels one import may decode (memory use). Lower it on low-memory machines.",
    keywords: ["pdf", "import", "memory", "budget", "megapixels"],
    configKey: "pdf_import.pixel_budget_mp",
  },

  {
    id: "recovery-store",
    page: "files",
    heading: "Recovery",
    label: "Crash recovery store",
    description:
      "If a save fails, a copy of the drawing is kept here and offered on the next launch.",
    keywords: ["recovery", "crash", "backup", "restore", "snapshot", "reveal"],
  },
  {
    id: "settings-file",
    page: "files",
    heading: "Recovery",
    label: "Settings file",
    description:
      "Every setting is a key in a plain text file you can edit by hand.",
    keywords: [
      "config.toml",
      "toml",
      "settings file",
      "reveal",
      "edit by hand",
    ],
  },

  // ---- Links ----
  {
    id: "link-format",
    page: "links",
    label: "New link format",
    description:
      "How a link to another drawing is written: the shortest unique name, a path relative to this drawing, or the full path from the vault root.",
    keywords: [
      "wikilink",
      "path",
      "shortest",
      "relative",
      "absolute",
      "format",
    ],
    configKey: "links.new_link_format",
  },
  {
    id: "link-shape-format",
    page: "links",
    label: "Shape link format",
    description:
      "How a link on a shape is stored: [[Name]] (works with Obsidian) or a vaultdraw:// URL (opens in other Excalidraw apps).",
    keywords: ["wikilink", "url", "vaultdraw", "obsidian", "element link"],
    configKey: "links.shape_link_format",
  },
  {
    id: "link-open-modifier",
    page: "links",
    label: "Open link modifier",
    description:
      "Key to hold while clicking a link to open the drawing it points to.",
    keywords: ["click", "modifier", "cmd", "ctrl", "alt", "shift", "mod"],
    configKey: "links.open_modifier",
  },
  {
    id: "link-update-on-rename",
    page: "links",
    label: "Update links on rename",
    description:
      "When a drawing is renamed or moved, rewrite the links that point to it: always, never, or ask each time.",
    keywords: [
      "rename",
      "move",
      "rewrite",
      "automatically",
      "ask",
      "internal links",
    ],
    configKey: "links.update_on_rename",
  },
  {
    id: "link-autocomplete",
    page: "links",
    label: "Link suggestions",
    description: "Suggest drawings while you type [[ in a text element.",
    keywords: ["autocomplete", "suggest", "popup", "wikilink", "[["],
    configKey: "links.autocomplete",
  },
  {
    id: "link-hint-chars",
    page: "links",
    label: "Hint characters",
    description:
      "Letters used for link hints (Vim style). At least 2 different lowercase characters, no spaces.",
    keywords: ["hint", "vimium", "keys", "letters", "alphabet", "keyboard"],
    configKey: "links.hint_chars",
  },
  {
    id: "link-style",
    page: "links",
    label: "Style links in text",
    description:
      "Draw links in text elements with the link colour and an underline. Brackets are dimmed, unresolved links are fainter with a dashed underline.",
    keywords: ["color", "colour", "underline", "highlight", "wikilink", "[["],
    configKey: "links.style_links",
  },
  {
    id: "link-color",
    page: "links",
    label: "Link colour",
    description:
      "Colour of styled links: the theme accent, or a fixed colour that follows dark mode like any stroke.",
    keywords: ["color", "accent", "theme", "hex", "custom"],
    configKey: "links.color",
  },
  {
    id: "link-hover-preview",
    page: "links",
    label: "Hover preview",
    description:
      "Show a preview card of the linked drawing when you hover a link: always, only while holding the open modifier, or never.",
    keywords: ["preview", "hover", "card", "popup", "thumbnail", "tooltip"],
    configKey: "links.hover_preview",
  },

  // ---- Tags (shares the Links page) ----
  {
    id: "tags-autocomplete",
    page: "links",
    label: "Tag suggestions",
    description: "Suggest existing tags while you type # in a text element.",
    keywords: ["tag", "hashtag", "autocomplete", "suggest", "popup", "#"],
    configKey: "tags.autocomplete",
  },
  {
    id: "tags-pane-sort",
    page: "links",
    label: "Tags pane order",
    description:
      "Default order of the Tags pane: by name or by number of drawings. Each vault can switch it from the pane.",
    keywords: ["tag", "sort", "order", "count", "name", "pane"],
    configKey: "tags.pane_sort",
  },

  ...HISTORY_SETTINGS_SCHEMA,
  ...TABS_SETTINGS_SCHEMA,
  ...LAYOUT_SETTINGS_SCHEMA,
  ...MEMORY_SETTINGS_SCHEMA,
  ...SYNC_SETTINGS_SCHEMA,
  ...SERVICES_SETTINGS_SCHEMA,
  ...SPECULATIVE_SETTINGS_SCHEMA,
  ...WATCH_SETTINGS_SCHEMA,

  // ---- Hotkeys ----
  {
    id: "hotkeys-list",
    page: "hotkeys",
    label: "Hotkeys",
    description:
      "Assign keyboard shortcuts to commands; changes are saved to your config file.",
    keywords: ["shortcuts", "keyboard", "keybindings", "keys", "commands"],
  },

  // ---- Extensions ----
  {
    id: "extensions-list",
    page: "extensions",
    label: "Built-in extensions",
    description:
      "Turn search, links, tags, graph view, library, templates, history, thumbnails, formulas, Mermaid and PDF import on or off. Saved in your config file.",
    keywords: [
      "extension",
      "feature",
      "disable",
      "turn off",
      "minimal",
      "safe start",
      "graph",
      "formula",
      "mermaid",
      "pdf",
      "library",
      "templates",
      "tags",
      "search",
      "links",
    ],
  },

  // ---- Plugins ----
  {
    id: "plugins-installed",
    page: "plugins",
    label: "Installed plugins",
    description:
      "Turn plugins on or off, install one from a folder, and edit the settings they declare.",
    keywords: [
      "plugin",
      "extension",
      "install",
      "uninstall",
      "safe mode",
      "addon",
    ],
    perVault: true,
  },

  // ---- Control ----
  {
    id: "ai-enabled",
    page: "control",
    label: "AI",
    description:
      "Off keeps your device fully offline. On lets an AI app you connect read and edit your drawings.",
    keywords: ["ai", "assistant", "agent", "llm", "mcp", "offline", "privacy"],
    configKey: "ai.enabled",
  },
  {
    id: "ai-mcp-enabled",
    page: "control",
    label: "AI tools interface (MCP)",
    description:
      "Lets AI apps connect through the MCP tools interface. Only applies while AI is on.",
    keywords: ["mcp", "model context protocol", "tools", "ai", "agent"],
    configKey: "ai.mcp_enabled",
  },
  {
    id: "control-notify-edits",
    page: "control",
    label: "Edit notices",
    description: "Show a notice when a script or AI tool edits the drawing.",
    keywords: ["notify", "notice", "toast", "script", "ai", "edit", "control"],
    configKey: "control.notify_edits",
  },

  // ---- Hang watchdog (Interface) ----
  {
    id: "watchdog-enabled",
    page: "interface",
    label: "Hang watchdog",
    description:
      "Show a Wait / Quit dialog when the page stops answering (macOS).",
    keywords: [
      "hang",
      "freeze",
      "frozen",
      "not responding",
      "watchdog",
      "quit",
    ],
    configKey: "watchdog.enabled",
  },
  {
    id: "watchdog-grace",
    page: "interface",
    label: "Hang watchdog delay",
    description:
      "How long the page must stay unresponsive, after WebKit's own 3 s, before the dialog appears.",
    keywords: [
      "hang",
      "freeze",
      "not responding",
      "watchdog",
      "delay",
      "grace",
    ],
    configKey: "watchdog.grace_ms",
  },

  // ---- Window title bar (Interface, Linux) ----
  {
    id: "window-decorations",
    page: "interface",
    label: "Window title bar",
    description:
      "Linux only. Custom: one bar, the app header carries minimize, maximize and close. Native: the system title bar above the app header. Applies after a restart.",
    keywords: [
      "title bar",
      "titlebar",
      "decorations",
      "window",
      "chrome",
      "linux",
      "minimize",
      "maximize",
      "close",
    ],
    configKey: "window.decorations",
  },

  // ---- About ----
  {
    id: "about-info",
    page: "about",
    label: "About Vaultdraw",
    description:
      "Version, website, documentation, bug reports and source code.",
    keywords: [
      "version",
      "help",
      "website",
      "docs",
      "documentation",
      "bug",
      "feature request",
      "issues",
      "updates",
      "changelog",
      "license",
      "source",
    ],
  },
];

const BY_ID = new Map(SETTINGS_SCHEMA.map((s) => [s.id, s]));

export const getSettingSchema = (id: string): SettingSchema => {
  const schema = BY_ID.get(id);
  if (!schema) {
    throw new Error(`Unknown setting "${id}"`);
  }
  return schema;
};

export const getPage = (id: SettingsPageId): SettingsPage =>
  SETTINGS_PAGES.find((p) => p.id === id)!;

export const settingsForPage = (
  page: SettingsPageId,
  schema: readonly SettingSchema[] = SETTINGS_SCHEMA,
): SettingSchema[] => schema.filter((s) => s.page === page);

const haystack = (s: SettingSchema) =>
  [s.label, withoutShortcuts(s.description), ...s.keywords, s.configKey ?? ""]
    .join("\n")
    .toLocaleLowerCase();

/**
 * Settings whose label, description, keywords or config key contain every
 * word of the query (case-insensitive). Empty query -> no results.
 * Results keep schema order, which is page order then row order.
 */
export const searchSettings = (
  query: string,
  schema: readonly SettingSchema[] = SETTINGS_SCHEMA,
): SettingSchema[] => {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }
  return schema.filter((s) => {
    const text = haystack(s);
    return words.every((w) => text.includes(w));
  });
};

/** Search results grouped by page, in sidebar order. */
export const groupByPage = (
  results: readonly SettingSchema[],
): { page: SettingsPage; settings: SettingSchema[] }[] =>
  SETTINGS_PAGES.map((page) => ({
    page,
    settings: results.filter((s) => s.page === page.id),
  })).filter((g) => g.settings.length > 0);
