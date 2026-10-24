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
 * vault, `vault.write` creates drawings in it. The names `net`, `secret` and
 * `control` are reserved.
 *
 * @since 0.2.0
 */
export type PluginPermission = "vault.read" | "vault.write";

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
}
