import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Per-vault theme, reached by clicking only: in Settings → Appearance with
// the "This vault" scope, picking Dark mode changes the app at once and is
// marked Overridden; the global scope still shows the global value; Reset to
// global brings the global look back.
const dialog = (page: Page) => page.getByRole("dialog");
const row = (page: Page, id: string) =>
  dialog(page).locator(`[data-setting-id="${id}"]`);
const radio = (page: Page, name: "Global" | "This vault") =>
  dialog(page)
    .getByRole("radiogroup", { name: "Settings scope" })
    .getByRole("radio", { name });
const html = (page: Page) => page.locator("html");

test("per-vault theme: Dark mode for this vault only, then back to global", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await openVault(page);
  await expect(html(page)).not.toHaveClass(/\bdark\b/);

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await dialog(page)
    .getByRole("tab", { name: "Appearance", exact: true })
    .click();
  await radio(page, "This vault").click();
  await expect(radio(page, "This vault")).toBeChecked();

  const mode = row(page, "mode");
  await expect(mode).toContainText("Inherited from global");
  await mode.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(mode).toContainText("Overridden");
  await expect(html(page)).toHaveClass(/\bdark\b/);

  // The global value is unchanged.
  await radio(page, "Global").click();
  await expect(
    row(page, "mode").getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(html(page)).toHaveClass(/\bdark\b/);

  await radio(page, "This vault").click();
  await row(page, "mode")
    .getByRole("button", { name: /^Reset .* to global$/ })
    .click();
  await expect(row(page, "mode")).toContainText("Inherited from global");
  await expect(html(page)).not.toHaveClass(/\bdark\b/);
  expect(errors).toEqual([]);
});
