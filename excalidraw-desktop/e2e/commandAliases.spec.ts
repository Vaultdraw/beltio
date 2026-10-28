import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";

// A key bound in config.toml to a command's OLD id (the Gallery's command was
// `thumbnails.galleryToggle` before it became an extension) still opens it.
test("a key bound to a renamed command id still opens the Gallery", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          hotkeys: { "thumbnails.galleryToggle": ["Alt+Shift+Q"] },
        }),
      );
    },
    [PREFS_KEY] as const,
  );
  await openVault(page, "?seed=tags");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  await page.keyboard.press("Alt+Shift+Q");
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await page.keyboard.press("Alt+Shift+Q");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  expect(errors).toEqual([]);
});
