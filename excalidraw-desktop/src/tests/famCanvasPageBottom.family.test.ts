/**
 * Family hunter canvas (2026-10-31), family of toimprove 231: "content crossing a page bottom
 * flows to the next page, never clamped up over what is above". 231 fixed a text that STARTS on
 * the page and runs past its bottom edge. The same Enter can put the body box's top at or just
 * below the edge, in the 40 px gap between two sheets (a heading that ends 5 to 12 px above the
 * edge: body top = heading bottom + half a body line). `flowToNextPage` needs the top inside the
 * page, so that box takes the old clamp, which uses the page nearest its centre: page 1, so a
 * one-line body is pulled UP over the heading. This sweeps top positions across the edge for
 * several page setups and box heights.
 */
import { describe, expect, it } from "vitest";

import { newTextElement } from "@excalidraw/element";
import {
  DEFAULT_PAGE_SETUP,
  getPageRect,
  isBoundsInsidePage,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { PageSetup } from "@excalidraw/excalidraw/data/pageSetup";

import { planEnforcement } from "../page/enforcement";
import { toMap } from "../page/testElements";

const SETUPS: { name: string; setup: PageSetup }[] = [
  { name: "A4 portrait", setup: { ...DEFAULT_PAGE_SETUP, pageCount: 3 } },
  {
    name: "A4 landscape",
    setup: {
      ...DEFAULT_PAGE_SETUP,
      orientation: "landscape",
      width: DEFAULT_PAGE_SETUP.height,
      height: DEFAULT_PAGE_SETUP.width,
      pageCount: 3,
    },
  },
  {
    name: "custom 400 x 300",
    setup: {
      ...DEFAULT_PAGE_SETUP,
      size: "custom",
      width: 400,
      height: 300,
      pageCount: 3,
    },
  },
];
// one body line (20 px x 1.25), two lines, a paragraph
const HEIGHTS = [25, 50, 125];

const box = (y: number, height: number, width: number) =>
  ({
    ...newTextElement({ text: "t", x: 20, y, fontSize: 20 }),
    id: "t",
    y,
    width,
    height,
  } as never);

describe("family: where a free text lands when its top is near a page's bottom edge", () => {
  for (const { name, setup } of SETUPS) {
    const page = getPageRect(setup, 0);
    const bottom = page.y + page.height;
    const width = Math.min(200, setup.width - 40);
    const tops: number[] = [];
    for (let d = -60; d <= 60; d += 2.5) {
      tops.push(bottom + d);
    }

    it(`${name}: whatever the top, the box ends up inside one page`, () => {
      for (const h of HEIGHTS) {
        for (const y of tops) {
          const el = box(y, h, width);
          const dy =
            planEnforcement(setup, [el], [el], {}, toMap([el])).get("t")?.dy ??
            0;
          const moved = [20, y + dy, 20 + width, y + dy + h] as const;
          expect(
            isBoundsInsidePage(setup, moved),
            `h=${h} top=bottom${y - bottom}`,
          ).toBe(true);
        }
      }
    });

    it.fails(
      `${name}: a box whose top is at or below the edge is never pulled up (toimprove 302)`,
      () => {
        const pulled: string[] = [];
        for (const h of HEIGHTS) {
          for (const y of tops.filter((t) => t >= bottom)) {
            const el = box(y, h, width);
            const dy =
              planEnforcement(setup, [el], [el], {}, toMap([el])).get("t")
                ?.dy ?? 0;
            if (dy < 0) {
              pulled.push(`h=${h} top=bottom+${y - bottom} dy=${dy}`);
            }
          }
        }
        expect(pulled).toEqual([]);
      },
    );

    it(`${name}: a box that starts on the page and crosses the edge flows to the next page`, () => {
      for (const h of HEIGHTS) {
        for (const y of tops.filter(
          (t) => t < bottom && t + h > bottom && t >= page.y,
        )) {
          const el = box(y, h, width);
          const dy =
            planEnforcement(setup, [el], [el], {}, toMap([el])).get("t")?.dy ??
            0;
          expect(dy, `h=${h} top=bottom${y - bottom}`).toBeGreaterThan(0);
        }
      }
    });
  }
});
