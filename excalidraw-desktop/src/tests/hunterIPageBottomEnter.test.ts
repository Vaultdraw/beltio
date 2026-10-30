import { describe, expect, it } from "vitest";

import { newTextElement } from "@excalidraw/element";
import { DEFAULT_PAGE_SETUP } from "@excalidraw/excalidraw/data/pageSetup";

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

  it.fails("page enforcement never moves the body box onto the heading", () => {
    const all = [heading, body];
    const move = planEnforcement(setup, all, [body], {}, toMap(all)).get(
      "body",
    );
    const top = body.y + (move?.dy ?? 0);
    expect(top).toBeGreaterThanOrEqual(heading.y + heading.height);
  });
});
