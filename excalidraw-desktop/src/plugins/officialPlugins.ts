/**
 * Official plugins that ship inside the app (`plugins/official/<id>/`, copied to
 * `<resources>/plugins/<id>/`). They are on by default, yet nothing of them loads
 * at startup: this table lets the shell show their commands and claim their file
 * types as stubs, and the first use starts the plugin host (boot.ts).
 *
 * A tiny core file with no imports, so the startup path can read it. The
 * `officialPlugins.test.ts` test checks every row against the plugin's plugin.toml.
 * Turning one off: remove its id from `plugins.enabled` (Settings, Plugins).
 */

export interface OfficialCommand {
  /** The short id in plugin.toml; the registered id is `<plugin id>.<id>`. */
  id: string;
  title: string;
  /** Default keys, as in plugin.toml (none when absent). */
  keys?: string[];
  when?: string[];
  repeat?: boolean;
}

/** A context menu item shown before the plugin loads (`[[contributes.menus]]`). */
export interface OfficialMenu {
  surface: "tree" | "tab" | "canvas";
  command: string;
  title: string;
  kinds?: string[];
}

/** An activity bar button that runs one of the plugin's commands; `active` while its overlay is open. */
export interface OfficialActivity {
  /** The entry id (also its place in the `interface.activity_bar` order). */
  id: string;
  label: string;
  /** A built-in icon name (boot.ts ACTIVITY_ICONS). */
  icon: "gallery" | "graph";
  /** Short command id. */
  command: string;
  /** The built-in entry it sits behind by default. */
  after?: string;
}

/** A side panel shown before the plugin loads (`[[contributes.panels]]`); opening it starts the plugin. */
export interface OfficialPanel {
  /** Short panel id (the full id is `<plugin id>.<id>`). */
  id: string;
  title: string;
  /** A built-in panel icon name (stubs.ts ICONS). */
  icon: string;
}

export interface OfficialImporter {
  id: string;
  title: string;
  extensions: string[];
  /** The importer makes its own drawing, so it needs no open drawing (and works in a read-only one). */
  ownDrawing: boolean;
  /** Largest file it takes, in bytes (the default is 32 MiB, the drawing cap). */
  maxBytes?: number;
}

export interface OfficialPlugin {
  id: string;
  name: string;
  importers: OfficialImporter[];
  commands: OfficialCommand[];
  cancelCommand?: string;
  menus?: OfficialMenu[];
  panels?: OfficialPanel[];
  activity?: OfficialActivity;
  /**
   * The `[extensions]` switch that turns this plugin on and off (same id). The plugin runs only
   * while the switch is on (and the extension set is not in safe start or bisect).
   */
  extension?: "graph" | "mermaid" | "formula" | "pdf-import";
  /**
   * A bool setting of this plugin (`[plugin.<id>]`) that, while true, starts the plugin host at idle
   * after launch: the plugin reacts to app events, so it has to be loaded before its first command.
   * While it is false (the default) nothing loads.
   */
  startWhen?: string;
  /**
   * The plugin sees pastes (`ctx.clipboard.onPaste`, `activation = ["onPaste"]`): the first paste of
   * multi-line text starts it, so it costs nothing at launch.
   */
  pasteHook?: boolean;
  /**
   * Off until the user turns it on (Settings, Plugins): it is not in the default `plugins.enabled`,
   * and an older config does not gain it. For a plugin that talks to the network with a key.
   */
  defaultOff?: boolean;
}

