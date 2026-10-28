import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";
import { live, seedAndOpen, toScene } from "./pageHelpers";

// toimprove #37: right-click the empty canvas -> "Import file…" -> pick a file.
// An image lands at the right-clicked point; a PDF opens the import dialog.

const DRAWING = "Import.excalidraw";

const png = async (page: Page) =>
  Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 100;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#1971c2";
      ctx.fillRect(0, 0, 160, 100);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );

/** Right-click the canvas at (x, y) and pick `file` from "Import file…". */
const importAt = async (
  page: Page,
  x: number,
  y: number,
  file: { name: string; mimeType: string; buffer: Buffer },
) => {
  await page.mouse.click(x, y, { button: "right" });
  const item = page.locator(".context-menu").getByRole("button", {
    name: "Import file…",
  });
  await expect(item).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await item.click();
  await (await chooser).setFiles(file);
};

test("right-click canvas → Import file… inserts an image there, or opens the PDF dialog", async ({
  page,
}) => {
  await openVault(page);
  await seedAndOpen(page, DRAWING);
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  const at = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.4 };
  const scene = await toScene(page, at.x, at.y);

  await importAt(page, at.x, at.y, {
    name: "photo.png",
    mimeType: "image/png",
    buffer: await png(page),
  });
  const image = async () =>
    (await live(page)).elements.find((e) => e.type === "image");
  await expect
    .poll(async () => (await image())?.width, { timeout: 10000 })
    .toBe(160);
  const el = (await image())!;
  // Centred on the right-clicked point.
  expect(Math.abs(el.x + el.width / 2 - scene.x)).toBeLessThan(2);
  expect(Math.abs(el.y + el.height / 2 - scene.y)).toBeLessThan(2);

  await importAt(page, at.x + 300, at.y, {
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  const dialog = page.getByRole("dialog", { name: "Import PDF" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("notes.pdf");
});
