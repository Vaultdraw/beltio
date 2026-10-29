/**
 * `layoutNote`: a parsed note (`NoteDoc`) and a width table → page items the
 * host turns into page-mode elements. Runs inside the worker
 * (src/worker/entry.ts) or in-thread as a fallback.
 *
 * ```
 * NoteDoc ─ mapNote ─▶ items ─ wrap (editor wrapText) ─▶ line entries ─ Paginator ─▶ pages
 *                        │                                                  ▲
 *                        └─ PartCutter: a new part (drawing) every ~1,000 elements
 * ```
 *
 * Everything streams: `layoutNoteStream` yields the first page as soon as
 * the paginator closes it, before the rest of the note is wrapped.
 */
import { mapNote } from "./blocks";
import { fontPlan } from "./fonts";
import { Paginator } from "./paginate";
import { gridOf } from "./tableGrid";
import { PartCutter } from "./parts";
import { Wrapper } from "./wrap";

import type { NoteDoc } from "@vaultdraw/api";
import type { MappedList, MappedText } from "./blocks";
import type { Role } from "./fonts";
import type { Container, Entry, TextBlock } from "./paginate";
import type {
  LayoutEvent,
  LayoutOptions,
  LayoutResult,
  LayoutStats,
} from "./types";
import type { WidthTable } from "./widthTable";

export type {
  LayoutEvent,
  LayoutFonts,
  LayoutOptions,
  LayoutPage,
  LayoutPart,
  LayoutResult,
  LayoutStats,
  PageItem,
} from "./types";
export { buildWidthTable, widthTableTransferables } from "./widthTable";
export type { WidthTable, MeasureFn } from "./widthTable";

export const DEFAULT_PART_ELEMENTS = 1000;
/** Default image box when the note gives no size: the content width at most. */
const IMAGE_WIDTH = 480;
const IMAGE_RATIO = 0.625;

const margins = (m: LayoutOptions["page"]["margin"]) =>
  typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;

/** Where the next entries go: the content area, narrowed inside containers. */
interface Frame {
  container: Container | null;
  x: number;
  width: number;
  /** The container opened and has no entry yet: the first gets the top padding. */
  fresh: boolean;
}

/**
 * Lays a note out page by page. The generator yields `part`, `page`,
 * `partEnd` and `done` events in order (see `LayoutEvent`).
 */
