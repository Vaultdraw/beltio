/**
 * Every shape of Markdown table imports as a real table (toimprove 109): one data-driven sweep.
 * Each row is a table; each is checked for what the user sees: every word drawn (no "…"), every
 * cell's text inside its own cell, rows tall enough for their lines, the table inside the text
 * width, the Markdown alignment, and one group per table part so it moves as one.
 * The cell text itself comes from the parser: the shared case table with the Rust parser is
 * checked at the end (vaultdraw-core/src/markdown/table_cell_cases.json).
 */
import { describe, expect, test } from "vitest";

import cases from "../../../../../excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/markdown/table_cell_cases.json";
import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteDoc } from "@vaultdraw/api";
import type {
  PageItem,
  PageItemLine,
  PageItemRect,
  PageItemText,
} from "../../src/layout/types";

type Align = "none" | "left" | "center" | "right";
interface Shape {
  name: string;
  header: string[];
  rows: string[][];
  align?: Align[];
}

const range = [0, 0] as const;

const docOf = ({ header, rows, align = [] }: Shape): NoteDoc =>
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

const LONG_WORD = `https://example.org/${"averyveryverylongpathsegment".repeat(
  6,
)}`;
const SENTENCE =
  "Program that creates VMs, gives them fake hardware and handles what they trap on. On Linux: KVM (a module in the host kernel) plus QEMU (a normal program that provides fake devices).";

const SHAPES: Shape[] = [
  {
    name: "the owner's Key terms (narrow first column, long second)",
    header: ["Term", "Meaning"],
    rows: [
      ["Hypervisor", SENTENCE],
      ["VMX non-root mode", "Where the guest runs. The CPU watches it."],
      ["Host", "The real machine and its kernel."],
    ],
  },
  {
    name: "wide: four long columns",
    header: ["One", "Two", "Three", "Four"],
    rows: [[SENTENCE, SENTENCE, SENTENCE, SENTENCE]],
  },
  {
    name: "narrow: one letter per cell",
    header: ["A", "B"],
    rows: [["x", "y"]],
  },
  {
    name: "a word longer than the page",
    header: ["Link", "Note"],
    rows: [[LONG_WORD, "breaks by character, nothing cut"]],
  },
  {
    name: "empty and ragged cells",
    header: ["A", "", "C"],
    rows: [["", "only middle", ""], ["1"], []],
  },
  {
    name: "alignment from the Markdown",
    header: ["Left", "Center", "Right", "Default"],
    rows: [["a", "b", "1,024", "d"]],
    align: ["left", "center", "right", "none"],
  },
  {
    name: "pipes inside cells (escaped and in code)",
    header: ["Expr", "Means"],
    rows: [
      ["x | y", "x or y"],
      ["a || b", "logical or"],
    ],
  },
  {
    name: "one column",
    header: ["Only"],
    rows: [[SENTENCE], ["short"]],
  },
  {
    name: "thirty columns",
    header: Array.from({ length: 30 }, (_, c) => `Column ${c + 1}`),
    rows: Array.from({ length: 3 }, (_, r) =>
      Array.from({ length: 30 }, (_, c) => `r${r}c${c} value`),
    ),
  },
  {
    name: "two hundred rows",
    header: ["#", "Text"],
    rows: Array.from({ length: 200 }, (_, r) => [String(r), `row ${r} text`]),
  },
];

const squash = (s: string) => s.replace(/\s+/g, "");

const tableParts = (items: PageItem[]) => {
  const byGroup = new Map<string, PageItem[]>();
  for (const it of items) {
    if (it.group) {
      byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
    }
  }
  return [...byGroup.values()];
};

