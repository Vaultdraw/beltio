import { describe, expect, it } from "vitest";

import { EDGE_MAX_SPEED, edgeSpeed } from "./edgeScroll";

describe("edgeSpeed", () => {
  it("is 0 in the middle", () => {
    expect(edgeSpeed(500, 0, 1000)).toBe(0);
    expect(edgeSpeed(40, 0, 1000)).toBe(0);
    expect(edgeSpeed(960, 0, 1000)).toBe(0);
  });
  it("scrolls toward the near edge, faster closer, capped past it", () => {
    expect(edgeSpeed(20, 0, 1000)).toBeLessThan(0);
    expect(edgeSpeed(5, 0, 1000)).toBeLessThan(edgeSpeed(30, 0, 1000));
    expect(edgeSpeed(-300, 0, 1000)).toBe(-EDGE_MAX_SPEED);
    expect(edgeSpeed(990, 0, 1000)).toBeGreaterThan(edgeSpeed(970, 0, 1000));
    expect(edgeSpeed(5000, 0, 1000)).toBe(EDGE_MAX_SPEED);
  });
  it("copes with a tiny or empty span", () => {
    expect(edgeSpeed(5, 0, 0)).toBe(0);
    expect(Math.abs(edgeSpeed(0, 0, 20))).toBeGreaterThan(0);
  });
});
