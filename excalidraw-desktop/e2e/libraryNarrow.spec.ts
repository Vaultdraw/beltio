import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

/**
 * The library's pending "add" tile only follows the selection while the
 * selection tool is active (any layout). The packaged smoke hit this: an
 * earlier step left a drawing tool active, so Cmd+A produced no tile. Narrow
 * windows (phone layout) behave the same, so cover both.
 */
const pending = (page: Page) =>
  page
    .getByTestId("library-section-personal")
    .locator("xpath=following-sibling::*[1]")
    .locator(".library-unit__pulse");

const key = (page: Page, k: string, chord: boolean) =>
  page.evaluate(
    ([key, withChord]) =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          metaKey: withChord,
          ctrlKey: withChord,
          cancelable: true,
          bubbles: true,
        }),
      ),
    [k, chord] as const,
  );

const sizes = [
  { name: "phone layout", width: 560, height: 800 },
  { name: "desktop layout", width: 1280, height: 850 },
];

for (const { name, width, height } of sizes) {
  test(`select-all with a drawing tool active needs the selection tool first (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openVault(page);
    for (const folder of ["DSA", "Dynamic Programming"]) {
      await page
        .locator(".vault-tree-item__name", { hasText: folder })
        .first()
        .click();
    }
    await openDrawing(page, "Graphs");
    await page.locator("[data-testid='toolbar-rectangle']").first().click();
    await page.locator(".default-sidebar-trigger").first().click();
    await expect(page.getByTestId("library-section-personal")).toBeVisible();

    // Rectangle tool still active: no pending tile (upstream behaviour).
    await key(page, "a", true);
    await page.waitForTimeout(500);
    await expect(pending(page)).toHaveCount(0);

    // The smoke's sequence: selection tool, then select-all.
    await expect(async () => {
      await key(page, "v", false);
      await key(page, "a", true);
      await expect(pending(page)).toHaveCount(1, { timeout: 500 });
    }).toPass({ timeout: 8000 });
  });
}
