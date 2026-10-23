import React from "react";

import { ARROW_TYPE, KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { GlobalTestState, act, render } from "./test-utils";

const { h } = window;

// dispatch on the canvas so the event propagates to the container's
// keydown handler (`handleKeyboardGlobally` is disabled by default)
const pressKey = (key: string) => {
  Keyboard.keyPress(key, GlobalTestState.interactiveCanvas);
};

const run = (
  tool: Parameters<typeof h.app.activateToolShortcut>[0],
  via: "letter" | "digit",
) => {
  let result = false;
  act(() => {
    result = h.app.activateToolShortcut(tool, via);
  });
  return result;
};

describe("tool shortcuts", () => {
  it("keeps the built-in letter keys by default", async () => {
    await render(<Excalidraw />);
    pressKey(KEYS.R);
    expect(h.state.activeTool.type).toBe("rectangle");
    pressKey(KEYS.Q);
    expect(h.state.activeTool.locked).toBe(true);
  });

  it("ignores R and Q when UIOptions.toolShortcuts is false", async () => {
    await render(<Excalidraw UIOptions={{ toolShortcuts: false }} />);
    pressKey(KEYS.R);
    expect(h.state.activeTool.type).toBe("selection");
    pressKey(KEYS.Q);
    expect(h.state.activeTool.locked).toBe(false);
  });

  it("activateToolShortcut works when the built-in keys are off", async () => {
    await render(<Excalidraw UIOptions={{ toolShortcuts: false }} />);
    expect(run("rectangle", "letter")).toBe(true);
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(run("lock", "letter")).toBe(true);
    expect(h.state.activeTool.locked).toBe(true);
    expect(run("selection", "digit")).toBe(true);
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("cycles the arrow type when called twice", async () => {
    await render(<Excalidraw />);
    expect(run("arrow", "letter")).toBe(true);
    expect(h.state.activeTool.type).toBe("arrow");
    const before = h.state.currentItemArrowType;
    run("arrow", "letter");
    expect(h.state.currentItemArrowType).not.toBe(before);
    expect(Object.values(ARROW_TYPE)).toContain(h.state.currentItemArrowType);
  });

  it("refuses while an element is being drawn", async () => {
    await render(<Excalidraw />);
    UI.clickTool("rectangle");
    const mouse = new Pointer("mouse");
    mouse.down(10, 10);
    mouse.move(40, 40);
    expect(h.state.newElement).not.toBeNull();
    expect(run("ellipse", "letter")).toBe(false);
    expect(h.state.activeTool.type).toBe("rectangle");
    mouse.up();
  });

  it("allows only laser and hand in view mode", async () => {
    await render(<Excalidraw />);
    API.setAppState({ viewModeEnabled: true });
    expect(run("rectangle", "letter")).toBe(false);
    expect(run("laser", "letter")).toBe(true);
    expect(h.state.activeTool.type).toBe("laser");
    expect(run("hand", "letter")).toBe(true);
    expect(h.state.activeTool.type).toBe("hand");
  });
});
