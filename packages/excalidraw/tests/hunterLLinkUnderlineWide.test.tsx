import { afterEach, describe, expect, it } from "vitest";
import { getFontString } from "@excalidraw/common";
import { getLineWidth, newTextElement } from "@excalidraw/element";
import { arrayToMap } from "@excalidraw/common";

import {
  getLinkUnderline,
  setLinkIndicator,
} from "../components/hyperlink/linkIndicator";

/**
 * Hunter L-3 (2026-10-30 night), next door to toimprove 224 (2ef95ae6). A linked text of
 * several lines is now underlined under each line, as wide as that line's text. A linked text
 * of ONE line still gets the old rule: the whole box width (`relativeSegments`, `lines.length < 2`).
 * A one-line text in a box the user made wider (its width fixed by dragging a side handle) is
 * underlined far past its last letter, and the underline strip there is a link click on empty
 * space. Obsidian underlines only the link text.
 */
describe("hunter L-3: a one-line linked text in a wide box", () => {
  afterEach(() => setLinkIndicator(null));

  const base = newTextElement({
    x: 0,
    y: 0,
    text: "Roadmap",
    fontSize: 20,
    link: "https://example.com",
  });
  // the user dragged the box's right side out: same text, a wider box
  const wide = { ...base, width: 400, autoResize: false } as typeof base;
  const textWidth = getLineWidth("Roadmap", getFontString(base));

  it("sanity: two lines in the same wide box are underlined as wide as their text", () => {
    setLinkIndicator({ style: "underline" });
    const two = {
      ...wide,
      text: "Roadmap\nRoadmap",
      version: 99,
    } as typeof base;
    const u = getLinkUnderline(two, arrayToMap([two]))!;
    expect(u.segments).toHaveLength(2);
    expect(u.segments[0].x2 - u.segments[0].x1).toBeCloseTo(textWidth, 0);
  });

  it.fails("one line is underlined as wide as its text, not the box", () => {
    setLinkIndicator({ style: "underline" });
    const u = getLinkUnderline(wide, arrayToMap([wide]))!;
    expect(textWidth).toBeLessThan(200);
    expect(u.x2 - u.x1).toBeCloseTo(textWidth, 0);
  });
});
