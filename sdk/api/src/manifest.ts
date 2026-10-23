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
}

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
}
