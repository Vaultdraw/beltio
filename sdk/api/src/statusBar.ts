import type { Disposable } from "./disposable";

/**
 * What a status bar item shows. Text only: the app draws it, so a plugin item
 * costs one small element and nothing while it has no text.
 *
 * @since 0.10.0
 */
export interface StatusBarState {
  /**
   * The text, at most 80 characters (longer text is cut). An empty string hides the item.
   *
   * @since 0.10.0
   */
  text: string;
  /**
   * Shown on hover. Default: the `title` from plugin.toml.
   *
   * @since 0.10.0
   */
  tooltip?: string;
  /**
   * Colours the text with a theme token: `"warn"` and `"error"` stand out, `"muted"` recedes.
   *
   * @since 0.10.0
   */
  tone?: "normal" | "muted" | "warn" | "error";
}

/**
 * Status bar: fill an item declared in plugin.toml (`[[contributes.status_bar]]`).
 * The bar is hidden while no item has text, and the user can turn it off with
 * `plugins.status_bar` or the command "Toggle plugin status bar".
 *
 * @since 0.10.0
 */
export interface StatusBarApi {
  /**
   * Shows or updates a declared item (short id). Cheap to call often: the app
   * redraws only when the text, tooltip or tone changed.
   *
   * @since 0.10.0
   */
  set(id: string, state: StatusBarState): void;
  /**
   * Hides a declared item (short id).
   *
   * @since 0.10.0
   */
  clear(id: string): void;
  /**
   * Like `set`, but the item is cleared when the returned handle is disposed.
   *
   * @since 0.10.0
   */
  show(id: string, state: StatusBarState): Disposable;
}
