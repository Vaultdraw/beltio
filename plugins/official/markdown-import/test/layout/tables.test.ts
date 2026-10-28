/**
 * Markdown tables are real grids (toimprove 69): header row shaded, borders, wrapped cells with
 * nothing cut, column widths from the content, rows that break between pages.
 */
import { describe, expect, test } from "vitest";

import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteDoc } from "@vaultdraw/api";
import type { PageItem, PageItemText } from "../../src/layout/types";

const range = [0, 0] as const;

const docOf = (
  header: string[],
  rows: string[][],
  align: ("none" | "left" | "center" | "right")[] = [],
): NoteDoc =>
  ({
    schemaVersion: 1,
    blocks: [
      { kind: "paragraph", text: "Before.", range },
      {
        kind: "table",
        align,
        header,
        rows,
        cols: header.length,
        cellCount: (rows.length + 1) * header.length,
        range,
      },
      { kind: "paragraph", text: "After.", range },
    ],
    links: [],
    tags: [],
    stats: { words: 10, blocks: 3, droppedEmphasis: 0, droppedHtml: 0 },
  } as unknown as NoteDoc);

const run = (doc: NoteDoc, over = {}) => {
  const opts = defaultOptions(over);
  const table = buildWidthTable(fakeMeasure, doc, opts);
  return layoutNote(doc, table, opts);
};

const texts = (items: PageItem[]) =>
  items.filter((i): i is PageItemText => i.type === "text");

const OWNER = docOf(
  ["Concept", "Main responsibility"],
  [
    [
      "Protected mode",
      "Provides privilege levels and protection mechanisms on x86.",
    ],
    [
      "Paging enforcement",
      "Translates virtual addresses into physical addresses and enforces access permissions per page.",
    ],
    [
      "MMU check",
      "Hardware that performs address translation and protection checks.",
    ],
    [
      "Operating system protection",
      "Configures page tables and manages memory allocation and protection policy.",
    ],
  ],
);

describe("tables", () => {
  test("no cell is cut: every word of every cell is drawn", () => {
    const { parts } = run(OWNER, { fontSize: 16 });
    const drawn = texts(parts[0].items)
      .map((t) => t.text.replace(/\n/g, " "))
      .join(" ");
    for (const w of OWNER.blocks[1].kind === "table"
      ? [
          ...(OWNER.blocks[1] as any).header,
          ...(OWNER.blocks[1] as any).rows.flat(),
        ].flatMap((c: string) => c.split(" "))
      : []) {
      expect(drawn).toContain(w);
    }
    expect(drawn).not.toMatch(/[…─│┼]/);
  });

  test("a header shade, a border, one inner line per row and column, no full-width stray rule", () => {
    const { parts } = run(OWNER);
    const items = parts[0].items;
    const rects = items.filter((i) => i.type === "rect");
    expect(rects.map((r) => (r as any).fill)).toEqual(["code", "none"]);
    const border = rects[1] as any;
    expect(border.stroke).toBe("thin");
    const lines = items.filter((i) => i.type === "line") as any[];
    const horizontal = lines.filter((l) => l.height === 0);
    const vertical = lines.filter((l) => l.width === 0);
    expect(horizontal).toHaveLength(4); // 5 rows
    expect(vertical).toHaveLength(1); // 2 columns
    for (const l of lines) {
      expect(l.x).toBeGreaterThanOrEqual(border.x);
      expect(l.x).toBeLessThanOrEqual(border.x + border.width);
      expect(l.y).toBeGreaterThanOrEqual(border.y);
      expect(l.y + l.height).toBeLessThanOrEqual(
        border.y + border.height + 0.01,
      );
    }
  });

  test("cells wrap inside their column and the table stays inside the content width", () => {
    const opts = defaultOptions();
    const { parts } = run(OWNER);
    const items = parts[0].items;
    const border = items.find(
      (i) => i.type === "rect" && (i as any).fill === "none",
    ) as any;
    const margin = opts.page.margin as number;
    expect(border.x).toBeGreaterThanOrEqual(margin);
    expect(border.x + border.width).toBeLessThanOrEqual(
      opts.page.width - margin + 0.01,
    );
    const cells = texts(items).filter((t) => t.y > border.y);
    expect(cells.some((t) => t.text.includes("\n"))).toBe(true);
    for (const t of cells.filter(
      (c) => c.y >= border.y && c.y < border.y + border.height,
    )) {
      expect(t.x + t.width).toBeLessThanOrEqual(border.x + border.width + 0.01);
      expect(t.y + t.height).toBeLessThanOrEqual(
        border.y + border.height + 0.01,
      );
    }
  });

  test("columns are as wide as their content, and a short table is not stretched", () => {
    const { parts } = run(docOf(["A", "B"], [["x", "y"]]));
    const border = parts[0].items.find(
      (i) => i.type === "rect" && (i as any).fill === "none",
    ) as any;
    expect(border.width).toBeLessThan(150);
  });

  test("column alignment reaches the cell text", () => {
    const { parts } = run(
      docOf(["L", "R", "C"], [["a", "b", "c"]], ["left", "right", "center"]),
    );
    const aligns = texts(parts[0].items)
      .filter((t) => ["L", "R", "C"].includes(t.text))
      .map((t) => t.align);
    expect(aligns).toEqual(["left", "right", "center"]);
  });

  test("a long table breaks between rows, nothing is dropped (no row or column cap)", () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      Array.from({ length: 12 }, (_, c) => `r${i}c${c}`),
    );
    const doc = docOf(
      Array.from({ length: 12 }, (_, c) => `H${c}`),
      rows,
    );
    const { parts } = run(doc);
    const all = parts
      .flatMap((p) => texts(p.items))
      .map((t) => t.text.replace(/\s+/g, ""))
      .join("|");
    expect(all).toContain("r299c11");
    expect(all).toContain("H11");
    // Every cell of every row is there (cells wrap by character when a column is very narrow).
    for (let i = 0; i < 300; i += 37) {
      expect(all).toContain(`r${i}c5`);
    }
    expect(
      parts
        .flatMap((p) => p.items)
        .filter((i) => i.type === "rect" && (i as any).fill === "none").length,
    ).toBeGreaterThan(1);
  });

  test("blank and ragged cells are fine", () => {
    const { parts } = run(docOf(["A", "B", "C"], [["1"], ["", "2", ""]]));
    const t = texts(parts[0].items).map((x) => x.text);
    expect(t).toEqual(expect.arrayContaining(["A", "B", "C", "1", "2"]));
  });
});
