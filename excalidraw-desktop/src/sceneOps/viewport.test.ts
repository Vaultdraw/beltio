import { describe, expect, it } from "vitest";

import { viewportCenter } from "./viewport";

const st = (scrollX: number, scrollY: number, zoom: number) => ({
  scrollX,
  scrollY,
  width: 1000,
  height: 600,
  zoom: { value: zoom },
});

describe("viewportCenter", () => {
  it("is half the size at zoom 1", () => {
    expect(viewportCenter(st(0, 0, 1))).toEqual({ x: 500, y: 300 });
  });
  it("halves the visible extent at zoom 2", () => {
    expect(viewportCenter(st(0, 0, 2))).toEqual({ x: 250, y: 150 });
  });
  it("follows scroll (scroll is the scene offset, subtracted)", () => {
    expect(viewportCenter(st(-100, 50, 1))).toEqual({ x: 600, y: 250 });
    expect(viewportCenter(st(-100, 50, 2))).toEqual({ x: 350, y: 100 });
  });
});
