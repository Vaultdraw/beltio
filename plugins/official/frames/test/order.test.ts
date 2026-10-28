import { describe, expect, it } from "vitest";

import {
  labelOf,
  moveId,
  orderFrames,
  readingOrder,
  startIndex,
  type FrameBox,
} from "../src/order";

const box = (id: string, x: number, y: number, name?: string): FrameBox => ({
  id,
  name,
  x,
  y,
  width: 100,
  height: 100,
});

describe("slide order", () => {
  it("reading order is rows from the top, each left to right", () => {
    const frames = [
      box("d", 300, 110),
      box("b", 150, 5),
      box("a", 0, 0),
      box("c", 0, 120),
    ];
    expect(readingOrder(frames).map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("saved numbers come first, unnumbered frames follow in reading order", () => {
    const frames = [box("a", 0, 0), box("b", 150, 0), box("c", 300, 0)];
    const order: Record<string, number> = { c: 0, a: 1 };
    expect(orderFrames(frames, (id) => order[id]).map((f) => f.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("labels a frame by name, else by place", () => {
    expect(labelOf(box("a", 0, 0, "Intro"), 0)).toBe("Intro");
    expect(labelOf(box("a", 0, 0, "  "), 2)).toBe("Frame 3");
  });

  it("moves an id and clamps at the ends", () => {
    expect(moveId(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], 2, 9)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], 1, -4)).toEqual(["b", "a", "c"]);
    expect(moveId(["a"], 5, 0)).toEqual(["a"]);
  });

  it("starts at the selected frame, else the one around the view centre, else the nearest", () => {
    const slides = [box("a", 0, 0), box("b", 500, 0), box("c", 1000, 0)];
    expect(startIndex(slides, ["b"], { x: 0, y: 0 })).toBe(1);
    expect(startIndex(slides, [], { x: 520, y: 50 })).toBe(1);
    expect(startIndex(slides, [], { x: 900, y: 50 })).toBe(2);
    expect(startIndex([], [], { x: 0, y: 0 })).toBe(-1);
  });
});
