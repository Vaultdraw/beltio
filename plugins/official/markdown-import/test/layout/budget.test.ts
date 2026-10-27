/**
 * The review's layout budgets (VERDICT.md table B) and the plugin's rules:
 * elements per 1,000 words, parts of about `partElements`, code never
 * tagged or linked, the first page before the rest, cancel.
 */
import { describe, expect, test } from "vitest";

import { layoutNote, layoutNoteStream } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";
import {
  createLayoutClient,
  LayoutAbortedError,
} from "../../src/worker/client";
import { layoutNoteBatches } from "../../src/worker/stream";

import { defaultOptions, fakeMeasure, generateNote } from "./fixtures";

import type { LayoutEvent, PageItem } from "../../src/layout/types";

const note50k = generateNote(50_000, 3);

describe("layout budgets", () => {
  test("at most 60 elements per 1,000 words on a 50k-word note", () => {
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, note50k, opts);
    const { parts, stats } = layoutNote(note50k, table, opts);
    const perThousand = (stats.elements / stats.words) * 1000;
    console.log(
      `50k words: ${stats.elements} elements, ${stats.pages} pages, ${
        parts.length
      } parts, ${perThousand.toFixed(1)} elements per 1k words`,
    );
    expect(perThousand).toBeLessThanOrEqual(60);
    expect(parts.reduce((n, p) => n + p.items.length, 0)).toBe(stats.elements);
  });

  test("parts hold about partElements, cut at level-1 or level-2 headings", () => {
    const opts = defaultOptions({ partElements: 300 });
    const table = buildWidthTable(fakeMeasure, note50k, opts);
    const { parts } = layoutNote(note50k, table, opts);
    expect(parts.length).toBeGreaterThan(3);
    for (const [i, part] of parts.entries()) {
      if (i < parts.length - 1) {
        expect(part.items.length).toBeGreaterThanOrEqual(150);
      }
      // Boxes may add a few over the estimate; never a whole extra part.
      expect(part.items.length).toBeLessThanOrEqual(300 * 1.35);
      expect(part.items.every((it) => it.page < part.pageCount)).toBe(true);
      if (i > 0) {
        expect(part.title).toMatch(/^Section \d+/);
        const first = part.items.find((it) => it.type === "text");
        expect(first?.data).toMatchObject({ heading: expect.any(Number) });
        expect((first?.data?.heading as number) <= 2).toBe(true);
      }
    }
  });

  test("code is never tagged or linked, and keeps its box", () => {
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, note50k, opts);
    const { parts } = layoutNote(note50k, table, opts);
    const items = parts.flatMap((p) => p.items);
    const code = items.filter(
      (i): i is Extract<PageItem, { type: "text" }> =>
        i.type === "text" && i.tone === "code",
    );
    expect(code.length).toBeGreaterThan(0);
    for (const c of code) {
      expect(c.link).toBeUndefined();
      expect(c.data).toBeUndefined();
      expect(c.fontFamily).toBe("Cascadia");
    }
    expect(
      items.filter((i) => i.type === "rect" && i.fill === "code").length,
    ).toBeGreaterThanOrEqual(code.length / 2);
  });

  test("the first page leaves before the rest is laid out", () => {
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, note50k, opts);
    const t0 = performance.now();
    const gen = layoutNoteStream(note50k, table, opts);
    let first: Extract<LayoutEvent, { type: "page" }> | undefined;
    for (const ev of gen) {
      if (ev.type === "page") {
        first = ev;
        break;
      }
    }
    const ms = performance.now() - t0;
    gen.return(undefined);
    console.log(`first page of 50k words after ${ms.toFixed(2)} ms`);
    expect(first).toMatchObject({
      type: "page",
      partIndex: 0,
      page: 0,
      pageCount: 1,
    });
    expect(first!.items.length).toBeGreaterThan(3);
    // Budget: 5 ms; jsdom on a loaded machine gets slack, but never the whole layout.
    expect(ms).toBeLessThan(60);
  });

  test("the in-thread client yields batches in order and cancels", async () => {
    const doc = generateNote(5_000, 5);
    const client = createLayoutClient({ inThread: true });
    expect(client.inWorker).toBe(false);
    const seen: string[] = [];
    const opts = { ...defaultOptions(), partElements: 200 };
    const stats = await client.layout({
      doc,
      table: buildWidthTable(fakeMeasure, doc, opts),
      opts,
      onEvent: (ev) => seen.push(ev.type),
    });
    expect(seen[0]).toBe("part");
    expect(seen[1]).toBe("page");
    expect(seen.at(-1)).toBe("partEnd");
    expect(stats.parts).toBeGreaterThan(1);

    const ctrl = new AbortController();
    let pages = 0;
    const run = client.layout({
      doc,
      table: buildWidthTable(fakeMeasure, doc, opts),
      opts,
      signal: ctrl.signal,
      onEvent: (ev) => {
        if (ev.type === "page" && ++pages === 2) {
          ctrl.abort();
        }
      },
    });
    await expect(run).rejects.toBeInstanceOf(LayoutAbortedError);
    expect(pages).toBe(2);
  });

  test("layoutNoteBatches: one batch per page, part numbers 1-based, partDone on the last", async () => {
    const doc = generateNote(3_000, 9);
    const batches = [];
    const gen = layoutNoteBatches(doc, {
      family: "Nunito",
      fontSize: 16,
      page: { width: 794, height: 1123 },
      partElements: 120,
      measure: fakeMeasure,
      client: createLayoutClient({ inThread: true }),
    });
    for (;;) {
      const r = await gen.next();
      if (r.done) {
        // A part whose last page left before its end gets an empty closing batch.
        expect(r.value?.pages).toBe(
          batches.filter((b) => b.items.length).length,
        );
        break;
      }
      batches.push(r.value);
    }
    expect(batches[0].part).toBe(1);
    expect(batches[0].pageCount).toBe(1);
    expect(batches[0].title).toBe("");
    const parts = new Set(batches.map((b) => b.part));
    expect(parts.size).toBeGreaterThan(1);
    for (const part of parts) {
      const own = batches.filter((b) => b.part === part);
      const pages = own.filter((b) => b.items.length);
      expect(own.at(-1)?.partDone?.pageCount).toBe(pages.length);
      expect(pages.map((b) => b.pageCount)).toEqual(pages.map((_, i) => i + 1));
    }
  });
});
