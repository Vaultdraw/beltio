import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { useVaultEditorLinks } from "./useVaultEditorLinks";

import type { EditorLinksWiring } from "./useVaultEditorLinks";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const fakeApi = () => {
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => [],
    getSceneElementsIncludingDeleted: () => [],
    getAppState: () => ({ zoom: { value: 1 }, selectedElementIds: {} }),
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, updateScene };
};

const wiring = (currentPath: string): EditorLinksWiring => ({
  settings: {
    ...DEFAULT_LINKS_SETTINGS,
    styleLinks: true,
    autocomplete: false,
    hoverPreview: "off",
  },
  names: [],
  currentPath,
  callbacks: { openDrawing: vi.fn(), onUnresolved: vi.fn(), onCreate: vi.fn() },
  links: null,
  handle: null,
  pickDrawing: async () => null,
  bridge: { current: null },
});

describe("link styling across a scene swap", () => {
  it("keeps the styler on the shown scene: no repaint when the swap starts or lands", () => {
    const { api, updateScene } = fakeApi();
    const a = wiring("Work/a.excalidraw");
    const hook = renderHook(
      ({ ready, w }: { ready: boolean; w: EditorLinksWiring }) =>
        useVaultEditorLinks(ready ? api : null, null, w, api),
      { initialProps: { ready: true, w: a } },
    );
    // installing the styler repaints the scene once
    expect(updateScene).toHaveBeenCalledTimes(1);
    updateScene.mockClear();

    // swap in flight: links wait (api null), the old scene stays styled
    const b = wiring("Work/b.excalidraw");
    hook.rerender({ ready: false, w: b });
    expect(updateScene).not.toHaveBeenCalled();

    // the new scene landed: its own render already used the styler
    hook.rerender({ ready: true, w: b });
    expect(updateScene).not.toHaveBeenCalled();
  });
});
