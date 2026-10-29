/**
 * The seams to the other engineers' modules: the layout (src/layout, src/worker) and the
 * Obsidian vault import (src/obsidian). main.ts and commands.ts import only from here.
 */

import { buildWidthTable } from "./layout/index";
import { importObsidianVault as importVault } from "./obsidian/importVault";
import { CODE_FONT, fontFamilyOf, layoutFamiliesOf } from "./settings";
import { createLayoutClient, LayoutAbortedError } from "./worker/client";

import type {
  FontFamilyName,
  NoteDoc,
  PageGeometry,
  PluginContext,
  SourceFolder,
  TargetFolder,
} from "@vaultdraw/api";

import type {
  LayoutOptions as LayoutEngineOptions,
  PageItem,
} from "./layout/types";
import type { ImportSettings } from "./settings";
import type {
  LaidOutPart,
  NoteLayout,
  ObsidianImportResult,
} from "./obsidian/types";

import type { WebImages } from "./webImages";

export interface LayoutOptions {
  family: FontFamilyName;
  fontSize: number;
  page: PageGeometry;
  /** About this many elements per part (drawing). */
  partElements: number;
  measure: PluginContext["text"]["measure"];
  signal: AbortSignal;
}

export interface LayoutBatch {
  items: PageItem[];
  /** Pages used so far in this part. */
  pageCount: number;
  /** 1-based part this batch belongs to; a new number starts a new drawing. */
  part: number;
}

/** Page margin in scene pixels (an A4 page is 794 wide). */
const PAGE_MARGIN = 56;

/** Streams the laid-out note: page 1 first, then the rest, in a worker when there is one. */
export async function* layoutNoteStream(
  doc: NoteDoc,
  opts: LayoutOptions,
): AsyncGenerator<LayoutBatch> {
  const fonts = {
    body: opts.family,
    heading: opts.family,
    code: CODE_FONT,
  };
  const layout: LayoutEngineOptions = {
    fonts,
    fontSize: opts.fontSize,
    page: {
      width: opts.page.width,
      height: opts.page.height,
      margin: PAGE_MARGIN,
    },
    partElements: opts.partElements,
  };
  const table = buildWidthTable(opts.measure, doc, layout);
  const queue: LayoutBatch[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  const waitForBatch = () => new Promise<void>((r) => (wake = r));
  const run = createLayoutClient()
    .layout({
      doc,
      table,
      opts: layout,
      signal: opts.signal,
      onEvent(ev) {
        if (ev.type === "page") {
          queue.push({
            items: ev.items,
            pageCount: ev.pageCount,
            part: ev.partIndex + 1,
          });
          poke();
        }
      },
    })
    .catch((err: unknown) => {
      failure = err;
    })
    .finally(() => {
      finished = true;
      poke();
    });
  while (true) {
    const next = queue.shift();
    if (next) {
      yield next;
    } else if (finished) {
      break;
    } else {
      await waitForBatch();
    }
  }
  await run;
  if (failure && !(failure instanceof LayoutAbortedError)) {
    throw failure;
  }
}

export interface ObsidianImportOptions {
  ctx: PluginContext;
  source: SourceFolder;
  target: TargetFolder;
  settings: ImportSettings;
  signal: AbortSignal;
  /** Called before each file: "Importing 12 of 340: Note". */
  onProgress(done: number, total: number, current: string): void;
  /** See `ObsidianImportOptions.nextTarget` in `obsidian/types.ts`. */
  nextTarget?: (attempt: number) => Promise<TargetFolder | null>;
  /** See `ObsidianImportOptions.web` in `obsidian/types.ts`. */
  /** Re-import: only these notes (source paths); nothing is copied and no report is written. */
  only?: ReadonlySet<string>;
  web?: WebImages;
}

/** Each note through the worker layout, collected per part (a drawing each). */
const workerLayout =
  (opts: ObsidianImportOptions): NoteLayout =>
  async (doc, signal) => {
    const { ctx, settings } = opts;
    const lo: LayoutOptions = {
      family: fontFamilyOf(settings),
      fontSize: settings.fontSize,
      page: ctx.pages.geometry({ size: settings.pageSize, layout: "separate" }),
      partElements: settings.partElements,
      measure: (f, s) => ctx.text.measure(f, s),
      signal,
    };
    const parts: LaidOutPart[] = [];
    for await (const batch of layoutNoteStream(doc, lo)) {
      const part = (parts[batch.part - 1] ??= { items: [], pageCount: 1 });
      part.items.push(...batch.items);
      part.pageCount = batch.pageCount;
    }
    return parts;
  };

export async function importObsidianVault(
  opts: ObsidianImportOptions,
): Promise<ObsidianImportResult> {
  await opts.ctx.fonts.ensure(layoutFamiliesOf(opts.settings));
  return importVault({ ...opts, layout: workerLayout(opts) });
}

export type { ObsidianImportResult } from "./obsidian/types";
