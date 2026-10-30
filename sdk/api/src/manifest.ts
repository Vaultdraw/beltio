import type { SettingDecl } from "./settings";

/**
 * What a plugin may read about itself (`ctx.manifest`).
 *
 * @since 0.1.0
 */
export interface PluginManifestInfo {
  /** @since 0.1.0 */
  id: string;
  /** @since 0.1.0 */
  version: string;
  /** The install folder of the plugin. @deprecated An internal path with no use without file access: still filled in 1.x, removed in 2.0. @since 0.1.0 */
  dir: string;
  /**
   * What the plugin declared in `plugin.toml`. A declaration, not a sandbox.
   *
   * @since 0.2.0
   */
  permissions: readonly PluginPermission[];
  /**
   * The key under which this plugin's element data is stored in a drawing:
   * `data_key` from `plugin.toml`, else `plugins.<id>`.
   *
   * @since 0.4.0
   */
  dataKey: string;
}

/**
 * A permission a plugin can declare. `vault.read` reads the drawings in your
 * vault, `vault.write` creates drawings in it, `folders.import` (since 0.9.0)
 * reads a folder you pick and writes into a destination you pick
 * (`ctx.folders`), `control` (since 0.22.0) lets other programs call the
 * plugin's declared methods (`ctx.methods`), `pdf` (since 0.26.0) opens PDF files and renders their
 * pages (`ctx.pdf`), `clipboard` (since 0.28.0) reads the clipboard text and sees pasted text (`ctx.clipboard`). `network.images` (since 0.31.0) downloads the pictures of web pages a note shows, after the user allows it (`ctx.network`). `net` (since 1.1.0) sends requests to the internet addresses the plugin is configured for (`ctx.net`), and `secret` (since 1.1.0) keeps secrets such as API keys that the plugin can never read back (`ctx.secret`).
 *
 * @since 0.2.0
 */
export type PluginPermission =
  | "vault.read"
  | "vault.write"
  | "folders.import"
  | "control"
  | "pdf"
  | "clipboard"
  | "network.images"
  | "net"
  | "secret";

/**
 * A command declared in `plugin.toml`.
 *
 * @since 0.1.0
 */
export interface CommandContribution {
  /** @since 0.1.0 */
  id: string;
  /** @since 0.1.0 */
  title: string;
  /** @since 0.1.0 */
  keys: string[];
  /** @since 0.1.0 */
  when: string[];
  /** @since 0.1.0 */
  palette: boolean;
  /** Runs again while the key is held (cursor moves). Absent or false: once per press. @since 0.20.0 */
  repeat?: boolean;
}

/**
 * A panel declared in `plugin.toml`.
 *
 * @since 0.1.0
 */
export interface PanelContribution {
  /** @since 0.1.0 */
  id: string;
  /** @since 0.1.0 */
  title: string;
  /** @since 0.1.0 */
  icon: string | null;
  /** @since 0.1.0 */
  group: "top" | "bottom";
}

/**
 * An importer declared in `plugin.toml` (`[[contributes.importers]]`): the
 * file types the plugin handles when the user drops or picks one.
 *
 * @since 0.6.0
 */
export interface ImporterContribution {
  /** @since 0.6.0 */
  id: string;
  /** @since 0.6.0 */
  title: string;
  /**
   * Lower case, no leading dot, such as `txt` or `excalidraw.md`.
   *
   * @since 0.6.0
   */
  extensions: string[];
}

/**
 * A status bar item declared in plugin.toml (`[[contributes.status_bar]]`).
 *
 * @since 0.10.0
 */
export interface StatusBarContribution {
  /** @since 0.10.0 */
  id: string;
  /** @since 0.10.0 */
  title: string;
  /** @since 0.10.0 */
  align: "left" | "right";
  /** @since 0.10.0 */
  priority: number;
  /** Short id of the command a click runs, or null. @since 0.10.0 */
  command: string | null;
}

/**
 * A view declared in plugin.toml (`[[contributes.views]]`).
 *
 * @since 0.11.0
 */
export interface ViewContribution {
  /** @since 0.11.0 */
  id: string;
  /** @since 0.11.0 */
  title: string;
  /** Note name endings such as `kanban.md`. @since 0.11.0 */
  extensions: string[];
}

