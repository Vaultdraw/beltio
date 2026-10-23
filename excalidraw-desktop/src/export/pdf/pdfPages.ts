/** Which pages a PDF export has (pure: page geometry only, no rendering). */

import { DEFAULT_EXPORT_PADDING } from "@excalidraw/common";
import { getCommonBounds } from "@excalidraw/element";
import {
  getPageRect,
  getPageSizeInPoints,
  isPageModeOn,
} from "@excalidraw/excalidraw/data/pageSetup";

import type {
  PageRect,
  PageSetup,
} from "@excalidraw/excalidraw/data/pageSetup";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { emptyCanvasError } from "../exportError";

export type PdfPagePlan = {
  /** area of the scene drawn on this page, scene px */
  rect: PageRect;
  /** PDF page size, points */
  widthPt: number;
  heightPt: number;
};

/** 1 scene px = 1 CSS px at 96 dpi = 0.75 pt. */
export const PT_PER_PX = 0.75;

/** Page mode: one PDF page per page; otherwise one page around the content. */
export const planPdfPages = (
  pageSetup: PageSetup | null | undefined,
  elements: readonly ExcalidrawElement[],
): PdfPagePlan[] => {
  if (isPageModeOn(pageSetup)) {
    const size = getPageSizeInPoints(pageSetup);
    // Continuous pages have no gap, so getPageRect(i) are the page-size
    // breaks of the roll; separate pages skip their gaps.
    return Array.from({ length: pageSetup.pageCount }, (_, i) => ({
      rect: getPageRect(pageSetup, i),
      widthPt: size.width,
      heightPt: size.height,
    }));
  }
  const live = elements.filter((el) => !el.isDeleted);
  if (live.length === 0) {
    throw emptyCanvasError();
  }
  const [x1, y1, x2, y2] = getCommonBounds(live);
  const rect = {
    x: x1 - DEFAULT_EXPORT_PADDING,
    y: y1 - DEFAULT_EXPORT_PADDING,
    width: x2 - x1 + DEFAULT_EXPORT_PADDING * 2,
    height: y2 - y1 + DEFAULT_EXPORT_PADDING * 2,
  };
  return [
    {
      rect,
      widthPt: rect.width * PT_PER_PX,
      heightPt: rect.height * PT_PER_PX,
    },
  ];
};

/** Browsers cap canvases (~16.7 M px, ~16 k per side): keep well below. */
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 8192;

/** The requested scale, lowered so the page canvas stays within limits. */
export const clampRenderScale = (
  width: number,
  height: number,
  scale: number,
): number =>
  Math.min(
    scale,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    MAX_CANVAS_SIDE / Math.max(width, height),
  );
