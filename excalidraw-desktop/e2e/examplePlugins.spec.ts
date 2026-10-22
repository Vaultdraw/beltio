import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// The sdk/examples plugins through the real UI. Manifests come from each
// example's plugin.toml, modules from sdk/examples/<id>/main.js (see
// fixtures/pluginServer.ts).

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const openVaultWithPlugins = async (page: Page, plugins: string) => {
  await openVault(page, `?plugins=${plugins}`);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
};

test("hello-command: palette and hotkey show the greeting toast", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVaultWithPlugins(page, "hello-command");
  const toast = page.getByText("Hello, Vaultdraw!");

  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("say hello");
  await expect(palette(page).getByRole("option").first()).toContainText(
    "Hello: say hello",
  );
  await page.keyboard.press("Enter");
  await expect(toast).toBeVisible();

  // Wait for the first toast to go away, so the hotkey must show a new one.
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
  await page.keyboard.press("ControlOrMeta+Alt+Shift+KeyH");
  await expect(toast).toBeVisible();
  expect(errors).toEqual([]);
});
