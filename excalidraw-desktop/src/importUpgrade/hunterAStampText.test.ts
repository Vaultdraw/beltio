import { describe, expect, it } from "vitest";

import { editState, stampElements } from "./stamp";

// Hunter A round 2: edit every way, then re-import. Dragging a text's side handle changes how it
// wraps (width, and autoResize turns false) without changing its source or font size.
const base = () => ({
  id: "t1",
  type: "text",
  x: 10,
  y: 10,
  width: 300,
  height: 50,
  text: "a long paragraph that wraps",
  originalText: "a long paragraph that wraps",
  fontSize: 16,
  fontFamily: 6,
  textAlign: "left",
  verticalAlign: "top",
  autoResize: true,
  version: 1,
});

describe("import stamps: how the user can edit a text", () => {
  it("stamped text is untouched", () => {
    const els = [base()];
    stampElements(els);
    expect(editState({ elements: els })).toBe("untouched");
  });
  it("narrowing the text box (side handle: width and autoResize) counts as an edit", () => {
    const els: Record<string, unknown>[] = [base()];
    stampElements(els);
    els[0] = { ...els[0], width: 120, autoResize: false, height: 120 };
    expect(editState({ elements: els })).toBe("edited");
  });
});
