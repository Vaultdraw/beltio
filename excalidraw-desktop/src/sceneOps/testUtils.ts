/** Test helpers: real elements built through the fork, and a stub scene api. */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

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
) => {
  const updateScene = vi.fn();
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
    updateScene,
  } as unknown as SceneApi;
  return { api, updateScene };
};
