import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { trackErrors } from "./helpers";
import {
  BLUE,
  GRAPE,
  ORANGE,
  PREVIEW,
  colorOn,
  openPanelByShortcut,
  preview,
  rectEl,
  rows,
  runPaletteCommand,
  sceneJson,
  setup,
  type Rgb,
} from "./historyHelpers";

// Highlight colours (ChangeOverlay HIGHLIGHT_COLORS).
const ONLY_IN_VERSION: Rgb = [47, 158, 68]; // added (comes back on restore)
const CHANGED: Rgb = [240, 140, 0];
const NOT_IN_VERSION: Rgb = [224, 49, 49]; // dashed ghost of "added since"

// Shapes avoid the highlight colours so the overlay probe is unambiguous.
const anchor = rectEl("anc", 0, 0, null, 620, 420, 9);
const same = rectEl("same", 40, 40, BLUE, 140, 100, 1);
const onlyV = rectEl("onlyv", 400, 40, GRAPE, 140, 100, 2);
const movedOld = rectEl("moved", 220, 40, ORANGE, 140, 100, 3);
const movedNow = {
  ...rectEl("moved", 220, 260, ORANGE, 140, 100, 3),
  version: 2,
  versionNonce: 9999,
};
const addedSince = rectEl("since", 40, 260, BLUE, 140, 100, 4);

// Real files carry fractional indices; without them the editor assigns one on
// load, which bumps `version` and would flag every element as changed.
const indexed = <T extends object>(list: T[]) =>
  list.map((el, i) => ({ ...el, index: `a${i}` }));

const VERSION = {
  json: sceneJson(indexed([anchor, same, movedOld, onlyV])),
};
const CURRENT = indexed([anchor, same, movedNow, addedSince]);

const PREFS_KEY = "excalidraw-vault-preferences-v1";

const overlay = (page: Page) => page.getByTestId("history-change-overlay");
const legend = (page: Page) => page.getByTestId("history-legend");
const toggle = (page: Page) => page.getByTestId("history-highlights");

/** Pixels of `rgb` on the highlight canvas: count and client-space centroid. */
const overlayColor = (page: Page, rgb: Rgb) =>
  page.evaluate((rgb) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-testid='history-change-overlay']",
    );
    if (!canvas) {
      return { count: 0, x: 0, y: 0 };
    }
    const { width, height } = canvas;
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, width, height).data;
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i] - rgb[0]) <= 12 &&
        Math.abs(data[i + 1] - rgb[1]) <= 12 &&
        Math.abs(data[i + 2] - rgb[2]) <= 12 &&
        data[i + 3] > 200
      ) {
        const p = i / 4;
        sx += p % width;
        sy += Math.floor(p / width);
        count++;
      }
    }
    const rect = canvas.getBoundingClientRect();
    const k = rect.width / width;
    return {
      count,
      x: count ? rect.left + (sx / count) * k : 0,
      y: count ? rect.top + (sy / count) * k : 0,
    };
  }, rgb);

const expectOverlay = (page: Page, rgb: Rgb, present: boolean) =>
  expect
    .poll(async () => (await overlayColor(page, rgb)).count > 30, {
      timeout: 8000,
    })
    .toBe(present);

const openPreview = async (page: Page) => {
  await openPanelByShortcut(page);
  await rows(page).first().click();
  await expect(preview(page)).toBeVisible();
};

const near = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  px = 20,
) => Math.hypot(a.x - b.x, a.y - b.y) <= px;

test.describe("change highlights", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, CURRENT, [VERSION]);
  });

  test("legend counts, overlay canvas and colours sit on the shapes", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPreview(page);
    await expect(legend(page)).toContainText("Only in this version 1");
    await expect(legend(page)).toContainText("Not in this version 1");
    await expect(legend(page)).toContainText("Changed since 1");
    await expect(overlay(page)).toHaveCount(1);
    await expect(overlay(page)).toHaveCSS("pointer-events", "none");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

    // The overlay lives inside the preview.
    await expect(
      preview(page).getByTestId("history-change-overlay"),
    ).toHaveCount(1);

    await expectOverlay(page, ONLY_IN_VERSION, true);
    await expectOverlay(page, CHANGED, true);
    await expectOverlay(page, NOT_IN_VERSION, true);

    // Outline centres match the fill centres of the shapes drawn underneath.
    await expect
      .poll(async () =>
        near(
          await overlayColor(page, ONLY_IN_VERSION),
          await colorOn(page, PREVIEW, GRAPE),
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        near(
          await overlayColor(page, CHANGED),
          await colorOn(page, PREVIEW, ORANGE),
        ),
      )
      .toBe(true);
    // The unchanged shape has no outline: no highlight colour near it.
    const blue = await colorOn(page, PREVIEW, BLUE);
    expect(blue.count).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });

  test("the Highlights button and the palette command toggle the overlay", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPreview(page);
    await expect(overlay(page)).toHaveCount(1);

    await toggle(page).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(legend(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    await runPaletteCommand(page, "History: Toggle change highlights");
    await expect(overlay(page)).toHaveCount(1);
    await expect(legend(page)).toContainText("Changed since 1");
    await expectOverlay(page, CHANGED, true);

    await runPaletteCommand(page, "History: Toggle change highlights");
    await expect(overlay(page)).toHaveCount(0);

    await toggle(page).click();
    await expect(overlay(page)).toHaveCount(1);
    await expectOverlay(page, ONLY_IN_VERSION, true);
    expect(errors).toEqual([]);
  });

  test("panning and zooming the preview redraws the overlay without errors", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openPreview(page);
    await expectOverlay(page, ONLY_IN_VERSION, true);
    const box = (await preview(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const before = await overlayColor(page, ONLY_IN_VERSION);
    await page.mouse.wheel(0, 120); // vertical pan
    await expect
      .poll(async () => (await overlayColor(page, ONLY_IN_VERSION)).y)
      .not.toBeCloseTo(before.y, 0);
    // Still on the shape after the pan.
    await expect
      .poll(async () =>
        near(
          await overlayColor(page, ONLY_IN_VERSION),
          await colorOn(page, PREVIEW, GRAPE),
        ),
      )
      .toBe(true);

    const panned = await overlayColor(page, ONLY_IN_VERSION);
    await page.keyboard.down("Meta");
    await page.mouse.wheel(0, -200); // zoom
    await page.keyboard.up("Meta");
    await expect
      .poll(async () => (await overlayColor(page, ONLY_IN_VERSION)).count)
      .not.toBe(panned.count);
    await expect
      .poll(async () =>
        near(
          await overlayColor(page, CHANGED),
          await colorOn(page, PREVIEW, ORANGE),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
});

test("history.highlight_changes off starts the preview without highlights", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(
    ([key]) => {
      if (!window.sessionStorage.getItem("hl-seeded")) {
        window.localStorage.setItem(
          key as string,
          JSON.stringify({ historyHighlightChanges: false }),
        );
        window.sessionStorage.setItem("hl-seeded", "1");
      }
    },
    [PREFS_KEY] as const,
  );
  await setup(page, CURRENT, [VERSION]);
  await openPreview(page);
  await expect(overlay(page)).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  // One click turns them on.
  await toggle(page).click();
  await expect(overlay(page)).toHaveCount(1);
  await expectOverlay(page, CHANGED, true);
  expect(errors).toEqual([]);
});
