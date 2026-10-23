import type { Disposable } from "./disposable";

/**
 * A plain TOML scalar, the only kind of value a setting can hold.
 *
 * @since 0.1.0
 */
export type SettingValue = string | number | boolean;

/**
 * A layer that may hold a setting value.
 *
 * @since 0.1.0
 */
export type SettingScopeName = "global" | "vault";

/**
 * One choice of a `select` setting.
 *
 * @since 0.1.0
 */
export interface SelectOption {
  /** @since 0.1.0 */
  value: string;
  /** @since 0.1.0 */
  label: string;
}

/**
 * A setting declared in `plugin.toml`.
 *
 * @since 0.1.0
 */
export interface SettingDecl {
  /** @since 0.1.0 */
  key: string;
  /** @since 0.1.0 */
  type: "bool" | "int" | "number" | "string" | "select" | "color";
  /** @since 0.1.0 */
  title: string;
  /** @since 0.1.0 */
  description?: string;
  /** @since 0.1.0 */
  default: SettingValue;
  /** @since 0.1.0 */
  min?: number;
  /** @since 0.1.0 */
  max?: number;
  /**
   * `select` only.
   *
   * @since 0.1.0
   */
  options?: readonly SelectOption[];
  /**
   * Layers that may hold a value; defaults to both.
   *
   * @since 0.1.0
   */
  scope?: readonly SettingScopeName[];
}

/**
 * Read and write the plugin's own declared settings.
 *
 * @since 0.1.0
 */
export interface SettingsApi {
  /**
   * Effective value (vault > global > default).
   *
   * @since 0.1.0
   */
  get<T = unknown>(key: string): T;
  /**
   * Writes a value. Rejects when the value or scope is invalid.
   *
   * @since 0.1.0
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Calls `cb` when the effective value of `key` changes.
   *
   * @since 0.1.0
   */
  onChange(key: string, cb: (value: unknown) => void): Disposable;
}
