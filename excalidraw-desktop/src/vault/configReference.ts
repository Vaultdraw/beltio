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
      snippets: {
        doc: "CSS snippets to apply, by file name in `snippets/` without `.css`, in this order. See [CSS snippets](#css-snippets).",
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
      thumbnail_max_elements: {
        doc: "Biggest drawing (in elements) that gets a thumbnail.",
      },
      thumbnail_cache_mb: {
        doc: "Size cap of a vault's thumbnail cache on disk, in megabytes; the oldest thumbnails go first. Applies at the next thumbnail saved.",
      },
      defer_home_pane: {
        doc: "When a vault opens, paint the file tree first and the home pane one frame later, in the same place; `false` draws both together.",
      },
      activity_bar: { doc: "Show the activity bar." },
      activity_bar_order: {
        doc: "Activity bar entry order: `library`, `history`, `graph`, `gallery`, `search`, `tags`, `templates`, `hotkeys`, `settings`; unlisted entries follow in their default order.",
      },
      activity_bar_hidden: { doc: "Activity bar entries to hide." },
    },
  },
  {
    table: "library",
    intro:
      "Named libraries: each `.excalidrawlib` file is a section in the library panel. See [Library](#library).",
    keys: {
      folders: {
        doc: "Extra folders of `.excalidrawlib` files, each file a library (absolute paths, or starting with `~/`). The panel looks at them again when the window gains focus.",
      },
      default: {
        doc: 'Name of the library that takes new items when you add without choosing a section; `""` (or a name that does not exist) means Personal.',
      },
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
      list_start: {
        doc: "When every vault folder is listed for recent drawings, the file switcher, link suggestions and the move dialog: `open`, `idle` or `use` (the first of those). The file tree loads at open either way. See [Startup](#startup).",
      },
      speculative_open: {
        doc: "Read and parse a drawing when you press on it in the file tree, a tab or the switcher, before the click lands, so it opens sooner. Holds one drawing for a moment; costs nothing when off or unused. See [Speed trade-offs](#speed-trade-offs).",
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
      start: {
        doc: "When the link index starts: `open` (vault open), `idle` (once the app is idle) or `use` (first links action). Starting links also starts search. See [Startup](#startup).",
      },
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
    table: "notes",
    intro:
      "Markdown notes: the reading view and the editor. See [Notes](#notes).",
    keys: {
      open_in: {
        doc: "What a note shows when it opens: the reading view or the editor.",
      },
      vim: { doc: "Vim keys in the note editor." },
      line_wrap: { doc: "Wrap long lines in the editor." },
      line_numbers: { doc: "Show line numbers in the editor." },
      font_size: { doc: "Text size of notes, in pixels." },
      readable_width: {
        doc: "Widest the reading text gets, in pixels; 0 uses the whole pane.",
      },
      autosave_ms: {
        doc: "Save this long after the last keystroke; 0 saves only with `Notes: Save`.",
      },
      highlight_code: { doc: "Colour code blocks in the reading view." },
      math: {
        doc: "Render `$…$` and `$$…$$` as formulas in the reading view.",
      },
      remote_images: {
        doc: "Load images from `http(s)` addresses. Off keeps notes fully offline: the image shows its alt text instead.",
      },
      toggle_tasks: {
        doc: "Tick `- [ ]` task checkboxes by clicking them in the reading view. The change is saved through the guarded save; off leaves them read-only.",
      },
    },
  },
  {
    table: "layout",
    intro:
      "Which parts of the window show, and presets such as focus mode. See [Layout and focus mode](#layout-and-focus-mode).",
    keys: {
      header: {
        doc: "Show the vault header (title, save status, History and Graph buttons).",
      },
      footer: {
        doc: "Show Excalidraw's footer (zoom, undo and redo, help).",
      },
      preset: {
        doc: 'A preset to apply at launch and whenever this value changes; `""` = none.',
      },
      presets: {
        doc: "Named presets, `[layout.presets.<name>]`, each listing the parts it shows or hides: `header`, `navigator`, `activity_bar`, `tab_strip`, `footer`, `status_bar`. `focus` is built in.",
        default: "`focus` hides every part",
        accepts: "tables of `part = true | false`",
      },
    },
  },
  {
    table: "focus",
    intro:
      "What focus mode hides (`View: Focus mode`). See [Layout and focus mode](#layout-and-focus-mode).",
    keys: {
      hide: {
        doc: "The parts focus mode hides: `header`, `navigator`, `activity_bar`, `tab_strip`, `footer`, `status_bar`. The canvas and the drawing toolbar always stay.",
        default: "every part",
        accepts: "a list of part names",
      },
      remember: {
        doc: "Open in focus mode when it was on at the last quit.",
      },
      hint: {
        doc: "Show a small `Focus` chip (with the exit key) while focus mode is on.",
      },
    },
  },
  {
    table: "sync",
    intro:
      "Vaults inside iCloud Drive, Dropbox, Syncthing or OneDrive. See [Sync services](#sync-services).",
    keys: {
      conflict_badge: {
        doc: "Show a `conflict` badge on conflict copies (`name (conflicted copy …)`, `name.sync-conflict-…`, `name 2`) in the file tree.",
      },
      download_placeholders: {
        doc: "Ask iCloud to download a drawing that shows as not downloaded when you click it. Off: only its Download button does.",
      },
    },
  },
  {
    table: "memory",
    intro: "Memory kept by open drawings. See [Memory](#memory).",
    keys: {
      free_unused_images: {
        doc: "Release image data that no element and no undo or redo step can restore.",
      },
      undo_steps: {
        doc: "Undo steps kept per drawing; older steps go, with the images only they could restore.",
      },
      hidden_purge_s: {
        doc: "Seconds the window stays hidden before the app frees its caches; 0 never does.",
      },
      idle_purge_s: {
        doc: "Seconds without input, while visible, before off-screen caches are freed; 0 never does.",
      },
      low_memory_canvas: {
        doc: "Back the editor canvases with CPU memory: about 100 MB less memory, but panning drops to about 60 frames per second. Read when the editor starts (restart to apply).",
      },
    },
  },
  {
    table: "search",
    intro:
      "Search speed trade-offs. Lower counts and a longer wait cost less on a slow machine.",
    keys: {
      debounce_ms: {
        doc: "Wait this long after the last keystroke before a search runs.",
      },
      max_drawings: {
        doc: "Most drawings listed in the search results.",
      },
      max_snippets: {
        doc: "Most matching elements shown under each drawing; the index keeps 5 per drawing, so 5 is the top.",
      },
      notes: {
        doc: "Search the Markdown notes (`.md`) of the vault, with their `#tags`, links and headings. Read when the index starts (reopen the vault).",
      },
      note_text_mb: {
        doc: "Megabytes of note text the index keeps in memory (16 holds about 6,500 notes). Past it a note keeps its name, headings, tags and links. Read when the index starts; 0 keeps only those.",
      },
      start: {
        doc: "When the search index starts: `open` (vault open), `idle` (once the app is idle) or `use` (first search). Tags show once it has started. See [Startup](#startup).",
      },
    },
  },
  {
    table: "extensions",
    intro:
      "Built-in extensions, on (`true`) or off (`false`). Off means not loaded: no memory, no work, no commands. Changes apply live. See [Extensions](#extensions).",
    keys: {
      search: {
        doc: "Search inside drawings from the file tree and the palette; off searches file names only.",
      },
      links: {
        doc: "Links between drawings: the links dock, `[[` autocomplete, link styling, hints, back and forward. Renaming still updates links per `links.update_on_rename`.",
      },
      tags: { doc: "Tags: the tags pane, tag chips, tag search and rename." },
      graph: { doc: "Graph view." },
      library: { doc: "The library sidebar and inserting library items." },
      templates: {
        doc: "New drawing from a template, and saving a drawing as one.",
      },
      formula: {
        doc: "The formula plugin: insert and edit LaTeX formulas, and render `$…$` in notes (off: notes show the TeX source).",
      },
      mermaid: {
        doc: "Mermaid to Excalidraw (the official mermaid plugin: dialog, menu entries, paste conversion and the mermaid.to_drawing method).",
      },
      "pdf-import": { doc: "Import PDF pages into a drawing." },
      notes: {
        doc: "Markdown notes: open a `.md` file in a tab with a reading view and an editor. See [Notes](#notes).",
      },
      history: {
        doc: "The History panel, timeline, checkpoints and their commands. Versions are still saved while `history.enabled` is on.",
      },
    },
  },
  {
    table: "keys",
    intro:
      'Key sequences and the which-key popup. `[keys.labels]` names sequence groups (`"<leader> f" = "files"`); its entries are free text and are not checked. See [Key sequences, leader and which-key](#key-sequences-leader-and-which-key).',
    keys: {
      leader: { doc: "The key `<leader>` stands for in a sequence." },
      timeout_ms: {
        doc: "Time allowed between the keys of a sequence; 0 waits for the next key.",
      },
      cancel_after_ms: {
        doc: "Drop a half-typed sequence after this long; 0 never does.",
      },
      which_key: {
        doc: "Show the which-key popup while a sequence is half typed.",
      },
      which_key_delay_ms: {
        doc: "Wait this long before the popup appears.",
      },
      which_key_position: { doc: "Where the popup shows." },
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
      start: {
        doc: "When file history starts: `open` (vault open), `idle` or `use` (first edit or history action). Edits made before it starts are not versioned. See [Startup](#startup).",
      },
    },
  },
  {
    table: "plugins",
    intro: "Plugins in the `plugins/` folder of the config folder.",
    keys: {
      enabled: {
        doc: "Ids of the plugins to load: your own plugins and official ones that are on. Official plugins (markdown-import, gallery) are on unless listed in `disabled`.",
      },
      disabled: {
        doc: 'Official plugins you turned off, like `["gallery"]`. Settings writes it; a new official plugin is on until you list it here.',
      },
      importers: {
        doc: 'Which plugin imports a file extension when two plugins claim it; `""` turns plugin handling off for that extension.',
      },
      storage_limit_kb: {
        doc: "Most data one plugin may save with `ctx.storage`, in KiB; a save past it is refused.",
      },
      scene_max_ops: {
        doc: "Most ops in one plugin `scene.batch` call; a batch past it is refused.",
      },
      toolbar: {
        doc: "Show the strip of buttons plugins declare with `[[contributes.toolbar]]`. It appears only while a plugin declares a button.",
      },
      status_bar: {
        doc: "Show the status bar plugins fill with `ctx.statusBar`. It appears only while a plugin item has text.",
      },
      registry_url: {
        doc: "The community plugins index that Settings, Plugins, Browse lists (an https address). Needs the plugins consent.",
      },
      registry_ttl_hours: {
        doc: "Hours before Browse fetches the plugins index again; 0 fetches every time it opens.",
      },
    },
  },
  {
    table: "ai",
    intro: "AI features, off until you turn them on. See [AI](#ai).",
    keys: {
      enabled: {
        doc: "The master switch; turning it on in Settings or with **AI: Toggle AI** first shows a warning.",
      },
      mcp_enabled: {
        doc: "The AI tools interface (the `mcp` role of the control socket); it opens only while both keys are `true`.",
      },
    },
  },
  {
    table: "control",
    intro:
      "Scripts and links from outside. The socket and link keys are read by the native side; see [Control and links](#control-and-links).",
    keys: {
      notify_edits: {
        doc: "Show a notice when a script or AI tool edits the drawing on screen.",
      },
    },
  },
  {
    table: "window",
    intro:
      "The window's title bar on Linux. The native side reads it at launch, so a change needs a restart. See [Window title bar (Linux)](#window-title-bar-linux).",
    keys: {
      decorations: {
        doc: "Linux only: `custom` hides the system title bar and the app header carries minimize, maximize and close; `native` keeps the system title bar. Needs a restart; ignored on macOS and Windows.",
      },
    },
  },
  {
    table: "watchdog",
    intro:
      "The hang watchdog: a Wait / Quit dialog when the page stops answering. See [Hang watchdog](#hang-watchdog).",
    keys: {
      enabled: {
        doc: "Show a Wait / Quit dialog when the page stops answering (macOS; Linux later).",
      },
      grace_ms: {
        doc: "How long the page must stay unresponsive (after WebKit's own 3 s) before the dialog appears, in milliseconds. Applies from the next hang.",
      },
    },
  },
  {
    table: "network",
    intro:
      "The internet is used only for features you allow, and only when you use them. See [Network](#network).",
    keys: {
      enabled: {
        doc: "Master switch: `false` blocks every download, whatever else is allowed. Turning it on from Settings asks in a native dialog.",
      },
      allow_themes: {
        doc: "Allow theme downloads. Absent means ask on first use; `true` allows, `false` refuses. Turning it on asks in a native dialog.",
        default: "unset (ask)",
      },
      allow_plugins: {
        doc: "Allow the community plugins list and plugin downloads. Absent means ask on first use; `true` allows, `false` refuses. Turning it on asks in a native dialog.",
        default: "unset (ask)",
      },
    },
  },
  {
    table: "themes",
    intro:
      "Installing themes from the internet. See [Installing more themes](#installing-more-themes).",
    keys: {
      max_install_kb: {
        doc: "Largest theme file to accept, in KB (1 to 256).",
      },
      index_url: {
        doc: "The community themes index the theme browser lists (an https address). Needs the themes consent.",
      },
      index_ttl_hours: {
        doc: "Hours before the browser fetches the index again; 0 fetches every time it opens.",
      },
      previews: {
        doc: "Download preview images in the browser; `false` shows colour swatches only.",
      },
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
