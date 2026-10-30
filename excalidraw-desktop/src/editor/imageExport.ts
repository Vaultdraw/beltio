/**
 * Renders an image export request from the editor's export dialog (or the
 * copy-as-PNG/SVG actions) into bytes. Mirrors the semantics of
 * packages/excalidraw/data exportCanvas, minus the browser file/clipboard
 * sinks: the shell saves or copies the bytes natively.
 */

import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { SVG_DOCUMENT_PREAMBLE } from "@excalidraw/common";

import {
  createPageAreaExportFrame,
  detachFromFrames,
} from "@excalidraw/excalidraw/data/pageExportFrame";
import { isPageModeOn } from "@excalidraw/excalidraw/data/pageSetup";

import type { ImageExportRequest } from "@excalidraw/excalidraw/types";

import { drawingStem } from "../vault/fileKind";

import { emptyCanvasError } from "../export/exportError";

import { withStandardCanvasColors } from "./canvasSync";

export type RenderedImage = {
  bytes: Uint8Array;
  fileName: string;
  mime: "image/png" | "image/svg+xml";
};

/** The same render as [RenderedImage] with the bytes still in a Blob (no whole-image copy). */
export type RenderedImageBlob = Omit<RenderedImage, "bytes"> & { blob: Blob };

const isClipboard = (type: ImageExportRequest["type"]) =>
  type === "clipboard" || type === "clipboard-svg";

export const exportFileName = (
  drawingName: string,
  extension: "png" | "svg" | "pdf",
  embedScene: boolean,
) => {
  const base = drawingStem(drawingName) || "Drawing";
  return `${base}${embedScene ? ".excalidraw" : ""}.${extension}`;
};

/** Options the export dialog does not have (the control API sets them). */
export type ImageExportExtras = {
  /** Space around the content in px; the editor's default (10) when absent. */
  padding?: number;
};

export const renderImageExport = async (
  request: ImageExportRequest,
  win: Window & typeof globalThis,
  extras: ImageExportExtras = {},
): Promise<RenderedImage> => {
  const { blob, ...rest } = await renderImageBlob(request, win, extras);
  return { ...rest, bytes: new Uint8Array(await blob.arrayBuffer()) };
};

/** [renderImageExport] without turning the result into one big byte array. */
export const renderImageBlob = (
  request: ImageExportRequest,
  win: Window & typeof globalThis,
  extras: ImageExportExtras = {},
): Promise<RenderedImageBlob> => {
  if (request.elements.length === 0) {
    return Promise.reject(emptyCanvasError());
  }
  const svg = request.type === "svg" || request.type === "clipboard-svg";
  // Scene embedding applies to files only, never to the clipboard.
  const embedScene =
    !isClipboard(request.type) && request.appState.exportEmbedScene;
  // Page-shaped: the export area is the whole page column (a frame the
  // caller already chose, e.g. a selected frame, wins).
  const { pageSetup } = request.appState;
  const pageShaped =
    request.appState.exportPageShaped &&
    !request.exportingFrame &&
    isPageModeOn(pageSetup);
  const options = {
    elements: pageShaped
      ? (detachFromFrames(
          request.elements,
        ) as unknown as ImageExportRequest["elements"])
      : request.elements,
    appState: { ...request.appState, exportEmbedScene: embedScene },
    files: request.files,
    exportingFrame: pageShaped
      ? createPageAreaExportFrame(pageSetup!)
      : request.exportingFrame,
  };
  // Exports never contain the theme's on-screen colours (the transform is
  // global), so the whole render runs with canvas sync suspended.
  return withStandardCanvasColors(async () => {
    if (svg) {
      const element = await exportToSvg({
        ...options,
        exportPadding: extras.padding,
        renderEmbeddables: false,
      });
      const text =
        SVG_DOCUMENT_PREAMBLE +
        new win.XMLSerializer().serializeToString(element);
      return {
        blob: new Blob([text], { type: "image/svg+xml" }),
        fileName: exportFileName(request.name, "svg", embedScene),
        mime: "image/svg+xml" as const,
      };
    }
    // The public exportToBlob ignores appState.exportScale unless it gets
    // getDimensions (the editor's own export path sizes the canvas itself).
    const scale = request.appState.exportScale || 1;
    const blob = await exportToBlob({
      ...options,
      exportPadding: extras.padding,
      mimeType: "image/png",
      getDimensions: (width, height) => ({
        width: width * scale,
        height: height * scale,
        scale,
      }),
    });
    return {
      blob,
      fileName: exportFileName(request.name, "png", embedScene),
      mime: "image/png" as const,
    };
  });
};
