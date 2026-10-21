import { expect, test } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";

// The trail layer (laser, lasso, eraser) is a fixed full-window element; an
// idle one costs a composited backing store plus the layers of everything
// overlapping it (src/editor/compositing.css). It must be out of layout while
// empty and back while a trail is drawn.
test("trail layer is hidden while idle and shown while the laser draws", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  const layer = page.locator(".excalidraw .SVGLayer");
  const display = () => layer.evaluate((el) => getComputedStyle(el).display);
  await expect.poll(display).toBe("none");

  // The interactive canvas is 1x1 while idle; aim at the static one's box.
  const box = (await page
    .locator(".vault-editor canvas.static")
    .boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height - 40);
  await page.keyboard.press("k");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(
      box.x + box.width / 2 + i * 12,
      box.y + box.height / 2 + i * 6,
    );
  }
  await expect(layer.locator("svg path")).not.toHaveCount(0);
  expect(await display()).toBe("block");
  const rect = await layer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(rect.w).toBeGreaterThan(0);
  expect(rect.h).toBeGreaterThan(0);
  await page.mouse.up();

  // The trail fades out, then the layer leaves layout again.
  await expect.poll(display, { timeout: 10_000 }).toBe("none");
});
