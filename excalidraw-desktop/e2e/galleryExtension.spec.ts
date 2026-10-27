import { expect, test } from "@playwright/test";

import { trackErrors } from "./helpers";
import { openTagsVault } from "./tagsHelpers";

// The Gallery is an official extension, reached by clicking: its activity bar button opens the
// grid; Settings > Extensions switches it off (button gone) and on (button back, grid opens).
test("Gallery extension: the button opens the grid, the Extensions switch removes and restores it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  const button = page.getByTestId("activity-bar-gallery");
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await button.click();
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);

  const toggle = async () => {
    await page.getByTestId("activity-bar-settings").click();
    const settings = page.locator(".vault-settings-modal");
    await settings.getByRole("tab", { name: "Extensions" }).click();
    const row = page.getByTestId("extension-row-gallery");
    await row.locator(".vault-switch").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".vault-settings-modal")).toHaveCount(0);
  };
  await toggle();
  await expect(button).toHaveCount(0);
  await toggle();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  expect(errors).toEqual([]);
});
