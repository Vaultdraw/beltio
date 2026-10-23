/**
 * Documentation of every config.toml key, joined with CONFIG_MAPPING (what is
 * accepted), DEFAULT_PREFERENCES (defaults) and PER_VAULT_FIELDS to generate
 * the "Every key" section of docs/configuration.md
 * (scripts/gen-config-reference.ts). configReference.test.ts fails when a
 * mapping key has no entry here or the doc is stale.
 *
 * Only the generator and the tests import this module: the app bundle does
 * not carry these strings.
 */
import { TOOL_STYLE_KEYS, type StyledTool } from "../toolDefaults/toolStyles";

import type { ConfigMapping } from "./settingsSync";

export interface KeyDoc {
  /** What the key does, one sentence. */
  doc: string;
  /** Replaces the rendered default (long or structured defaults). */
  default?: string;
  /** Replaces the mapping's `expected` text (when it is computed). */
  accepts?: string;
}

export interface TableDoc {
  table: string;
  /** One line under the table heading. */
  intro: string;
  keys: Readonly<Record<string, KeyDoc>>;
}

const tool = (name: StyledTool): KeyDoc => ({
  doc: `Default style of the ${name} tool. Only the keys you set apply; the others keep the editor's current style.`,
  default: "unset",
  accepts: `a table with any of ${TOOL_STYLE_KEYS[name]
    .map((k) => `\`${k}\``)
    .join(", ")}`,
});

export const CONFIG_REFERENCE: readonly TableDoc[] = [
  {
    table: "appearance",
    intro: "Theme, light or dark mode, and canvas colours.",
    keys: {
      theme: { doc: "Colour theme: a built-in name or a theme in `themes/`." },
      mode: { doc: "Light, dark, or follow the system." },
      sync_canvas: {
        doc: "The canvas background, pencil and palette colours follow the theme.",
      },
      canvas_background: {
        doc: "Canvas background for new drawings when `sync_canvas` is off.",
      },
      accent_color: {
        doc: "Replaces the theme's primary colour, nudged for contrast; empty uses the theme's own.",
      },
    },
  },
  {
    table: "editor",
    intro: "Defaults for new elements.",
    keys: {
      font_family: {
        doc: "Font of new text: 1 Virgil, 2 Helvetica, 3 Cascadia, 5 Excalifont, 6 Nunito, 7 Lilita One, 8 Comic Shanns, 9 Liberation Sans, 10 Assistant.",
      },
      font_size: { doc: "Font size of new text." },
      stroke_color: { doc: "Stroke colour of new elements." },
      background_color: { doc: "Fill colour of new elements." },
      fill_style: { doc: "Fill pattern of new elements." },
      stroke_width: { doc: "Stroke width of new elements." },
      roughness: { doc: "0 architect, 1 artist, 2 cartoonist." },
    },
  },
  {
    table: "paper",
    intro:
      "Paper for new drawings; each drawing can change it from the canvas menu. See [Notebook backgrounds](#notebook-backgrounds).",
    keys: {
      style: { doc: "Background pattern." },
      spacing: { doc: "Distance between lines or dots." },
      color: { doc: "Pattern colour." },
      opacity: { doc: "Pattern opacity." },
      major_every: {
        doc: "Grid and graph: a stronger line every N lines.",
      },
      margin_line: { doc: "Ruled lines: draw the margin line." },
    },
  },
  {
    table: "page",
    intro:
      "Page mode for new drawings: simulated pages instead of the infinite canvas. See [Page mode](#page-mode).",
    keys: {
      mode: { doc: "Infinite canvas or pages." },
      layout: {
        doc: "Separate sheets with a gap, or one long continuous page.",
      },
      size: { doc: "Page size; `custom` uses `width` and `height`." },
      orientation: { doc: "Page orientation." },
      width: { doc: "Custom page width in pixels." },
      height: { doc: "Custom page height in pixels." },
      paper_theme: {
        doc: "Page colours: normal, old school, or match the current theme.",
      },
    },
  },
  {
    table: "pdf_import",
    intro: "Importing PDF pages as images. See [PDF import](#pdf-import).",
    keys: {
      max_side: { doc: "Longest side of each page image in pixels." },
      format: { doc: "Image format of imported pages." },
      quality: { doc: "JPEG quality." },
      lock_pages: {
        doc: "Lock imported pages so annotating does not drag them.",
      },
      warn_pages: { doc: "Ask before importing more pages than this." },
      pixel_budget_mp: {
        doc: "Decoded-pixel budget per import; large PDFs get a lower resolution.",
      },
    },
  },
  {
    table: "saving",
    intro: "Writing drawings to disk.",
    keys: {
      autosave_delay_ms: {
        doc: "Idle time in milliseconds before an edit is written to disk.",
      },
    },
  },
  {
    table: "interface",
    intro: "The app window around the canvas.",
    keys: {
      zoom: {
        doc: "Whole-app zoom in percent (Cmd/Ctrl+Shift `+`, `-`, `0`).",
      },
      show_tag_chips: {
        doc: "Show a drawing's tags as chips in the file navigator.",
      },
      thumbnails: {
        doc: "Show drawing thumbnails (home, search, palette, gallery).",
      },
      activity_bar: { doc: "Show the activity bar." },
      activity_bar_order: {
        doc: "Activity bar entry order: `library`, `history`, `graph`, `gallery`, `search`, `tags`, `templates`, `hotkeys`, `settings`; unlisted entries follow in their default order.",
      },
      activity_bar_hidden: { doc: "Activity bar entries to hide." },
    },
  },
  {
    table: "navigator",
    intro: "The file tree.",
    keys: {
      sort: {
        doc: "Sort order; folders always come first, names compare by number.",
      },
    },
  },
  {
    table: "files",
    intro: "Creating and deleting drawings.",
    keys: {
      confirm_delete: { doc: "Ask before moving a drawing to the Trash." },
      new_drawing_folder: {
        doc: "Folder for new drawings, relative to the vault root; empty puts them next to the open drawing.",
      },
      templates_folder: {
        doc: "Vault folder holding your templates. See [Templates](#templates).",
      },
    },
  },
  {
    table: "links",
    intro:
      "`[[links]]` between drawings. See [Links and backlinks](#links-and-backlinks).",
    keys: {
      new_link_format: { doc: "How new `[[links]]` are written." },
      shape_link_format: { doc: "Link stored on a shape." },
      open_modifier: { doc: "Modifier that opens a link on click." },
      update_on_rename: {
        doc: 'Rewrite links when a drawing is renamed or moved; `"ask"` asks each time.',
      },
      autocomplete: { doc: "Suggest drawings while typing `[[`." },
      hint_chars: { doc: "Letters used by link hint mode." },
      style_links: {
        doc: "Draw `[[links]]` in text with the link colour and an underline.",
      },
      color: { doc: "Link colour; `accent` uses the theme accent." },
      hover_preview: { doc: "When the hover preview card shows." },
    },
  },
  {
    table: "tags",
    intro: "`#tags` in drawing text.",
    keys: {
      autocomplete: { doc: "Suggest existing tags while typing `#`." },
      pane_sort: { doc: "Order of the Tags pane: by name or by use count." },
    },
  },
  {
    table: "pens",
    intro: "Saved pens of the freedraw tool (Alt+1 to Alt+9 by default).",
    keys: {
      presets: {
        doc: "The saved pens, in order. `width` 0.5 thin, 1 medium, 2 bold, about 10 highlighter; `smoothing` 0 (raw) to 1; `highlighter` draws behind everything.",
        default: "the built-in pens",
        accepts:
          'a list of tables like `{ name = "Fine liner", color = "#1e1e1e", width = 0.5, opacity = 100, pressure = false, smoothing = 0.3, highlighter = false }`',
      },
    },
  },
  {
    table: "laser",
    intro: "The laser pointer trail.",
    keys: {
      color: { doc: "Trail colour." },
      size: { doc: "Trail thickness in pixels." },
      decay_ms: { doc: "Time until the trail fades, in milliseconds." },
      length: { doc: "Tail length in points." },
    },
  },
  {
    table: "tools",
    intro:
      "Default style per drawing tool, one `[tools.<tool>]` table each. See [Tool defaults](#tool-defaults).",
    keys: {
      rectangle: tool("rectangle"),
      diamond: tool("diamond"),
      ellipse: tool("ellipse"),
      arrow: tool("arrow"),
      line: tool("line"),
      text: tool("text"),
    },
  },
  {
    table: "tabs",
    intro: "Several drawings open at once.",
    keys: {
      enabled: {
        doc: "Open several drawings at once; `false` is one drawing at a time.",
      },
      show_strip: {
        doc: "Show the tab strip; `never` switches tabs with the keyboard only.",
      },
      open_from_navigator: {
        doc: "Opening from the file tree replaces the open drawing (`current`) or opens a new tab.",
      },
      focus_new: { doc: "Switch to a drawing opened in a new tab." },
      new_tab_position: { doc: "Where a new tab goes." },
      ctrl_tab: {
        doc: "Ctrl+Tab order: last used (`mru`) or strip order.",
      },
      close_pinned: { doc: "Allow Cmd/Ctrl+W to close pinned tabs." },
      restore: { doc: "Reopen the open tabs when a vault opens." },
      undo_budget_mb: {
        doc: "Undo history kept for background tabs, in megabytes.",
      },
    },
  },
  {
    table: "history",
    intro:
      "Version history of each drawing, kept in the vault. Older versions thin out: every version, then hourly, daily and weekly ones.",
    keys: {
      enabled: { doc: "Make versions at all; `false` turns history off." },
      interval_minutes: { doc: "Minutes between timed versions." },
      keep_all_hours: { doc: "Keep every version for this many hours." },
      keep_hourly_hours: {
        doc: "Then keep one version per hour for this many hours.",
      },
      keep_daily_days: {
        doc: "Then keep one version per day for this many days.",
      },
      keep_weekly_weeks: {
        doc: "Then keep one version per week for this many weeks.",
      },
      size_cap_mb: {
        doc: "Size cap of a vault's history in megabytes; the oldest versions go first.",
      },
      highlight_changes: {
        doc: "Highlight what changed in the History preview.",
      },
    },
  },
  {
    table: "plugins",
    intro: "Plugins in the `plugins/` folder of the config folder.",
    keys: {
      enabled: { doc: "Ids of the plugins to load." },
    },
  },
];

