import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { resetCanvasSync } from "../editor/canvasSync";
import { getSaveSignature } from "../editor/saveSignature";

import { rect } from "./testElements";
import { usePageMode } from "./usePageMode";

const state = (pageSetup: any) =>
  ({
    pageSetup,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
    scrollConstraints: null,
    selectedElementIds: {},
  } as any);

describe("usePageMode", () => {
  it("binds the Page commands while mounted; PageUp/PageDown only while page mode is on", async () => {
    let appState = state(null);
    const api = {
      getAppState: () => appState,
      getSceneElementsIncludingDeleted: () => [],
      getSceneElementsMapIncludingDeleted: () => new Map(),
      updateScene: (d: any) => {
        appState = { ...appState, ...d.appState };
      },
    };
    const { result, unmount } = renderHook(() =>
      usePageMode({
        apiRef: { current: api as any },
        getWindow: () => window,
        disabled: false,
        readOnly: false,
        openPageSetup: () => {},
      }),
    );
    expect(getRegisteredHandler("page.on")).toBeTypeOf("function");
    expect(getRegisteredHandler("page.next")).toBeUndefined();

    appState = state({ ...DEFAULT_PAGE_SETUP });
    await act(async () => {
      result.current.onChange([], appState);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getRegisteredHandler("page.next")).toBeTypeOf("function");

    appState = state({ ...DEFAULT_PAGE_SETUP, enabled: false });
    await act(async () => {
      result.current.onChange([], appState);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getRegisteredHandler("page.next")).toBeUndefined();

    unmount();
    expect(getRegisteredHandler("page.on")).toBeUndefined();
    resetCanvasSync();
  });

  it("shows the outside-the-page notice for old content, dismissible", async () => {
    const old = rect(-900, 10);
    const appState = state({ ...DEFAULT_PAGE_SETUP });
    const api = {
      getAppState: () => appState,
      getSceneElementsIncludingDeleted: () => [old],
      getSceneElementsMapIncludingDeleted: () =>
        new Map([[old.id, old]]) as any,
      updateScene: () => {},
    };
    const { result } = renderHook(() =>
      usePageMode({
        apiRef: { current: api as any },
        getWindow: () => window,
        disabled: false,
        readOnly: false,
        openPageSetup: () => {},
      }),
    );
    await act(async () => {
      result.current.onChange([old], appState);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.notice?.count).toBe(1);
    // command audit (S8): the palette command exists only while the notice shows
    expect(getRegisteredHandler("page.dismissNotice")).toBeTypeOf("function");
    act(() => getRegisteredHandler("page.dismissNotice")!());
    expect(result.current.notice).toBeNull();
    expect(getRegisteredHandler("page.dismissNotice")).toBeUndefined();
    resetCanvasSync();
  });
});

describe("save signature", () => {
  it("changes with the page setup so page changes autosave", () => {
    const base = {
      viewBackgroundColor: "#fff",
      gridModeEnabled: false,
      viewBackgroundPattern: null,
    };
    const a = getSaveSignature([], { ...base, pageSetup: null });
    const b = getSaveSignature([], {
      ...base,
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    });
    const c = getSaveSignature([], {
      ...base,
      pageSetup: { ...DEFAULT_PAGE_SETUP, pageCount: 2 },
    });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("usePageMode reset (another document is shown)", () => {
  it("unbinds page navigation and starts the runtime over, so the next document's setup is judged fresh", async () => {
    let appState = state({ ...DEFAULT_PAGE_SETUP });
    const api = {
      getAppState: () => appState,
      getSceneElementsIncludingDeleted: () => [],
      getSceneElementsMapIncludingDeleted: () => new Map(),
      updateScene: (d: any) => {
        appState = { ...appState, ...d.appState };
      },
    };
    const { result } = renderHook(() =>
      usePageMode({
        apiRef: { current: api as any },
        getWindow: () => window,
        disabled: false,
        readOnly: false,
        openPageSetup: () => {},
      }),
    );
    await act(async () => {
      result.current.onChange([], appState);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getRegisteredHandler("page.next")).toBeTypeOf("function");

    act(() => result.current.reset());
    expect(getRegisteredHandler("page.next")).toBeUndefined();
    // the page commands themselves stay bound
    expect(getRegisteredHandler("page.on")).toBeTypeOf("function");

    // the same setup in the next document turns navigation on again
    appState = state({ ...DEFAULT_PAGE_SETUP });
    await act(async () => {
      result.current.onChange([], appState);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getRegisteredHandler("page.next")).toBeTypeOf("function");
  });
});
