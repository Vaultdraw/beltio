/**
 * `ctx.folders`: a folder the user picks to read from, and a destination the
 * user picks to write into, for importing other tools' folders into a vault.
 * Needs the permission `folders.import`. The source is never written.
 */

/**
 * One file of a source folder.
 *
 * @since 0.9.0
 */
export interface FolderEntry {
  /** Relative to the folder, "/"-separated. @since 0.9.0 */
  path: string;
  /** Bytes. @since 0.9.0 */
  size: number;
  /** Milliseconds since the epoch. @since 0.9.0 */
  modifiedAt: number;
}

/**
 * Options of `folders.pickSource`.
 *
 * @since 0.9.0
 */
export interface PickSourceOptions {
  /** The dialog's title. @since 0.9.0 */
  title?: string;
}

/**
 * Where `folders.pickTarget` writes: a new vault folder the user picks in a
 * save dialog (it must not exist, or be empty), or a folder inside the open
 * vault (created when missing, no dialog).
 *
 * @since 0.9.0
 */
export type PickTargetOptions =
  | { kind: "newVault"; title?: string }
  | { kind: "vaultFolder"; path: string };

/**
 * A folder the user picked, read-only. The handle lives for the session.
 *
 * @since 0.9.0
 */
export interface SourceFolder {
  /** The folder's name (never its path on disk). @since 0.9.0 */
  readonly name: string;
  /**
   * Every file below the folder, recursively, at most 100,000. Any segment
   * that starts with "." (`.obsidian`, `.trash`, `.git`) and symlinks are
   * skipped.
   *
   * @since 0.9.0
   */
  list(): Promise<FolderEntry[]>;
  /** A file as UTF-8 text (lossy), at most 64 MiB. @since 0.9.0 */
  readText(path: string): Promise<string>;
  /** A file's bytes, at most 64 MiB. @since 0.9.0 */
  readBytes(path: string): Promise<Uint8Array>;
}

/**
 * A destination the user picked. Writes are create-only: an existing file is
 * refused with `NAME_COLLISION`, never overwritten.
 *
 * @since 0.9.0
 */
export interface TargetFolder {
  /** @since 0.9.0 */
  readonly name: string;
  /** @since 0.9.0 */
  readonly kind: "newVault" | "vaultFolder";
  /**
   * Writes a drawing (scene JSON as `pages.buildScene` returns it) at `path`,
   * which must end in `.excalidraw`. Atomic.
   *
   * @since 0.9.0
   */
  writeDrawing(path: string, scene: object): Promise<void>;
  /**
   * Copies a file of a source folder to `to` in this folder, natively (the
   * bytes never pass through the plugin).
   *
   * @since 0.9.0
   */
  copyFrom(source: SourceFolder, from: string, to: string): Promise<void>;
  /**
   * Converts an Obsidian Excalidraw file (`*.excalidraw.md`, plain or
   * compressed) of a source folder into the drawing `to` (ends in
   * `.excalidraw`), natively. Create-only; `INVALID_FILE` when the file holds
   * no drawing.
   *
   * @since 0.9.0
   */
  convertDrawing(source: SourceFolder, from: string, to: string): Promise<void>;
  /**
   * A new vault: the app opens it. A vault folder: the app reveals it in the
   * file tree.
   *
   * @since 0.9.0
   */
  open(): Promise<void>;
}

/**
 * Folders outside the vault: pick one to read, pick a destination to write.
 * Every call needs `folders.import` (bundled plugins need no consent).
 *
 * @since 0.9.0
 */
export interface FoldersApi {
  /** A native folder dialog; null when the user cancels. @since 0.9.0 */
  pickSource(options?: PickSourceOptions): Promise<SourceFolder | null>;
  /**
   * A new vault (save dialog; null when cancelled) or a folder in the open
   * vault (`NO_VAULT` when none is open, `READ_ONLY` when it is).
   *
   * @since 0.9.0
   */
  pickTarget(options: PickTargetOptions): Promise<TargetFolder | null>;
}
