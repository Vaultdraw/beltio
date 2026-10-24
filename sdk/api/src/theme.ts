import type { Disposable } from "./disposable";

/**
 * The CSS custom properties of the app's colour theme. The names are API: a
 * token is never removed without an alias. `sdk/docs/theme-tokens.md` says what
 * each one is for.
 *
 * @since 0.2.0
 */
export type ThemeTokenName =
  | "--vault-canvas"
  | "--vault-bg"
  | "--vault-surface"
  | "--vault-surface-hover"
  | "--vault-surface-active"
  | "--vault-border"
  | "--vault-border-strong"
  | "--vault-menu-bg"
  | "--vault-text"
  | "--vault-text-muted"
  | "--vault-text-faint"
  | "--vault-primary"
  | "--vault-primary-hover"
  | "--vault-primary-active"
  | "--vault-primary-light"
  | "--vault-primary-border"
  | "--vault-on-primary"
  | "--vault-on-danger"
  | "--vault-accent-text"
  | "--vault-success"
  | "--vault-success-bg"
  | "--vault-success-border"
  | "--vault-warning"
  | "--vault-warning-bg"
  | "--vault-warning-border"
  | "--vault-danger"
  | "--vault-danger-bg"
  | "--vault-danger-border"
  | "--vault-danger-hover"
  | "--vault-shadow-sm"
  | "--vault-shadow-md"
  | "--vault-shadow-lg"
  | "--vault-shadow-island"
  | "--vault-shadow-pop"
  | "--vault-scrim"
  | "--vault-hover"
  | "--vault-chip"
  | "--vault-chip-strong"
  | "--vault-sel"
  | "--vault-sel-strong"
  | "--vault-ring";

/**
 * The light or dark look that is shown now.
 *
 * @since 0.2.0
 */
export type ThemeMode = "light" | "dark";

/**
 * What `theme.onChange` reports.
 *
 * @since 0.2.0
 */
export interface ThemeChange {
  /** @since 0.2.0 */
  mode: ThemeMode;
  /** The id of the colour theme that is shown (`default` for the stock one). @since 0.2.0 */
  themeId: string;
}

/**
 * The colours the app shows, read only. Nothing is built until a plugin first
 * reads `ctx.theme`, and nothing listens until it calls `onChange`.
 *
 * @since 0.2.0
 */
export interface ThemeApi {
  /**
   * `"light"` or `"dark"`, as shown now.
   *
   * @since 0.2.0
   */
  mode(): ThemeMode;
  /**
   * Every token as the CSS string the app uses: some are `rgba(...)` colours
   * or shadows, not only `#rrggbb`. Frozen; read it again after a change.
   *
   * @since 0.2.0
   */
  tokens(): Readonly<Record<ThemeTokenName, string>>;
  /**
   * Called after the theme, the mode or the accent changes.
   *
   * @since 0.2.0
   */
  onChange(cb: (e: ThemeChange) => void): Disposable;
}
