/**
 * `ctx.pages` rules, shared by the app's host and the mock: page geometry
 * (the editor's page sizes, packages/excalidraw/data/pageSetup.ts, tied by
 * sdk/api/test/mockParity.test.ts) and the greedy paginator.
 */
import { PluginApiError } from "./rules";

import type {
  FlowItem,
  FlowOptions,
  FlowPlacement,
  PageGeometry,
  PageRequest,
  PageSizeName,
} from "@vaultdraw/api";

const mm = (w: number, h: number) => ({
  width: Math.round((w * 96) / 25.4),
  height: Math.round((h * 96) / 25.4),
});

/** Portrait sizes in scene pixels (96 dpi). */
export const PAGE_SIZES: Readonly<
  Record<PageSizeName, { width: number; height: number }>
> = {
  a3: mm(297, 420),
  a4: mm(210, 297),
  a5: mm(148, 210),
  b5: mm(176, 250),
  letter: mm(215.9, 279.4),
  legal: mm(215.9, 355.6),
  tablet: { width: 834, height: 1194 },
  tabletLarge: { width: 1032, height: 1376 },
  phone: { width: 393, height: 852 },
};

/** Space between separate pages, scene pixels. */
export const PAGE_GAP = 40;
const SIDE = { min: 100, max: 5000 };
export const MAX_FLOW_ITEMS = 1_000_000;

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", message);

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const side = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw bad(`size.${name} must be a number`);
  }
  if (v < SIDE.min || v > SIDE.max) {
    throw bad(`size.${name} must be between ${SIDE.min} and ${SIDE.max}`);
  }
  return Math.round(v);
};

export const pageGeometry = (request: PageRequest = {}): PageGeometry => {
  if (!isObject(request)) {
    throw bad("The page request must be an object");
  }
  const {
    size = "a4",
    orientation = "portrait",
    layout = "separate",
  } = request;
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw bad('orientation must be "portrait" or "landscape"');
  }
  if (layout !== "separate" && layout !== "continuous") {
    throw bad('layout must be "separate" or "continuous"');
  }
  let width: number;
  let height: number;
  if (typeof size === "string") {
    if (!Object.hasOwn(PAGE_SIZES, size)) {
      throw bad(`Unknown page size "${size}"`);
    }
    const p = PAGE_SIZES[size as PageSizeName];
    [width, height] =
      orientation === "landscape" ? [p.height, p.width] : [p.width, p.height];
  } else if (isObject(size)) {
    width = side(size.width, "width");
    height = side(size.height, "height");
  } else {
    throw bad("size must be a page size name or { width, height }");
  }
  const gap = layout === "separate" ? PAGE_GAP : 0;
  return Object.freeze({ width, height, gap, pitch: height + gap });
};

const nonNegative = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw bad(`${what} must be a number of 0 or more`);
  }
  return v;
};

/**
 * Greedy pagination with keep-with-next chains. An item that does not fit
 * goes to the next page; a chain (items joined by `keepWithNext`) that fits
 * on one page but not on the rest of this one moves as a whole.
 */
export const flowPages = (
  items: readonly FlowItem[],
  options: FlowOptions,
): FlowPlacement[] => {
  if (!Array.isArray(items)) {
    throw bad("items must be an array");
  }
  if (items.length > MAX_FLOW_ITEMS) {
    throw bad(`At most ${MAX_FLOW_ITEMS} items per call`);
  }
  if (!isObject(options)) {
    throw bad("options must be an object");
  }
  const capacity = nonNegative(options.contentHeight, "contentHeight");
  if (capacity === 0) {
    throw bad("contentHeight must be more than 0");
  }
  const n = items.length;
  const heights = new Float64Array(n);
  const spaces = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const it = items[i];
    if (!isObject(it)) {
      throw bad(`items[${i}] must be an object`);
    }
    heights[i] = nonNegative(it.height, `items[${i}].height`);
    spaces[i] =
      it.spaceBefore === undefined
        ? 0
        : nonNegative(it.spaceBefore, `items[${i}].spaceBefore`);
  }
  // Height of the keep-with-next chain starting at i, stopping once it exceeds `limit`.
  const chainHeight = (i: number, limit: number): number => {
    let h = heights[i];
    for (let j = i; items[j].keepWithNext && j + 1 < n && h <= limit; j++) {
      h += spaces[j + 1] + heights[j + 1];
    }
    return h;
  };
  const out: FlowPlacement[] = new Array(n);
  let page = 0;
  let y = 0;
  let empty = true;
  // Items up to here belong to a chain already known to fit: no checks.
  let keepUntil = -1;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const chain = it.keepWithNext ? chainHeight(i, capacity) : heights[i];
    if (!empty) {
      const room = capacity - y - spaces[i];
      const moves =
        it.breakBefore ||
        (i > keepUntil &&
          chain > room &&
          // A chain taller than a page breaks inside, once its first item fits.
          (chain <= capacity || heights[i] > room));
      if (moves) {
        page++;
        y = 0;
        empty = true;
      }
    }
    if (it.keepWithNext && i > keepUntil && chain <= capacity) {
      keepUntil = lastOfChain(items, i);
    }
    if (!empty) {
      y += spaces[i];
    }
    out[i] = Object.freeze({ page, y });
    y += heights[i];
    empty = false;
  }
  return out;
};

const lastOfChain = (items: readonly FlowItem[], i: number): number => {
  let j = i;
  while (items[j].keepWithNext && j + 1 < items.length) {
    j++;
  }
  return j;
};