export function* layoutNoteStream(
  doc: NoteDoc,
  table: WidthTable,
  opts: LayoutOptions,
): Generator<LayoutEvent> {
  const m = margins(opts.page.margin);
  const contentWidth = opts.page.width - m.left - m.right;
  const contentHeight = opts.page.height - m.top - m.bottom;
  if (!(contentWidth > 0) || !(contentHeight > 0)) {
    throw new Error("The page margins leave no room for content");
  }
  const roles = fontPlan(opts.fonts, opts.fontSize, opts.boldHeadings);
  const wrapper = new Wrapper(table);
  const bodyLine = roles.body.linePx;
  const pad = bodyLine / 2;
  const listIndent = roles.body.size * 1.5;
  const cutter = new PartCutter(opts.partElements ?? DEFAULT_PART_ELEMENTS);

  const stats: LayoutStats = {
    words: doc.stats.words,
    blocks: doc.stats.blocks,
    elements: 0,
    pages: 0,
    parts: 0,
    skipped: 0,
  };
  let partIndex = -1;
  let partElements = 0;
  let paginator: Paginator | null = null;
  let frame: Frame = {
    container: null,
    x: 0,
    width: contentWidth,
    fresh: false,
  };

  const startPart = (title: string): LayoutEvent => {
    partIndex++;
    partElements = 0;
    paginator = new Paginator(contentHeight, { top: m.top, left: m.left });
    stats.parts++;
    return { type: "part", partIndex, title };
  };
  const pageEvents = (final: boolean): LayoutEvent[] => {
    if (!paginator) {
      return [];
    }
    return paginator.flush(final).map((p) => {
      partElements += p.items.length;
      stats.elements += p.items.length;
      stats.pages++;
      return {
        type: "page" as const,
        partIndex,
        page: p.page,
        items: p.items,
        pageCount: p.page + 1,
      };
    });
  };
  const endPart = (): LayoutEvent[] => {
    const out = pageEvents(true);
    out.push({
      type: "partEnd",
      partIndex,
      pageCount: paginator?.completedPages ?? 0,
      elements: partElements,
    });
    return out;
  };

  const push = (entry: Entry) => {
    if (frame.fresh) {
      entry.height += pad;
      entry.offset += pad;
      frame.fresh = false;
    }
    paginator!.push(entry);
  };
  const line = (
    block: TextBlock,
    text: string,
    spaceBefore: number,
    keepWithNext: boolean,
  ): Entry => ({
    height: block.role.linePx,
    offset: 0,
    spaceBefore,
    keepWithNext,
    container: frame.container,
    payload: { kind: "line", block, text },
  });
  /** Pushes a block's lines with the widow/orphan rules (2 lines together at each end). */
  const pushLines = (
    block: TextBlock,
    lines: string[],
    spaceBefore: number,
    keepWithNext: boolean,
    splittable: boolean,
  ) => {
    const n = lines.length;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const keep = last ? keepWithNext : !splittable || i === 0 || i === n - 2;
      push(line(block, lines[i], i === 0 ? spaceBefore : 0, keep));
    }
  };

  const textItem = (item: MappedText) => {
    const role: Role = roles[item.role];
    const block: TextBlock = { role, x: frame.x, width: frame.width };
    if (item.tone) {
      block.tone = item.tone;
    }
    if (item.link) {
      block.link = item.link;
    }
    if (item.data) {
      block.data = item.data;
    }
    const lines = wrapper.lines(item.text, role, frame.width);
    pushLines(
      block,
      lines,
      item.spaceBefore * bodyLine,
      item.keepWithNext,
      item.splittable,
    );
  };

  const listItem = (item: MappedList) => {
    const role = item.bold ? roles.bodyBold : roles.body;
    const indent = Math.min(item.depth * listIndent, frame.width / 2);
    const block: TextBlock = {
      role,
      x: frame.x + indent,
      width: frame.width - indent,
    };
    const space = wrapper.width(" ", role);
    const lines: string[] = [];
    for (const li of item.items) {
      const prefixWidth = wrapper.width(li.prefix, role);
      const spaces = space > 0 ? Math.ceil(prefixWidth / space) : 2;
      const cont = " ".repeat(spaces);
      const inset = Math.max(prefixWidth, spaces * space);
      const wrapped = wrapper.lines(li.text, role, block.width - inset);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push((i === 0 ? li.prefix : cont) + wrapped[i]);
      }
    }
    pushLines(block, lines, item.spaceBefore * bodyLine, false, true);
  };

  const open = (fill: Container["fill"]) => {
    const container: Container = {
      fill,
      parent: frame.container,
      x: frame.x,
      width: frame.width,
      closed: false,
    };
    frame = {
      container,
      x: frame.x + pad,
      width: frame.width - 2 * pad,
      fresh: true,
    };
  };
  const close = () => {
    const c = frame.container!;
    c.closed = true;
    if (!frame.fresh) {
      const last = paginator!.lastPending();
      if (last) {
        last.height += pad;
      }
    }
    frame = {
      container: c.parent,
      x: c.x,
      width: c.width,
      fresh: false,
    };
  };

  yield startPart("");
  for (const item of mapNote(doc, {
    headingColors: opts.headingColors ?? true,
    boldText: opts.boldText ?? true,
  })) {
    if (cutter.consider(item)) {
      yield* endPart();
      yield startPart(
        item.kind === "text" && item.cut !== undefined
          ? item.text
          : `Part ${partIndex + 2}`,
      );
    }
    switch (item.kind) {
      case "text":
        textItem(item);
        break;
      case "list":
        listItem(item);
        break;
      case "table": {
        const grid = gridOf(
          item.header,
          item.rows,
          item.align,
          wrapper,
          roles.body,
          frame.width,
          roles.bodyBold,
          item.bold,
        );
        const n = grid.rowH.length;
        for (let r = 0; r < n; r++) {
          push({
            height: grid.rowH[r],
            offset: 0,
            spaceBefore: r === 0 ? item.spaceBefore * bodyLine : 0,
            // The header stays with the first body row.
            keepWithNext: grid.header && r === 0 && n > 1,
            container: frame.container,
            payload: { kind: "tableRow", x: frame.x, grid, row: r },
          });
        }
        break;
      }
      case "open":
        open(item.fill);
        break;
      case "close":
        close();
        break;
      case "rule":
        push({
          height: bodyLine,
          offset: 0,
          spaceBefore: item.spaceBefore * bodyLine,
          keepWithNext: false,
          container: frame.container,
          payload: { kind: "rule", x: frame.x, width: frame.width },
        });
        break;
      case "image": {
        let width = item.width ?? Math.min(frame.width, IMAGE_WIDTH);
        let height =
          item.height ??
          (item.width ? item.width * IMAGE_RATIO : width * IMAGE_RATIO);
        if (item.height && !item.width) {
          width = Math.min(frame.width, item.height / IMAGE_RATIO);
        }
        if (width > frame.width) {
          height *= frame.width / width;
          width = frame.width;
        }
        height = Math.min(height, contentHeight - pad);
        push({
          height,
          offset: 0,
          spaceBefore: item.spaceBefore * bodyLine,
          keepWithNext: false,
          container: frame.container,
          payload: {
            kind: "image",
            x: frame.x,
            width,
            target: item.target,
            mimeType: item.mimeType,
            ...(item.alt ? { alt: item.alt } : {}),
          },
        });
        break;
      }
      default:
        break;
    }
    if (frame.container === null) {
      yield* pageEvents(false);
    }
  }
  yield* endPart();
  yield { type: "done", stats };
}

/** The whole layout at once: parts with their items and page counts. */
export const layoutNote = (
  doc: NoteDoc,
  table: WidthTable,
  opts: LayoutOptions,
): LayoutResult => {
  const parts: LayoutResult["parts"] = [];
  let stats: LayoutStats | null = null;
  for (const ev of layoutNoteStream(doc, table, opts)) {
    switch (ev.type) {
      case "part":
        parts.push({ title: ev.title, items: [], pageCount: 0 });
        break;
      case "page":
        parts[ev.partIndex].items.push(...ev.items);
        parts[ev.partIndex].pageCount = ev.pageCount;
        break;
      case "partEnd":
        parts[ev.partIndex].pageCount = ev.pageCount;
        break;
      case "done":
        stats = ev.stats;
        break;
    }
  }
  return { parts, stats: stats! };
};
