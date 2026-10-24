import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// Each setting says where its value comes from. A change made in Settings wins and
// the chip names the config.toml value it hides; one click puts that value back.
test("a setting's chip names its source, the value it hides, and resets to config.toml", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { interface: { thumbnails: false } };
  });
  await openVault(page, "?config=1");

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Interface" }).click();
  const row = dialog.locator('[data-setting-id="thumbnails"]');
  const toggle = row.getByRole("switch", { name: /Show drawing thumbnails/ });
  const chip = row.getByRole("button", { name: /^Value from/ });

  // config.toml sets it: the chip says so.
  await expect(toggle).not.toBeChecked();
  await expect(chip).toHaveText("config.toml");

  // Change it in Settings: overrides wins, and the chip says what it hides.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(chip).toContainText("overrides");
  await chip.click();
  await expect(row.getByRole("group", { name: "Value source" })).toContainText(
    "config.toml says false",
  );

  // Reset to the config.toml value: the value and the chip go back.
  await row.getByRole("button", { name: "Reset to config.toml value" }).click();
  await expect(toggle).not.toBeChecked();
  await expect(chip).toHaveText("config.toml");
  expect(errors).toEqual([]);
});
