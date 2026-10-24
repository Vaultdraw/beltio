import type { SceneElement, SceneOp } from "./scene";

/**
 * One entry of a vault folder.
 *
 * @since 0.6.0
 */
export interface VaultEntry {
  /**
   * Vault-relative, "/"-separated.
   *
   * @since 0.6.0
   */
  path: string;
  /** @since 0.6.0 */
  name: string;
  /** @since 0.6.0 */
  kind: "drawing" | "folder";
  /**
   * Milliseconds since the epoch.
   *
   * @since 0.6.0
   */
  modifiedAt: number;
  /**
   * Bytes; 0 for folders.
   *
   * @since 0.6.0
   */
  size: number;
}

/**
 * The drawings of the open vault. Paths are vault-relative and use "/";
 * entries and segments that start with a dot are never listed or accepted.
 * Errors carry a `code`: `PERMISSION`, `INVALID_PATH`, `NOT_FOUND`,
 * `NAME_COLLISION`, `READ_ONLY`, `NO_VAULT`, `INVALID_FILE`.
 *
 * @since 0.6.0
 */
export interface VaultApi {
  /**
   * The open vault (never its path on disk), or null when none is open. Free.
   *
   * @since 0.6.0
   */
  info(): { name: string; readOnly: boolean } | null;
  /**
   * One folder (`""` is the root), folders first. Dot entries and symlinks
   * are left out. Needs `vault.read`.
   *
   * @since 0.6.0
   */
  list(dir?: string): Promise<VaultEntry[]>;
  /**
   * A drawing as slim elements plus its revision. Needs `vault.read`.
   *
   * @since 0.6.0
   */
  readDrawing(
    path: string,
  ): Promise<{ elements: readonly SceneElement[]; revision: string }>;
  /**
   * Creates a new drawing (the path must end in `.excalidraw`) from `add`
   * ops, and refuses when the path exists. Needs `vault.write`.
   *
   * @since 0.6.0
   */
  createDrawing(
    path: string,
    ops: readonly SceneOp[],
  ): Promise<{ path: string; revision: string; ids: string[] }>;
}
