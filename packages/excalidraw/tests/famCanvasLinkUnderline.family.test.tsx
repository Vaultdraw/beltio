import { afterEach, describe, expect, it } from "vitest";
import { arrayToMap, getFontString } from "@excalidraw/common";
import { getLineWidth, newTextElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import {
  getLinkUnderline,
  isPointHittingUnderline,
  setLinkIndicator,
} from "../components/hyperlink/linkIndicator";

/**
 * Family hunter canvas (2026-10-31): "a linked text is underlined under its own letters on
 * every line, and a click past the letters is not the link". 205, 224, 258 each fixed one
 * shape of the box; this table crosses every alignment, box width, line shape and angle.
 */
const TEXTS = [
  { name: "one line", text: "Roadmap" },
  { name: "one line, trailing spaces", text: "Roadmap   " },
  {
    name: "three lines of different length",
    text: "a\nRoadmap for the year\nab",
  },
  { name: "empty middle line", text: "Roadmap\n\nPlan" },
  { name: "trailing newline", text: "Roadmap\n" },
  { name: "wide letters", text: "WWWWWWWW" },
];
const ALIGNS = ["left", "center", "right"] as const;
const BOXES = [
  { name: "fitted", extra: 0 },
  { name: "dragged wider", extra: 300 },
];
const ANGLES = [0, Math.PI / 5];

describe("family: link underline under the text's own letters", () => {
  afterEach(() => setLinkIndicator(null));

  for (const t of TEXTS) {
    for (const align of ALIGNS) {
      for (const box of BOXES) {
        for (const angle of ANGLES) {
          it(`${t.name} / ${align} / ${box.name} / angle ${angle.toFixed(
            1,
          )}`, () => {
            setLinkIndicator({ style: "underline" });
            const base = newTextElement({
              x: 40,
              y: 60,
              text: t.text,
              fontSize: 20,
              textAlign: align,
              link: "https://example.com",
            });
            const el = {
              ...base,
              width: base.width + box.extra,
              angle,
              autoResize: box.extra === 0,
            } as typeof base;
            const u = getLinkUnderline(el, arrayToMap([el]))!;
            const font = getFontString(el);
            const lines = t.text
              .split("\n")
              .map((l) => l.trimEnd())
              .filter((l) => getLineWidth(l, font) > 0);
            expect(u.segments).toHaveLength(lines.length);
            lines.forEach((l, i) => {
              const s = u.segments[i];
              expect(s.x2 - s.x1).toBeCloseTo(getLineWidth(l, font), 0);
              // inside the box
              expect(s.x1).toBeGreaterThanOrEqual(el.x - 0.5);
              expect(s.x2).toBeLessThanOrEqual(el.x + el.width + 0.5);
              // the middle of the underline opens the link (rotated about the box centre)
              const mid = (s.x1 + s.x2) / 2;
              const rot = (px: number, py: number) => {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const dx = px - u.centerX;
                const dy = py - u.centerY;
                return pointFrom<any>(
                  u.centerX + dx * cos - dy * sin,
                  u.centerY + dx * sin + dy * cos,
                );
              };
              expect(isPointHittingUnderline(u, 1, rot(mid, s.y))).toBe(true);
              // 20 px past the end of the letters (still inside a wide box) does not
              if (box.extra) {
                expect(
                  isPointHittingUnderline(u, 1, rot(s.x2 + 20, s.y)) &&
                    s.x2 + 20 < el.x + el.width,
                ).toBe(false);
              }
            });
          });
        }
      }
    }
  }
});
