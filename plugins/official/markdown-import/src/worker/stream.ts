/**
 * The seam main.ts uses (src/deps.ts re-exports it): build the width table
 * on the main thread with `ctx.text.measure`, run the layout in the worker
 * (or in-thread where there is none) and hand back one batch per page, the
 * first page first. `part` is 1-based; a new number means a new drawing.
 */
import { layoutNoteStream as layoutInThread } from "../layout/index";
import { buildWidthTable } from "../layout/widthTable";

import { createLayoutClient } from "./client";

import type { NoteDoc } from "@vaultdraw/api";
import type {
  FontFamilyName,
  LayoutFonts,
  LayoutOptions,
  LayoutStats,
  PageItem,
} from "../layout/types";
import type { MeasureFn } from "../layout/widthTable";
import type { LayoutClient } from "./client";

export interface LayoutBatchOptions {
  /** One family for everything (code still uses `fonts.code`, default Cascadia), or three. */
  family?: FontFamilyName;
  fonts?: Partial<LayoutFonts>;
  fontSize: number;
  page: {
    width: number;
    height: number;
    margin?: LayoutOptions["page"]["margin"];
  };
  partElements: number;
  measure: MeasureFn;
  signal?: AbortSignal;
  /** For tests: the in-thread fallback even where workers exist. */
  client?: LayoutClient;
}

export interface LayoutBatch {
  items: PageItem[];
  /** Pages used so far in this part, this batch's page included. */
  pageCount: number;
  /** 1-based part this batch belongs to; a new number starts a new drawing. */
  part: number;
  /** The part's title (a heading at the cut; "" for the first part). */
  title: string;
  /** Set on the last batch of a part. */
  partDone?: { pageCount: number; elements: number };
}

export const DEFAULT_MARGIN = 48;
export const DEFAULT_CODE_FONT: FontFamilyName = "Cascadia";

export const layoutFonts = (opts: LayoutBatchOptions): LayoutFonts => {
  const base = opts.family ?? opts.fonts?.body ?? "Excalifont";
  return {
    body: opts.fonts?.body ?? base,
    heading: opts.fonts?.heading ?? base,
    code: opts.fonts?.code ?? DEFAULT_CODE_FONT,
  };
};

/** Builds the width table for a note: one main-thread measure pass. */
export const measureNote = (doc: NoteDoc, opts: LayoutBatchOptions) =>
  buildWidthTable(opts.measure, doc, {
    fonts: layoutFonts(opts),
    fontSize: opts.fontSize,
  });

/**
 * Streams the laid-out note as batches, one per page. The stats arrive as
 * the generator's return value.
 */
export async function* layoutNoteBatches(
  doc: NoteDoc,
  opts: LayoutBatchOptions,
): AsyncGenerator<LayoutBatch, LayoutStats | undefined> {
  const table = measureNote(doc, opts);
  const layoutOpts: LayoutOptions = {
    fonts: layoutFonts(opts),
    fontSize: opts.fontSize,
    page: {
      width: opts.page.width,
      height: opts.page.height,
      margin: opts.page.margin ?? DEFAULT_MARGIN,
    },
    partElements: opts.partElements,
  };
  const client = opts.client ?? createLayoutClient();
  // Events arrive on a callback; the generator drains them in order.
  const queue: LayoutBatch[] = [];
  let wake: (() => void) | null = null;
  let finished: { stats?: LayoutStats; error?: unknown } | null = null;
  const titles: string[] = [];
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  client
    .layout({
      doc,
      table,
      opts: layoutOpts,
      signal: opts.signal,
      onEvent: (ev) => {
        if (ev.type === "part") {
          titles[ev.partIndex] = ev.title;
        } else if (ev.type === "page") {
          queue.push({
            items: ev.items,
            pageCount: ev.pageCount,
            part: ev.partIndex + 1,
            title: titles[ev.partIndex] ?? "",
          });
        } else if (ev.type === "partEnd") {
          const last = queue.length ? queue[queue.length - 1] : null;
          const done = { pageCount: ev.pageCount, elements: ev.elements };
          if (last && last.part === ev.partIndex + 1 && !last.partDone) {
            last.partDone = done;
          } else {
            queue.push({
              items: [],
              pageCount: ev.pageCount,
              part: ev.partIndex + 1,
              title: titles[ev.partIndex] ?? "",
              partDone: done,
            });
          }
        }
        notify();
      },
    })
    .then(
      (stats) => {
        finished = { stats };
        notify();
      },
      (error) => {
        finished = { error };
        notify();
      },
    );
  for (;;) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    if (finished) {
      const f: { stats?: LayoutStats; error?: unknown } = finished;
      if (f.error) {
        throw f.error;
      }
      return f.stats;
    }
    await new Promise<void>((r) => {
      wake = r;
    });
  }
}

export { layoutInThread };
