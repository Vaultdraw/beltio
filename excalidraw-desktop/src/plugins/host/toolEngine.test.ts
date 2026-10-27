import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { registerEditorApi } from "../../editor/editorApi";
import {
  addToolStubs,
  getActiveToolKey,
  setToolHandlers,
  type ToolStub,
} from "../toolRegistry";

import { releasePluginTools, resetToolEngine, toggleTool } from "./toolEngine";

const stub: ToolStub = {
  key: "p.box",
  pluginId: "p",
  pluginName: "P",
  id: "box",
  title: "Box",
  icon: null,
  cursor: "crosshair",
  command: "p.tool.box",
};

/** An editor API with just what the engine uses. */
function fakeApi() {
  let down: (t: unknown, s: unknown, e: unknown) => void = () => {};
  let change: (els: unknown, st: { activeTool: unknown }) => void = () => {};
  const api = {
    onPointerDown: (cb: typeof down) => {
      down = cb;
      return () => {};
    },
    onChange: (cb: typeof change) => {
      change = cb;
      return () => {};
    },
    getAppState: () => ({
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
    }),
    setActiveTool: vi.fn((tool: unknown) => change([], { activeTool: tool })),
  };
  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    setActiveTool: api.setActiveTool,
    pointerDown: () =>
      down(
        { type: "custom", customType: "p.box" },
        { origin: { x: 5, y: 6 } },
        { target: document.body, shiftKey: true },
      ),
  };
}

const move = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }),
  );

const offs: (() => void)[] = [];
afterEach(() => {
  resetToolEngine();
  offs.splice(0).forEach((o) => o());
});

describe("tool engine", () => {
  it("chooses the tool, runs a gesture and goes back to selecting", async () => {
    const fake = fakeApi();
    offs.push(
      registerEditorApi("doc", fake.api, () => ({
        path: "a",
        readOnly: false,
      })),
    );
    const h = {
      pointerDown: vi.fn(),
      pointerMove: vi.fn(),
      pointerUp: vi.fn(),
      cancel: vi.fn(),
    };
    offs.push(addToolStubs([stub]), setToolHandlers("p.box", h));

    await toggleTool(stub, async () => true);
    expect(getActiveToolKey()).toBe("p.box");
    expect(fake.setActiveTool).toHaveBeenCalledWith({
      type: "custom",
      customType: "p.box",
    });

    fake.pointerDown();
    expect(h.pointerDown).toHaveBeenCalledWith(
      expect.objectContaining({ x: 5, y: 6, shiftKey: true }),
    );
    move("pointerup", 30, 40);
    expect(h.pointerUp).toHaveBeenCalledWith(
      expect.objectContaining({ x: 30, y: 40 }),
    );
    // No listener is left behind: a later move reaches nobody.
    move("pointerup", 1, 1);
    expect(h.pointerUp).toHaveBeenCalledTimes(1);

    await toggleTool(stub, async () => true);
    expect(getActiveToolKey()).toBeNull();
    expect(fake.setActiveTool).toHaveBeenLastCalledWith({ type: "selection" });
  });

  it("cancels a gesture when another tool is chosen, and when the plugin goes", async () => {
    const fake = fakeApi();
    offs.push(
      registerEditorApi("doc", fake.api, () => ({
        path: "a",
        readOnly: false,
      })),
    );
    const h = { pointerDown: vi.fn(), pointerUp: vi.fn(), cancel: vi.fn() };
    offs.push(addToolStubs([stub]), setToolHandlers("p.box", h));
    await toggleTool(stub, async () => true);
    fake.pointerDown();
    fake.api.setActiveTool({ type: "rectangle" } as never);
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(getActiveToolKey()).toBeNull();

    await toggleTool(stub, async () => true);
    fake.pointerDown();
    releasePluginTools("p");
    expect(h.cancel).toHaveBeenCalledTimes(2);
    move("pointerup", 9, 9);
    expect(h.pointerUp).not.toHaveBeenCalled();
  });

  it("refuses in a read-only drawing", async () => {
    const fake = fakeApi();
    offs.push(
      registerEditorApi("doc", fake.api, () => ({ path: "a", readOnly: true })),
    );
    offs.push(addToolStubs([stub]), setToolHandlers("p.box", {}));
    await toggleTool(stub, async () => true);
    expect(getActiveToolKey()).toBeNull();
    expect(fake.setActiveTool).not.toHaveBeenCalled();
  });
});
