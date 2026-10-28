import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

// toimprove #41: Home > Recent thumbnails are crisp (device-pixel density) and
// show the whole drawing with padding (no crop, no bitmap upscaling).
test("home recent thumbnails are crisp and show the whole drawing", async ({
  page,
}) => {
  await openVault(page, "?scene=fit&thumbs=1");
  const recent = page.getByRole("region", { name: "Recent drawings" });
  const tile = recent.getByRole("button", { name: /Atools/ });
  await expect(tile).toBeVisible();
  const img = tile.locator("img.vault-thumb");
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  const m = await img.evaluate((el: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = c.width;
    let minY = c.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const box = el.getBoundingClientRect();
    return {
      w: c.width,
      h: c.height,
      cssW: box.width,
      dpr: window.devicePixelRatio,
      ink: { minX, minY, maxX, maxY },
    };
  });
  // Crisp: at least one image pixel per device pixel of the tile.
  expect(m.w).toBeGreaterThanOrEqual(Math.floor(m.cssW * m.dpr));
  // The 4:3 tile box, so object-fit never upscales a small drawing.
  expect(m.w / m.h).toBeCloseTo(4 / 3, 2);
  // Whole word visible: ink present and clear of every edge (padding).
  expect(m.ink.maxX).toBeGreaterThan(m.ink.minX);
  const margin = m.h * 0.05;
  expect(m.ink.minX).toBeGreaterThan(margin);
  expect(m.ink.minY).toBeGreaterThan(margin);
  expect(m.ink.maxX).toBeLessThan(m.w - margin);
  expect(m.ink.maxY).toBeLessThan(m.h - margin);
  // Not zoomed in: a short word stays well under the tile width.
  expect((m.ink.maxX - m.ink.minX) / m.w).toBeLessThan(0.6);
});

// Opt-in visual before/after of the thumbnail fit cases (not assertions):
//   THUMB_FIT_SHOTS=<dir> npx playwright test e2e/thumbnailFit.spec.ts -g shots
test("thumbnail fit shots", async ({ page }) => {
  const dir = process.env.THUMB_FIT_SHOTS;
  test.skip(!dir, "set THUMB_FIT_SHOTS=<dir>");
  await page.setViewportSize({ width: 1200, height: 800 });
  await openVault(page, "?scene=fit&thumbs=1");
  const recent = page.getByRole("region", { name: "Recent drawings" });
  await expect(recent.locator("img.vault-thumb")).toHaveCount(5, {
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await recent.screenshot({
    path: `${dir}/${process.env.THUMB_FIT_TAG ?? "shot"}-home-recent.png`,
  });
});
