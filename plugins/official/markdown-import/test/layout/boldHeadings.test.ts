/**
 * Bold headings (bold-inline): headings are laid out and measured in the
 * bold variant of the font and come out as items with `bold: true`; body,
 * code and quotes do not; `heading_bold` off turns it off.
 */
import { describe, expect, it } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { TextFont } from "@vaultdraw/api";
import type { LayoutOptions, PageItem } from "../../src/layout/types";

const MD = "# Title\n\nBody words here.\n\n## Part\n\n```\ncode\n```\n";

const run = (over: Partial<LayoutOptions> = {}, seen: TextFont[] = []) => {
  const doc = fakeParseMarkdown(MD);
  const opts = defaultOptions(over);
  const measure = (f: TextFont, s: readonly string[]) => {
    seen.push(f);
    // bold glyphs are 10% wider
    return fakeMeasure(f, s).map((w) => (f.bold ? w * 1.1 : w));
  };
  const table = buildWidthTable(measure, doc, opts);
  return layoutNote(doc, table, opts).parts.flatMap((p) => p.items);
};

const texts = (items: PageItem[]) =>
  items.filter(
    (i): i is Extract<PageItem, { type: "text" }> => i.type === "text",
  );

describe("heading_bold", () => {
  it("headings are bold items; body and code are not", () => {
    const items = texts(run());
    const bold = Object.fromEntries(
      items.map((i) => [i.text, i.bold === true]),
    );
    expect(bold.Title).toBe(true);
    expect(bold.Part).toBe(true);
    expect(bold["Body words here."]).toBe(false);
  });

  it("measures the heading fonts with bold: true, and only those", () => {
    const seen: TextFont[] = [];
    run({}, seen);
    const bold = seen.filter((f) => f.bold);
    const plain = seen.filter((f) => !f.bold);
    expect(bold.length).toBeGreaterThan(0);
    expect(bold.every((f) => f.family === "Nunito")).toBe(true);
    // the body size has no bold measure
    expect(bold.some((f) => f.size === 16)).toBe(false);
    expect(plain.some((f) => f.size === 16)).toBe(true);
  });

  it("off: no bold anywhere and no bold measure", () => {
    const seen: TextFont[] = [];
    const items = texts(run({ boldHeadings: false }, seen));
    expect(items.some((i) => i.bold)).toBe(false);
    expect(seen.some((f) => f.bold)).toBe(false);
  });

  it("a long heading wraps by its bold width", () => {
    const long = `# ${"word ".repeat(40)}`;
    const doc = fakeParseMarkdown(long);
    const wrapLines = (boldHeadings: boolean) => {
      const opts = defaultOptions({ boldHeadings });
      const table = buildWidthTable(
        (f, s) => fakeMeasure(f, s).map((w) => (f.bold ? w * 1.5 : w)),
        doc,
        opts,
      );
      const item = texts(
        layoutNote(doc, table, opts).parts.flatMap((p) => p.items),
      )[0];
      return item.text.split("\n").length;
    };
    expect(wrapLines(true)).toBeGreaterThan(wrapLines(false));
  });
});
