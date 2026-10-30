import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault } from "../helpers";

// Launch hunter 2 [launch] [shell]: the harness runs as macOS; here the page says it is WebKitGTK on
// Linux (what the Linux packages run) and the user reads the app's own words. A Linux user must
// not be told to use Cmd or Finder. The chords themselves work (checked: Ctrl+Z, Ctrl+Shift+Z,
// Ctrl+D, Ctrl+, , Ctrl+P, Ctrl+Shift+P all act on the Linux platform).
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
test.use({ userAgent: UA });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Linux x86_64" });
  });
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("toimprove 287: on Linux the Interface settings page does not say Cmd+click", async ({
  page,
}) => {
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Interface", exact: true }).click();
  await expect(dialog).not.toContainText(/\bCmd\b|⌘/);
});

test("toimprove 287: on Linux the command palette does not offer Reveal in Finder", async ({
  page,
}) => {
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("reveal");
  await expect(page.getByText(/Finder/)).toHaveCount(0);
});
