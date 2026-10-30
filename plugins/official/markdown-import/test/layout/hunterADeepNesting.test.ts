/**
 * Hunter A round 3: a note nested very deep (quotes inside quotes, lists inside lists) still lays
 * out: no throw, no hang, every word still drawn, nothing placed outside the page width. The
 * parser caps nothing (see the ignored Rust test hostile_notes_parse_without_crashing), so the
 * layout meets whatever depth a note has.
 */
import { describe, expect, test } from "vitest";

import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteBlock, NoteDoc } from "@vaultdraw/api";
import type { PageItem, PageItemText } from "../../src/layout/types";

const para = (text: string): NoteBlock =>
  ({ kind: "paragraph", range: [0, 0], text } as unknown as NoteBlock);
const quote = (blocks: NoteBlock[]): NoteBlock =>
  ({ kind: "blockquote", range: [0, 0], blocks } as unknown as NoteBlock);
const item = (depth: number, text: string): NoteBlock =>
  ({
    kind: "listItem",
    range: [0, 0],
    ordered: false,
    marker: "-",
    depth,
    task: "none",
    text,
  } as unknown as NoteBlock);

const nestedQuote = (depth: number): NoteBlock[] => {
  let inner: NoteBlock[] = [para("deepest words stay readable")];
  for (let i = 0; i < depth; i++) {
    inner = [quote(inner)];
  }
  return inner;
};
const nestedList = (depth: number): NoteBlock[] =>
  Array.from({ length: depth }, (_, i) => item(i, `item level ${i}`));

const docOf = (blocks: NoteBlock[]): NoteDoc =>
  ({
    schemaVersion: 1,
    blocks,
    links: [],
    tags: [],
    stats: { words: 0, blocks: 0, droppedEmphasis: 0, droppedHtml: 0 },
  } as unknown as NoteDoc);

const CASES: [string, (d: number) => NoteBlock[]][] = [
  ["quotes in quotes", nestedQuote],
  ["lists in lists", nestedList],
];

describe.each(CASES)("deep nesting: %s", (_name, make) => {
  test.each([50, 200, 1000])("depth %i lays out inside the page", (depth) => {
    const doc = docOf(make(depth));
    const opts = defaultOptions();
    const started = Date.now();
    const result = layoutNote(
      doc,
      buildWidthTable(fakeMeasure, doc, opts),
      opts,
    );
    expect(Date.now() - started, "layout time (ms)").toBeLessThan(15_000);
    const items: PageItem[] = result.parts.flatMap((p) => p.items);
    const texts = items.filter((i): i is PageItemText => i.type === "text");
    const drawn = texts.map((t) => t.text).join(" ");
    expect(drawn).toContain(
      make === nestedQuote ? "readable" : `level ${depth - 1}`,
    );
    const pageRight = opts.page.width ?? 794;
    const outside = texts.filter(
      (t) => t.x + t.width > pageRight + 1 || t.x < -1,
    );
    expect(
      outside
        .map((t) => `${t.text} x=${Math.round(t.x)} w=${Math.round(t.width)}`)
        .slice(0, 3),
      "text outside the page",
    ).toEqual([]);
  });
});
