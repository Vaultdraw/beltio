import { pointFrom } from "@excalidraw/math";
import { newElement, newTextElement } from "@excalidraw/element";
import { arrayToMap } from "@excalidraw/common";

import { getDefaultAppState } from "../appState";
import { isPointHittingLinkIcon } from "../components/hyperlink/helpers";
import {
  getLinkUnderline,
  isPointHittingUnderline,
  isWebLink,
  setLinkIndicator,
  showsLinkGlyph,
  showsLinkUnderline,
} from "../components/hyperlink/linkIndicator";

import type { AppState } from "../types";

const appState = (zoom = 1) =>
  ({ ...getDefaultAppState(), zoom: { value: zoom } } as unknown as AppState);

describe("link indicator", () => {
  afterEach(() => setLinkIndicator(null));

  it("tells web links from drawing links", () => {
    expect(isWebLink("https://a.b")).toBe(true);
    expect(isWebLink("mailto:a@b.c")).toBe(true);
    expect(isWebLink("[[Plan]]")).toBe(false);
    expect(isWebLink("vaultdraw://open?file=a")).toBe(false);
  });

  it.each([
    ["underline", true, false, true],
    ["underline", false, true, false],
    ["icon", true, true, false],
    ["icon", false, true, false],
    ["both", true, true, true],
    ["both", false, true, false],
  ] as const)(
    "style %s, has text %s: glyph %s, underline %s",
    (style, hasText, glyph, line) => {
      expect(showsLinkGlyph(style, hasText)).toBe(glyph);
      expect(showsLinkUnderline(style, hasText)).toBe(line);
    },
  );

  it("underlines text elements, not plain shapes", () => {
    const text = newTextElement({ x: 10, y: 10, text: "hello", link: "[[A]]" });
    const rect = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      link: "https://a.b",
    });
    const map = arrayToMap([text, rect]);
    const u = getLinkUnderline(text, map)!;
    expect(u.x1).toBe(10);
    expect(u.x2).toBeCloseTo(10 + text.width);
    expect(u.y).toBeCloseTo(10 + text.height - 1);
    expect(getLinkUnderline(rect, map)).toBeNull();
  });

  it("the underline strip is clickable at any zoom, the corner is not in underline mode", () => {
    const text = newTextElement({ x: 10, y: 10, text: "hello", link: "[[A]]" });
    const map = arrayToMap([text]);
    const u = getLinkUnderline(text, map)!;
    expect(isPointHittingUnderline(u, 1, pointFrom(20, u.y + 3))).toBe(true);
    expect(isPointHittingUnderline(u, 1, pointFrom(20, u.y - 20))).toBe(false);
    // zoomed out the strip grows in scene units to stay 12 screen px tall
    expect(isPointHittingUnderline(u, 0.25, pointFrom(20, u.y + 20))).toBe(
      true,
    );
    setLinkIndicator({ style: "underline" });
    const cornerX = 10 + text.width + 6;
    const cornerY = 10 - 10;
    expect(
      isPointHittingLinkIcon(text, map, appState(), pointFrom(20, u.y)),
    ).toBe(true);
    expect(
      isPointHittingLinkIcon(
        text,
        map,
        appState(),
        pointFrom(cornerX, cornerY),
      ),
    ).toBe(false);
    setLinkIndicator({ style: "icon" });
    expect(
      isPointHittingLinkIcon(text, map, appState(), pointFrom(20, u.y)),
    ).toBe(false);
  });
});
