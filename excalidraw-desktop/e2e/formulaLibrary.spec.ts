import { expect } from "@playwright/test";

import { test } from "./fixture";

import {
  SRC,
  images,
  inkPixels,
  insertViaPalette,
  openEmpty,
  scene,
} from "./formulaHelpers";
import { trackErrors } from "./helpers";

// A formula added to the library carries its SVG file: the panel shows it,
// the persisted .excalidrawlib has it, and it renders when inserted into
// another drawing.

test("formula in the library: preview, persistence, insert into another drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEmpty(page, "FormulaLib.excalidraw");
  await insertViaPalette(page, SRC);

  // Add to the library through the panel's add tile.
  await page.locator(".default-sidebar-trigger").first().click();
  const personal = page.getByTestId("library-section-personal");
  await expect(personal).toBeVisible();
  const grid = personal.locator("xpath=following-sibling::*[1]");
  await grid.locator(".library-unit__adder").click({ force: true });
  const input = grid.getByTestId("library-item-name-input");
  await input.fill("Integral");
  await input.press("Enter");
  const tile = grid.locator(
    ".library-unit:not(:has(.library-unit__adder)) .library-unit__dragger",
  );
  await expect(tile).toHaveCount(1);

  // The preview shows the formula image (loads, non-zero size).
  const previewImg = tile.locator("svg image").first();
  await expect(previewImg).toBeAttached();
  await expect
    .poll(() =>
      previewImg.evaluate(
        (el) =>
          new Promise<number>((resolve) => {
            const href =
              el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth);
            img.onerror = () => resolve(0);
            img.src = href;
          }),
      ),
    )
    .toBeGreaterThan(0);

  // Persisted with the item (self-contained file).
  const readSaved = () =>
    page.evaluate(() => (window as any).__libraryRepo.getJson("personal"));
  await expect.poll(readSaved).not.toBeNull();
  const saved = (await readSaved()) as string;
  const item = JSON.parse(saved).libraryItems[0];
  const fileId = item.elements.find((e: any) => e.type === "image").fileId;
  expect(item.files[fileId].mimeType).toBe("image/svg+xml");
  expect(item.files[fileId].dataURL.length).toBeLessThan(50_000);

  // Another drawing, which never had the file: insert from the library.
  await page.evaluate(() => {
    const repo = (window as any).__vaultRepo;
    repo.seedDrawing(
      "Other.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      }),
    );
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  });
  await page
    .locator(".vault-tree-item__name", { hasText: "Other" })
    .first()
    .click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(600);
  expect(Object.keys((await scene(page)).files)).toHaveLength(0);

  if (!(await personal.isVisible())) {
    await page.locator(".default-sidebar-trigger").first().click();
  }
  await expect(tile).toHaveCount(1);
  await tile.click();

  await expect.poll(async () => (await images(page)).length).toBe(1);
  const [inserted] = await images(page);
  expect(inserted.fileId).toBe(fileId);
  expect((await scene(page)).files[fileId]).toBeTruthy();
  // inserting closes the (undocked) sidebar
  await expect(personal).toBeHidden();
  await expect
    .poll(async () => (await inkPixels(page, inserted)).length)
    .toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
