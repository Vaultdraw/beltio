import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// Settings → General → Profile: make a profile from visible buttons, see it become the
// active one, switch back to default, delete it after a confirmation.
test("a profile is created, switched and deleted from Settings", async ({
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
  const select = dialog.getByLabel("Profile", { exact: true });
  await expect(select).toHaveValue("default");

  await dialog.getByRole("button", { name: "New profile" }).click();
  const form = page.getByRole("dialog", { name: "New profile" });
  await form.getByLabel("Profile name").fill("work");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(select).toHaveValue("work");

  await select.selectOption("default");
  await expect(select).toHaveValue("default");

  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "work" }).click();
  await page.getByRole("button", { name: "Delete profile" }).click();
  await expect(select.locator("option")).toHaveText(["default"]);
  expect(errors).toEqual([]);
});
