import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Settings → General → Backup: press "Back up vault…" and see the finished notice that names
// the zip. (The native side is the config harness's fake; the zip itself is tested in Rust.)
test("a backup is started from Settings and its result is shown", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?config=1");

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "General" }).click();
  await dialog.getByRole("button", { name: "Back up vault…" }).click();

  await expect(
    page.getByText("Backup written: /backups/vault backup 2026-10-28.zip"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Restore from backup…" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
