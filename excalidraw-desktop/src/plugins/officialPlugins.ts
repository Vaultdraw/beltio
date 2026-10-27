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
  kinds: string[];
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

export interface OfficialImporter {
  id: string;
  title: string;
  extensions: string[];
  /** The importer makes its own drawing, so it needs no open drawing (and works in a read-only one). */
  ownDrawing: boolean;
}

export interface OfficialPlugin {
  id: string;
  name: string;
  importers: OfficialImporter[];
  commands: OfficialCommand[];
  cancelCommand?: string;
  menus?: OfficialMenu[];
  activity?: OfficialActivity;
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
];

export const isOfficialPluginId = (id: string): boolean =>
  OFFICIAL_PLUGINS.some((p) => p.id === id);

/** True when this plugin's importers make their own drawing (no open drawing needed). */
export const createsOwnDrawing = (pluginId: string): boolean =>
  OFFICIAL_PLUGINS.some(
    (p) => p.id === pluginId && p.importers.some((i) => i.ownDrawing),
  );

/** The main menu's "Import Obsidian vault…" item runs this command (shown while the plugin is on). */
export const OBSIDIAN_IMPORT_COMMAND_ID = "markdown-import.obsidian";
