/**
 * Where a context menu item was chosen.
 *
 * @since 0.12.0
 */
export interface MenuTarget {
  /**
   * The menu: a file or folder row in the navigator (`"tree"`), a tab (`"tab"`) or the drawing's
   * right-click menu (`"canvas"`).
   *
   * @since 0.12.0
   */
  surface: "tree" | "tab" | "canvas";
  /**
   * Vault-relative path of the row, tab or open drawing; null for the home tab or no open file.
   *
   * @since 0.12.0
   */
  path: string | null;
  /**
   * The kind of the row (`"tree"` only).
   *
   * @since 0.12.0
   */
  kind?: "drawing" | "note" | "folder" | "other";
  /**
   * Where on the canvas, in scene coordinates (`"canvas"` only).
   *
   * @since 0.12.0
   */
  at?: { x: number; y: number };
}

/**
 * Context menus: items are declared in plugin.toml (`[[contributes.menus]]`) and run one of the
 * plugin's commands. The command reads where the item was chosen with `target()`.
 *
 * @since 0.12.0
 */
export interface MenusApi {
  /**
   * Where the menu item that started the running command was chosen, or null when the command did
   * not come from a menu item (the palette, a key). Valid until the command finishes.
   *
   * @since 0.12.0
   */
  target(): MenuTarget | null;
}
