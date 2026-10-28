import { expect, test } from "@playwright/test";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";

// Wiring smoke only (dock, links-aware rename, Cmd+click create prompt).
// The full links spec lives in links.spec.ts.
test("dock lists backlinks and a rename rewrites links", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=links");
  await openDrawing(page, "Alpha");

  await page.keyboard.press("Meta+Alt+b");
  const dock = page.locator(".vault-links");
  await expect(dock).toBeVisible();
  await expect(dock).toContainText("Hub");
  await expect(dock).toContainText("Inner");

  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^Alpha$/ }),
    })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New name").fill("Beta");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => (window as any).__vaultLinks.settled());
  await expect
    .poll(async () => {
      const scene = await readScene(page, "Hub.excalidraw");
      return scene.elements.map((e: any) => e.originalText ?? e.link).join("|");
    })
    .toContain("[[Beta]]");
  expect(errors).toEqual([]);
});

// Data safety never depends on an extension: with `[extensions] links` off, a
// rename still rewrites the links that point to the renamed drawing.
test("links extension off: a rename still rewrites links", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=links");
  await page.getByTestId("activity-bar-settings").click();
  const settings = page.locator(".vault-settings-modal");
  await settings.getByRole("tab", { name: "Extensions" }).click();
  const row = page.getByTestId("extension-row-links");
  await row.locator(".vault-switch").click();
  await expect(row.getByRole("switch")).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-settings-modal")).toHaveCount(0);

  const tree = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^Alpha$/ }),
    })
    .first();
  await tree.hover();
  await tree.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New name").fill("Beta");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(async () => {
      const scene = await readScene(page, "Hub.excalidraw");
      return scene.elements.map((e: any) => e.originalText ?? e.link).join("|");
    })
    .toContain("[[Beta]]");
  expect(errors).toEqual([]);
});
