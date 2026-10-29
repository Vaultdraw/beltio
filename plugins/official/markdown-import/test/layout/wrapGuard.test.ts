/**
 * The wrap guard (toimprove #111, #113): no text line is wider than its text
 * element, whatever the font, size, column, quote or code box; a wider line
 * is clipped by the editor.
 */
import { describe, expect, it } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";
import { Wrapper } from "../../src/layout/wrap";
import { fontPlan } from "../../src/layout/fonts";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteBlock, NoteDoc } from "@vaultdraw/api";
import type { LayoutOptions } from "../../src/layout/types";

/** A note from Markdown (headings, paragraphs, lists) or from parser blocks. */
const docOf = (md: string | NoteBlock[]): NoteDoc => {
  if (typeof md === "string") {
    return fakeParseMarkdown(md);
  }
  const base = fakeParseMarkdown("x");
  return { ...base, blocks: md, stats: { ...base.stats, blocks: md.length } };
};

const R: [number, number] = [0, 0];

const layout = (
  md: string | NoteBlock[],
  over: Partial<LayoutOptions> = {},
) => {
  const doc = docOf(md);
  const opts = defaultOptions(over);
  const table = buildWidthTable(fakeMeasure, doc, opts);
  const items = layoutNote(doc, table, opts).parts.flatMap((p) => p.items);
  return { doc, opts, table, items };
};

// --- wrap guard -------------------------------------------------------------

const LONG =
  "To understand cpu lets first understand what a transistor is A transistor is basically an electrically controlled switch It controls the flow of electricity through it By controlling the flow of electicity is can create a YES NO state  But how does yes no switch become logic ?? One switch alone cant do anything special but if we combine many switches it can give us logic";

const NOTE = [
  "# This folder is about understanding of Virtual Machines and much more besides",
  LONG,
  "## Why VMs need special CPU help with a long heading that wraps",
  `- ${LONG}`,
  `   - ${LONG}`,
  `1. ${LONG}`,
  "Averyveryverylongwordwithoutanyspacesthatcannotbebrokenatawordboundaryatall".repeat(
    3,
  ),
].join("\n\n");

const FONT_CASES: Array<[string, Partial<LayoutOptions>]> = [
  ["Nunito 16", {}],
  [
    "Cascadia 16",
    { fonts: { body: "Cascadia", heading: "Cascadia", code: "Cascadia" } },
  ],
  [
    "Excalifont 20",
    {
      fonts: { body: "Excalifont", heading: "Excalifont", code: "Cascadia" },
      fontSize: 20,
    },
  ],
  ["narrow page", { page: { width: 420, height: 1123, margin: 48 } }],
];

describe("wrap guard: no line is wider than its text element", () => {
  it.each(FONT_CASES)("%s", (_name, over) => {
    const { items, table, opts } = layout(NOTE, over);
    const wrapper = new Wrapper(table);
    const roles = Object.values(fontPlan(opts.fonts, opts.fontSize));
    let checked = 0;
    for (const it of items) {
      if (it.type !== "text") {
        continue;
      }
      const role = roles.find(
        (r) => r.family === it.fontFamily && r.size === it.fontSize,
      )!;
      expect(role, `${it.fontFamily} ${it.fontSize}`).toBeDefined();
      for (const line of it.text.split("\n")) {
        const w = wrapper.width(line, role);
        // A single word longer than the column is broken by characters, so
        // the guard holds for it too.
        expect(w, line).toBeLessThanOrEqual(it.width + 0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("wrap guard: boxes (quote, code) narrow the column", () => {
  it("long quote and code lines stay inside their element", () => {
    const blocks = [
      {
        range: R,
        kind: "blockquote",
        blocks: [{ range: R, kind: "paragraph", text: LONG }],
      },
      { range: R, kind: "code", code: true, lang: "", text: "y".repeat(300) },
    ] as unknown as NoteBlock[];
    const { items, table, opts } = layout(blocks);
    const wrapper = new Wrapper(table);
    const roles = Object.values(fontPlan(opts.fonts, opts.fontSize));
    const texts = items.filter((i) => i.type === "text");
    expect(texts.length).toBe(2);
    for (const it of texts) {
      if (it.type !== "text") {
        continue;
      }
      const role = roles.find(
        (r) => r.family === it.fontFamily && r.size === it.fontSize,
      )!;
      for (const line of it.text.split("\n")) {
        expect(wrapper.width(line, role)).toBeLessThanOrEqual(it.width + 0.01);
      }
    }
  });
});
