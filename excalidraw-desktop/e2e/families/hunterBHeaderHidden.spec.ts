import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";
import { runCommand } from "../pageHelpers";

// Hunter B round 3 (B-4): anything the header hosts disappears with the header.
test.fixme(
  "hunter B: Offline mode stays visible with the header hidden",
  async ({ page }) => {
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");
    await runCommand(page, "Offline mode: on or off");
    await expect(page.getByTestId("offline-badge")).toBeVisible();
    await runCommand(page, "Layout: Toggle header");
    await expect(page.locator("header.vault-header")).toHaveCount(0);
    // Expected (Obsidian shows its status in the status bar): some visible Offline indicator remains.
    await expect(page.getByTestId("offline-badge")).toBeVisible();
  },
);
