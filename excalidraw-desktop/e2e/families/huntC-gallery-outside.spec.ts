import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault } from "../helpers";

// Hunter C (2026-10-30, C-6, fixed in gridWindow.sameWindow): the gallery (thumbnails of every drawing) open while the vault changes
// outside. Obsidian's file views (bases, graph, search) follow the file system at once.

const outside = (page: Page, change: object) =>
  page.evaluate((c) => (window as any).__vaultRepo.outside(c), change);

test("the gallery follows drawings created, renamed and deleted outside", async ({
  page,
}) => {
  await openVault(page);
  await page.getByTestId("activity-bar-gallery").click();
  const view = page.getByTestId("gallery-view");
  await expect(view).toBeVisible();
  await expect(view).toContainText("DSA");
  await outside(page, { op: "create", path: "Brand new.excalidraw" });
  await expect(view).toContainText("Brand new", { timeout: 8000 });
  await outside(page, {
    op: "rename",
    path: "Brand new.excalidraw",
    to: "Renamed one.excalidraw",
  });
  await expect(view).toContainText("Renamed one", { timeout: 8000 });
  await expect(view).not.toContainText("Brand new");
  await outside(page, { op: "delete", path: "Renamed one.excalidraw" });
  await expect(view).not.toContainText("Renamed one", { timeout: 8000 });
});
