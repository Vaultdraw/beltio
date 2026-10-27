/**
 * Wrap parity: the editor's `wrapText` fed by the width table gives the
 * same lines as `wrapText` fed by a canvas-like measure of whole strings
 * (advances plus pair kerning), for every font role and width.
 */
import { describe, expect, test } from "vitest";

import {
  charWidth,
  setCustomTextMetricsProvider,
} from "../../../../../packages/element/src/textMeasurements";
import { getWrappedTextLines } from "../../../../../packages/element/src/textWrapping";
import { fontPlan } from "../../src/layout/fonts";
import { buildWidthTable, LineMeasurer } from "../../src/layout/widthTable";
import { Wrapper } from "../../src/layout/wrap";

import {
  defaultOptions,
  fakeLineWidth,
  fakeMeasure,
  generateNote,
} from "./fixtures";

import type { FontString } from "../../../../../packages/element/src/types";
import type { NoteDoc } from "@vaultdraw/api";

const CORPUS = [
  "A short line.",
  "The vault keeps every drawing in a folder you own, offline first and fast on the worst laptop; keyboard everywhere.",
  "Hyphenated-words-break-after-the-hyphen and averyveryverylongwordthatdoesnotfitononelineatallandmustbesplitbycharacter",
  "Tabs\tand   multiple   spaces   stay   as   written",
  "Hard\nbreaks\nkeep their lines, even  when   one line is long enough to wrap around the available width twice over",
  "Unicode: café naïve Ünïcödé — dashes… and quotes “like these” ‘too’",
  "日本語のテキストは文字ごとに折り返されます。Hello 「世界。」",
  "Emoji 🌍 and 👨‍👩‍👧‍👦 sequences 🇨🇿 stay whole",
  "AVAVAV To Ty ry rv Wa We kerned pairs AV AV AV AV AV AV AV AV AV AV",
  "[[Wiki link|alias]] and #tag/x and `code` inline [1] footnote",
];

const doc: NoteDoc = {
  schemaVersion: 1,
  blocks: CORPUS.flatMap((text) => [
    { kind: "paragraph", text, range: [0, 0] },
    { kind: "heading", level: 1, text, range: [0, 0] },
    { kind: "heading", level: 3, text, range: [0, 0] },
    { kind: "code", code: true, text, range: [0, 0] },
  ]),
  links: [],
  tags: [],
  stats: {
    words: 0,
    blocks: CORPUS.length,
    droppedEmphasis: 0,
    droppedHtml: 0,
  },
};

/** `wrapText` with the canvas-like measure, as the editor would run it. */
const referenceLines = (
  text: string,
  font: FontString,
  size: number,
  width: number,
) => {
  setCustomTextMetricsProvider({
    getLineWidth: (t) => fakeLineWidth(t, size),
  });
  charWidth.clearCache(font);
  return getWrappedTextLines(text, font, width).map((l) => l.text);
};

describe("wrap parity", () => {
  const opts = defaultOptions();
  const roles = fontPlan(opts.fonts, opts.fontSize);

  test("table widths equal the canvas-like widths", () => {
    const table = buildWidthTable(fakeMeasure, doc, opts);
    const body = table.fonts.find((f) => f.size === roles.body.size)!;
    expect(body.pairs.length).toBeGreaterThan(0);
    const m = new LineMeasurer(body);
    for (const text of CORPUS) {
      for (const line of text.split("\n")) {
        expect(m.width(line)).toBeCloseTo(
          fakeLineWidth(line, roles.body.size),
          6,
        );
      }
    }
  });

  test.each([60, 120, 200, 350, 698])(
    "same line breaks at width %i",
    (width) => {
      const table = buildWidthTable(fakeMeasure, doc, opts);
      for (const roleName of ["body", "h1", "h3", "code"] as const) {
        const role = roles[roleName];
        const expected = CORPUS.map((text) =>
          referenceLines(
            text,
            `${role.size}px ${role.family}` as FontString,
            role.size,
            width,
          ),
        );
        // A fresh wrapper installs the table provider again.
        const wrapper = new Wrapper(table);
        const actual = CORPUS.map((text) => wrapper.lines(text, role, width));
        expect(actual).toEqual(expected);
      }
    },
  );

  test("a generated note wraps identically", () => {
    const note = generateNote(3000, 7);
    const table = buildWidthTable(fakeMeasure, note, opts);
    const role = roles.body;
    const font = `${role.size}px ${role.family}` as FontString;
    const texts = note.blocks.flatMap((b) => ("text" in b ? [b.text] : []));
    const expected = texts.map((t) => referenceLines(t, font, role.size, 400));
    const wrapper = new Wrapper(table);
    expect(texts.map((t) => wrapper.lines(t, role, 400))).toEqual(expected);
  });

  test("unseen characters get the fallback width, never NaN", () => {
    const table = buildWidthTable(fakeMeasure, doc, opts);
    const m = new LineMeasurer(table.fonts[0]);
    expect(Number.isFinite(m.width("ⴰⴱⴲ unmeasured 𝔘𝔫𝔦"))).toBe(true);
    expect(m.width("ⴰ")).toBe(table.fonts[0].fallback);
  });
});
