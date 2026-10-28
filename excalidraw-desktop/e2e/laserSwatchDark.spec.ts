import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// #38: the canvas never theme-filters the laser trail, so in dark mode the
// Settings laser swatch must show the configured colour as is.
test("dark Tools > Laser: the swatch and preview show the real laser colour", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await dialog.getByRole("tab", { name: "Tools", exact: true }).click();
  await dialog
    .getByRole("tablist", { name: "Tools" })
    .getByRole("tab", { name: "Laser" })
    .click();
  const panel = dialog.getByTestId("tools-laser");
  // #1971c2 is a colour the dark filter would visibly change.
  const swatch = panel.getByRole("radio", { name: "Laser colour #1971c2" });
  await swatch.click();
  await expect(swatch).toHaveAttribute("aria-checked", "true");

  const bg = await swatch.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(bg).toBe("rgb(25, 113, 194)");
  const preview = await panel
    .getByTestId("tool-preview-laser")
    .locator("circle")
    .evaluate((el) => getComputedStyle(el).fill);
  expect(preview).toBe(bg);
});
