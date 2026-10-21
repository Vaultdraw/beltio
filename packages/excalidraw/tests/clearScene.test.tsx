import React from "react";
import { act } from "@testing-library/react";

import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { render } from "./test-utils";

const { h } = window;

const scene = (prefix: string, count = 50) =>
  Array.from({ length: count }, (_, i) =>
    API.createElement({ type: "rectangle", id: `${prefix}${i}`, x: i * 10 }),
  );

/** what a host replacing the scene in place does (the desktop scene swap) */
const replaceScene = (prefix: string) =>
  act(() => {
    h.app.api.history.clear();
    h.app.api.clearScene();
    API.updateScene({
      elements: scene(prefix),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });

describe("clearScene (replacing the scene in place)", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("the undo baseline holds the new scene only, however many scenes came before", () => {
    for (const prefix of ["a", "b", "c", "d"]) {
      replaceScene(prefix);
      expect(h.store.snapshot.elements.size).toBe(50);
      expect([...h.store.snapshot.elements.keys()][0]).toBe(`${prefix}0`);
    }
  });

  it("undo after an edit on the new scene restores the new scene", () => {
    replaceScene("a");
    replaceScene("b");
    const [first] = h.elements;
    act(() => {
      API.updateScene({
        elements: h.elements.map((el) =>
          el.id === first.id ? { ...el, x: 999, version: el.version + 1 } : el,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    expect(h.elements.find((el) => el.id === first.id)?.x).toBe(999);
    Keyboard.undo();
    expect(h.elements.find((el) => el.id === first.id)?.x).toBe(first.x);
    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(50);
    // nothing older to undo: the earlier scene is not in the baseline
    Keyboard.undo();
    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(50);
    expect(h.elements[0].id).toBe("b0");
  });
});