export const OFFICIAL_PLUGINS: readonly OfficialPlugin[] = [
  {
    id: "markdown-import",
    name: "Markdown import",
    importers: [
      {
        id: "md",
        title: "Markdown",
        extensions: ["md", "markdown"],
        ownDrawing: true,
      },
    ],
    commands: [
      { id: "import", title: "Import: Markdown…" },
      { id: "import-clipboard", title: "Import: Markdown from clipboard" },
      {
        id: "import-document-font",
        title: "Import: Markdown with the Document font",
      },
      { id: "next-heading", title: "Markdown: Next heading" },
      { id: "previous-heading", title: "Markdown: Previous heading" },
      { id: "timings", title: "Import: Show timings" },
      { id: "obsidian", title: "Import Obsidian vault…" },
      {
        id: "obsidian-new-vault",
        title: "Import Obsidian vault into a new vault…",
      },
      {
        id: "download-images",
        title: "Markdown: Download web images in this drawing",
      },
      {
        id: "attach-images",
        title: "Markdown: Attach missing images from a folder…",
      },
      {
        id: "reimport-note",
        title: "Markdown: Re-import this note from its Markdown",
      },
      {
        id: "reimport-notes",
        title: "Markdown: Re-import unchanged imported notes",
      },
    ],
    menus: [
      {
        surface: "tree",
        command: "reimport-note",
        title: "Re-import from its Markdown",
        kinds: ["drawing"],
      },
      {
        surface: "tab",
        command: "reimport-note",
        title: "Re-import from its Markdown",
      },
      {
        surface: "tree",
        command: "reimport-notes",
        title: "Re-import unchanged imported notes here",
        kinds: ["folder"],
      },
    ],
    /** A hidden command the core "Import: Cancel" runs for imports that are not file imports. */
    cancelCommand: "cancel-import",
  },
  {
    id: "gallery",
    name: "Gallery",
    importers: [],
    commands: [
      {
        id: "toggle",
        title: "Gallery: Toggle grid view",
        keys: ["Mod+Alt+KeyE"],
      },
      { id: "show-folder", title: "Gallery: Show folder as grid" },
      {
        id: "close",
        title: "Gallery: Close gallery",
        keys: ["Escape"],
        when: ["galleryFocus", "!modalOpen"],
      },
    ],
    menus: [
      {
        surface: "tree",
        command: "show-folder",
        title: "Show as grid",
        kinds: ["folder"],
      },
    ],
    activity: {
      id: "gallery",
      label: "Gallery",
      icon: "gallery",
      command: "toggle",
      after: "graph",
    },
  },
  {
    id: "graph",
    name: "Graph",
    /** The `[extensions] graph` switch (Settings, Extensions) turns this plugin on and off. */
    extension: "graph",
    importers: [],
    commands: [
      {
        id: "open",
        title: "Graph: Open graph view",
        keys: ["Mod+Alt+G"],
        when: ["vaultOpen", "!modalOpen"],
      },
      {
        id: "openLocal",
        title: "Graph: Open local graph",
        keys: ["Mod+Alt+L"],
        when: ["drawingOpen", "!modalOpen"],
      },
      {
        id: "toggleOrphans",
        title: "Graph: Toggle orphans",
        when: ["vaultOpen", "!modalOpen"],
      },
      {
        id: "toggleTags",
        title: "Graph: Toggle tags",
        when: ["vaultOpen", "!modalOpen"],
      },
      {
        id: "toggleUnresolved",
        title: "Graph: Toggle unresolved links",
        when: ["vaultOpen", "!modalOpen"],
      },
      {
        id: "fit",
        title: "Graph: Fit graph to view",
        keys: ["0"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "moveLeft",
        title: "Graph: Focus node to the left",
        keys: ["H", "ArrowLeft"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "moveRight",
        title: "Graph: Focus node to the right",
        keys: ["L", "ArrowRight"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "moveUp",
        title: "Graph: Focus node above",
        keys: ["K", "ArrowUp"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "moveDown",
        title: "Graph: Focus node below",
        keys: ["J", "ArrowDown"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "openNode",
        title: "Graph: Open focused node",
        keys: ["Enter"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "focusFilter",
        title: "Graph: Focus the filter",
        keys: ["Slash"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "toggleLocal",
        title: "Graph: Switch between global and local graph",
        keys: ["Shift+L"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "depth1",
        title: "Graph: Local depth 1",
        keys: ["1"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "depth2",
        title: "Graph: Local depth 2",
        keys: ["2"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "depth3",
        title: "Graph: Local depth 3",
        keys: ["3"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "hints",
        title: "Graph: Show link hints",
        keys: ["F", "Shift+F"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "zoomIn",
        title: "Graph: Zoom in",
        keys: ["Equal", "Shift+Equal"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "zoomOut",
        title: "Graph: Zoom out",
        keys: ["Minus"],
        when: ["graphFocus", "!modalOpen"],
        repeat: true,
      },
      {
        id: "close",
        title: "Graph: Close graph",
        keys: ["Escape"],
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "toggleArrows",
        title: "Graph: Toggle arrows",
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "toggleColourBy",
        title: "Graph: Toggle colour by folder or mono",
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "toggleSettings",
        title: "Graph: Toggle settings panel",
        when: ["graphFocus", "!modalOpen"],
      },
      {
        id: "resetDisplay",
        title: "Graph: Reset display and forces",
        when: ["graphFocus", "!modalOpen"],
      },
    ],
    activity: {
      id: "graph",
      label: "Graph view",
      icon: "graph",
      command: "open",
      after: "history",
    },
  },
  {
    id: "mermaid",
    name: "Mermaid",
    /** The `[extensions] mermaid` switch (Settings, Extensions) turns this plugin on and off. */
    extension: "mermaid",
    importers: [],
    commands: [],
  },
  {
    id: "formula",
    name: "Formula",
    /** The `[extensions] formula` switch (Settings, Extensions) turns this plugin on and off. */
    extension: "formula",
    importers: [],
    commands: [
      {
        id: "insert",
        title: "Formula: Insert formula",
        keys: ["Mod+Shift+M"],
        when: ["drawingOpen", "writable", "!modalOpen"],
      },
      {
        id: "edit",
        title: "Formula: Edit formula",
        when: ["drawingOpen", "writable", "!modalOpen"],
      },
    ],
  },
  {
    id: "pdf-import",
    name: "PDF import",
    /** The `[extensions] pdf-import` switch (Settings, Extensions) turns this plugin on and off. */
    extension: "pdf-import",
    importers: [
      {
        id: "pdf",
        title: "PDF",
        extensions: ["pdf"],
        ownDrawing: false,
        /** The native renderer takes dropped PDFs up to 128 MiB. */
        maxBytes: 128 * 1024 * 1024,
      },
    ],
    commands: [
      {
        id: "import",
        title: "Import: PDF…",
        when: ["drawingOpen", "writable"],
      },
    ],
  },
  {
    id: "favourites",
    name: "Favourites",
    importers: [],
    commands: [
      {
        id: "toggle",
        title: "Favourites: Add or remove the open drawing",
        keys: ["Mod+Alt+J"],
        when: ["drawingOpen", "!modalOpen"],
      },
      {
        id: "toggle-element",
        title: "Favourites: Add or remove the selected element",
        when: ["drawingOpen", "!modalOpen"],
      },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
        id: `open${n}`,
        title: `Favourites: Open favourite ${n}`,
        when: ["vaultOpen", "!modalOpen"],
      })),
    ],
    menus: [
      {
        surface: "tree",
        command: "toggle",
        title: "Favourite: add or remove",
        kinds: ["drawing", "note"],
      },
      {
        surface: "tab",
        command: "toggle",
        title: "Favourite: add or remove",
      },
      {
        surface: "canvas",
        command: "toggle-element",
        title: "Favourite: add or remove the selection",
      },
    ],
    panels: [{ id: "list", title: "Favourites", icon: "bookmark" }],
  },
  {
    id: "auto-export",
    name: "Auto-export",
    /** `[plugin.auto-export] enabled = true` starts it at launch; false (the default) loads nothing. */
    startWhen: "enabled",
    importers: [],
    commands: [
      {
        id: "export-all",
        title: "Auto-export: Export all drawings now",
        when: ["vaultOpen"],
      },
      {
        id: "export-current",
        title: "Auto-export: Export this drawing now",
        when: ["drawingOpen"],
      },
    ],
  },
  {
    id: "table",
    name: "Table",
    pasteHook: true,
    importers: [],
    commands: [
      {
        id: "insert-from-clipboard",
        title: "Insert table from clipboard",
        when: ["drawingOpen"],
      },
    ],
  },
  {
    id: "ai-assistant",
    name: "AI assistant",
    defaultOff: true,
    importers: [],
    commands: [
      { id: "ask", title: "AI: Ask about this drawing", when: ["vaultOpen"] },
      {
        id: "describe",
        title: "AI: Describe the selection",
        when: ["drawingOpen"],
      },
      {
        id: "diagram",
        title: "AI: Generate a diagram from text",
        when: ["drawingOpen"],
      },
      {
        id: "summarise",
        title: "AI: Summarise this note",
        when: ["drawingOpen"],
      },
      { id: "cancel", title: "AI: Stop the answer" },
      { id: "clear", title: "AI: Clear the conversation" },
      { id: "set-key", title: "AI: Set API key" },
      { id: "remove-key", title: "AI: Remove API key" },
    ],
    panels: [{ id: "assistant", title: "AI assistant", icon: "template" }],
  },
];

/**
 * Official plugins are on unless the user turned one off: `plugins.disabled` lists the ones
 * switched off on purpose, `plugins.enabled` holds the user's own (third-party) plugins and the
 * official ones that are on. A new official plugin is in neither list, so it counts as on.
 */
export const OFFICIAL_IDS: readonly string[] = OFFICIAL_PLUGINS.map(
  (p) => p.id,
);

/** The ones that start on: every official plugin except those marked `defaultOff`. */
export const DEFAULT_ON_IDS: readonly string[] = OFFICIAL_PLUGINS.filter(
  (p) => !p.defaultOff,
).map((p) => p.id);

/**
 * Official plugins that shipped in a release before `plugins.disabled` did: an old `plugins.enabled`
 * list governed these. None yet (markdown-import first ships in 0.2.0, with this mechanism).
 */
const LEGACY_OFFICIAL: readonly string[] = [];

/**
 * The enabled list and the disabled-official list to use, from what was saved (undefined: not
 * saved). An old config that has only `enabled` is migrated once: a legacy official plugin it
 * does not name was turned off, so it stays off; official plugins newer than the list are on.
 */
export function resolveOfficial(
  savedEnabled: readonly string[] | undefined,
  savedDisabled: readonly string[] | undefined,
): { enabled: string[]; disabled: string[] } {
  const enabled = [...(savedEnabled ?? [])];
  const disabled = (
    savedDisabled ??
    (savedEnabled
      ? LEGACY_OFFICIAL.filter((id) => !savedEnabled.includes(id))
      : [])
  ).filter((id) => OFFICIAL_IDS.includes(id));
  for (const id of DEFAULT_ON_IDS) {
    if (!disabled.includes(id) && !enabled.includes(id)) {
      enabled.push(id);
    }
  }
  return { enabled: enabled.filter((id) => !disabled.includes(id)), disabled };
}

/** The official plugins a given enabled list leaves off: what to record as `plugins.disabled`. */
export const disabledOfficial = (enabled: readonly string[]): string[] =>
  OFFICIAL_IDS.filter((id) => !enabled.includes(id));

export const isOfficialPluginId = (id: string): boolean =>
  OFFICIAL_PLUGINS.some((p) => p.id === id);

/** True when this plugin's importers make their own drawing (no open drawing needed). */
export const createsOwnDrawing = (pluginId: string): boolean =>
  OFFICIAL_PLUGINS.some(
    (p) => p.id === pluginId && p.importers.some((i) => i.ownDrawing),
  );

/** The largest file an importer takes: its own `maxBytes`, else the 32 MiB drawing cap. */
export const importerMaxBytes = (
  pluginId: string,
  importerId: string,
  fallback: number,
): number =>
  OFFICIAL_PLUGINS.find((p) => p.id === pluginId)?.importers.find(
    (i) => i.id === importerId,
  )?.maxBytes ?? fallback;

/** The main menu's "Import PDF…" item runs this command (shown while the plugin is on). */
export const PDF_IMPORT_COMMAND_ID = "pdf-import.import";

/** The main menu's "Import Obsidian vault…" item runs this command (shown while the plugin is on). */
export const OBSIDIAN_IMPORT_COMMAND_ID = "markdown-import.obsidian";
