/**
 * Export a vault drawing from the navigator without opening it: read the
 * file, restore it off-screen and render it through the same path as the
 * editor's export dialog (`renderImageExport`: standard colours, scale,
 * background, dark, embed scene), then hand the bytes to the native save
 * dialog. "Save a copy…" is a native byte-for-byte file copy.
 */

import { renderExport } from "./renderExport";

import type { ExplorerExportOptions } from "./renderExport";

import type { VaultRepository } from "../vault/types";

export { sceneToExportRequest } from "./renderExport";
export type { ExplorerExportOptions } from "./renderExport";

export type ExplorerExportFormat = "png" | "svg" | "pdf" | "copy";

type ExportRepository = Pick<
  VaultRepository,
  "readDrawing" | "exportFile" | "saveDrawingCopy"
>;

/** The one place that reads a drawing's JSON for export. */
export const readDrawingJson = async (
  repository: ExportRepository,
  handle: string,
  path: string,
): Promise<string> => (await repository.readDrawing(handle, path)).json;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Exports the drawing at `path`. Resolves false when the user cancels the
 * save dialog; rejects on errors (e.g. an empty drawing).
 */
export const exportDrawingFromVault = async (input: {
  repository: ExportRepository;
  handle: string;
  path: string;
  format: ExplorerExportFormat;
  options: ExplorerExportOptions;
  win: Window & typeof globalThis;
  /** Called with the file's JSON before the (main-thread) render starts. */
  beforeRender?: (json: string) => void | Promise<void>;
  /** Called after rendering, right before the save dialog opens. */
  onRendered?: () => void;
  /** PDF only: pages rendered so far. */
  onProgress?: (done: number, total: number) => void;
}): Promise<boolean> => {
  const { repository, handle, path, format, options, win } = input;
  if (format === "copy") {
    input.onRendered?.();
    return repository.saveDrawingCopy(handle, path);
  }
  const json = await readDrawingJson(repository, handle, path);
  await input.beforeRender?.(json);
  const out = await renderExport(
    json,
    baseName(path),
    format,
    options,
    win,
    input.onProgress,
  );
  input.onRendered?.();
  return repository.exportFile(out.fileName, out.bytes);
};
