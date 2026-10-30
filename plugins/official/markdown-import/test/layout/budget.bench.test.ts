/** Timing of the first page (wall-clock, outside the fast tier). */
import { describe, expect, test } from "vitest";

import { layoutNoteStream } from "../../src/layout/index";
import { buildWidthTable } from "../../src/layout/widthTable";

import { defaultOptions, fakeMeasure, generateNote } from "./fixtures";

describe("layout timing", () => {
  test("the first page of a 50k-word note leaves in under 60 ms", () => {
    const note50k = generateNote(50_000, 3);
    const opts = defaultOptions();
    const table = buildWidthTable(fakeMeasure, note50k, opts);
    const t0 = performance.now();
    const gen = layoutNoteStream(note50k, table, opts);
    for (const ev of gen) {
      if (ev.type === "page") {
        break;
      }
    }
    const ms = performance.now() - t0;
    gen.return(undefined);
    expect(ms).toBeLessThan(60);
  });
});
