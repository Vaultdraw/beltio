import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// [layout] and user commands, reached by clicking visible UI only: the
// Header switch in Settings → Interface hides the header; a [commands]
// entry shows up as a command on the Hotkeys page.
const PREFS_KEY = "excalidraw-vault-preferences-v1";
const dialog = (page: Page) => page.getByRole("dialog");

const openSettingsPage = async (page: Page, tab: string) => {
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("tab", { name: tab }).click();
};

test("layout: the Header switch hides the header; user commands are listed", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(
    ([key, value]) => {
      if (!window.sessionStorage.getItem("layout-seeded")) {
        window.localStorage.setItem(key, JSON.stringify(value));
        window.sessionStorage.setItem("layout-seeded", "1");
      }
    },
    [
      PREFS_KEY,
      {
        userCommands: {
          "zoom-twice": {
            title: "Zoom in twice",
            run: ["view.zoomIn", "view.zoomIn"],
          },
        },
      },
    ] as const,
  );
  await openVault(page);
  const header = page.locator("header.vault-header");
  await expect(header).toBeVisible();

  await openSettingsPage(page, "Interface");
  const row = dialog(page).locator('[data-setting-id="layout-header"]');
  await row.scrollIntoViewIfNeeded();
  await row.locator("label.vault-switch").click();
  await expect(header).toHaveCount(0);

  await dialog(page).getByRole("tab", { name: "Hotkeys" }).click();
  await expect(dialog(page).getByText("Zoom in twice")).toBeVisible();

  await dialog(page).getByRole("button", { name: "Close settings" }).click();
  await expect(header).toHaveCount(0);
  expect(errors).toEqual([]);
});
