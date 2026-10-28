import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";

test("Settings → Interface → Memory: the low-memory canvas switch is off by default and saves", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Interface" }).click();

  const row = dialog.locator('[data-setting-id="memory-low-memory-canvas"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("about 100 MB less memory");
  await expect(row).toContainText("60 frames per second");
  const toggle = row.getByRole("switch");
  await expect(toggle).not.toBeChecked();
  const restart = row.getByRole("button", { name: "Restart now" });
  await expect(restart).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  // The running canvases still use the old value: a restart applies it.
  await expect(restart).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        (key) =>
          JSON.parse(window.localStorage.getItem(key) ?? "{}")
            .memoryLowMemoryCanvas,
        PREFS_KEY,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
