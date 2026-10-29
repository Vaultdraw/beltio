/**
 * Import styling (toimprove #111): each Markdown construct gets its role
 * (tone, fill and `data.role`), so the theme colours it; the `heading_colors`
 * setting turns heading colours off. The wrap guard is wrapGuard.test.ts.
 */
import { describe, expect, it } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteBlock, NoteDoc } from "@vaultdraw/api";
import type { PageItem } from "../../src/layout/types";
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
const LINK_BLOCKS = [
  {
    range: R,
    kind: "paragraph",
    text: "Site",
    inline: [{ kind: "link", start: 0, end: 4, target: "https://example.com" }],
  },
] as unknown as NoteBlock[];
const CODE_BLOCKS = [
  { range: R, kind: "code", code: true, lang: "js", text: "let x = 1;" },
] as unknown as NoteBlock[];
const QUOTE_BLOCKS = [
  {
    range: R,
    kind: "blockquote",
    blocks: [{ range: R, kind: "paragraph", text: "quoted words" }],
  },
] as unknown as NoteBlock[];

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

const textOf = (items: PageItem[], needle: string) =>
  items.find(
    (i): i is Extract<PageItem, { type: "text" }> =>
      i.type === "text" && i.text.includes(needle),
  );

/** One row per construct: the Markdown, the text to find, the tone it must have. */
const CONSTRUCTS: Array<
  [string, string | NoteBlock[], string, string | undefined]
> = [
  ["heading 1", "# Alpha heading", "Alpha heading", "heading1"],
  ["heading 2", "## Beta heading", "Beta heading", "heading2"],
  ["heading 3", "### Gamma heading", "Gamma heading", "heading3"],
  ["heading 4", "#### Delta heading", "Delta heading", "heading4"],
  ["heading 5", "##### Epsilon heading", "Epsilon heading", "heading5"],
  ["heading 6", "###### Zeta heading", "Zeta heading", "heading6"],
  ["paragraph", "Plain words here.", "Plain words here.", undefined],
  ["whole link", LINK_BLOCKS, "Site", "link"],
  ["code block", CODE_BLOCKS, "let x = 1;", "code"],
  ["list item", "- first item", "first item", undefined],
  ["task", "- [ ] open task", "open task", undefined],
];

describe("each construct gets its style", () => {
  it.each(CONSTRUCTS)("%s", (_name, md, needle, tone) => {
    const { items } = layout(md);
    const item = textOf(items, needle);
    expect(item, needle).toBeDefined();
    expect(item!.tone).toBe(tone);
  });

  it("headings step down in size, as Obsidian's", () => {
    const { items } = layout(
      CONSTRUCTS.slice(0, 6)
        .map((r) => r[1])
        .join("\n\n"),
    );
    const sizes = CONSTRUCTS.slice(0, 6).map(
      (r) => textOf(items, r[2])!.fontSize,
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
    expect(sizes[5]).toBe(16);
  });

  it("heading_colors off: headings take the text colour", () => {
    const { items } = layout("# Alpha\n\n## Beta", { headingColors: false });
    expect(textOf(items, "Alpha")!.tone).toBeUndefined();
    expect(textOf(items, "Beta")!.tone).toBeUndefined();
    // Still marked as headings: navigation and the update pass need it.
    expect(textOf(items, "Alpha")!.data).toEqual({ heading: 1 });
  });

  it("headings and links carry their role", () => {
    const { items } = layout("## Beta");
    expect(textOf(items, "Beta")!.data).toEqual({ heading: 2, role: "h2" });
    const link = textOf(layout(LINK_BLOCKS).items, "Site")!;
    expect(link.data).toEqual({ role: "link" });
  });

  it("a quote has a box and a left bar the height of the box", () => {
    const { items } = layout(QUOTE_BLOCKS);
    const box = items.find((i) => i.type === "rect" && i.fill === "quote")!;
    const bar = items.find((i) => i.type === "rect" && i.fill === "bar")!;
    expect(box).toBeDefined();
    expect(bar).toMatchObject({ x: box.x, y: box.y, height: box.height });
    expect(bar.width).toBeLessThan(6);
    // The quote text sits right of the bar.
    expect(textOf(items, "quoted")!.x).toBeGreaterThan(bar.x + bar.width);
  });
});
