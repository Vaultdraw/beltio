import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// A plugin asks for a view in the main pane (ctx.views.open): the checklist-view
// example's command "Checklist: open the list" shows the list as a tab, in the plugin's
// view. Opened from the palette: the command is the feature's only trigger.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

test("a plugin command opens its view in the main pane as a tab", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=checklist-view&seed=checklist");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await expect(page.getByLabel("milk")).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("Checklist: open the list");
  await expect(palette(page).getByRole("option").first()).toContainText(
    "Checklist: open the list",
  );
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("milk")).toBeVisible();
  await expect(page.getByLabel("eggs")).toBeChecked();
  await expect(
    page.locator("[data-path='Groceries.checklist.md']"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
