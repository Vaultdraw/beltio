/**
 * The seams to the other engineers' modules: the layout (src/layout, src/worker) and the
 * Obsidian vault import (src/obsidian). main.ts and commands.ts import only from here.
 *
 * STUB: until those land, `layoutNoteStream` stacks every block as one plain text on
 * pages and `importObsidianVault` refuses. Replace each body with a re-export of the real
 * function (the signatures below are the contract) when it is committed.
 */
import type {
  FontFamilyName,
  NoteBlock,
  NoteDoc,
  PageGeometry,
  PluginContext,
} from "@vaultdraw/api";

import type { PageItem, SourceFolder, TargetFolder } from "./api09";
import type { ImportSettings } from "./settings";

/** The worker bundle as a string, injected by build.mjs (empty until src/worker/entry.ts exists). */
declare const __MD_WORKER_SOURCE__: string;
export const WORKER_SOURCE: string =
  typeof __MD_WORKER_SOURCE__ === "string" ? __MD_WORKER_SOURCE__ : "";

export interface LayoutOptions {
  family: FontFamilyName;
  fontSize: number;
  page: PageGeometry;
  /** About this many elements per part (drawing). */
  partElements: number;
  measure: PluginContext["text"]["measure"];
  lineHeight: number;
  signal: AbortSignal;
}

export interface LayoutBatch {
  items: PageItem[];
  /** Pages used so far in this part. */
  pageCount: number;
  /** 1-based part this batch belongs to; a new number starts a new drawing. */
  part: number;
}

/** Streams the laid-out note: page 1 first, then batches. */
export async function* layoutNoteStream(
  doc: NoteDoc,
  opts: LayoutOptions,
): AsyncGenerator<LayoutBatch> {
  const margin = 48;
  let y = margin;
  const items: PageItem[] = [];
  const text = (b: NoteBlock): string =>
    "text" in b && typeof b.text === "string" ? b.text : "";
  for (const block of doc.blocks) {
    if (opts.signal.aborted) {
      return;
    }
    const t = text(block);
    if (!t) {
      continue;
    }
    const level = block.kind === "heading" ? block.level : 0;
    const fontSize = level ? opts.fontSize + (7 - level) * 2 : opts.fontSize;
    const height = Math.ceil(fontSize * opts.lineHeight);
    items.push({
      type: "text",
      page: 0,
      x: margin,
      y,
      width: opts.page.width - margin * 2,
      height,
      text: t,
      fontSize,
      fontFamily: opts.family,
      lineHeight: opts.lineHeight,
      ...(level ? { data: { heading: level } } : {}),
    });
    y += height + 12;
  }
  yield { items, pageCount: 1, part: 1 };
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
