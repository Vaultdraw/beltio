import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// What you change in Settings is saved apart from config.toml and wins over
// it: it survives a Reload, and a broken overrides file is named without
// losing the value.
test("a Settings change wins over config.toml, survives Reload, and a broken overrides.toml is named", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { interface: { thumbnails: false } };
  });
  await openVault(page, "?config=1");

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Interface" }).click();
  const toggle = dialog.getByRole("switch", {
    name: /Show drawing thumbnails/,
  });
  // config.toml says off.
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();

  // Reload reads both files again: the Settings change still wins.
  await dialog.getByRole("tab", { name: "General" }).click();
  await expect(dialog.getByText("/e2e/state/overrides.toml")).toBeVisible();
  const reload = dialog.getByRole("button", { name: "Reload" });
  await reload.click();
  await dialog.getByRole("tab", { name: "Interface" }).click();
  await expect(toggle).toBeChecked();

  // overrides.toml breaks: the problem names the file, the value stays.
  await page.evaluate(() => {
    (window as any).__e2eOverridesBroken = "expected a value";
  });
  await dialog.getByRole("tab", { name: "General" }).click();
  await reload.click();
  const problems = dialog.getByRole("list", {
    name: "Problems in config files",
  });
  await expect(problems.getByRole("listitem")).toHaveText([
    "overrides.toml line 2: expected a value",
  ]);
  await dialog.getByRole("tab", { name: "Interface" }).click();
  await expect(toggle).toBeChecked();
  expect(errors).toEqual([]);
});
