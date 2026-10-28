import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

test("Settings > About shows the version and the help links", async ({
  page,
}) => {
  const errors = trackErrors(page);
  // Browser preview opens links with window.open: capture it, no network.
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = (url) => {
      (window as any).__opened.push(String(url));
      return null;
    };
  });
  await openVault(page);

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "About" }).click();

  await expect(page.getByTestId("about-page")).toBeVisible();
  await expect(page.getByTestId("about-version")).toHaveText(
    /^Version \d+\.\d+\.\d+/,
  );
  for (const name of [
    "Website",
    "Documentation",
    "Report a bug",
    "Request a feature",
    "Source code",
  ]) {
    await expect(dialog.getByRole("button", { name })).toBeVisible();
  }

  // A link opens the browser, never navigates the app.
  await dialog.getByRole("button", { name: "Report a bug" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__opened[0] ?? ""))
    .toContain("https://github.com/Vaultdraw/vaultdraw/issues/new?title=");
  expect(errors).toEqual([]);
});
