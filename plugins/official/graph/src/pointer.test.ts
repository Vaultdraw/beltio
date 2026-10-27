import { describe, expect, it } from "vitest";

import { wheelZoomFactor } from "./camera";
import { releaseVelocity } from "./pointer";

describe("wheelZoomFactor", () => {
  it("pinch (ctrl) is 10x a scroll of the same delta", () => {
    const scroll = Math.log2(wheelZoomFactor(-3, 0, false));
    const pinch = Math.log2(wheelZoomFactor(-3, 0, true));
    expect(pinch / scroll).toBeCloseTo(10, 6);
  });
  it("line mode is coarser than pixel mode and sign decides direction", () => {
    expect(wheelZoomFactor(-1, 1)).toBeGreaterThan(wheelZoomFactor(-1, 0));
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });
  it("clamps per event", () => {
    expect(wheelZoomFactor(-1e5)).toBe(2);
    expect(wheelZoomFactor(1e5, 0, true)).toBe(0.5);
  });
});

describe("releaseVelocity", () => {
  const s = (x: number, t: number) => ({ x, y: 0, t });
  it("measures px/ms over the last 80 ms", () => {
    const v = releaseVelocity(
      [s(0, 0), s(50, 100), s(60, 120), s(90, 150)],
      160,
    );
    expect(v.vx).toBeCloseTo(40 / 50, 6);
  });
  it("is zero when stale or slow", () => {
    expect(releaseVelocity([s(0, 0), s(100, 50)], 200)).toEqual({
      vx: 0,
      vy: 0,
    });
    expect(releaseVelocity([s(0, 0), s(5, 50)], 55)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
  });
});