/**
 * A context menu item declared in plugin.toml (`[[contributes.menus]]`).
 *
 * @since 0.12.0
 */
export interface MenuContribution {
  /** @since 0.12.0 */
  surface: "tree" | "tab" | "canvas";
  /** Short id of the command it runs. @since 0.12.0 */
  command: string;
  /** The item's text, or null for the command's title. @since 0.12.0 */
  title: string | null;
  /** Tree rows it shows for; empty means all. @since 0.12.0 */
  kinds: ("drawing" | "note" | "folder")[];
}

/**
 * A toolbar button declared in plugin.toml (`[[contributes.toolbar]]`).
 *
 * @since 0.14.0
 */
export interface ToolbarContribution {
  /** Short id of the command a click runs. @since 0.14.0 */
  command: string;
  /** Tooltip and label, or null for the command's title. @since 0.14.0 */
  title: string | null;
  /** SVG path data on a 24 by 24 grid, or null for the first letter of the title. @since 0.14.0 */
  icon: string | null;
  /** Higher comes first. @since 0.14.0 */
  priority: number;
}

/**
 * A canvas tool declared in plugin.toml (`[[contributes.tools]]`).
 *
 * @since 0.15.0
 */
export interface ToolContribution {
  /** @since 0.15.0 */
  id: string;
  /** @since 0.15.0 */
  title: string;
  /** SVG path data on a 24 by 24 grid, or null for the first letter of the title. @since 0.15.0 */
  icon: string | null;
  /** The pointer while the tool is active; null is `crosshair`. @since 0.15.0 */
  cursor: "crosshair" | "default" | "pointer" | "grab" | "text" | null;
}

/**
 * A custom shape declared in plugin.toml (`[[contributes.shapes]]`).
 *
 * @since 0.16.0
 */
export interface ShapeContribution {
  /** @since 0.16.0 */
  id: string;
  /** @since 0.16.0 */
  title: string;
  /** SVG path data on a 24 by 24 grid for its toolbar button, or null for the first letter of the title. @since 0.16.0 */
  icon: string | null;
  /** Size of a new shape. @since 0.16.0 */
  width: number;
  /** @since 0.16.0 */
  height: number;
}

/**
 * A method other programs can call, declared in plugin.toml (`[[contributes.methods]]`, needs the
 * permission `control`).
 *
 * @since 0.22.0
 */
export interface MethodContribution {
  /** Lower case letters, digits and `_`. @since 0.22.0 */
  id: string;
  /** @since 0.22.0 */
  title: string;
  /** @since 0.22.0 */
  description?: string | null;
  /** JSON Schema of the input. @since 0.22.0 */
  params?: Record<string, unknown> | null;
  /** Offered to AI apps as a tool while AI is on. @since 0.22.0 */
  mcp: boolean;
  /** Changes the vault or a drawing. @since 0.22.0 */
  write: boolean;
  /** Milliseconds before a call fails with TIMEOUT. @since 0.22.0 */
  timeout_ms?: number | null;
}

/**
 * Everything a plugin declares it adds to the app.
 *
 * @since 0.1.0
 */
export interface PluginContributions {
  /** @since 0.1.0 */
  commands: CommandContribution[];
  /** @since 0.1.0 */
  panels: PanelContribution[];
  /** @since 0.1.0 */
  settings: SettingDecl[];
  /**
   * Absent when the app that reads the manifest is older than 0.6.0.
   *
   * @since 0.6.0
   */
  importers?: ImporterContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.10.0.
   *
   * @since 0.10.0
   */
  status_bar?: StatusBarContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.11.0.
   *
   * @since 0.11.0
   */
  views?: ViewContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.12.0.
   *
   * @since 0.12.0
   */
  menus?: MenuContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.14.0.
   *
   * @since 0.14.0
   */
  toolbar?: ToolbarContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.15.0.
   *
   * @since 0.15.0
   */
  tools?: ToolContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.16.0.
   *
   * @since 0.16.0
   */
  shapes?: ShapeContribution[];
  /**
   * Absent when the app that reads the manifest is older than 0.22.0.
   *
   * @since 0.22.0
   */
  methods?: MethodContribution[];
}
