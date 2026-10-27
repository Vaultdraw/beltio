import { describe, expect, it } from "vitest";

import { selectInDirection } from "./keyboard";

// 0 centre, 1 right, 2 far right, 3 up, 4 down-left
const pos = Float32Array.from([0, 0, 10, 0, 40, 2, 0, -10, -8, 9]);
const centre = { x: 0, y: 0 };

describe("selectInDirection", () => {
  it("prefers a neighbour in that direction", () => {
    expect(selectInDirection(pos, 5, 0, "right", [1, 2], null, centre)).toBe(1);
    expect(selectInDirection(pos, 5, 0, "up", [1, 3], null, centre)).toBe(3);
    expect(selectInDirection(pos, 5, 0, "down", [1, 4], null, centre)).toBe(4);
  });

  it("falls back to any visible node that way, then to the nearest", () => {
    expect(selectInDirection(pos, 5, 0, "right", [3], null, centre)).toBe(1);
    expect(selectInDirection(pos, 5, 2, "right", [], null, centre)).toBe(1); // nothing right of 2: nearest
  });

  it("skips hidden nodes and returns -1 when alone", () => {
    const hidden = Uint8Array.from([0, 1, 0, 0, 0]);
    expect(selectInDirection(pos, 5, 0, "right", [1], hidden, centre)).toBe(2);
    expect(selectInDirection(pos, 1, 0, "right", [], null, centre)).toBe(-1);
  });

  it("with no focus picks the node nearest the centre", () => {
    expect(
      selectInDirection(pos, 5, -1, "right", [], null, { x: 38, y: 2 }),
    ).toBe(2);
  });
});
