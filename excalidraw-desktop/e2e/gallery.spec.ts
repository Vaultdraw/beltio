import { test } from "./fixture";

import { openDrawing, openVault, SHOTS } from "./helpers";

// Visual review gallery (not assertions): captures each main screen.
test.describe("gallery", () => {
  test.skip(({ browserName }) => browserName !== "webkit", "webkit only");
  for (const theme of ["light", "dark"]) {
    test(`screens ${theme}`, async ({ page }) => {
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      await openVault(page);
      await page.screenshot({ path: `${SHOTS}/gallery-${theme}-1-home.png` });
      await page
        .locator(".vault-tree-item__name", { hasText: "DSA" })
        .first()
        .click();
      await page
        .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
        .first()
        .click();
      await openDrawing(page, "Graphs");
      await page.screenshot({ path: `${SHOTS}/gallery-${theme}-2-editor.png` });
      await page
        .locator(".vault-tree-item", { hasText: "Graphs" })
        .first()
        .hover();
      await page.screenshot({ path: `${SHOTS}/gallery-${theme}-3-hover.png` });
      await page.getByTestId("main-menu-trigger").click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/gallery-${theme}-4-menu.png` });
      await page.getByRole("menuitem", { name: "Vault settings" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${SHOTS}/gallery-${theme}-5-settings.png`,
      });
    });
  }
  test("onboarding", async ({ page }) => {
    await page.goto("/e2e.html");
    await page.evaluate(() => {
      (window as any).__vaultRepo.reopenVault = async () => null;
    });
    await page.screenshot({ path: `${SHOTS}/gallery-onboarding.png` });
  });
});
