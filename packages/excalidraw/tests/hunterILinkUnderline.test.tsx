import { afterEach, describe, expect, it } from "vitest";
import { pointFrom } from "@excalidraw/math";
import { newTextElement } from "@excalidraw/element";
import { arrayToMap } from "@excalidraw/common";

import type { GlobalPoint } from "@excalidraw/math";

import { getDefaultAppState } from "../appState";
import { isPointHittingLinkIcon } from "../components/hyperlink/helpers";
import {
  getLinkUnderline,
  setLinkIndicator,
} from "../components/hyperlink/linkIndicator";

import type { AppState } from "../types";

/**
 * Hunter I-3 (2026-10-30). With the default `links.canvas_indicator = "underline"` (b69e7e27),
 * the clickable strip under a linked text is 12 SCREEN px tall at every zoom. Zoomed out, the
 * strip covers the whole text: a click in the middle of a linked text (to select or drag it)
 * opens the link instead. A 20 px text is hit in its middle from about 50% zoom down.
 * Excalidraw and tldraw keep the link on a small corner icon; Obsidian opens a link only when
 * the click lands on the link text itself, never on a strip around it.
 */
const appState = (zoom: number) =>
  ({ ...getDefaultAppState(), zoom: { value: zoom } } as unknown as AppState);

describe("hunter I-3: a click in the middle of a linked text, zoomed out", () => {
  afterEach(() => setLinkIndicator(null));

  const text = newTextElement({
    x: 0,
    y: 0,
    text: "Roadmap",
    fontSize: 20,
    link: "https://example.com",
  });
  const map = arrayToMap([text]);
  const middle = pointFrom<GlobalPoint>(text.width / 2, text.height / 2);

  it("sanity: at 100% the middle of the text selects it", () => {
    setLinkIndicator({ style: "underline" });
    expect(isPointHittingLinkIcon(text, map, appState(1), middle)).toBe(false);
  });

  it.fails.each([0.5, 0.25])(
    "at %s zoom the middle of the text is not a link click",
    (zoom) => {
      setLinkIndicator({ style: "underline" });
      expect(isPointHittingLinkIcon(text, map, appState(zoom), middle)).toBe(
        false,
      );
    },
  );
});

/**
 * Hunter I-7 (2026-10-30). A linked text of several lines gets ONE underline, under its last
 * line, as wide as its longest line (`getLinkUnderline` uses the whole text box). The last
 * line "Q4" reads as the link and the line runs on past it into empty space; only that strip
 * is clickable. Obsidian underlines the link text on every line it covers.
 */
describe("hunter I-7: a linked text of several lines", () => {
  const multi = newTextElement({
    x: 0,
    y: 0,
    text: "Roadmap for the next quarter\nQ4",
    fontSize: 20,
    link: "[[Roadmap]]",
  });
  const lastLine = newTextElement({ x: 0, y: 0, text: "Q4", fontSize: 20 });

  it("sanity: the box is as wide as its longest line", () => {
    expect(multi.width).toBeGreaterThan(lastLine.width * 3);
  });

  it.fails(
    "the underline under the last line is no wider than that line",
    () => {
      const u = getLinkUnderline(multi, arrayToMap([multi]))!;
      expect(u.x2 - u.x1).toBeLessThanOrEqual(lastLine.width + 1);
    },
  );
});
