import {
  DEFAULT_PAGE_SETUP,
  PAGE_GAP,
  getAutoExtendedPageCount,
  getClampToPageOffset,
  getFitPageWidthZoom,
  getPageAreaHeight,
  getPageIndexAt,
  getPageIndexContaining,
  getPageIndexRange,
  getPageRect,
  getPageSizeInPoints,
  getPageTextMaxWidth,
  normalizePageSetup,
  updatePageSetup,
} from "./pageSetup";

import type { PageSetup } from "./pageSetup";

const sep = (changes: Partial<PageSetup> = {}): PageSetup =>
  updatePageSetup(null, { layout: "separate", pageCount: 3, ...changes });
const cont = (changes: Partial<PageSetup> = {}): PageSetup =>
  updatePageSetup(null, { layout: "continuous", pageCount: 3, ...changes });

describe("normalizePageSetup", () => {
  it("returns null for missing or bad input (normal canvas)", () => {
    expect(normalizePageSetup(undefined)).toBeNull();
    expect(normalizePageSetup(null)).toBeNull();
    expect(normalizePageSetup("a4")).toBeNull();
    expect(normalizePageSetup([])).toBeNull();
  });

  it("fills defaults and derives preset sizes from size + orientation", () => {
    expect(normalizePageSetup({})).toEqual(DEFAULT_PAGE_SETUP);
    const s = normalizePageSetup({
      size: "a4",
      orientation: "landscape",
      width: 1,
      height: 1,
    })!;
    expect([s.width, s.height]).toEqual([1123, 794]);
  });

  it("clamps custom sizes and page counts, rejects unknown enums", () => {
    const s = normalizePageSetup({
      size: "custom",
      width: 10,
      height: 99999.6,
      pageCount: 0,
      layout: "zigzag",
      paperTheme: "neon",
      enabled: "yes",
    })!;
    expect(s).toMatchObject({
      width: 100,
      height: 5000,
      pageCount: 1,
      layout: DEFAULT_PAGE_SETUP.layout,
      paperTheme: "normal",
      enabled: true,
    });
  });
});

describe("page geometry", () => {
  it("stacks separate pages with a gap and continuous pages without", () => {
    expect(getPageRect(sep(), 2).y).toBe(2 * (1123 + PAGE_GAP));
    expect(getPageRect(cont(), 2).y).toBe(2 * 1123);
    expect(getPageAreaHeight(sep())).toBe(3 * 1123 + 2 * PAGE_GAP);
    expect(getPageAreaHeight(cont())).toBe(3 * 1123);
  });

  it("finds the nearest page and the containing page", () => {
    const s = sep();
    expect(getPageIndexAt(s, -500)).toBe(0);
    expect(getPageIndexAt(s, 1123 + 5)).toBe(0); // first half of the gap
    expect(getPageIndexAt(s, 1123 + 35)).toBe(1);
    expect(getPageIndexAt(s, 1e9)).toBe(2);
    expect(getPageIndexContaining(s, 10, 10)).toBe(0);
    expect(getPageIndexContaining(s, 10, 1123 + 10)).toBe(-1); // gap
    expect(getPageIndexContaining(s, -1, 10)).toBe(-1);
    expect(getPageIndexContaining(s, 795, 10)).toBe(-1);
    expect(getPageIndexContaining(s, 10, 1e9)).toBe(-1);
    expect(getPageIndexRange(s, 1000, 1300)).toEqual([0, 1]);
    expect(getPageIndexRange(s, 1e9, 2e9)).toBeNull();
  });

  it("clamps bounds into the page of their centre", () => {
    const s = sep();
    expect(getClampToPageOffset(s, [10, 10, 100, 100])).toEqual({
      dx: 0,
      dy: 0,
      index: 0,
    });
    expect(getClampToPageOffset(s, [-20, 10, 80, 100]).dx).toBe(20);
    expect(getClampToPageOffset(s, [750, 10, 850, 100]).dx).toBe(-56);
    // crosses the break, centre on page 0: pushed up
    expect(getClampToPageOffset(s, [0, 1080, 50, 1140])).toMatchObject({
      dy: 1123 - 1140,
      index: 0,
    });
    // centre on page 1: pushed down onto page 1
    const off = getClampToPageOffset(s, [0, 1150, 50, 1250]);
    expect(off).toMatchObject({ index: 1, dy: 1163 - 1150 });
    // bigger than the page: aligned to the top-left corner
    expect(getClampToPageOffset(s, [-50, 5, 2000, 50]).dx).toBe(50);
  });

  it("auto-extends only when content reaches the last quarter", () => {
    const s = sep({ pageCount: 1 });
    expect(getAutoExtendedPageCount(s, 100)).toBe(1);
    expect(getAutoExtendedPageCount(s, 1123 * 0.8)).toBe(2);
    expect(getAutoExtendedPageCount(sep({ pageCount: 4 }), 100)).toBe(4);
    expect(getAutoExtendedPageCount(cont({ pageCount: 1 }), 1123 * 2.9)).toBe(
      4,
    );
    expect(getAutoExtendedPageCount(s, Number.NaN)).toBe(1);
  });

  it("fits the page width and reports exact PDF sizes", () => {
    expect(getFitPageWidthZoom(sep(), 794 + 48, 24)).toBe(1);
    expect(getPageSizeInPoints(sep())).toEqual({ width: 595, height: 842 });
    expect(
      getPageSizeInPoints(updatePageSetup(null, { orientation: "landscape" })),
    ).toEqual({ width: 842, height: 595 });
  });
});

describe("continuous layout clamping", () => {
  it("clamps to the column, so content may straddle page breaks", () => {
    const c = cont();
    expect(getClampToPageOffset(c, [0, 1080, 50, 1140])).toMatchObject({
      dx: 0,
      dy: 0,
    });
    expect(getClampToPageOffset(c, [-10, 3300, 50, 3400])).toMatchObject({
      dx: 10,
      dy: 3 * 1123 - 3400,
    });
  });
});

describe("getPageTextMaxWidth (a free text wraps at the page edge)", () => {
  const A4W = 794;
  const t = (
    x: number,
    width: number,
    textAlign: "left" | "center" | "right" = "left",
    fontSize = 20,
  ) => ({ x, width, textAlign, fontSize });

  it("left aligned: from its left edge to the page's right edge", () => {
    expect(getPageTextMaxWidth(sep(), t(100, 50))).toBe(A4W - 100);
    expect(getPageTextMaxWidth(sep(), t(0, 50))).toBe(A4W);
  });

  it("right aligned: from the page's left edge to its right edge", () => {
    expect(getPageTextMaxWidth(sep(), t(500, 100, "right"))).toBe(600);
  });

  it("centred: the nearer side decides, both ways", () => {
    expect(getPageTextMaxWidth(sep(), t(100, 100, "center"))).toBe(300);
    expect(getPageTextMaxWidth(sep(), t(594, 100, "center"))).toBe(300);
  });

  it("a text at the very edge keeps room for a few letters, never one per line", () => {
    expect(getPageTextMaxWidth(sep(), t(790, 4, "left", 20))).toBe(120);
    expect(getPageTextMaxWidth(sep(), t(790, 4, "left", 500))).toBe(A4W);
  });

  it("is the same on every page of a layout (x is the only input)", () => {
    for (const layout of [sep(), cont()]) {
      expect(getPageTextMaxWidth(layout, t(300, 10))).toBe(A4W - 300);
    }
  });
});
