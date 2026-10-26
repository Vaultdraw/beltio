/** Off means not created: a hook whose extension is off binds no handler. */
import { cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { FORMULA_COMMAND_IDS } from "../formula/formulaCommands";
import { useFormulaCommands } from "../formula/useFormulaCommands";
import { useAppLinks, type AppLinksDeps } from "../links/useAppLinks";
import { DEFAULT_LINKS_SETTINGS } from "../links/types";
import { useAppTags } from "../tags/useAppTags";

import type { VaultLinks } from "../links/types";

afterEach(cleanup);

describe("extension off: no handlers", () => {
  it("formula", () => {
    const apiRef = createRef<ExcalidrawImperativeAPI>();
    const { rerender, result } = renderHook(
      ({ enabled }) => useFormulaCommands({ apiRef, enabled }),
      { initialProps: { enabled: false } },
    );
    expect(getRegisteredHandler(FORMULA_COMMAND_IDS.insert)).toBeUndefined();
    expect(result.current.onImageEdit({} as never)).toBe(false);
    rerender({ enabled: true });
    expect(getRegisteredHandler(FORMULA_COMMAND_IDS.insert)).toBeTypeOf(
      "function",
    );
  });

  it("tags", () => {
    const deps = {
      api: null,
      links: null,
      handle: null,
      activePath: null,
      bridge: { current: null },
      flushActive: async () => {},
      notify: () => {},
      doc: document,
    };
    const { rerender } = renderHook(
      ({ enabled }) => useAppTags({ ...deps, enabled }),
      { initialProps: { enabled: false } },
    );
    expect(getRegisteredHandler("tags.focusPane")).toBeUndefined();
    rerender({ enabled: true });
    expect(getRegisteredHandler("tags.focusPane")).toBeTypeOf("function");
  });

  it("links: no link commands, no re-measure, but drawing.open: stays", () => {
    vi.useFakeTimers();
    const links = {
      onRewriteDone: vi.fn(async () => () => {}),
      remeasure: vi.fn(async () => ({ paths: {} })),
    } as unknown as VaultLinks;
    const deps: AppLinksDeps = {
      enabled: false,
      links,
      search: null,
      repository: {} as never,
      vault: { handle: "h", name: "V", path: "/v", readOnly: false },
      win: window,
      doc: document,
      settings: { ...DEFAULT_LINKS_SETTINGS, updateOnRename: false },
      entries: [],
      indexing: false,
      activePath: null,
      navigatorCollapsed: false,
      open: async () => {},
      prepareParent: async () => "",
      createDrawing: async () => {},
      loadDirectory: async () => {},
      expandFolder: () => {},
      showNavigator: () => {},
      openHotkeys: () => {},
      notify: () => {},
    };
    const { result } = renderHook(() => useAppLinks(deps));
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
    expect(getRegisteredHandler("links.toggleDock")).toBeUndefined();
    expect(getRegisteredHandler("drawing.open:a.excalidraw")).toBeTypeOf(
      "function",
    );
    expect(links.remeasure).not.toHaveBeenCalled();
    // update_on_rename off and Links off: not even the rewrite listener.
    expect(links.onRewriteDone).not.toHaveBeenCalled();
    expect(result.current.dockVisible).toBe(false);
  });
});