const PER_VAULT_NOTE =
  "**Per vault** keys can also be set in `<vault>/.excalidraw-vault/settings.toml` (see [Per-vault settings](#per-vault-settings)).";

export const BEGIN_MARKER =
  "<!-- BEGIN GENERATED: config keys (edit excalidraw-desktop/src/vault/configReference.ts, then run yarn docs:config in excalidraw-desktop) -->";
export const END_MARKER = "<!-- END GENERATED: config keys -->";

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** A default as TOML: strings quoted, lists inline. */
export const tomlValue = (value: unknown): string =>
  typeof value === "string"
    ? JSON.stringify(value)
    : Array.isArray(value)
    ? `[${value.map(tomlValue).join(", ")}]`
    : String(value);

const code = (text: string) =>
  text.includes("`") ? text : `\`${text.replace(/\|/g, "\\|")}\``;

export interface RenderInput {
  mappings: readonly Pick<ConfigMapping, "key" | "field" | "expected">[];
  defaults: Readonly<Record<string, unknown>>;
  perVaultFields: readonly string[];
}

/** Keys in the mapping table with no doc, and docs with no mapping. */
export function referenceGaps({ mappings }: Pick<RenderInput, "mappings">): {
  undocumented: string[];
  unknown: string[];
} {
  const documented = new Set(
    CONFIG_REFERENCE.flatMap((t) =>
      Object.keys(t.keys).map((k) => `${t.table}.${k}`),
    ),
  );
  const mapped = new Set(mappings.map((m) => m.key));
  return {
    undocumented: [...mapped].filter((k) => !documented.has(k)),
    unknown: [...documented].filter((k) => !mapped.has(k)),
  };
}