describe("every table shape imports as a real table", () => {
  test.each(SHAPES)("$name", (shape) => {
    const opts = defaultOptions();
    const doc = docOf(shape);
    const { parts } = layoutNote(
      doc,
      buildWidthTable(fakeMeasure, doc, opts),
      opts,
    );
    const margin = opts.page.margin as number;
    const items = parts.flatMap((p) => p.items);
    const groups = tableParts(items);
    expect(groups.length).toBeGreaterThan(0);

    // Every word of every cell is drawn, nothing cut.
    const drawn = squash(
      groups
        .flat()
        .filter((i): i is PageItemText => i.type === "text")
        .map((t) => t.text)
        .join(""),
    );
    expect(drawn).not.toMatch(/[…│─┼]/);
    expect(drawn).toBe(squash([shape.header, ...shape.rows].flat().join("")));

    for (const g of groups) {
      // One page per group, and the paragraphs around are not in it.
      expect(new Set(g.map((i) => i.page)).size).toBe(1);
      const border = g.find(
        (i): i is PageItemRect => i.type === "rect" && i.fill === "none",
      )!;
      expect(border.stroke).toBe("thin");
      expect(border.x).toBeGreaterThanOrEqual(margin - 0.01);
      expect(border.x + border.width).toBeLessThanOrEqual(
        opts.page.width - margin + 0.01,
      );
      const xs = [
        border.x,
        ...g
          .filter((i): i is PageItemLine => i.type === "line" && i.width === 0)
          .map((l) => l.x),
        border.x + border.width,
      ].sort((a, b) => a - b);
      const ys = [
        border.y,
        ...g
          .filter((i): i is PageItemLine => i.type === "line" && i.height === 0)
          .map((l) => l.y),
        border.y + border.height,
      ].sort((a, b) => a - b);
      for (const t of g.filter((i): i is PageItemText => i.type === "text")) {
        // Inside its own cell: between two neighbouring grid lines, both ways.
        const c = xs.findIndex((x, k) => x <= t.x && t.x < xs[k + 1]);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(xs[c + 1] + 0.01);
        const r = ys.findIndex((y, k) => y <= t.y && t.y < ys[k + 1]);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(t.y + t.height).toBeLessThanOrEqual(ys[r + 1] + 0.01);
      }
    }

    if (shape.align) {
      const want: Record<Align, string> = {
        left: "left",
        center: "center",
        right: "right",
        none: "left",
      };
      const texts = groups
        .flat()
        .filter((i): i is PageItemText => i.type === "text");
      shape.rows[0].forEach((cell, c) => {
        expect(texts.find((t) => t.text === cell)?.align).toBe(
          want[shape.align![c]],
        );
      });
    }
  });

  test("the paragraphs around a table are not in its group", () => {
    const opts = defaultOptions();
    const doc = docOf(SHAPES[0]);
    const { parts } = layoutNote(
      doc,
      buildWidthTable(fakeMeasure, doc, opts),
      opts,
    );
    const outside = parts[0].items.filter(
      (i) => i.type === "text" && ["Before.", "After."].includes(i.text),
    );
    expect(outside).toHaveLength(2);
    expect(outside.every((i) => i.group === undefined)).toBe(true);
  });

  test("a table split over pages is one group per page", () => {
    const opts = defaultOptions();
    const doc = docOf(SHAPES[SHAPES.length - 1]);
    const { parts } = layoutNote(
      doc,
      buildWidthTable(fakeMeasure, doc, opts),
      opts,
    );
    const groups = tableParts(parts.flatMap((p) => p.items));
    const pages = new Set(parts.flatMap((p) => p.items).map((i) => i.page));
    expect(groups.length).toBe(pages.size);
    expect(groups.length).toBeGreaterThan(1);
  });
});

type CellCase = [markdown: string, header: string[], rows: string[][]];

describe("table cell text (shared table with the Rust parser)", () => {
  test.each(cases as CellCase[])("%j", (md, header, rows) => {
    const table = fakeParseMarkdown(md).blocks.find((b) => b.kind === "table");
    expect(table && { header: table.header, rows: table.rows }).toEqual({
      header,
      rows,
    });
  });
});
