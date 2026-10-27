/**
 * The streaming paginator places entries on the same pages as the SDK's
 * batch `flowPages`, whatever the order entries arrive in, and assembles
 * boxes, texts, images and rules into page items.
 */
import { describe, expect, test } from "vitest";

import { flowPages } from "../../../../../sdk/api/shared/pages";
import { fontPlan } from "../../src/layout/fonts";
import { Paginator } from "../../src/layout/paginate";

import type { FlowItem } from "@vaultdraw/api";
import type { Container, Entry, TextBlock } from "../../src/layout/paginate";

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const roles = fontPlan(
  { body: "Nunito", heading: "Nunito", code: "Cascadia" },
  16,
);
const block: TextBlock = { role: roles.body, x: 0, width: 500 };

const entry = (
  height: number,
  spaceBefore: number,
  keepWithNext: boolean,
  text = "x",
): Entry => ({
  height,
  offset: 0,
  spaceBefore,
  keepWithNext,
  container: null,
  payload: { kind: "line", block, text },
});

/** Page of each entry, from the pages the paginator hands back. */
const pagesOf = (
  entries: Entry[],
  capacity: number,
  chunk: number,
): number[] => {
  const p = new Paginator(capacity, { top: 0, left: 0 });
  const out: number[] = [];
  const texts = new Map<string, number>();
  let i = 0;
  const take = (pages: ReturnType<Paginator["flush"]>) => {
    for (const page of pages) {
      for (const item of page.items) {
        if (item.type === "text") {
          for (const line of item.text.split("\n")) {
            texts.set(line, page.page);
          }
        }
      }
    }
  };
  while (i < entries.length) {
    for (let k = 0; k < chunk && i < entries.length; k++, i++) {
      p.push(entries[i]);
    }
    take(p.flush(false));
  }
  take(p.flush(true));
  for (const e of entries) {
    out.push(texts.get((e.payload as { text: string }).text)!);
  }
  return out;
};

describe("Paginator", () => {
  test.each([1, 2, 3, 5, 8, 13])("matches flowPages, seed %i", (seed) => {
    const next = rng(seed);
    const n = 300;
    const capacity = 200;
    const items: FlowItem[] = [];
    const entries: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const height = next() < 0.1 ? 150 + next() * 120 : 10 + next() * 30;
      const spaceBefore = next() < 0.3 ? next() * 20 : 0;
      const keepWithNext = next() < 0.35;
      items.push({ height, spaceBefore, keepWithNext });
      entries.push(entry(height, spaceBefore, keepWithNext, `e${i}`));
    }
    const expected = flowPages(items, { contentHeight: capacity }).map(
      (p) => p.page,
    );
    for (const chunk of [1, 7, 1000]) {
      expect(pagesOf(entries, capacity, chunk)).toEqual(expected);
    }
  });

  test("a chain at the end of the input resolves on the final flush", () => {
    const entries = [
      entry(50, 0, false, "a"),
      entry(50, 0, true, "b"),
      entry(50, 0, true, "c"),
    ];
    const expected = flowPages(
      entries.map((e) => ({ height: e.height, keepWithNext: e.keepWithNext })),
      { contentHeight: 120 },
    ).map((p) => p.page);
    expect(pagesOf(entries, 120, 1)).toEqual(expected);
    expect(expected).toEqual([0, 1, 1]);
  });

  test("assembles boxes behind texts, merges a block's lines, places images and rules", () => {
    const p = new Paginator(1000, { top: 40, left: 30 });
    const box: Container = {
      fill: "code",
      parent: null,
      x: 0,
      width: 500,
      closed: false,
    };
    p.push(entry(20, 0, false, "line one"));
    const codeBlock: TextBlock = { role: roles.body, x: 0, width: 480 };
    const codeLine = (text: string): Entry => ({
      ...entry(30, 0, false, text),
      payload: { kind: "line", block: codeBlock, text },
    });
    p.push({
      ...codeLine("code a"),
      spaceBefore: 10,
      keepWithNext: true,
      offset: 10,
      container: box,
    });
    p.push({ ...codeLine("code b"), container: box });
    p.push({
      height: 100,
      offset: 0,
      spaceBefore: 5,
      keepWithNext: false,
      container: null,
      payload: {
        kind: "image",
        x: 0,
        width: 200,
        target: "pic.png",
        mimeType: "image/png",
        alt: "A pic",
      },
    });
    p.push({
      height: 20,
      offset: 0,
      spaceBefore: 0,
      keepWithNext: false,
      container: null,
      payload: { kind: "rule", x: 0, width: 500 },
    });
    const [page] = p.flush(true);
    expect(page.items.map((i) => i.type)).toEqual([
      "rect",
      "text",
      "text",
      "image",
      "line",
    ]);
    const [rect, first, code, image, rule] = page.items;
    expect(rect).toMatchObject({
      fill: "code",
      x: 30,
      y: 40 + 30,
      height: 60,
      width: 500,
    });
    expect(first).toMatchObject({
      y: 40,
      text: "line one",
      height: roles.body.linePx,
    });
    expect(code).toMatchObject({
      y: 40 + 30 + 10,
      text: "code a\ncode b",
      height: 2 * roles.body.linePx,
    });
    expect(image).toMatchObject({
      y: 40 + 95,
      height: 100,
      alt: "A pic",
      target: "pic.png",
    });
    expect(rule).toMatchObject({ y: 40 + 195 + 10, height: 0, width: 500 });
  });
});
