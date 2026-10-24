/**
 * What is open in the window.
 *
 * @since 0.6.0
 */
export interface WorkspaceApi {
  /**
   * Opens a drawing, in a new tab with `newTab`. Free. Fails with
   * `NOT_FOUND` when the drawing does not exist.
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
}
