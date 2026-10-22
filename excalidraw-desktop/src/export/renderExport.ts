/**
 * Off-screen render of a drawing's JSON to export bytes: the one path shared
 * by the explorer export, the dialog's request shape and the control method
 * `export.render`. Everything between reading the file and saving the bytes.
 */

import { loadFromJSONText } from "@excalidraw/excalidraw";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { withStandardCanvasColors } from "../editor/canvasSync";
import { exportFileName, renderImageExport } from "../editor/imageExport";

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
};

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
  return renderImageExport(request, win);
};
