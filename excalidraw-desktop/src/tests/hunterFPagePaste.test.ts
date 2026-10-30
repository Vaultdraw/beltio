import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TEXT_MAX_WRAP_WIDTH } from "@excalidraw/common";
import {
  DEFAULT_PAGE_SETUP,
  getPageTextMaxWidth,
  getPresetPageSize,
  getClampToPageOffset,
} from "@excalidraw/excalidraw/data/pageSetup";

/**
 * Hunter F-3 (2026-10-30). 98bf7d49 made a TYPED free text wrap at the page edge in page mode
 * (App.text.ts uses getPageTextMaxWidth). A PASTED long text still wraps at min(view width, 800 px)
 * (App.clipboard.ts pasteWithin -> getMaxTextWidth), which is wider than a page of A5 (559 px),
 * Phone (393 px), B5 (665 px) ... The commit-time enforcement (page/enforcement.ts) then moves it to
 * the page's left edge ("too big to fit: align to the start edge"), so it still runs past the
 * right edge: the exact overflow the commit fixed for typing.
 */
describe("hunter F-3: pasted text wraps at the page edge in page mode", () => {
  // The page cap lives in getMaxTextWidth, the one helper typing and pasting share (toimprove 177;
  // behaviour pinned by packages/excalidraw/tests/pageTextMaxWidth.test.ts).
  const text = readFileSync(
    resolve(__dirname, "../../../packages/excalidraw/components/App.text.ts"),
    "utf8",
  );

  it("the shared max-width helper caps text at the page width", () => {
    expect(text).toMatch(/pageSetup\.width/);
  });

  it("(context) a 800 px wrapped text cannot be inside an A5 or phone page, even after the clamp", () => {
    for (const id of ["a5", "phone"] as const) {
      const size = getPresetPageSize(id, "portrait");
      const setup = {
        ...DEFAULT_PAGE_SETUP,
        ...size,
        layout: "continuous" as const,
      };
      expect(TEXT_MAX_WRAP_WIDTH).toBeGreaterThan(setup.width);
      const { dx } = getClampToPageOffset(setup, [
        100,
        0,
        100 + TEXT_MAX_WRAP_WIDTH,
        40,
      ]);
      // the clamp can only align the start edge: the right edge is still past the page
      expect(100 + dx + TEXT_MAX_WRAP_WIDTH).toBeGreaterThan(setup.width);
      // while the typed path caps the same text at the page width
      expect(
        getPageTextMaxWidth(setup, {
          x: 0,
          width: 10,
          fontSize: 20,
          textAlign: "left",
        }),
      ).toBe(setup.width);
    }
  });
});
