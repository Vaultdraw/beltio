import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SETUP,
  getPageRect,
  PAGE_GAP,
  PAGE_LIMITS,
} from "@excalidraw/excalidraw/data/pageSetup";

import { rect } from "../page/testElements";

import { planPagePlacement } from "./placePages";

import type { PagePlacementPlan } from "./placePages";

const a4 = { widthPt: 595, heightPt: 842 };
const wide = { widthPt: 842, heightPt: 595 };
const k = 96 / 72;
type Pt = { widthPt: number; heightPt: number };
const planPdfPlacement = (o: {
  pages: Pt[];
  indices: number[];
  elements: Parameters<typeof planPagePlacement>[0]["elements"];
  pageSetup: Parameters<typeof planPagePlacement>[0]["pageSetup"];
}): PagePlacementPlan =>
  planPagePlacement({
    sizes: o.indices.map((i) => ({
      width: o.pages[i].widthPt * k,
      height: o.pages[i].heightPt * k,
    })),
    elements: o.elements,
    pageSetup: o.pageSetup,
  });
const setup = { ...DEFAULT_PAGE_SETUP, enabled: true, pageCount: 3 };

describe("normal mode", () => {
  it("stacks at the origin on an empty scene", () => {
    const p = planPdfPlacement({
      pages: [a4, wide],
      indices: [0, 1],
      elements: [],
      pageSetup: null,
    });
    expect(p.pageCount).toBeUndefined();
    expect(p.rects[0]).toEqual({
      x: 0,
      y: 0,
      width: a4.widthPt * k,
      height: a4.heightPt * k,
    });
    expect(p.rects[1].y).toBeCloseTo(a4.heightPt * k + PAGE_GAP);
    expect(p.rects[1].width).toBeCloseTo(wide.widthPt * k);
  });

  it("starts below existing content, aligned to its left edge", () => {
    const p = planPdfPlacement({
      pages: [a4],
      indices: [0],
      elements: [
        rect(50, 20, 100, 80),
        rect(0, 900, 10, 10, { isDeleted: true }),
      ],
      pageSetup: { ...setup, enabled: false },
    });
    expect(p.rects[0].x).toBe(50);
    expect(p.rects[0].y).toBe(100 + PAGE_GAP);
  });
});

describe("page mode", () => {
  it("grows the page count but never shrinks it", () => {
    const one = { ...setup, pageCount: 1 };
    expect(
      planPdfPlacement({
        pages: [a4, a4],
        indices: [0, 1],
        elements: [],
        pageSetup: one,
      }).pageCount,
    ).toBe(2);
    const many = { ...setup, pageCount: 9 };
    expect(
      planPdfPlacement({
        pages: [a4],
        indices: [0],
        elements: [],
        pageSetup: many,
      }).pageCount,
    ).toBe(9);
  });

  it("starts at page 0 when empty and fits inside the pages", () => {
    const p = planPdfPlacement({
      pages: [a4, wide],
      indices: [0, 1],
      elements: [],
      pageSetup: setup,
    });
    expect(p.startPage).toBe(0);
    // the drawing already has more pages than the import needs: keep them
    expect(p.pageCount).toBe(Math.max(setup.pageCount, 2));
    expect(p.maxPagesThatFit).toBe(PAGE_LIMITS.pageCount.max);
    p.rects.forEach((r, i) => {
      const slot = getPageRect(setup, i);
      expect(r.x).toBeGreaterThanOrEqual(slot.x);
      expect(r.y).toBeGreaterThanOrEqual(slot.y);
      expect(r.x + r.width).toBeLessThanOrEqual(slot.x + slot.width);
      expect(r.y + r.height).toBeLessThanOrEqual(slot.y + slot.height);
    });
    // landscape page is width-limited and centred vertically
    expect(p.rects[1].width).toBeLessThanOrEqual(setup.width);
    expect(p.rects[1].y).toBeGreaterThan(getPageRect(setup, 1).y);
  });

  it("starts after the last page holding content", () => {
    const slot1 = getPageRect(setup, 1);
    const p = planPdfPlacement({
      pages: [a4],
      indices: [0, 0],
      elements: [rect(10, slot1.y + 10, 50, 50)],
      pageSetup: setup,
    });
    expect(p.startPage).toBe(2);
    expect(p.pageCount).toBe(4);
    expect(p.maxPagesThatFit).toBe(PAGE_LIMITS.pageCount.max - 2);
  });

  it("content ending exactly at a page bottom does not skip a page (continuous)", () => {
    const cont = { ...setup, layout: "continuous" as const };
    const p = planPdfPlacement({
      pages: [a4],
      indices: [0],
      elements: [rect(10, cont.height - 50, 50, 50)],
      pageSetup: cont,
    });
    expect(p.startPage).toBe(1);
  });
});
