import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";
import { live, toClient } from "./pageHelpers";

// toimprove #35: a pasted/dropped image resizes from its corner. Image handles
// sit centred on the corner, and grabbing just outside it used to move the
// image; the ring around a selected image now resizes it.

const dropImage = (page: Page) =>
  page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 120;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#e8590c";
    ctx.fillRect(0, 0, 200, 120);
    const blob = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), "image/png"),
    );
    // WebKit drops clipboardData from synthetic paste events; a drop goes
    // through the same image insertion, so it stands in for the paste.
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([blob], "pasted.png", { type: "image/png" }),
    );
    const target = document.querySelector(".vault-editor .excalidraw")!;
    const r = target.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const t of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(t, init));
    }
  });

const image = async (page: Page) =>
  (await live(page)).elements.find((e) => e.type === "image");

test("an inserted image resizes when its corner is dragged", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await dropImage(page);
  // Wait for the decoded size (the placeholder is 100x100).
  await expect
    .poll(async () => (await image(page))?.width, { timeout: 10000 })
    .toBe(200);
  const before = (await image(page))!;

  const centre = await toClient(
    page,
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.click(centre.x, centre.y);
  // Grab just outside the bottom-right corner, where users aim.
  const corner = await toClient(
    page,
    before.x + before.width,
    before.y + before.height,
  );
  await page.mouse.move(corner.x + 6, corner.y + 6);
  await page.mouse.down();
  await page.mouse.move(corner.x + 66, corner.y + 66, { steps: 8 });
  await page.mouse.up();

  const after = (await image(page))!;
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  expect(after.width).toBeGreaterThan(before.width + 30);
  expect(after.height).toBeGreaterThan(before.height + 15);
});
