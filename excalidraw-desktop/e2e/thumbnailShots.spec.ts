import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, SHOTS } from "./helpers";

// Visual review of the thumbnail surfaces (not assertions), opt-in:
//   THUMB_SHOTS=1 npx playwright test e2e/thumbnailShots.spec.ts
test.describe("thumbnail shots", () => {
  test.skip(process.env.THUMB_SHOTS !== "1", "set THUMB_SHOTS=1");
  for (const theme of ["light", "dark"]) {
    test(`surfaces ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      await openVault(page, "?seed=search&thumbs=1");
      const thumbs = page.locator("img.vault-thumb");
      await expect(thumbs.first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/thumbs-${theme}-1-home.png` });

      await page.keyboard.press("Meta+Alt+KeyE");
      await expect(page.getByRole("grid", { name: /Gallery/ })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("gallery-count")).toHaveText("3 items");
      await expect(
        page.getByTestId("gallery-view").locator("img.vault-thumb").first(),
      ).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${SHOTS}/thumbs-${theme}-2-gallery.png`,
      });
      await page.keyboard.press("Escape");

      await page.keyboard.press("Meta+p");
      await page.keyboard.type("graph");
      await page.waitForTimeout(800);
      await page.screenshot({
        path: `${SHOTS}/thumbs-${theme}-3-palette.png`,
      });
      await page.keyboard.press("Escape");

      await page.keyboard.press("Meta+Shift+KeyF");
      await page.keyboard.type("dijkstra");
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/thumbs-${theme}-4-search.png` });
    });
  }
});
