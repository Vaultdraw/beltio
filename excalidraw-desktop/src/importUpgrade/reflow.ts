/**
 * Re-wrap and reflow for imported notes (toimprove #111, #113): a text whose lines are wider
 * than its element is clipped by the editor. That happens when "Update imported notes" gives an
 * old import a wider font (Excalifont to Cascadia) and keeps the old line breaks. This re-wraps
 * each such text at its width in its font and moves the blocks below it down the page, onto the
 * next page when the page is full, the way the import lays a note out.
 *
 * Line breaks: the import wrapped paragraphs itself, so most breaks are soft. A break is kept
 * when the next line starts a list item (•, ☐, ☑, 1.), and a list item's indented continuation
 * lines join their item. With the font the text was wrapped in, a break is soft only when the
 * next word did not fit on the line, so a real line break of the note survives. Code (a text on
 * a code box) and text tables keep every line; a line too wide for them is broken by itself.
 *
 * Pure: elements in, elements out; the caller supplies the measure and the wrap.
 */

/** Width of one line, and the editor's wrap of a text at a width, for a family and size. */
export interface TextMeasure {
  width(text: string, fontFamily: number, fontSize: number): number;
  wrap(
    text: string,
    fontFamily: number,
    fontSize: number,
    maxWidth: number,
  ): string[];
}

type El = Record<string, unknown> & {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
};

export interface PageGeometry {
  height: number;
  /** Page i starts at i * pitch. */
  pitch: number;
  pageCount: number;
}

/** Space between separate pages (the editor's PAGE_GAP). */
const PAGE_GAP = 40;
/** A line may exceed its element by this much (float noise) before it counts as clipped. */
const SLACK = 0.5;
/** The import's code box fill (sdk/api/shared/pageItems.ts FILL_COLORS.code). */
const CODE_FILL = "#e9ecef";
const LIST_START = /^(•|☐|☑|\d+[.)]|[-*+]) /;

export const pageGeometryOf = (
  setup: Record<string, unknown> | undefined,
): PageGeometry | null => {
  if (!setup || setup.enabled !== true) {
    return null;
  }
  const height = Number(setup.height);
  if (!(height > 0)) {
    return null;
  }
  return {
    height,
    pitch: setup.layout === "continuous" ? height : height + PAGE_GAP,
    pageCount: Math.max(1, Number(setup.pageCount) || 1),
  };
};

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const isText = (e: El) =>
  e.type === "text" && e.isDeleted !== true && !e.containerId;

/** True when a line of the text is wider than the element (the editor clips it). */
export const overflows = (e: El, m: TextMeasure): boolean => {
  const width = num(e.width);
  const family = num(e.fontFamily);
  const size = num(e.fontSize);
  return String(e.text ?? "")
    .split("\n")
    .some((line) => m.width(line, family, size) > width + SLACK);
};

const onCodeBox = (e: El, boxes: El[]) =>
  boxes.some(
    (b) =>
      num(b.x) <= num(e.x) &&
      num(b.y) <= num(e.y) &&
      num(b.x) + num(b.width) >= num(e.x) + num(e.width) - 1 &&
      num(b.y) + num(b.height) >= num(e.y) + 1,
  );

const firstWord = (line: string) => line.trimStart().split(/\s+/)[0] ?? "";

/**
 * The text's lines grouped into what the note had as one line: soft breaks joined.
 * Each group: its text (joined with spaces) and the indent its continuation lines take.
 */
const groupsOf = (
  lines: string[],
  width: number,
  softAt: (line: string, next: string) => boolean,
): Array<{ text: string; indent: string }> => {
  const out: Array<{ text: string; indent: string }> = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (!last || line === "" || LIST_START.test(line.trimStart())) {
      out.push({ text: line, indent: "" });
      continue;
    }
    const lead = /^\s+/.exec(line)?.[0] ?? "";
    if (lead && LIST_START.test(last.text.trimStart())) {
      // A list item's continuation line.
      last.text += ` ${line.trimStart()}`;
      last.indent = lead;
      continue;
    }
    const prevLine = last.text;
    if (!lead && softAt(prevLine, line)) {
      last.text += ` ${line}`;
      continue;
    }
    out.push({ text: line, indent: "" });
  }
  void width;
  return out;
};

/**
 * The text re-wrapped at its width, or null when it already fits. `oldFamily`: the family it was
 * wrapped in when that changed just now (a break is then soft only where the next word did not
 * fit in that family).
 */
export const rewrapText = (
  e: El,
  m: TextMeasure,
  preformatted: boolean,
  oldFamily?: number,
): string[] | null => {
  if (!overflows(e, m)) {
    return null;
  }
  const width = num(e.width);
  const family = num(e.fontFamily);
  const size = num(e.fontSize);
  const lines = String(e.text ?? "").split("\n");
  if (preformatted) {
    return lines.flatMap((l) => m.wrap(l, family, size, width));
  }
  const softAt = (line: string, next: string) =>
    oldFamily === undefined
      ? true
      : m.width(`${line} ${firstWord(next)}`, oldFamily, size) > width + SLACK;
  const out: string[] = [];
  for (const g of groupsOf(lines, width, softAt)) {
    if (!g.indent) {
      out.push(...m.wrap(g.text, family, size, width));
      continue;
    }
    const inset = m.width(g.indent, family, size);
    const wrapped = m.wrap(g.text, family, size, Math.max(1, width - inset));
    out.push(...wrapped.map((l, i) => (i === 0 ? l : g.indent + l)));
  }
  return out;
};

