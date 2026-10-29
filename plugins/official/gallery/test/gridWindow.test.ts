import { describe, expect, it } from "vitest";

import {
  columnsFor,
  computeGridWindow,
  pageRows,
  sameWindow,
  scrollTopToReveal,
  type GridMetrics,
} from "../src/gridWindow";

const m = (over: Partial<GridMetrics> = {}): GridMetrics => ({
  viewportWidth: 1000,
  viewportHeight: 600,
  tileWidth: 192,
  tileHeight: 190,
  gap: 16,
  count: 5000,
  overscanRows: 1,
  ...over,
});

describe("gridWindow", () => {
  it("derives columns from the width (min 1)", () => {
    expect(columnsFor(1000, 192, 16)).toBe(4);
    expect(columnsFor(192, 192, 16)).toBe(1);
    expect(columnsFor(10, 192, 16)).toBe(1);
  });

  it("windows the top with overscan below only", () => {
    const w = computeGridWindow(0, m());
    expect(w.columns).toBe(4);
    expect(w.rowCount).toBe(1250);
    expect(w.firstRow).toBe(0);
    // rows 0..2 visible (600/206), +1 overscan
    expect(w.lastRow).toBe(3);
    expect(w.first).toBe(0);
    expect(w.last).toBe(15);
    expect(w.totalHeight).toBe(1250 * 206 - 16);
  });

  it("mounts a bounded number of tiles in the middle", () => {
    const w = computeGridWindow(206 * 500, m());
    expect(w.firstRow).toBe(499);
    expect(w.last - w.first + 1).toBeLessThanOrEqual(120);
  });

  it("clamps at the last row and a short last row", () => {
    const w = computeGridWindow(1e9, m({ count: 10 }));
    expect(w.rowCount).toBe(3);
    expect(w.lastRow).toBe(2);
    expect(w.last).toBe(9);
  });

  it("is empty for no items", () => {
    const w = computeGridWindow(0, m({ count: 0 }));
    expect(w.last).toBeLessThan(w.first);
    expect(w.totalHeight).toBe(0);
  });

  it("changes only when the first visible row changes", () => {
    const a = computeGridWindow(10, m());
    expect(sameWindow(a, computeGridWindow(5, m()))).toBe(true);
    expect(sameWindow(a, computeGridWindow(210, m()))).toBe(false);
  });

  it.each([
    [1, 2],
    [2, 1],
    [4, 5],
    [5, 0],
    [0, 1],
  ])(
    "an item count change from %i to %i inside one row changes the window",
    (from, to) => {
      const a = computeGridWindow(0, m({ count: from }));
      const b = computeGridWindow(0, m({ count: to }));
      expect(b.last - b.first + 1).toBe(to);
      expect(sameWindow(a, b)).toBe(false);
    },
  );

  it("re-flows on resize", () => {
    const a = computeGridWindow(0, m());
    const b = computeGridWindow(0, m({ viewportWidth: 500 }));
    expect(b.columns).toBe(2);
    expect(sameWindow(a, b)).toBe(false);
  });

  it("computes page rows and reveal positions", () => {
    expect(pageRows(600, 206)).toBe(2);
    expect(pageRows(100, 206)).toBe(1);
    expect(scrollTopToReveal(0, 0, m())).toBe(0);
    expect(scrollTopToReveal(40, 0, m())).toBe(10 * 206 + 190 - 600);
    expect(scrollTopToReveal(0, 3000, m())).toBe(0);
    expect(scrollTopToReveal(4, 0, m())).toBe(0);
  });
});
