/**
 * Golden layouts: each `goldens/<name>.doc.json` is a real `NoteDoc` (the
 * Rust parser's output for `<name>.md`, copied from the core crate's
 * goldens) and `<name>.layout.json` is the `PageItem` list it lays out to.
 * Update with `vitest -u` after a deliberate layout change.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { fakeParseMarkdown } from "../../../../../sdk/api/shared/markdown";
import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteDoc } from "@vaultdraw/api";

const dir = path.join(__dirname, "goldens");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".doc.json"))
  .map((f) => f.replace(/\.doc\.json$/, ""))
  .sort();

const round = (v: unknown): unknown => {
  if (typeof v === "number") {
    return Math.round(v * 100) / 100;
  }
  if (Array.isArray(v)) {
    return v.map(round);
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        round(x),
      ]),
    );
  }
  return v;
};

describe("golden layouts", () => {
  test.each(names)("%s", async (name) => {
    const doc = JSON.parse(
      readFileSync(path.join(dir, `${name}.doc.json`), "utf8"),
    ) as NoteDoc;
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, doc, opts);
    const result = layoutNote(doc, table, opts);
    for (const part of result.parts) {
      for (const item of part.items) {
        expect(item.page).toBeGreaterThanOrEqual(0);
        expect(item.page).toBeLessThan(part.pageCount);
        expect(item.x).toBeGreaterThanOrEqual(opts.page.margin as number);
        expect(item.x + item.width).toBeLessThanOrEqual(
          opts.page.width - (opts.page.margin as number) + 0.01,
        );
        expect(item.y + item.height).toBeLessThanOrEqual(
          opts.page.height - (opts.page.margin as number) + 0.01,
        );
      }
    }
    await expect(JSON.stringify(round(result), null, 1)).toMatchFileSnapshot(
      path.join(dir, `${name}.layout.json`),
    );
  });

  test("the SDK's fake parser feeds the layout too", () => {
    const md = readFileSync(path.join(dir, "readme_mixed.md"), "utf8");
    const doc = fakeParseMarkdown(md);
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, doc, opts);
    const { parts, stats } = layoutNote(doc, table, opts);
    expect(parts).toHaveLength(1);
    expect(stats.elements).toBe(parts[0].items.length);
    expect(
      parts[0].items.some(
        (i) => i.type === "text" && typeof i.data?.heading === "number",
      ),
    ).toBe(true);
  });
});
