import { describe, expect, it } from "vitest";

import { newTextElement } from "@excalidraw/element";
import {
  DEFAULT_PAGE_SETUP,
  getPageRect,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { planEnforcement } from "../page/enforcement";
import { toMap } from "../page/testElements";

/**
 * Hunter I-10 (2026-10-30). Page mode, separate sheets. A heading near the bottom of a page,
 * Markdown mode Enter: the body box starts right below it (heading bottom + half a body line,
 * markdownTyping.ts belowAnchor) and runs past the page's bottom edge. Page enforcement then
 * moves the new box into the page nearest its centre, which is the SAME page, pulling it up on
 * top of the heading. A page-based editor (Typst, Word, Obsidian's PDF export) flows the next
 * block to the next page.
 */
const setup: PageSetup = { ...DEFAULT_PAGE_SETUP, pageCount: 2 };

const box = (
  id: string,
  y: number,
  height: number,
  fontSize: number,
): ExcalidrawTextElement =>
  ({
    ...newTextElement({ text: id, x: 60, y, fontSize }),
    id,
    y,
    width: 200,
    height,
  } as ExcalidrawTextElement);

describe("hunter I-10: Enter after a heading at the bottom of a page", () => {
  const bottom = setup.height; // page 1 ends here
  const heading = box("heading", bottom - 60, 45, 36); // ends 15 px above the edge
  // body size 20, line height 1.25, block gap 0.5 line
  const body = box(
    "body",
    heading.y + heading.height + 0.5 * 20 * 1.25,
    25,
    20,
  );

  it("sanity: the body box starts below the heading and runs past the page edge", () => {
    expect(body.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    expect(body.y + body.height).toBeGreaterThan(bottom);
  });

  it("page enforcement never moves the body box onto the heading", () => {
    const all = [heading, body];
    const move = planEnforcement(setup, all, [body], {}, toMap(all)).get(
      "body",
    );
    const top = body.y + (move?.dy ?? 0);
    expect(top).toBeGreaterThanOrEqual(heading.y + heading.height);
  });
});

describe("toimprove 231 family: text crossing a page's bottom edge flows on", () => {
  const bottom = setup.height;
  const plan = (els: ExcalidrawTextElement[], s: PageSetup = setup) =>
    planEnforcement(s, els, [els[els.length - 1]], {}, toMap(els));

  it("a text box crossing page 1's bottom edge moves to the top of page 2", () => {
    const body = box("body", bottom - 10, 25, 20);
    const move = plan([body]).get("body")!;
    const page2 = getPageRect(setup, 1);
    expect(body.y + move.dy).toBe(page2.y);
  });

  it("on the last page it is still pulled back inside (nothing to flow to)", () => {
    const one = { ...setup, pageCount: 1 };
    const body = box("body", bottom - 10, 25, 20);
    const move = plan([body], one).get("body")!;
    expect(body.y + move.dy + body.height).toBeLessThanOrEqual(bottom);
  });

  it("continuous layout keeps the old clamp (no page break to flow over)", () => {
    const cont = { ...setup, layout: "continuous" as const };
    const body = box("body", bottom - 10, 25, 20);
    expect(plan([body], cont).get("body")).toBeUndefined();
  });
});
