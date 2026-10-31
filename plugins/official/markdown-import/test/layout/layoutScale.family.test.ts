/**
 * Family "cost is linear in note size" (toimprove 288, 294 for the reading view), here for the
 * import's page layout: every golden note (each Markdown construct the parser produces) repeated
 * to a base size and to 4 times that. Laying out 4 times the blocks must cost under 8 times the
 * time (linear is 4, quadratic is 16). A new construct is one more `goldens/<name>.doc.json`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure } from "./fixtures";

import type { NoteDoc } from "@vaultdraw/api";

const dir = path.join(__dirname, "goldens");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".doc.json"))
  .map((f) => f.replace(/\.doc\.json$/, ""))
  .sort();

const repeated = (doc: NoteDoc, times: number): NoteDoc => ({
  ...doc,
  blocks: Array.from({ length: times }, () => doc.blocks).flat(),
});

const run = (doc: NoteDoc): number => {
  const opts = defaultOptions();
  const table = buildWidthTable(fakeMeasure, doc, opts);
  const t0 = performance.now();
  layoutNote(doc, table, opts);
  return performance.now() - t0;
};
const best = (doc: NoteDoc) => Math.min(run(doc), run(doc));

describe.each(names)("layout cost sweep: %s", (name) => {
  const doc = JSON.parse(
    readFileSync(path.join(dir, `${name}.doc.json`), "utf8"),
  ) as NoteDoc;
  test("4 times the blocks cost under 8 times the time", () => {
    run(repeated(doc, 5));
    const small = best(repeated(doc, 400));
    const big = best(repeated(doc, 1600));
    expect(big / Math.max(small, 5)).toBeLessThan(8);
  }, 120_000);
});
