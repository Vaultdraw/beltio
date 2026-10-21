import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState } from "@excalidraw/excalidraw/types";

import { LOADING_LINE_DELAY_MS, LoadingLine } from "./LoadingLine";
import {
  isSceneCurrent,
  isSwapping,
  loadScene,
  raceTimeout,
  swapAppState,
  withDocumentAppState,
} from "./sceneSwap";

const live = {
  theme: "dark",
  openSidebar: { name: "default" },
  viewModeEnabled: false,
  toast: null,
  preferredSelectionTool: { type: "selection", initialized: true },
} as unknown as Parameters<typeof swapAppState>[1];

describe("which scene may be saved", () => {
  it("is current only when the scene belongs to the props' document", () => {
    expect(isSceneCurrent("a", "a")).toBe(true);
    expect(isSceneCurrent("a", "b")).toBe(false);
    expect(isSceneCurrent(null, "a")).toBe(false);
  });

  it("is swapping only once a scene is loaded and the props moved on", () => {
    expect(isSwapping(null, "a")).toBe(false); // first load in progress
    expect(isSwapping("a", "a")).toBe(false);
    expect(isSwapping("a", "b")).toBe(true);
  });
});

describe("swapAppState", () => {
  const loaded = {
    viewBackgroundColor: "#fff3bf",
    gridModeEnabled: true,
    selectedElementIds: {},
    openDialog: null,
    editingTextElement: null,
    activeTool: { type: "image", customType: null, locked: false },
    theme: "light",
    openSidebar: null,
    viewModeEnabled: true,
    toast: { message: "old" },
    isLoading: true,
  } as unknown as Partial<AppState>;

  it("takes the document's state and the host's own keys from the live editor", () => {
    const next = swapAppState(loaded, live);
    expect(next.viewBackgroundColor).toBe("#fff3bf");
    expect(next.gridModeEnabled).toBe(true);
    expect(next.theme).toBe("dark");
    expect(next.openSidebar).toEqual({ name: "default" });
    expect(next.viewModeEnabled).toBe(false);
    expect(next.toast).toBeNull();
    expect(next.isLoading).toBe(false);
  });

  it("opens on the preferred selection tool, as a fresh editor does", () => {
    expect(swapAppState(loaded, live).activeTool?.type).toBe("selection");
    const drawing = {
      ...loaded,
      activeTool: { type: "freedraw", customType: null, locked: false },
    } as unknown as Partial<AppState>;
    expect(swapAppState(drawing, live).activeTool?.type).toBe("freedraw");
  });

  it("initialises the preferred selection tool when the editor has none yet", () => {
    const next = swapAppState(loaded, {
      ...live,
      preferredSelectionTool: { type: "selection", initialized: false },
    });
    expect(next.preferredSelectionTool).toEqual({
      type: "selection",
      initialized: true,
    });
  });
});

describe("withDocumentAppState", () => {
  it("drops the file handle and applies the remembered view", () => {
    const next = withDocumentAppState(
      { fileHandle: {} as never, scrollX: 1, scrollY: 2 },
      { scrollX: 10, scrollY: 20, zoom: 1.5 },
    );
    expect(next.fileHandle).toBeNull();
    expect([next.scrollX, next.scrollY, next.zoom?.value]).toEqual([
      10, 20, 1.5,
    ]);
  });

  it("keeps the file's own view without a remembered one", () => {
    const next = withDocumentAppState({ scrollX: 1, scrollY: 2 }, undefined);
    expect([next.scrollX, next.scrollY]).toEqual([1, 2]);
  });
});

describe("loadScene", () => {
  it("parses saved JSON into elements, files and a restored state", async () => {
    const json = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [],
      appState: { viewBackgroundColor: "#a5d8ff" },
      files: {},
    });
    const scene = await loadScene(json, {
      scrollX: 3,
      scrollY: 4,
      zoom: 2,
    });
    expect(scene.elements).toEqual([]);
    expect(scene.appState.viewBackgroundColor).toBe("#a5d8ff");
    expect(scene.appState.scrollX).toBe(3);
  });

  it("rejects unreadable sources", async () => {
    await expect(loadScene("{ nope", undefined)).rejects.toThrow();
  });
});

describe("raceTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the work, or after the limit, and never rejects", async () => {
    const done = vi.fn();
    void raceTimeout(new Promise(() => {}), 50).then(done);
    await vi.advanceTimersByTimeAsync(49);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toHaveBeenCalled();
    await expect(
      raceTimeout(Promise.reject(new Error("x")), 50),
    ).resolves.toBeUndefined();
  });
});

describe("LoadingLine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows only for loads longer than the delay", () => {
    const view = render(<LoadingLine active={true} />);
    act(() => void vi.advanceTimersByTime(LOADING_LINE_DELAY_MS - 1));
    expect(view.queryByRole("progressbar")).toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(view.queryByRole("progressbar")).not.toBeNull();
    view.rerender(<LoadingLine active={false} />);
    expect(view.queryByRole("progressbar")).toBeNull();
  });

  it("a quick load never flashes the line", () => {
    const view = render(<LoadingLine active={true} />);
    act(() => void vi.advanceTimersByTime(100));
    view.rerender(<LoadingLine active={false} />);
    act(() => void vi.advanceTimersByTime(500));
    expect(view.queryByRole("progressbar")).toBeNull();
  });
});
