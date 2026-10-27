import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// The overlay-demo example (sdk/examples/overlay-demo) through the real UI: its toolbar button
// shows without loading the plugin; clicking it covers the drawing area with the plugin's view;
// its Close button uncovers the drawing again.

test("a plugin overlay covers the drawing area and closes with its button", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=overlay-demo");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await expect(page.getByText("Hello from an overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "Overlay" }).click();
  await expect(page.getByText("Hello from an overlay")).toBeVisible();
  await expect(page.locator(".vault-editor-body--covered")).toHaveCount(1);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Hello from an overlay")).toHaveCount(0);
  await expect(page.locator(".vault-editor-body--covered")).toHaveCount(0);
  expect(errors).toEqual([]);
});