export interface ReflowResult {
  elements: El[];
  /** Texts re-wrapped. */
  rewrapped: number;
  pageCount: number;
}

/**
 * Re-wraps every clipped text and moves what is below it down. `oldFamilies` maps element ids
 * whose font changed just now to the family they were wrapped in. Returns null when nothing is
 * clipped.
 */
export function reflowScene(
  elements: El[],
  geometry: PageGeometry | null,
  m: TextMeasure,
  oldFamilies: ReadonlyMap<string, number> = new Map(),
): ReflowResult | null {
  const live = elements.filter((e) => e.isDeleted !== true);
  const codeBoxes = live.filter(
    (e) => e.type === "rectangle" && e.backgroundColor === CODE_FILL,
  );
  const next = new Map<El, El>();
  for (const e of live) {
    if (!isText(e)) {
      continue;
    }
    const text = String(e.text ?? "");
    const pre = onCodeBox(e, codeBoxes) || text.includes("│");
    const lines = rewrapText(e, m, pre, oldFamilies.get(String(e.id)));
    if (!lines) {
      continue;
    }
    const joined = lines.join("\n");
    const lineHeight = num(e.lineHeight) || 1.25;
    next.set(e, {
      ...e,
      text: joined,
      originalText: joined,
      height: lines.length * num(e.fontSize) * lineHeight,
      version: num(e.version) + 1,
    });
  }
  if (next.size === 0) {
    return null;
  }
  const grown = (e: El) => num(next.get(e)?.height ?? e.height) - num(e.height);
  if (!geometry) {
    return {
      elements: elements.map((e) => next.get(e) ?? e),
      rewrapped: next.size,
      pageCount: 1,
    };
  }
  const moved = reflowPages(live, geometry, grown);
  const out = elements.map((e) => {
    const base = next.get(e) ?? e;
    const dy = moved.shift.get(e) ?? 0;
    return dy === 0
      ? base
      : {
          ...base,
          y: num(e.y) + dy,
          version: next.has(e) ? base.version : num(e.version) + 1,
        };
  });
  return { elements: out, rewrapped: next.size, pageCount: moved.pageCount };
}

interface Block {
  els: El[];
  /** Top and bottom relative to its page's top, before the reflow. */
  top: number;
  bottom: number;
  page: number;
  grow: number;
}

/**
 * Blocks (elements that overlap vertically on a page) keep their page and gaps; a block that
 * grew pushes the ones below it down, and a block that no longer fits moves to the top of the
 * next page with everything after it, as the import's paginator would.
 */
function reflowPages(
  live: El[],
  g: PageGeometry,
  grown: (e: El) => number,
): { shift: Map<El, number>; pageCount: number } {
  const pageOf = (e: El) => Math.max(0, Math.floor(num(e.y) / g.pitch));
  const byPage = new Map<number, El[]>();
  for (const e of live) {
    const p = pageOf(e);
    byPage.set(p, [...(byPage.get(p) ?? []), e]);
  }
  const blocks: Block[] = [];
  let margin = Infinity;
  for (const [p, els] of [...byPage].sort((a, b) => a[0] - b[0])) {
    els.sort((a, b) => num(a.y) - num(b.y));
    let cur: Block | null = null;
    for (const e of els) {
      const top = num(e.y) - p * g.pitch;
      const bottom = top + num(e.height);
      margin = Math.min(margin, top);
      if (cur && top < cur.bottom) {
        cur.els.push(e);
        cur.bottom = Math.max(cur.bottom, bottom);
        cur.grow = Math.max(cur.grow, grown(e));
      } else {
        cur = { els: [e], top, bottom, page: p, grow: grown(e) };
        blocks.push(cur);
      }
    }
  }
  margin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  const limit = g.height - margin;
  const shift = new Map<El, number>();
  let page = -1;
  // Bottom of the last block placed on `page`; null: nothing placed there yet.
  let cursor: number | null = null;
  let prev: Block | null = null;
  let pageCount = g.pageCount;
  for (const b of blocks) {
    if (page < b.page) {
      // Nothing spilled this far: the block keeps its page and place.
      page = b.page;
      cursor = null;
    }
    const gap =
      prev && prev.page === b.page ? b.top - prev.bottom : b.top - margin;
    const height = b.bottom - b.top + b.grow;
    let top: number = cursor === null ? b.top : cursor + Math.max(0, gap);
    if (top + height > limit && top > margin) {
      page++;
      top = margin;
    }
    for (const e of b.els) {
      const dy = page * g.pitch + top - (b.page * g.pitch + b.top);
      if (dy !== 0) {
        shift.set(e, dy);
      }
    }
    cursor = top + height;
    prev = b;
    pageCount = Math.max(pageCount, page + 1);
  }
  return { shift, pageCount };
}
