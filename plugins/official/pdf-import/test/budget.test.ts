import { describe, expect, it } from "vitest";

import { byteBudget, estimateImport, planImportSides } from "../src/budget";
import { DRAWING_BYTES_HEADROOM, MAX_DRAWING_BYTES } from "../src/limits";

import type { PdfImportSettings } from "@vaultdraw/api";

const S: PdfImportSettings = {
  maxSide: 1440,
  format: "jpeg",
  quality: 0.85,
  lockPages: true,
  warnPages: 50,
  pixelBudgetMp: 60,
};

const a4 = { widthPt: 595, heightPt: 842 };
const pages = (n: number) => Array.from({ length: n }, () => a4);
const all = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("planImportSides", () => {
  it("keeps maxSide for few pages", () => {
    expect(planImportSides(pages(10), all(10), S)).toBe(S.maxSide);
  });

  it("shrinks with the page count but not below minSide", () => {
    const s100 = planImportSides(pages(100), all(100), S);
    expect(s100).toBeLessThan(1200);
    expect(s100).toBeGreaterThanOrEqual(800);
    expect(planImportSides(pages(200), all(200), S)).toBe(800);
  });

  it("maxSide below minSide wins", () => {
    expect(planImportSides(pages(200), all(200), { ...S, maxSide: 600 })).toBe(
      600,
    );
  });
});

describe("estimateImport", () => {
  it("estimates sizes and pages that fit", () => {
    const e = estimateImport({
      pages: pages(5),
      indices: all(5),
      settings: S,
      currentBytes: 0,
    });
    expect(e.side).toBe(1440);
    expect(e.pagesThatFit).toBe(5);
    expect(e.totalBytes).toBeGreaterThan(e.bytesPerPage * 4);
    expect(e.decodedBytes).toBeGreaterThan(5 * 1000 * 1000);
  });

  it("limits pages by the remaining byte budget", () => {
    const full = byteBudget(0);
    const e = estimateImport({
      pages: pages(5),
      indices: all(5),
      settings: S,
      currentBytes: full - 1.5 * 300_000,
    });
    expect(e.pagesThatFit).toBeLessThan(5);
    expect(e.pagesThatFit).toBeGreaterThanOrEqual(0);
  });

  it("png estimates larger than jpeg", () => {
    const base = { pages: pages(2), indices: all(2), currentBytes: 0 };
    expect(
      estimateImport({ ...base, settings: { ...S, format: "png" } })
        .bytesPerPage,
    ).toBeGreaterThan(estimateImport({ ...base, settings: S }).bytesPerPage);
  });
});

describe("byteBudget", () => {
  it("subtracts from the headroom share", () => {
    expect(byteBudget(1000)).toBe(
      DRAWING_BYTES_HEADROOM * MAX_DRAWING_BYTES - 1000,
    );
  });
});
