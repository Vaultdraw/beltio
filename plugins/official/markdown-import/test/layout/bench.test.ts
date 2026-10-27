/**
 * Prints layout timings for 1k, 10k and 50k words (jsdom, this machine).
 * Not a gate: the numbers go in the report; the 4x gate runs in the browser.
 */
import { describe, expect, test } from "vitest";

import { layoutNote } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure, generateNote } from "./fixtures";

describe("layout bench", () => {
  test.each([1_000, 10_000, 50_000])("%i words", (words) => {
    const doc = generateNote(words, 11);
    const opts = defaultOptions();
    // Warm up once (regex caches, JIT), then one timed run decides.
    buildWidthTable(fakeMeasure, doc, opts);
    const t0 = performance.now();
    const table = buildWidthTable(fakeMeasure, doc, opts);
    const t1 = performance.now();
    const { stats } = layoutNote(doc, table, opts);
    const t2 = performance.now();
    // eslint-disable-next-line no-console -- bench output
    console.log(
      `${words} words: table ${(t1 - t0).toFixed(1)} ms, layout ${(
        t2 - t1
      ).toFixed(1)} ms, ${stats.elements} elements, ${stats.pages} pages`,
    );
    expect(stats.pages).toBeGreaterThan(0);
  });
});
