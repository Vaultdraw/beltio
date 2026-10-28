import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

const SHOT = "../personal/feature/menu-hotkeys/main-menu.png";
const item = (page: Page, name: string) => page.getByRole("menuitem", { name });
const openMenu = (page: Page) => page.getByTestId("main-menu-trigger").click();

test("main menu shows Vaultdraw hotkeys and follows rebinding", async ({
  page,
}) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");

  await openMenu(page);
  await expect(item(page, /Vault settings/)).toContainText(/(Cmd\+,|Ctrl\+,)/);
  // No default key: nothing shown.
  await expect(item(page, /Save a copy/)).not.toContainText(
    /Cmd|Ctrl|Alt|Option/,
  );
  await page.screenshot({ path: SHOT });
  await page.keyboard.press("Escape");

  // Rebind settings.open on the Hotkeys page, then re-open the menu.
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  await page
    .getByRole("button", { name: "Add hotkey for Open settings", exact: true })
    .click();
  await page.keyboard.press("Meta+Alt+KeyJ");
  // Drop the default chords (mac has a Ctrl alias too): the new one is shown.
  const chips = page
    .locator('.vault-hotkeys__row[data-command-id="settings.open"]')
    .locator(".vault-hotkeys__chip-key");
  while ((await chips.count()) > 1) {
    await chips
      .first()
      .getByRole("button", { name: /^Remove / })
      .click();
  }
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".vault-settings-modal")).toHaveCount(0);

  await openMenu(page);
  await expect(item(page, /Vault settings/)).toContainText(
    /(Cmd\+Option\+J|Ctrl\+Alt\+J)/,
  );
});
