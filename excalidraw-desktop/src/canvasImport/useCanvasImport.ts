/**
 * "Import file…": pick PDFs/images, then reuse the existing pipelines: the PDF
 * import dialog for a PDF, the editor's own image insertion for images (at the
 * right-clicked point, or the viewport centre from the palette).
 */
import { useCallback, useRef } from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { runImports } from "../plugins/importerMap";

import { importAccept, planImport, skippedMessage } from "./importFiles";
import { pickFiles } from "./pickFiles";

export type ScenePoint = { x: number; y: number };

export interface CanvasImportOptions {
  getApi: () => ExcalidrawImperativeAPI | undefined;
  getDocument: () => Document;
  openPdf: (file: File) => void | Promise<void>;
  /** Vault-relative path of the active drawing (plugin imports target it). */
  getPath?: () => string | null;
  notify: (message: string) => void;
  /** Injected in tests. */
  pick?: (doc: Document, accept: string) => Promise<File[]>;
}

const viewportCentre = (api: ExcalidrawImperativeAPI): ScenePoint => {
  const s = api.getAppState();
  return viewportCoordsToSceneCoords(
    {
      clientX: s.offsetLeft + s.width / 2,
      clientY: s.offsetTop + s.height / 2,
    },
    s,
  );
};

export const importPickedFiles = async (
  files: readonly File[],
  at: ScenePoint | undefined,
  options: Pick<
    CanvasImportOptions,
    "getApi" | "openPdf" | "notify" | "getPath"
  >,
) => {
  const api = options.getApi();
  if (!api || !files.length) {
    return;
  }
  const plan = planImport(files);
  if (plan.images.length) {
    await api.insertImages(plan.images, at);
  }
  if (plan.pdf) {
    await options.openPdf(plan.pdf);
  }
  const path = options.getPath?.() ?? null;
  if (plan.plugin.length > 0 && path === null) {
    const names = plan.plugin.map((i) => i.file.name).join(", ");
    options.notify(`Open a drawing to import ${names}.`);
  }
  const ran =
    plan.plugin.length > 0 &&
    path !== null &&
    (await runImports(plan.plugin, { path, at: at ?? viewportCentre(api) }));
  // Host not running: the plugin files are reported like any unknown file.
  const unhandled = ran || path === null ? [] : plan.plugin.map((i) => i.file);
  const skipped = skippedMessage([...unhandled, ...plan.skipped]);
  if (skipped) {
    options.notify(skipped);
  }
};

/** Stable `importFile(at?)`; nothing runs until it is called. */
export const useCanvasImport = (options: CanvasImportOptions) => {
  const live = useRef(options);
  live.current = options;
  return useCallback(async (at?: ScenePoint) => {
    const { getApi, getDocument, pick = pickFiles } = live.current;
    if (!getApi()) {
      return;
    }
    const files = await pick(getDocument(), importAccept());
    await importPickedFiles(files, at, live.current);
  }, []);
};
