import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Settings → General → Check shows the config check report in a dialog, with
// Copy and Close.
test("Check in Settings shows the config report, Copy confirms, Close dismisses", async ({
  page,
  context,
}) => {
  await context
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => undefined);
  const errors = trackErrors(page);
  const line =
    "config.toml:3:1: warning: unknown key interface.zom (did you mean interface.zoom?)";
  await page.addInitScript((text) => {
    (window as any).__e2eCheck = {
      ok: true,
      errors: 0,
      warnings: 1,
      text: `${text}\n1 warning in 1 file`,
      files: [],
      problems: [],
    };
  }, line);
  await openVault(page, "?config=1");

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog").first();
  await settings.getByRole("tab", { name: "General" }).click();
  await settings.getByRole("button", { name: "Check", exact: true }).click();

  const report = page.getByRole("dialog", { name: "Config check" });
  await expect(report.locator("pre")).toContainText(line);

  await report.getByRole("button", { name: "Copy" }).click();
  await expect(report.getByRole("status")).toHaveText("Copied");

  await report
    .locator(".vd-dialog__footer")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(report).toHaveCount(0);
  expect(errors).toEqual([]);
});
