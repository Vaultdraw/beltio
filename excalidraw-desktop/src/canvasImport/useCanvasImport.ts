/**
 * "Import file…": pick files, then reuse the existing pipelines: a plugin's importer
 * (PDF, Markdown, …) for its file types, the editor's own image insertion for images (at
 * the right-clicked point, or the viewport centre from the palette).
 */
import { useCallback, useRef } from "react";

import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createsOwnDrawing, runImports } from "../plugins/importerMap";

import { importAccept, planImport, skippedMessage } from "./importFiles";
import { pickFiles } from "./pickFiles";

export type ScenePoint = { x: number; y: number };

export interface CanvasImportOptions {
  getApi: () => ExcalidrawImperativeAPI | undefined;
  getDocument: () => Document;
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
  options: Pick<CanvasImportOptions, "getApi" | "notify" | "getPath">,
) => {
  if (!files.length) {
    return;
  }
  const api = options.getApi();
  const plan = planImport(files);
  // Importers that make their own drawing (Markdown) run with no drawing open.
  const own = plan.plugin.filter((i) => createsOwnDrawing(i.match.pluginId));
  const inDrawing = plan.plugin.filter((i) => !own.includes(i));
  if (!api) {
    // Home pane: only own-drawing importers can run.
    const rest = [...plan.images, ...inDrawing.map((i) => i.file)];
    if (own.length) {
      await runImports(own, { path: null, at: at ?? { x: 0, y: 0 } });
    }
    if (rest.length) {
      options.notify(
        `Open a drawing to import ${rest.map((f) => f.name).join(", ")}.`,
      );
    }
    return;
  }
  if (plan.images.length) {
    await api.insertImages(plan.images, at);
  }
  const path = options.getPath?.() ?? null;
  if (inDrawing.length > 0 && path === null) {
    const names = inDrawing.map((i) => i.file.name).join(", ");
    options.notify(`Open a drawing to import ${names}.`);
  }
  let ran = true;
  if (own.length > 0) {
    ran = await runImports(own, { path, at: at ?? viewportCentre(api) });
  }
  const ranInDrawing =
    inDrawing.length > 0 &&
    path !== null &&
    (await runImports(inDrawing, { path, at: at ?? viewportCentre(api) }));
  // Host not running: the plugin files are reported like any unknown file.
  const unhandled = [
    ...(ran ? [] : own.map((i) => i.file)),
    ...(ranInDrawing || path === null ? [] : inDrawing.map((i) => i.file)),
  ];
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
    const { getDocument, pick = pickFiles } = live.current;
    const files = await pick(getDocument(), importAccept());
    await importPickedFiles(files, at, live.current);
  }, []);
};
