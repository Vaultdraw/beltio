/**
 * What is open in the window.
 *
 * @since 0.6.0
 */
export interface WorkspaceApi {
  /**
   * Opens a drawing, in a new tab with `newTab`. Free. Fails with
   * `NO_VAULT` when no vault is open, `NOT_FOUND` when the drawing does not
   * exist, `IO_ERROR` when it could not be opened.
   *
   * @since 0.6.0
   */
  open(path: string, opts?: { newTab?: boolean }): Promise<void>;
  /**
   * The active drawing's vault-relative path, or null. Free.
   *
   * @since 0.6.0
   */
  activePath(): string | null;
  /**
   * The key label bound to "open this drawing" (in the user's notation for the platform, for
   * example "Ctrl+Alt+1"), or null when none is. Follows the user's own key bindings. Free.
   *
   * @since 0.21.0
   */
  openShortcut(path: string): string | null;
  /**
   * React hook: the entries of a folder, in the navigator's sort order, without the templates
   * folder, loading the folder if needed and updating when it changes. `undefined` until
   * the folder is listed. Call it while rendering a component the plugin gave the app.
   *
   * @since 0.20.0
   */
  useFolder(path: string): readonly FolderItem[] | undefined;
}

/**
 * One entry of a folder.
 *
 * @since 0.20.0
 */
export interface FolderItem {
  /** Vault-relative, "/"-separated. @since 0.20.0 */
  path: string;
  /** @since 0.20.0 */
  name: string;
  /** `note` is a Markdown note, `excalidrawMd` a drawing kept in a Markdown file. @since 0.20.0 */
  kind: "drawing" | "folder" | "note" | "excalidrawMd";
}
