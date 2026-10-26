/** Test helpers: real elements built through the fork, and a stub scene api. */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import type { SceneApi } from "./types";

export const makeElements = (n: number): ExcalidrawElement[] =>
  convertToExcalidrawElements(
    Array.from({ length: n }, (_, i) => ({
      type: "rectangle" as const,
      x: (i % 100) * 120,
      y: Math.floor(i / 100) * 120,
      width: 100,
      height: 80,
    })),
  ) as ExcalidrawElement[];

export const byId = (els: readonly ExcalidrawElement[]) =>
  new Map(els.map((e) => [e.id, e]));

export const stubApi = (
  els: readonly ExcalidrawElement[] = [],
  appState: Partial<AppState> = {},
  files: BinaryFiles = {},
) => {
  const order: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateScene = vi.fn((..._args: any[]) => {
    order.push("updateScene");
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addFiles = vi.fn((list: readonly any[]) => {
    order.push("addFiles");
    for (const f of list) {
      files = { ...files, [f.id]: f } as BinaryFiles;
    }
  });
  const api = {
    getAppState: () =>
      ({
        scrollX: 0,
        scrollY: 0,
        width: 1000,
        height: 600,
        zoom: { value: 1 },
        ...appState,
      } as AppState),
    getSceneElementsIncludingDeleted: () => els,
    getFiles: () => files,
    addFiles,
    updateScene,
  } as unknown as SceneApi;
  return { api, updateScene, addFiles, order };
};
