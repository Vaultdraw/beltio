import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

const settingsModal = (page: import("@playwright/test").Page) =>
  page.locator(".vault-settings-modal");

test.describe("Settings > Files", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page);
    await page.keyboard.press("Meta+Comma");
    await expect(settingsModal(page)).toBeVisible();
    await page.getByRole("tab", { name: "Files" }).click();
  });

  test("one autosave stepper changes the delay with the arrow keys", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const stepper = page.getByRole("spinbutton", { name: "Autosave delay" });
    await expect(stepper).toBeVisible();
    await expect(page.locator(".vault-range")).toHaveCount(0);
    await stepper.focus();
    await page.keyboard.press("Home");
    await expect(stepper).toHaveAttribute("aria-valuenow", "200");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(stepper).toHaveAttribute("aria-valuenow", "300");
    await page.keyboard.press("ArrowDown");
    await expect(stepper).toHaveAttribute("aria-valuenow", "250");
    await page.getByRole("button", { name: "Decrease Autosave delay" }).click();
    await expect(stepper).toHaveAttribute("aria-valuenow", "200");
    await expect(
      page.getByRole("button", { name: "Decrease Autosave delay" }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("the Recovery section shows the crash store and reveals it", async ({
    page,
  }) => {
    await expect(
      settingsModal(page).getByRole("heading", { name: "Recovery" }),
    ).toBeVisible();
    const row = settingsModal(page).locator(
      '[data-setting-id="recovery-store"]',
    );
    await expect(row).toContainText("Crash recovery store");
    await expect(row.locator(".vault-files-path")).toContainText(
      ".excalidraw-vault/recovery",
    );
    await page.evaluate(() => {
      const repo = (window as any).__vaultRepo;
      (window as any).__recoveryReveals = 0;
      repo.revealRecovery = async () => {
        (window as any).__recoveryReveals++;
      };
    });
    await row.getByRole("button", { name: "Reveal recovery folder" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__recoveryReveals))
      .toBe(1);
  });

  test("Reveal on the vault folder row, and the trash confirmation switch", async ({
    page,
  }) => {
    const row = settingsModal(page).locator('[data-setting-id="vault-folder"]');
    await expect(
      row.getByRole("button", { name: "Reveal vault folder" }),
    ).toBeVisible();
    const confirm = page.getByRole("switch", {
      name: "Confirm before trashing",
    });
    await expect(confirm).toBeChecked();
    await confirm.focus();
    await page.keyboard.press("Space");
    await expect(confirm).not.toBeChecked();
  });
});
