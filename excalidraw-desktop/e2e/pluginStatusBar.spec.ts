import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// The status-clock example (sdk/examples/status-clock) through the real UI:
// no bar until a plugin gives an item text; a click on the item runs its command.

test("status-clock: the bar appears with the time, a click shows seconds", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=hello-command");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await expect(page.getByTestId("plugin-status-bar")).toHaveCount(0);

  await openVault(page, "?plugins=status-clock");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  const item = page.getByTestId("plugin-status-status-clock.clock");
  await expect(item).toBeVisible();
  await expect(item).toHaveText(/^\d\d:\d\d$/);

  await item.click();
  await expect(item).toHaveText(/^\d\d:\d\d:\d\d$/);
  expect(errors).toEqual([]);
});
