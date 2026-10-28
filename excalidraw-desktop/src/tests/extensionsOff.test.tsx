/** Off means not created: a hook whose extension is off binds no handler. */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRegisteredHandler } from "../commands/handlerRegistry";
import { editFormulaImage, setFormulaEditRunner } from "../plugins/formulaEdit";
import { useAppLinks, type AppLinksDeps } from "../links/useAppLinks";
import { DEFAULT_LINKS_SETTINGS } from "../links/types";
import { useAppTags } from "../tags/useAppTags";

import type { VaultLinks } from "../links/types";

afterEach(cleanup);

describe("extension off: no handlers", () => {
  it("formula: a double-click is the editor's own unless the plugin is on", () => {
    const run = vi.fn(async () => undefined);
    setFormulaEditRunner(run);
    const el = {
      locked: false,
      customData: { latex: { v: 1, source: "x" } },
    } as never;
    // The plugin is in the enabled list by default and the extension is on.
    expect(editFormulaImage(window, el, false)).toBe(true);
    expect(run).toHaveBeenCalledWith("formula.edit");
    // View mode, a locked image and a plain image are left to the editor.
    expect(editFormulaImage(window, el, true)).toBe(false);
    expect(
      editFormulaImage(
        window,
        { locked: true, customData: { latex: {} } } as never,
        false,
      ),
    ).toBe(false);
    expect(editFormulaImage(window, { customData: {} } as never, false)).toBe(
      false,
    );
    setFormulaEditRunner(null);
    expect(editFormulaImage(window, el, false)).toBe(false);
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
