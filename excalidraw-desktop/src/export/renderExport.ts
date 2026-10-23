/**
 * Off-screen render of a drawing's JSON to export bytes: the one path shared
 * by the explorer export, the dialog's request shape and the control method
 * `export.render`. Everything between reading the file and saving the bytes.
 */

import { loadFromJSONText } from "@excalidraw/excalidraw";
import { getNonDeletedElements, isFrameLikeElement } from "@excalidraw/element";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { ControlError } from "../control/errors";
import { withStandardCanvasColors } from "../editor/canvasSync";
import { exportFileName, renderImageExport } from "../editor/imageExport";

import { ExportError } from "./exportError";

import { renderPdf } from "./pdf/renderPdf";

export type ExplorerExportOptions = {
  scale: number;
  background: boolean;
  embedScene: boolean;
  /** Paper pattern (notebook backgrounds); only with the background. */
  pattern: boolean;
  dark: boolean;
  /** Page mode: the whole page column instead of the content (PNG/SVG). */
  pageShaped?: boolean;
  /** Export one frame (or magicframe) by id, else by name (PNG/SVG). */
  frame?: string;
  /** Canvas padding in px (PNG/SVG); the editor's default when absent. */
  padding?: number;
};

const loadScene = async (json: string) => {
  try {
    return await loadFromJSONText(json, null, null);
  } catch (e) {
    throw new ExportError(
      "INVALID_FILE",
      `Not a drawing: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

/**
 * The frame (or magicframe) an export is cropped to: the first with `id`
 * equal to `frame`, else the first with that `name` (case-sensitive). Deleted
 * elements never match. NOT_FOUND (with `{frame}`) when there is none.
 */
export const findExportFrame = (
  elements: readonly ExcalidrawElement[],
  frame: string,
): NonDeleted<ExcalidrawFrameLikeElement> => {
  const frames = getNonDeletedElements(elements).filter(
    (e): e is NonDeleted<ExcalidrawFrameLikeElement> => isFrameLikeElement(e),
  );
  const found =
    frames.find((e) => e.id === frame) ?? frames.find((e) => e.name === frame);
  if (!found) {
    throw new ControlError("NOT_FOUND", `No such frame ${frame}`, { frame });
  }
  return found;
};

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
    exportingFrame:
      options.frame === undefined
        ? null
        : findExportFrame(scene.elements, options.frame),
    name,
  };
};

export type RenderedExport = {
  bytes: Uint8Array;
  mime: "image/png" | "image/svg+xml" | "application/pdf";
  fileName: string;
};

/**
 * `name` is the drawing's file name. PDF ignores `options.dark` and always
 * paints the background (JPEG pages have no alpha), as `renderPdf` does.
 * Rejects "Cannot export an empty canvas." for a drawing without elements.
 */
export const renderExport = async (
  json: string,
  name: string,
  format: "png" | "svg" | "pdf",
  options: ExplorerExportOptions,
  win: Window & typeof globalThis,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedExport> => {
  if (format === "pdf") {
    const scene = await loadScene(json);
    const bytes = await withStandardCanvasColors(() =>
      renderPdf({
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        pattern: options.pattern,
        onProgress,
      }),
    );
    return {
      bytes,
      mime: "application/pdf",
      fileName: exportFileName(name, "pdf", false),
    };
  }
  const request = await sceneToExportRequest(json, name, format, options, win);
  return renderImageExport(request, win, { padding: options.padding });
};
