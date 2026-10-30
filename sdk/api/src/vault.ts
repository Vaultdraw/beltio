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
 * @experimental Outside the 1.0 promise: it may change or go in a minor release.
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
 * @experimental Outside the 1.0 promise: it may change or go in a minor release.
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
 * @experimental Outside the 1.0 promise: it may change or go in a minor release.
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
 * What an exported image looks like.
 *
 * @since 0.27.0
 */
export interface ExportImageOptions {
  /** @since 0.27.0 */
  format: "svg" | "png";
  /** PNG pixel scale, 1 to 3 (default 1). @since 0.27.0 */
  scale?: number;
  /** Paint the canvas background (default true). @since 0.27.0 */
  background?: boolean;
  /** Render with the dark theme's colours (default false). @since 0.27.0 */
  dark?: boolean;
}

/**
 * Rendered exports in the vault: the app's own SVG and PNG export of a drawing, written into the
 * vault as a `.svg` or `.png` file. These are the only files a plugin can write besides drawings,
 * and only at paths without a dot segment. Errors carry the codes of the rest of `ctx.vault`.
 *
 * @since 0.27.0
 */
export interface VaultExportsApi {
  /**
   * Renders the drawing at `path` and writes the image to `to` (a path ending in `.svg` or `.png`
   * that matches `options.format`), replacing the file when it exists and creating the folders.
   * Resolves with the bytes written, or `null` when the drawing is empty (nothing is written).
   * Needs `vault.read` and `vault.write`. Runs on the main thread: queue calls one at a time.
   *
   * @since 0.27.0
   */
  render(
    path: string,
    to: string,
    options: ExportImageOptions,
  ): Promise<{ path: string; size: number } | null>;
  /**
   * Moves an export file, or a folder that holds only exports, replacing an existing file. Resolves
   * false when `from` does not exist. Needs `vault.write`.
   *
   * @since 0.27.0
   */
  move(from: string, to: string): Promise<boolean>;
  /**
   * Deletes an export file, or a folder that holds only exports (it refuses a folder with anything
   * else in it). Resolves false when it does not exist. Needs `vault.write`.
   *
   * @since 0.27.0
   */
  remove(path: string): Promise<boolean>;
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
   * Writes a whole drawing (scene JSON as `pages.buildScene` returns it) at `path`, over the one
   * there: the drawing as it was is saved in the vault's History first, under `versionName`, so
   * the user can restore it; when that fails nothing is written (`NO_VERSION`). Pending edits of
   * the open drawing are saved first and its tab shows the new drawing after. A missing drawing
   * is created. With `onlyIfUntouched`, a drawing the user changed since the import wrote it
   * (anything moved, resized, retyped, restyled, reordered, added or deleted) is left alone and
   * the call resolves `{ skipped: "changed" }`; a drawing written before the import stamped its
   * elements resolves `{ skipped: "unknown" }` (nobody can tell, so it is never rewritten on a
   * guess). Needs `vault.write`. Errors: `READ_ONLY`, `NO_VERSION`, `CONFLICT`,
   * `INVALID_PATH`, `NO_VAULT`.
   *
   * @since 0.33.0
   */
  replaceDrawing(
    path: string,
    scene: object,
    options: { versionName: string; onlyIfUntouched?: boolean },
  ): Promise<
    { revision: string; created?: boolean } | { skipped: "changed" | "unknown" }
  >;
  /**
   * Moves a drawing to the system Trash, after saving it as it was in the vault's History under
   * `versionName` (when that fails nothing is moved: `NO_VERSION`). With `onlyIfUntouched` it
   * moves only a drawing the import wrote and nobody changed since (see `replaceDrawing`), and
   * otherwise resolves `{ skipped: "changed" | "unknown" }`. What a re-import does with the
   * leftover parts of a note that got shorter. Needs `vault.write`. Errors: `READ_ONLY`,
   * `NO_VERSION`, `NOT_FOUND`, `INVALID_PATH`, `NO_VAULT`.
   *
   * @since 0.35.0
   */
  trashDrawing(
    path: string,
    options: { versionName: string; onlyIfUntouched?: boolean },
  ): Promise<{ trashed: true } | { skipped: "changed" | "unknown" }>;
  /**
   * The vault's link graph.
   *
   * @experimental Outside the 1.0 promise: it may change or go in a minor release.
   * @since 0.18.0
   */
  readonly graph: VaultGraphApi;
  /**
   * SVG and PNG exports of drawings, written into the vault.
   *
   * @since 0.27.0
   */
  readonly exports: VaultExportsApi;
  /**
   * The plugin's own table in the vault's settings file (bundled plugins only).
   *
   * @experimental Outside the 1.0 promise: it may change or go in a minor release.
   * @since 0.19.0
   */
  readonly table: VaultTableApi;
}
