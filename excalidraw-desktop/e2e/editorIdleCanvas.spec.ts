import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault } from "./helpers";

// The interactive canvas drops its backing store to 1x1 after 2 s with nothing
// to draw and gets it back before the next non-empty frame.

const interactive = (page: Page) =>
  page.locator(".vault-editor canvas.interactive");

const widthOf = (page: Page) =>
  interactive(page).evaluate((c: HTMLCanvasElement) => c.width);

/** Number of non-transparent pixels on the interactive canvas. */
const paintedPixels = (page: Page) =>
  interactive(page).evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) {
        n++;
      }
    }
    return n;
  });

test("interactive canvas is 1 px wide when idle and full size with a selection", async ({
  page,
}) => {
  await openVault(page, "?seed=search");
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  const cssWidth = await interactive(page).evaluate(
    (c: HTMLCanvasElement) => c.getBoundingClientRect().width,
  );
  const box = await canvasBox(page);

  // idle, nothing selected
  await page.mouse.click(box.x + 3, box.y + box.height - 3);
  await page.keyboard.press("Escape");
  await expect.poll(() => widthOf(page), { timeout: 6000 }).toBe(1);
  // layout and hit-testing are unchanged
  expect(
    await interactive(page).evaluate(
      (c: HTMLCanvasElement) => c.getBoundingClientRect().width,
    ),
  ).toBe(cssWidth);

  // draw a rectangle: the canvas is full size while it is selected, and the
  // selection is visible
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.5;
  const y0 = box.y + box.height * 0.5;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 80, y0 + 50, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
  await expect.poll(() => widthOf(page)).toBeGreaterThan(1);
  await expect.poll(() => paintedPixels(page)).toBeGreaterThan(100);
  await page.waitForTimeout(2600);
  expect(await widthOf(page)).toBeGreaterThan(1);

  // deselect: shrinks again
  await page.mouse.click(box.x + 3, box.y + box.height - 3);
  await expect.poll(() => widthOf(page), { timeout: 6000 }).toBe(1);

  // cost of the restore at 2560x1700
  const ms = await interactive(page).evaluate((c: HTMLCanvasElement) => {
    const t0 = performance.now();
    c.width = 2560;
    c.height = 1700;
    const ctx = c.getContext("2d")!;
    ctx.fillRect(0, 0, 10, 10);
    ctx.getImageData(0, 0, 1, 1);
    return performance.now() - t0;
  });
  // eslint-disable-next-line no-console
  console.log(`RESTORE_2560x1700_MS ${ms.toFixed(2)}`);
});
