/**
 * The seams to the other engineers' modules: the layout (src/layout, src/worker) and the
 * Obsidian vault import (src/obsidian). main.ts and commands.ts import only from here.
 *
 * `importObsidianVault` is a STUB until src/obsidian lands: it refuses. Replace its body
 * with a re-export of the real function (the signature below is the contract).
 */

import { buildWidthTable } from "./layout/index";
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
    code: "Cascadia" as FontFamilyName,
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
  /** Called as notes are converted. */
  onProgress(done: number, total: number, current: string): void;
}

export interface ObsidianImportResult {
  notes: number;
  drawings: number;
  attachments: number;
  skipped: number;
  /** The first note's path in the target, to open. */
  first?: string;
}

export async function importObsidianVault(
  _opts: ObsidianImportOptions,
): Promise<ObsidianImportResult> {
  throw new Error("The Obsidian vault import is not in this build yet");
}
