import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommand } from "../commands/commands";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { toastStore } from "../toasts/toastStore";

import { updatePreferences } from "../vault/preferences";

import { TOOL_DEFAULT_TOOLS } from "./toolStyles";
import { useToolDefaults } from "./useToolDefaults";

const store = vi.hoisted(() => ({
  defaults: {} as Record<string, Record<string, unknown>>,
  listeners: new Set<() => void>(),
  saved: [] as unknown[],
  reset: [] as unknown[],
}));

vi.mock("../vault/toolDefaultsStore", () => ({
  getEffectiveToolDefaults: () => store.defaults,
  subscribeToolDefaults: (cb: () => void) => {
    store.listeners.add(cb);
    return () => store.listeners.delete(cb);
  },
  saveToolDefault: async (tool: string, style: unknown) => {
    store.saved.push([tool, style]);
    return "global";
  },
  resetToolDefault: async (tool: string) => {
    store.reset.push(tool);
    return "vault";
  },
  toolDefaultLayer: () => "global",
}));

const BASE = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemStrokeWidthKey: "medium",
  currentItemStrokeStyle: "solid",
  selectedElementIds: {} as Record<string, boolean>,
};

function setup() {
  let state: Record<string, unknown> = {
    ...BASE,
    activeTool: { type: "selection" },
  };
  let elements: unknown[] = [];
  const updateScene = vi.fn(({ appState }: { appState: object }) => {
    state = { ...state, ...appState };
  });
  const setToast = vi.spyOn(toastStore, "push").mockImplementation(() => undefined);
  setToast.mockClear();
  const api = {
    updateScene,
    getAppState: () => state,
    getSceneElements: () => elements,
  };
  const apiRef = { current: api as never };
  const hook = renderHook(() => useToolDefaults(apiRef, true));
  const emit = () => hook.result.current.onAppState(state as never);
  return {
    hook,
    updateScene,
    setToast,
    emit,
    setElements: (e: unknown[]) => (elements = e),
    get state() {
      return state;
    },
    switchTo(type: string, extra: object = {}) {
      state = { ...state, ...extra, activeTool: { type } };
      emit();
    },
    set(extra: object) {
      state = { ...state, ...extra };
      emit();
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  store.defaults = {
    arrow: {
      stroke_color: "#f08c00",
      stroke_width: 3,
      stroke_style: "dotted",
    },
  };
  store.listeners.clear();
  store.saved = [];
  store.reset = [];
});

describe("useToolDefaults", () => {
  it("applies on entry without an undo entry and restores on leave", () => {
    const t = setup();
    t.emit();
    expect(t.updateScene).not.toHaveBeenCalled();
    t.switchTo("arrow");
    expect(t.updateScene).toHaveBeenCalledTimes(1);
    expect(t.updateScene.mock.calls[0][0]).toMatchObject({
      appState: {
        currentItemStrokeColor: "#f08c00",
        currentItemStrokeStyle: "dotted",
      },
      captureUpdate: "NEVER",
    });
    t.emit(); // the change caused by our patch: same tool, no work
    expect(t.updateScene).toHaveBeenCalledTimes(1);
    t.switchTo("selection");
    expect(t.state).toMatchObject(BASE);
    expect(t.updateScene).toHaveBeenCalledTimes(2);
  });

  it("does no work for unconfigured tools or while the tool stays", () => {
    const t = setup();
    t.switchTo("rectangle");
    t.switchTo("freedraw");
    t.set({ currentItemStrokeColor: "#ff0000" });
    t.set({ currentItemOpacity: 50 });
    expect(t.updateScene).not.toHaveBeenCalled();
  });

  it("keeps a pen colour set in the same transition", () => {
    const t = setup();
    t.switchTo("arrow");
    t.switchTo("freedraw", { currentItemStrokeColor: "#ff0000" });
    expect(t.state.currentItemStrokeColor).toBe("#ff0000");
    expect(t.state.currentItemStrokeStyle).toBe("solid");
  });

  it("returns the style's px only for the active tool while its width key stands", () => {
    const t = setup();
    const width = () => t.hook.result.current.currentItemStrokeWidth;
    expect(width()("arrow")).toBeNull();
    t.switchTo("arrow");
    expect(width()("arrow")).toBe(3);
    expect(width()("line")).toBeNull();
    expect(width()("freedraw")).toBeNull();
    t.set({ currentItemStrokeWidthKey: "bold" }); // a pick in the panel: its own px
    expect(width()("arrow")).toBe(4);
    t.switchTo("selection");
    expect(width()("arrow")).toBeNull();
  });

  it("keeps one callback identity", () => {
    const t = setup();
    const first = t.hook.result.current;
    t.switchTo("arrow");
    t.hook.rerender();
    expect(t.hook.result.current.currentItemStrokeWidth).toBe(
      first.currentItemStrokeWidth,
    );
    expect(t.hook.result.current.onAppState).toBe(first.onAppState);
  });

  it("re-applies when the active tool's defaults change", () => {
    const t = setup();
    t.switchTo("arrow");
    store.defaults = { arrow: { stroke_color: "#1971c2" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.state).toMatchObject({
      currentItemStrokeColor: "#1971c2",
      currentItemStrokeStyle: "solid",
    });
    expect(t.hook.result.current.currentItemStrokeWidth("arrow")).toBeNull();
    // a change for another tool does nothing
    const calls = t.updateScene.mock.calls.length;
    store.defaults = { ...store.defaults, line: { stroke_color: "#000000" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.updateScene.mock.calls.length).toBe(calls);
  });

  it("applies defaults configured while an unconfigured tool is active", () => {
    const t = setup();
    t.switchTo("line");
    store.defaults = { line: { stroke_color: "#2f9e44" } };
    act(() => store.listeners.forEach((cb) => cb()));
    expect(t.state.currentItemStrokeColor).toBe("#2f9e44");
  });
});

describe("tool default commands", () => {
  const run = async (id: string) => {
    await act(async () => {
      await getRegisteredHandler(id)?.();
    });
  };

  it("registers a save and a reset command per tool, plus saveActive", () => {
    for (const tool of TOOL_DEFAULT_TOOLS) {
      expect(getCommand(`toolDefaults.save.${tool}`)?.title).toMatch(
        /^Tool defaults: Save current style for /,
      );
      expect(getCommand(`toolDefaults.reset.${tool}`)?.title).toMatch(
        /^Tool defaults: Reset /,
      );
    }
    expect(getCommand("toolDefaults.saveActive")?.keys.default).toEqual([]);
    expect(getCommand("toolDefaults.save.arrow")?.title).toBe(
      "Tool defaults: Save current style for Arrow",
    );
  });

  it("saves the first selected element of the tool's type", async () => {
    const t = setup();
    t.setElements([
      { id: "r", type: "rectangle", strokeColor: "#000000" },
      {
        id: "a",
        type: "arrow",
        strokeColor: "#e03131",
        strokeWidth: 5,
        strokeStyle: "dashed",
        roughness: 0,
        opacity: 80,
        roundness: null,
        elbowed: false,
        startArrowhead: null,
        endArrowhead: "bar",
      },
    ]);
    t.set({ selectedElementIds: { r: true, a: true } });
    await run("toolDefaults.save.arrow");
    expect(store.saved).toEqual([
      [
        "arrow",
        {
          stroke_color: "#e03131",
          stroke_width: 5,
          stroke_style: "dashed",
          roughness: 0,
          opacity: 80,
          arrow_type: "sharp",
          start_arrowhead: "none",
          end_arrowhead: "bar",
        },
      ],
    ]);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Saved Arrow style as the default (global)",
    );
  });

  it("saves the editor's style, with the active px override, when nothing is selected", async () => {
    const t = setup();
    t.switchTo("arrow");
    await run("toolDefaults.save.arrow");
    expect(store.saved[0]).toMatchObject([
      "arrow",
      { stroke_color: "#f08c00", stroke_width: 3, stroke_style: "dotted" },
    ]);
  });

  it("saveActive uses the active tool, else the selection, else asks", async () => {
    const t = setup();
    await run("toolDefaults.saveActive");
    expect(store.saved).toHaveLength(0);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Pick a tool or select a shape first",
    );
    t.setElements([
      { id: "r", type: "rectangle", strokeColor: "#000000", roundness: null },
    ]);
    t.set({ selectedElementIds: { r: true } });
    await run("toolDefaults.saveActive");
    expect((store.saved[0] as unknown[])[0]).toBe("rectangle");
    t.switchTo("arrow");
    await run("toolDefaults.saveActive");
    expect((store.saved[1] as unknown[])[0]).toBe("arrow");
  });

  it("reset clears the layer in effect and toasts", async () => {
    const t = setup();
    await run("toolDefaults.reset.line");
    expect(store.reset).toEqual(["line"]);
    expect(t.setToast.mock.calls[0][0].message).toBe(
      "Reset Line default (this vault)",
    );
  });
});

describe("drawing overrides (picks inside this drawing)", () => {
  const RED = "#e03131";
  const drawing = (t: ReturnType<typeof setup>) =>
    t.hook.result.current.getDrawingStyles();
  const arrow = (id = "a") => ({
    id,
    type: "arrow",
    boundElements: [],
  });

  it("records a pick made with the tool and brings it back on re-entry", () => {
    const t = setup();
    t.switchTo("arrow");
    t.set({ currentItemStrokeColor: RED });
    expect(drawing(t)).toEqual({ arrow: { stroke_color: RED } });
    t.switchTo("rectangle");
    expect(t.state.currentItemStrokeColor).toBe("#1e1e1e");
    t.switchTo("arrow");
    expect(t.state).toMatchObject({
      currentItemStrokeColor: RED,
      currentItemStrokeStyle: "dotted", // the saved default still fills the rest
    });
    t.switchTo("selection");
    expect(t.state.currentItemStrokeColor).toBe("#1e1e1e");
  });

  it("never records our own patches (tool entry, re-apply)", () => {
    const t = setup();
    t.switchTo("arrow");
    t.emit();
    store.defaults = { arrow: { stroke_color: "#1971c2" } };
    act(() => store.listeners.forEach((cb) => cb()));
    t.emit();
    expect(drawing(t)).toEqual({});
  });

  it("is per tool: a pick for the arrow does not touch the rectangle", () => {
    const t = setup();
    t.switchTo("arrow");
    t.set({ currentItemStrokeColor: RED });
    t.switchTo("rectangle");
    t.set({ currentItemStrokeColor: "#2f9e44" });
    expect(drawing(t)).toEqual({
      arrow: { stroke_color: RED },
      rectangle: { stroke_color: "#2f9e44" },
    });
  });

  it("records an arrow type cycled with the A key", () => {
    const t = setup();
    t.switchTo("arrow");
    t.set({ currentItemArrowType: "elbow" });
    expect(drawing(t)).toEqual({ arrow: { arrow_type: "elbow" } });
  });

  it("records the px of a picked width key and uses it for new elements", () => {
    const t = setup();
    const width = () => t.hook.result.current.currentItemStrokeWidth;
    t.switchTo("arrow");
    expect(width()("arrow")).toBe(3);
    t.set({ currentItemStrokeWidthKey: "bold" });
    expect(drawing(t).arrow?.stroke_width).toBe(4);
    expect(width()("arrow")).toBe(4);
    t.set({ currentItemStrokeWidthKey: "medium" }); // back to the key of the 3 px default
    expect(drawing(t).arrow?.stroke_width).toBe(2);
    expect(width()("arrow")).toBe(2);
  });

  it("ignores freedraw, other tools, unmapped fields and plain selection-tool changes", () => {
    const t = setup();
    t.switchTo("freedraw");
    t.set({ currentItemStrokeColor: RED });
    t.switchTo("selection");
    t.set({ currentItemOpacity: 40 });
    t.switchTo("arrow");
    t.set({ currentItemStrokeVariability: "pressure" });
    expect(drawing(t)).toEqual({});
  });

  it("records a selection edit for the selected element's tool and restores the base", () => {
    const t = setup();
    t.setElements([arrow()]);
    t.set({ selectedElementIds: { a: true } });
    t.set({ currentItemStrokeColor: RED });
    expect(drawing(t)).toEqual({ arrow: { stroke_color: RED } });
    expect(t.state.currentItemStrokeColor).toBe("#1e1e1e");
    // the restore is not recorded again
    t.emit();
    expect(drawing(t)).toEqual({ arrow: { stroke_color: RED } });
  });

  it("records a font picked for a selected container for the text tool only", () => {
    const t = setup();
    t.setElements([
      {
        id: "r",
        type: "rectangle",
        boundElements: [{ type: "text", id: "x" }],
      },
    ]);
    t.set({ selectedElementIds: { r: true } });
    t.set({ currentItemFontFamily: 3, currentItemStrokeColor: RED });
    expect(drawing(t)).toEqual({
      rectangle: { stroke_color: RED },
      text: { stroke_color: RED, font_family: 3 },
    });
    expect(t.state.currentItemFontFamily).toBeUndefined();
  });

  it("counts a text being edited as a text pick without restoring the Text tool's own state", () => {
    const t = setup();
    t.switchTo("text");
    t.set({ editingTextElement: { id: "t" } });
    t.set({ currentItemFontSize: 40 });
    expect(drawing(t)).toEqual({ text: { font_size: 40 } });
    expect(t.state.currentItemFontSize).toBe(40);
  });

  it("does not record a selection of unstyled elements", () => {
    const t = setup();
    t.setElements([{ id: "f", type: "freedraw", boundElements: null }]);
    t.set({ selectedElementIds: { f: true } });
    t.set({ currentItemStrokeColor: RED });
    expect(drawing(t)).toEqual({});
    expect(t.state.currentItemStrokeColor).toBe(RED);
  });

  it("marks overridden properties for the active tool or the selection, and Use default clears them", () => {
    const t = setup();
    t.switchTo("arrow");
    const before = t.hook.result.current.styleOverrides;
    expect(before.isOverridden(["currentItemStrokeColor"])).toBe(false);
    act(() => t.set({ currentItemStrokeColor: RED }));
    const after = t.hook.result.current.styleOverrides;
    expect(after).not.toBe(before);
    expect(after.isOverridden(["currentItemStrokeColor"])).toBe(true);
    expect(after.isOverridden(["currentItemOpacity"])).toBe(false);
    expect(after.isOverridden(["currentItemFontSize"])).toBe(false);
    act(() => after.useDefault(["currentItemStrokeColor"]));
    expect(drawing(t)).toEqual({});
    expect(t.state.currentItemStrokeColor).toBe("#f08c00"); // the effective default
    expect(
      t.hook.result.current.styleOverrides.isOverridden([
        "currentItemStrokeColor",
      ]),
    ).toBe(false);
    // what we resynced is not a pick
    t.emit();
    expect(drawing(t)).toEqual({});
  });

  it("scopes the marker to the selected types", () => {
    const t = setup();
    t.setElements([arrow(), { id: "r", type: "rectangle", boundElements: [] }]);
    t.set({ selectedElementIds: { a: true } });
    act(() => t.set({ currentItemStrokeColor: RED }));
    expect(
      t.hook.result.current.styleOverrides.isOverridden([
        "currentItemStrokeColor",
      ]),
    ).toBe(true);
    t.set({ selectedElementIds: { r: true } });
    expect(
      t.hook.result.current.styleOverrides.isOverridden([
        "currentItemStrokeColor",
      ]),
    ).toBe(false);
  });

  it("resets everything with resetDrawingStyles and the command, and reapplies the default", async () => {
    const t = setup();
    t.switchTo("arrow");
    act(() => t.set({ currentItemStrokeColor: RED }));
    await act(async () => {
      await getRegisteredHandler("toolDefaults.resetDrawingStyles")?.();
    });
    expect(drawing(t)).toEqual({});
    expect(t.state.currentItemStrokeColor).toBe("#f08c00");
    expect(t.setToast.mock.calls.at(-1)?.[0].message).toBe(
      "Reset this drawing's styles to defaults",
    );
  });

  it("registers the reset command", () => {
    expect(getCommand("toolDefaults.resetDrawingStyles")?.title).toBe(
      "Tool defaults: Reset this drawing's styles to defaults",
    );
  });

  it("starts from the overrides the drawing was opened with", () => {
    const t = setup();
    t.hook.result.current.loadDrawingStyles({
      rectangle: { stroke_color: RED },
    });
    t.switchTo("rectangle");
    expect(t.state.currentItemStrokeColor).toBe(RED);
  });

  it("tells the editor to save when overrides change, and bumps the version", () => {
    const onOverridesChange = vi.fn();
    const state = { v: null as unknown };
    void state;
    let appState: Record<string, unknown> = {
      ...BASE,
      activeTool: { type: "arrow" },
    };
    const api = {
      updateScene: ({ appState: a }: { appState: object }) => {
        appState = { ...appState, ...a };
      },
      getAppState: () => appState,
      getSceneElements: () => [],
    };
    const hook = renderHook(() =>
      useToolDefaults({ current: api as never }, true, { onOverridesChange }),
    );
    act(() => hook.result.current.onAppState(appState as never));
    expect(hook.result.current.getOverridesVersion()).toBe(0);
    appState = { ...appState, currentItemStrokeColor: RED };
    act(() => hook.result.current.onAppState(appState as never));
    expect(onOverridesChange).toHaveBeenCalledTimes(1);
    expect(hook.result.current.getOverridesVersion()).toBe(1);
  });

  it("saving or resetting a tool's default drops this drawing's picks for it", async () => {
    const t = setup();
    t.switchTo("arrow");
    t.set({ currentItemStrokeColor: RED });
    await act(async () => {
      await getRegisteredHandler("toolDefaults.save.arrow")?.();
    });
    expect(drawing(t)).toEqual({});
    expect(store.saved[0]).toMatchObject(["arrow", { stroke_color: RED }]);
  });

  it("follows [editor] defaults edited while open, without touching the active tool's style", () => {
    const t = setup();
    t.switchTo("arrow");
    act(() => {
      updatePreferences({ defaultFontSize: 33 }, undefined);
    });
    expect(t.state.currentItemFontSize).toBe(33);
    expect(t.state.currentItemStrokeColor).toBe("#f08c00");
  });
});

describe("newTextStyle (text created without the Text tool)", () => {
  const textStyle = (t: ReturnType<typeof setup>) =>
    t.hook.result.current.newTextStyle();

  it("is null when the Text tool has no default", () => {
    const t = setup();
    t.emit();
    expect(textStyle(t)).toBeNull();
  });

  it("gives the Text default to double-click / label text", () => {
    store.defaults = { text: { stroke_color: "#f08c00", font_size: 28 } };
    const t = setup();
    t.emit();
    expect(textStyle(t)).toEqual({ strokeColor: "#f08c00", fontSize: 28 });
  });

  it("is null while the Text tool is active (its style is the editor's)", () => {
    store.defaults = { text: { stroke_color: "#f08c00" } };
    const t = setup();
    t.switchTo("text");
    expect(textStyle(t)).toBeNull();
  });

  it("layers this drawing's Text picks over the default (or over nothing)", () => {
    store.defaults = { text: { stroke_color: "#f08c00" } };
    const t = setup();
    t.switchTo("text");
    t.set({ currentItemStrokeColor: "#1971c2" });
    t.switchTo("selection");
    expect(textStyle(t)).toMatchObject({ strokeColor: "#1971c2" });
    store.defaults = {};
    t.hook.result.current.loadDrawingStyles({ text: { font_family: 3 } });
    expect(textStyle(t)).toEqual({ fontFamily: 3 });
  });
});

describe("newContainerStyle (wrap selection in container)", () => {
  const containerStyle = (t: ReturnType<typeof setup>) =>
    t.hook.result.current.newContainerStyle();

  it("is null when the Rectangle tool has no default", () => {
    const t = setup();
    t.emit();
    expect(containerStyle(t)).toBeNull();
  });

  it("gives the Rectangle default, whichever tool is active", () => {
    store.defaults = {
      rectangle: { background_color: "#ffec99", stroke_width: 4 },
    };
    const t = setup();
    t.emit();
    expect(containerStyle(t)).toEqual({
      backgroundColor: "#ffec99",
      strokeWidth: 4,
    });
    t.switchTo("text");
    expect(containerStyle(t)).toEqual({
      backgroundColor: "#ffec99",
      strokeWidth: 4,
    });
  });
});

describe("reset (another document is shown)", () => {
  it("does not undo the old patch on the new state, and the old drawing's picks are replaced", () => {
    store.defaults = { rectangle: { stroke_color: "#e03131" } };
    const t = setup();
    t.switchTo("rectangle");
    expect(t.state.currentItemStrokeColor).toBe("#e03131"); // applied to the old scene
    t.set({ currentItemStrokeColor: "#2f9e44" }); // a per-drawing pick
    expect(t.hook.result.current.getDrawingStyles().rectangle).toBeDefined();
    t.updateScene.mockClear();

    act(() => {
      t.hook.result.current.reset();
      t.hook.result.current.loadDrawingStyles({});
    });
    expect(t.hook.result.current.getDrawingStyles()).toEqual({});

    // the next document opens on the selection tool with its own colours
    t.switchTo("selection", { currentItemStrokeColor: "#1971c2" });
    expect(t.updateScene).not.toHaveBeenCalled();
    expect(t.state.currentItemStrokeColor).toBe("#1971c2");
  });
});
