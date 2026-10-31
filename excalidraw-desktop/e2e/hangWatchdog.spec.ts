import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";

// The watchdog runs on macOS only; elsewhere Settings does not show its rows (toimprove 307).
test.skip(process.platform !== "darwin", "the Hang watchdog is macOS only");

test("Settings > Interface: the Hang watchdog switch is on, turns off and is saved", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { name: "Interface" }).click();

  const row = page.getByTestId("setting-watchdog-enabled");
  const toggle = row.getByRole("switch");
  await expect(row).toContainText("Hang watchdog");
  await expect(toggle).toBeChecked();

  await row.locator(".vault-switch").click();
  await expect(toggle).not.toBeChecked();

  const saved = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"),
    PREFS_KEY,
  );
  expect(saved.watchdogEnabled).toBe(false);
  expect(errors).toEqual([]);
});
