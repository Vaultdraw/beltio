/** Where a run of page pictures goes in a drawing (`ctx.scene.placePages`). Pure. */
import { arrayToMap } from "@excalidraw/common";
import { getCommonBounds, getNonDeletedElements } from "@excalidraw/element";
import {
  getPageIndexAt,
  getPageRect,
  isPageModeOn,
  PAGE_GAP,
  PAGE_LIMITS,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getContentBottom } from "../page/pageContent";

export type PlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PagePlacementPlan = {
  rects: PlacementRect[];
  /** Page mode: the page count to set (start + n). */
  pageCount?: number;
  /** Page mode: first page used. */
  startPage?: number;
  /** Page mode: pages that still fit (limit - start). Infinity otherwise. */
  maxPagesThatFit: number;
};

export const planPagePlacement = ({
  sizes,
  elements,
  pageSetup,
}: {
  /** The pictures, in scene pixels. */
  sizes: readonly { width: number; height: number }[];
  elements: readonly ExcalidrawElement[];
  pageSetup: PageSetup | null | undefined;
}): PagePlacementPlan => {
  const live = getNonDeletedElements(elements);

  if (pageSetup && isPageModeOn(pageSetup)) {
    const bottom = getContentBottom(pageSetup, live, arrayToMap(live));
    const start =
      bottom > 0 ? getPageIndexAt(pageSetup, bottom - 0.001) + 1 : 0;
    const rects = sizes.map((s, k) => {
      const slot = getPageRect(pageSetup, start + k);
      const scale = Math.min(slot.width / s.width, slot.height / s.height);
      // round inwards so the fit never leaves the page
      const width = Math.floor(s.width * scale);
      const height = Math.floor(s.height * scale);
      return {
        x: slot.x + Math.floor((slot.width - width) / 2),
        y: slot.y + Math.floor((slot.height - height) / 2),
        width,
        height,
      };
    });
    return {
      rects,
      startPage: start,
      // never drop pages the drawing already has
      pageCount: Math.min(
        PAGE_LIMITS.pageCount.max,
        Math.max(pageSetup.pageCount, start + sizes.length),
      ),
      maxPagesThatFit: Math.max(0, PAGE_LIMITS.pageCount.max - start),
    };
  }

  let x = 0;
  let y = 0;
  if (live.length) {
    const [minX, , , maxY] = getCommonBounds(live);
    x = minX;
    y = maxY + PAGE_GAP;
  }
  const rects = sizes.map((s) => {
    const rect = { x, y, width: s.width, height: s.height };
    y += s.height + PAGE_GAP;
    return rect;
  });
  return { rects, maxPagesThatFit: Infinity };
};
