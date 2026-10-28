import { expect } from "@playwright/test";

import { test } from "./fixture";

import {
  clickMainMenuItem,
  openDrawing,
  openVault,
  trackErrors,
} from "./helpers";

// Focus mode, reached by clicking: the editor's main menu entry hides the
// navigator, header and footer; Esc brings them back.
test("focus mode: the menu entry hides the chrome, Esc restores it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const header = page.locator("header.vault-header");
  const navigator = page.getByLabel("Vault File Navigator");
  await expect(header).toBeVisible();
  await expect(navigator).toBeVisible();

  await clickMainMenuItem(page, "Focus mode");
  await expect(header).toHaveCount(0);
  await expect(navigator).toBeHidden();
  // The canvas and the drawing toolbar stay.
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
  await expect(page.locator(".App-toolbar").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(header).toBeVisible();
  await expect(navigator).toBeVisible();
  expect(errors).toEqual([]);
});
