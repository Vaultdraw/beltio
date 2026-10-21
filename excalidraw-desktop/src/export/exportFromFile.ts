/**
 * Export a vault drawing from the navigator without opening it: read the
 * file, restore it off-screen and render it through the same path as the
 * editor's export dialog (`renderImageExport`: standard colours, scale,
 * background, dark, embed scene), then hand the bytes to the native save
 * dialog. "Save a copy…" is a native byte-for-byte file copy.
 */

import { loadFromJSONText } from "@excalidraw/excalidraw";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { withStandardCanvasColors } from "../editor/canvasSync";
import { exportFileName, renderImageExport } from "../editor/imageExport";

import { renderPdf } from "./pdf/renderPdf";

import type { VaultRepository } from "../vault/types";

export type ExplorerExportFormat = "png" | "svg" | "pdf" | "copy";

export type ExplorerExportOptions = {
  scale: number;
  background: boolean;
  embedScene: boolean;
  /** Paper pattern (notebook backgrounds); only with the background. */
  pattern: boolean;
  dark: boolean;
  /** Page mode: the whole page column instead of the content (PNG/SVG). */
  pageShaped?: boolean;
};

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

const loadScene = async (json: string) => loadFromJSONText(json, null, null);

/** Restores the drawing's JSON into an export request (no editor needed). */
export const sceneToExportRequest = async (
  json: string,
  name: string,
  type: "png" | "svg",
  options: ExplorerExportOptions,
  win: Window & typeof globalThis,
): Promise<ImageExportRequest> => {
  const scene = await loadScene(json);
  return {
    type,
    // The whole (non-deleted) scene, like the dialog without "only selected".
    elements: getNonDeletedElements(
      scene.elements,
    ) as unknown as ImageExportRequest["elements"],
    // Restored appState lacks only the viewport fields (width, offsets),
    // which exports never read.
    appState: {
      ...scene.appState,
      exportScale: options.scale,
      exportBackground: options.background,
      exportEmbedScene: options.embedScene,
      // Like the dialog's "Background pattern" switch: off without background.
      exportBackgroundPattern: options.background && options.pattern,
      exportWithDarkMode: options.dark,
      exportPageShaped: !!options.pageShaped,
    } as ImageExportRequest["appState"],
    files: scene.files,
    exportingFrame: null,
    name,
  };
};

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
  if (format === "pdf") {
    const scene = await loadScene(json);
    const pdf = await withStandardCanvasColors(() =>
      renderPdf({
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        pattern: options.pattern,
        onProgress: input.onProgress,
      }),
    );
    input.onRendered?.();
    return repository.exportFile(
      exportFileName(baseName(path), "pdf", false),
      pdf,
    );
  }
  const request = await sceneToExportRequest(
    json,
    baseName(path),
    format,
    options,
    win,
  );
  const image = await renderImageExport(request, win);
  input.onRendered?.();
  return repository.exportFile(image.fileName, image.bytes);
};
