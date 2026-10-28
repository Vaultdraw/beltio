import { expect } from "@playwright/test";

import { test } from "./fixture";

import { trackErrors } from "./helpers";
import { openTagsVault } from "./tagsHelpers";

// Settings → Extensions, reached by clicking: turning Graph view off removes
// its activity bar button at once, turning it back on brings it back.
test("Settings > Extensions: a switch turns a built-in extension off and on live", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  const graphButton = page.getByTestId("activity-bar-graph");
  await expect(graphButton).toBeVisible();

  const openExtensions = async () => {
    await page.getByTestId("activity-bar-settings").click();
    const settings = page.locator(".vault-settings-modal");
    await expect(settings).toBeVisible();
    await settings.getByRole("tab", { name: "Extensions" }).click();
    await expect(page.getByTestId("settings-extensions")).toBeVisible();
    return settings;
  };
  const graphRow = () => page.getByTestId("extension-row-graph");

  await openExtensions();
  await expect(graphRow().getByRole("switch")).toBeChecked();
  await graphRow().locator(".vault-switch").click();
  await expect(graphRow().getByRole("switch")).not.toBeChecked();
  await expect(page.getByTestId("extension-row-index")).toContainText(
    "Needed by",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-settings-modal")).toHaveCount(0);
  await expect(graphButton).toHaveCount(0);

  await openExtensions();
  await graphRow().locator(".vault-switch").click();
  await expect(graphRow().getByRole("switch")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(graphButton).toBeVisible();
  expect(errors).toEqual([]);
});

// The History panel switch hides the History interface only; versions keep
// being saved (that is the separate "File history" switch).
test("Settings > Extensions: the History panel switch hides and restores the History button", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  const historyButton = page.getByTestId("activity-bar-history");
  await expect(historyButton).toBeVisible();

  const toggle = async () => {
    await page.getByTestId("activity-bar-settings").click();
    const settings = page.locator(".vault-settings-modal");
    await settings.getByRole("tab", { name: "Extensions" }).click();
    const row = page.getByTestId("extension-row-history");
    await expect(
      page.getByTestId("extension-row-history-record"),
    ).toContainText("File history");
    await row.locator(".vault-switch").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".vault-settings-modal")).toHaveCount(0);
  };

  await toggle();
  await expect(historyButton).toHaveCount(0);
  await toggle();
  await expect(historyButton).toBeVisible();
  expect(errors).toEqual([]);
});
