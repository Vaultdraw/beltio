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
 * The vault's link graph, as bytes. The format is the app's `VDG1` graph export (a compact binary
 * table of notes, drawings, tags and links); a plugin that draws a graph decodes it itself.
 *
 * @since 0.18.0
 */
export interface VaultGraphApi {
  /**
   * The whole graph of the open vault in one call. Needs `vault.read`. Starts the link index if
   * it is not running yet, so the first call can take a moment on a large vault.
   *
   * @since 0.18.0
   */
  read(): Promise<Uint8Array>;
  /**
   * A place to keep a graph view's computed layout so it opens instantly next time. The app keeps
   * it per vault in its state folder (never inside the vault); the bytes are the plugin's own format.
   *
   * @since 0.18.0
   */
  readonly layout: {
    /** The saved bytes, empty when none. Needs `vault.read`. @since 0.18.0 */
    load(): Promise<Uint8Array>;
    /** Replaces the saved bytes; empty clears. Needs `vault.write`. @since 0.18.0 */
    save(bytes: Uint8Array): Promise<void>;
  };
}

/**
 * One change to the plugin's own vault settings table.
 *
 * @since 0.19.0
 */
export interface VaultTableChange {
  /** A plain key of the table (letters, digits, `_`, `-`); no dots. @since 0.19.0 */
  key: string;
  /** A string, number, boolean, list or table; `null` removes the key. @since 0.19.0 */
  value: unknown;
}

/**
 * The plugin's own table in the open vault's `.excalidraw-vault/settings.toml`: `[<plugin id>]`.
 * Only plugins that ship with the app may use it (a plugin from anywhere else keeps scalar
 * settings under `[plugin.<id>]` with `contributes.settings`). Comments and other tables in the
 * file stay as they are.
 *
 * @since 0.19.0
 */
export interface VaultTableApi {
  /** The table as an object, `{}` when there is none. Needs `vault.read`. @since 0.19.0 */
  read(): Promise<Record<string, unknown>>;
  /** Applies the changes in one write. Needs `vault.write`; refused in a read-only vault. @since 0.19.0 */
  update(changes: readonly VaultTableChange[]): Promise<void>;
}

/**
 * The drawings of the open vault. Paths are vault-relative and use "/";
 * entries and segments that start with a dot are never listed or accepted.
 * Errors carry a `code`: `PERMISSION`, `INVALID_ARGUMENT`, `INVALID_PATH`,
 * `NOT_FOUND`, `NAME_COLLISION`, `READ_ONLY`, `NO_VAULT`, `INVALID_FILE`,
 * `IO_ERROR`.
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
   * ops (and, from 0.4.0, `group` ops with refs and `data`), and refuses when
   * the path exists. Needs `vault.write`. `refs` maps each `ref` to its id.
   *
   * @since 0.6.0
   */
  createDrawing(
    path: string,
    ops: readonly SceneOp[],
  ): Promise<{
    path: string;
    revision: string;
    ids: string[];
    refs: Record<string, string>;
  }>;
  /**
   * The vault's link graph.
   *
   * @since 0.18.0
   */
  readonly graph: VaultGraphApi;
  /**
   * The plugin's own table in the vault's settings file (bundled plugins only).
   *
   * @since 0.19.0
   */
  readonly table: VaultTableApi;
}
