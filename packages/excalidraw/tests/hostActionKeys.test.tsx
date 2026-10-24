import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { GlobalTestState, act, render } from "./test-utils";

const { h } = window;

const twoRects = () => {
  const a = API.createElement({ type: "rectangle", x: 0, y: 0 });
  const b = API.createElement({ type: "rectangle", x: 100, y: 50 });
  API.setElements([a, b]);
  API.setSelectedElements([a, b]);
  return [a, b];
};

const run = (name: Parameters<typeof h.app.actionManager.runShortcut>[0]) => {
  let result = false;
  act(() => {
    result = h.app.actionManager.runShortcut(name);
  });
  return result;
};

describe("host action keys", () => {
  it("keeps the built-in key by default", async () => {
    await render(<Excalidraw />);
    twoRects();
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.G, GlobalTestState.interactiveCanvas);
    });
    expect(h.elements.every((el) => el.groupIds.length === 1)).toBe(true);
  });

  it("skips a key the host owns", async () => {
    await render(<Excalidraw UIOptions={{ hostActionKeys: ["group"] }} />);
    twoRects();
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.G, GlobalTestState.interactiveCanvas);
    });
    expect(h.elements.every((el) => el.groupIds.length === 0)).toBe(true);
  });

  it("runShortcut runs the action when the host owns the key", async () => {
    await render(<Excalidraw UIOptions={{ hostActionKeys: ["group"] }} />);
    twoRects();
    expect(run("group")).toBe(true);
    expect(h.elements.every((el) => el.groupIds.length === 1)).toBe(true);
  });

  it("runShortcut aligns like the keyboard does", async () => {
    await render(<Excalidraw />);
    twoRects();
    expect(run("alignTop")).toBe(true);
    expect(h.elements[1].y).toBe(h.elements[0].y);
  });

  it("refuses in view mode and for unknown actions", async () => {
    await render(<Excalidraw />);
    twoRects();
    API.setAppState({ viewModeEnabled: true });
    expect(run("group")).toBe(false);
    expect(run("noSuchAction" as any)).toBe(false);
  });
});
