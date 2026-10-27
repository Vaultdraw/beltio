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
