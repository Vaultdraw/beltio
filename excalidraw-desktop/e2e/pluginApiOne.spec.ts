import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";
import { openVault, trackErrors } from "./helpers";

// API 1.0 through visible UI: a plugin loads from the palette, and its settings page (Settings,
// Plugins, the plugin's Settings button) changes what the plugin does.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const modal = (page: Page) => page.locator(".vault-settings-modal");

test("a plugin loads, and its settings page changes what its command does", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=hello");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);

  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("say hello");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Hello from a plugin")).toBeVisible();

  await page.keyboard.press("Meta+Comma");
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole("tab", { name: "Plugins" }).click();
  await modal(page).getByRole("button", { name: "Hello settings" }).click();
  const field = modal(page).getByRole("textbox", { name: "Greeting" });
  await field.fill("Howdy");
  await field.press("Enter");
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("say hello");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Howdy from a plugin")).toBeVisible();
  expect(errors).toEqual([]);
});
