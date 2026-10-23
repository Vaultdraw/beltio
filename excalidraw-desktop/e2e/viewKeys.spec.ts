import { expect, test } from "@playwright/test";

import { seedPrefs } from "./linksHelpers";
import { openVault, trackErrors } from "./helpers";

// The gallery's keys are gallery.* commands: after a click on the activity
// bar, the default Escape is replaced by a key rebound in [hotkeys].
test("a rebound gallery key closes the gallery; the old default no longer does", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedPrefs(page, { hotkeys: { "gallery.close": ["Q"] } });
  await openVault(page);

  await page.getByTestId("activity-bar-gallery").click();
  const gallery = page.getByTestId("gallery-view");
  await expect(gallery).toBeVisible();

  // The old default is gone, so Escape leaves the grid open.
  await page.keyboard.press("Escape");
  await expect(gallery).toBeVisible();

  // The rebound key closes it, and the palette lists it with that shortcut.
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(">gallery: close");
  await expect(
    palette.getByRole("option", { name: /Close gallery/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("grid").focus();
  await page.keyboard.press("q");
  await expect(gallery).toHaveCount(0);
  expect(errors).toEqual([]);
});
