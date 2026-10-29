import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";

// Hunter B round 3: Escape and focus when overlays stack (Settings, palette, tab menu, text editing).
const palette = (p: Page) => p.getByRole("dialog", { name: "Command palette" });
const start = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

test("hunter B: Tab inside the palette never reaches the page behind it", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[role='dialog']"),
      ),
    ).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[role='dialog']"),
      ),
    ).toBe(true);
  }
});

test("hunter B: Escape while a tab menu is open closes only the menu", async ({
  page,
}) => {
  await start(page);
  await page.locator("[role='tab']").first().click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".vault-editor")).toBeVisible();
});
