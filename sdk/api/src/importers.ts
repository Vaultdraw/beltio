import type { Disposable } from "./disposable";
import type { SceneOp } from "./scene";

/**
 * A file the user dropped or picked.
 *
 * @since 0.6.0
 */
export interface ImportInput {
  /**
   * The file name only, never a path.
   *
   * @since 0.6.0
   */
  name: string;
  /**
   * Size in bytes.
   *
   * @since 0.6.0
   */
  size: number;
  /**
   * The file's bytes, read on demand.
   *
   * @since 0.6.0
   */
  bytes(): Promise<Uint8Array>;
  /**
   * The file as UTF-8 text; invalid bytes become U+FFFD.
   *
   * @since 0.6.0
   */
  text(): Promise<string>;
}

/**
 * Where an import goes and how to stop it.
 *
 * @since 0.6.0
 */
export interface ImportOptions {
  /**
   * Aborted when the user switches drawing, the plugin is stopped, or the
   * user runs "Import: Cancel".
   *
   * @since 0.6.0
   */
  signal: AbortSignal;
  /**
   * A scene point: the drop point, or the viewport centre for the picker.
   *
   * @since 0.6.0
   */
  at: { x: number; y: number };
  /**
   * The drawing the result goes into.
   *
   * @since 0.6.0
   */
  path: string;
}

/**
 * What an importer returns: ops to apply as one undo step, or nothing when
 * it did its own work (`ctx.vault.createDrawing`, `ctx.workspace.open`).
 *
 * @since 0.6.0
 */
export type ImportResult = { ops: readonly SceneOp[] } | void;

/**
 * Code that turns one file type into drawing content.
 *
 * @since 0.6.0
 */
export interface Importer {
  /** @since 0.6.0 */
  import(
    input: ImportInput,
    opts: ImportOptions,
  ): Promise<ImportResult> | ImportResult;
}

/**
 * Importers a plugin declares in `plugin.toml` (`[[contributes.importers]]`).
 *
 * @since 0.6.0
 */
export interface ImportersApi {
  /**
   * Registers the code for an importer declared in `plugin.toml`. An id that
   * is not declared is refused.
   *
   * @since 0.6.0
   */
  register(id: string, importer: Importer): Disposable;
}
