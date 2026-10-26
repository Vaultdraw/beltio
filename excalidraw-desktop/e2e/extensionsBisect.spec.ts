import { expect, test } from "@playwright/test";

import { enterVault, trackErrors } from "./helpers";
import { openTagsVault } from "./tagsHelpers";

// Extension bisect, reached by clicking: Settings → Extensions → Find a
// problem extension restarts (a reload here) with half of the extensions off
// and a banner that asks; Stop restarts with everything back on.
test("extension bisect: start from Settings, half off with a banner, Stop restores", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  const graphButton = page.getByTestId("activity-bar-graph");
  await expect(graphButton).toBeVisible();

  await page.getByTestId("activity-bar-settings").click();
  const settings = page.locator(".vault-settings-modal");
  await settings.getByRole("tab", { name: "Extensions" }).click();
  await expect(page.getByTestId("settings-extensions")).toBeVisible();
  const reloaded = page.waitForEvent("load");
  await settings
    .getByRole("button", { name: "Find a problem extension" })
    .click();
  await reloaded;
  await enterVault(page);

  const banner = page.getByTestId("bisect-banner");
  await expect(banner).toContainText("step 1");
  await expect(banner).toContainText("Graph view");
  await expect(graphButton).toHaveCount(0);

  const stopped = page.waitForEvent("load");
  await banner.getByRole("button", { name: "Stop" }).click();
  await stopped;
  await enterVault(page);
  await expect(page.getByTestId("bisect-banner")).toHaveCount(0);
  await expect(graphButton).toBeVisible();
  expect(errors).toEqual([]);
});
