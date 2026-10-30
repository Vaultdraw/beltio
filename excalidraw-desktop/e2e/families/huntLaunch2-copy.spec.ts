import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 2 [launch] [shell]: the Control page's AI row promises "fully offline" while the
// network is on by default (update check, theme and plugin lists, web pictures). Offline mode is
// the switch that does that. toimprove 286.
test("toimprove 286: Settings > Control, the AI row does not claim to keep the device fully offline", async ({
  page,
}) => {
  await openVault(page);
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Control", exact: true }).click();
  const row = dialog.locator(".vault-setting-row", { hasText: "AI" }).first();
  await expect(row).toBeVisible();
  // Offline mode is a different switch, off by default: the claim is false.
  await expect(dialog.getByText(/fully offline/)).toHaveCount(0);
});