/** The generated Markdown between the markers (markers included). */
export function renderConfigReference(input: RenderInput): string {
  const byKey = new Map(input.mappings.map((m) => [m.key, m]));
  const perVault = new Set(input.perVaultFields);
  const out = [
    BEGIN_MARKER,
    "",
    "## Every key",
    "",
    `Every \`config.toml\` key, generated from the app's key table, so this list is always complete. ${PER_VAULT_NOTE} A key not listed here is reported as unknown and ignored.`,
    "",
  ];
  for (const table of CONFIG_REFERENCE) {
    out.push(`### \`[${table.table}]\``, "", table.intro, "");
    out.push("| Key | Default | Accepts | Per vault | What it does |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const [name, doc] of Object.entries(table.keys)) {
      const mapping = byKey.get(`${table.table}.${name}`);
      if (!mapping) {
        throw new Error(`No config mapping for ${table.table}.${name}`);
      }
      const accepts =
        doc.accepts ??
        (typeof mapping.expected === "string" ? mapping.expected : "");
      const fallback =
        doc.default ?? tomlValue(input.defaults[mapping.field as string]);
      out.push(
        `| ${code(name)} | ${
          doc.default ? cell(fallback) : code(fallback)
        } | ${cell(accepts)} | ${
          perVault.has(mapping.field) ? "yes" : ""
        } | ${cell(doc.doc)} |`,
      );
    }
    out.push("");
  }
  out.push(
    "### `[hotkeys]` and `[plugin.<id>]`",
    "",
    "Open tables: `[hotkeys]` takes one entry per command id (see [The `[hotkeys]` table](#the-hotkeys-table)), and `[plugin.<id>]` holds the settings a plugin declares. Their keys are not checked against this list.",
    "",
    END_MARKER,
  );
  return out.join("\n");
}

/** Replaces the generated block in `doc`; throws if the markers are missing. */
export function spliceReference(doc: string, block: string): string {
  const start = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start < 0 || end < start) {
    throw new Error("docs/configuration.md has no generated-block markers");
  }
  return doc.slice(0, start) + block + doc.slice(end + END_MARKER.length);
}
