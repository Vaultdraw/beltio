import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

const outline = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`;
  });

test("Settings → Appearance → CSS snippets: a switch applies and removes the snippet", async ({
  page,
}) => {
  await openVault(page, "?snippets=1");
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Appearance", exact: true }).click();

  const row = dialog.getByTestId("settings-snippets");
  await expect(row).toBeVisible();
  await expect(row.getByText("red-outline", { exact: true })).toBeVisible();
  await expect(row.getByText("wide-sidebar", { exact: true })).toBeVisible();

  const toggle = row.getByRole("switch", {
    name: "Enable snippet red-outline",
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => outline(page)).toBe("3px solid rgb(255, 0, 0)");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () => (await outline(page)).startsWith("3px solid"))
    .toBe(false);
});
