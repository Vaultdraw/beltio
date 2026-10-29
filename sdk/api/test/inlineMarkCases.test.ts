/**
 * Family: bold, italic and code spans read the same in the Rust parser and in the browser
 * stand-in, in paragraphs, headings and table cells. One table, read by both suites
 * (`vaultdraw-core/src/markdown/inline_mark_cases.json`; list items are Rust-only).
 */
import { describe, expect, test } from "vitest";

import table from "../../../excalidraw-desktop/src-tauri/crates/vaultdraw-core/src/markdown/inline_mark_cases.json";
import { fakeParseMarkdown } from "../shared/markdown";

import type { NoteMark } from "@vaultdraw/api";

type Mark = [string, number, number];
const asTriples = (marks: readonly NoteMark[] | undefined): Mark[] =>
  (marks ?? []).map((m) => [m.kind, m.start, m.end]);

describe("inline marks (shared table with the Rust parser)", () => {
  const blocks = table.blocks.filter((c) => !("rustOnly" in c));
  test.each(blocks)("$name", (c) => {
    const [block] = fakeParseMarkdown(c.input).blocks as unknown as {
      kind: string;
      text: string;
      marks?: NoteMark[];
    }[];
    expect(block.kind).toBe(c.kind);
    expect(block.text).toBe(c.text);
    expect(asTriples(block.marks)).toEqual(c.marks);
  });

  test.each(table.cells)("cell: $name", (c) => {
    const [block] = fakeParseMarkdown(c.input).blocks as unknown as {
      header: string[];
      rows: string[][];
      headerMarks?: NoteMark[][];
      rowMarks?: NoteMark[][][];
    }[];
    const head = block.header.map((t, i) => [
      t,
      asTriples(block.headerMarks?.[i]),
    ]);
    const rows = block.rows.map((r, ri) =>
      r.map((t, ci) => [t, asTriples(block.rowMarks?.[ri]?.[ci])]),
    );
    expect(head).toEqual(c.header);
    expect(rows).toEqual(c.rows);
  });

  test("no marks: the fields are absent", () => {
    const doc = fakeParseMarkdown("plain\n\n| a |\n|---|\n| b |");
    for (const b of doc.blocks as unknown as Record<string, unknown>[]) {
      expect(b).not.toHaveProperty("marks");
      expect(b).not.toHaveProperty("headerMarks");
      expect(b).not.toHaveProperty("rowMarks");
    }
  });
});
