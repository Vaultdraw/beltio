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
  /** @since 0.1.0 */
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
 * (`ctx.folders`). The names `net`, `secret` and `control` are reserved.
 *
 * @since 0.2.0
 */
export type PluginPermission = "vault.read" | "vault.write" | "folders.import";

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
}
