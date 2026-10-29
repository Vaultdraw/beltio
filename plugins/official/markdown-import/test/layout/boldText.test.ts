/**
 * Whole-bold text (bold-inline step 3): a paragraph, list or table cell that is bold from its
 * first to its last word is laid out and measured in the bold variant of the font; bold words
 * inside a sentence stay regular (no mixed runs); `bold_text` off turns it off. The parser's
 * spans come from the shared table (sdk/api/test/inlineMarkCases.test.ts).
 */
import { describe, expect, it } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { wholeBold } from "../../src/layout/marks";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteBlock, TextFont } from "@vaultdraw/api";
import type { LayoutOptions, PageItem } from "../../src/layout/types";

const R: [number, number] = [0, 0];
const para = (text: string, marks: unknown[]) =>
  ({ range: R, kind: "paragraph", text, marks } as unknown as NoteBlock);

const run = (
  blocks: NoteBlock[] | string,
  over: Partial<LayoutOptions> = {},
  seen: TextFont[] = [],
) => {
  const base = fakeParseMarkdown(typeof blocks === "string" ? blocks : "x");
  const doc =
    typeof blocks === "string"
      ? base
      : { ...base, blocks, stats: { ...base.stats, blocks: blocks.length } };
  const opts = defaultOptions(over);
  const measure = (f: TextFont, s: readonly string[]) => {
    seen.push(f);
    return fakeMeasure(f, s).map((w) => (f.bold ? w * 1.1 : w));
  };
  const table = buildWidthTable(measure, doc, opts);
  return layoutNote(doc, table, opts)
    .parts.flatMap((p) => p.items)
    .filter((i): i is Extract<PageItem, { type: "text" }> => i.type === "text");
};

describe("wholeBold", () => {
  it.each([
    ["All of it", [["bold", 0, 9]], true],
    [
      "one and two",
      [
        ["bold", 0, 3],
        ["bold", 8, 11],
      ],
      false,
    ],
    [
      "one two",
      [
        ["bold", 0, 3],
        ["bold", 4, 7],
      ],
      true,
    ],
    ["a b c", [["bold", 2, 3]], false],
    ["all", [["italic", 0, 3]], false],
    ["", [["bold", 0, 0]], false],
    [
      "bold  \n  words",
      [
        ["bold", 0, 4],
        ["bold", 9, 14],
      ],
      true,
    ],
  ] as const)("%j", (text, marks, want) => {
    const m = marks.map(([kind, start, end]) => ({ kind, start, end }));
    expect(wholeBold(text, m as never)).toBe(want);
  });
});

describe("bold paragraphs", () => {
  const blocks = [
    para("All of it", [{ kind: "bold", start: 0, end: 9 }]),
    para("some bold words", [{ kind: "bold", start: 5, end: 9 }]),
    para("plain words", []),
  ];

  it("only the all-bold paragraph is a bold item", () => {
    const items = run(blocks);
    const by = Object.fromEntries(items.map((i) => [i.text, i.bold === true]));
    expect(by).toEqual({
      "All of it": true,
      "some bold words": false,
      "plain words": false,
    });
  });

  it("measures the body font in bold only when the note has a bold paragraph", () => {
    const seen: TextFont[] = [];
    run(blocks, {}, seen);
    expect(seen.some((f) => f.bold && f.size === 16)).toBe(true);
    const none: TextFont[] = [];
    run([para("plain", [])], {}, none);
    expect(none.some((f) => f.bold && f.size === 16)).toBe(false);
  });

  it("bold_text off: nothing is bold", () => {
    const seen: TextFont[] = [];
    const items = run(blocks, { boldText: false }, seen);
    expect(items.some((i) => i.bold)).toBe(false);
    expect(seen.some((f) => f.bold && f.size === 16)).toBe(false);
  });

  it("a whole-bold link keeps its link tone and is not bold", () => {
    const text = "Site";
    const block = {
      range: R,
      kind: "paragraph",
      text,
      inline: [{ kind: "link", start: 0, end: 4, target: "https://e.org" }],
      marks: [{ kind: "bold", start: 0, end: 4 }],
    } as unknown as NoteBlock;
    const [item] = run([block]);
    expect(item.tone).toBe("link");
    expect(item.bold).toBeUndefined();
  });
});

describe("bold list items and table cells", () => {
  const item = (text: string, bold: boolean) =>
    ({
      range: R,
      kind: "listItem",
      ordered: false,
      marker: "-",
      depth: 0,
      task: "none",
      text,
      marks: bold ? [{ kind: "bold", start: 0, end: text.length }] : [],
    } as unknown as NoteBlock);

  it("a run of items is bold when every item is", () => {
    const all = run([item("one", true), item("two", true)]);
    expect(all[0].bold).toBe(true);
    const mixed = run([item("one", true), item("two", false)]);
    expect(mixed[0].bold).toBeUndefined();
  });

  it("a table cell that is all bold is a bold item; the others are not", () => {
    const table = {
      range: R,
      kind: "table",
      align: ["none", "none"],
      header: ["Term", "Meaning"],
      rows: [["KVM", "a module"]],
      cols: 2,
      cellCount: 4,
      headerMarks: [[{ kind: "bold", start: 0, end: 4 }], []],
      rowMarks: [[[{ kind: "bold", start: 0, end: 3 }], []]],
    } as unknown as NoteBlock;
    const items = run([table]);
    const by = Object.fromEntries(items.map((i) => [i.text, i.bold === true]));
    expect(by).toEqual({
      Term: true,
      Meaning: false,
      KVM: true,
      "a module": false,
    });
  });

  it("from Markdown through the stand-in parser: **Bold** paragraph, a bold table header", () => {
    const items = run(
      "**All bold**\n\nsome **bold** here\n\n| **H** | x |\n|---|---|\n| a | b |",
    );
    const by = Object.fromEntries(items.map((i) => [i.text, i.bold === true]));
    expect(by["All bold"]).toBe(true);
    expect(by["some bold here"]).toBe(false);
    expect(by.H).toBe(true);
    expect(by.x).toBe(false);
  });
});
