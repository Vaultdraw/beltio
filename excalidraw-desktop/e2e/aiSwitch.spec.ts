import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

test("Settings > Control: the AI switch asks first, then shows the MCP sub-switch", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { name: "Control" }).click();

  const aiSwitch = page.getByTestId("setting-ai-enabled").getByRole("switch");
  await expect(aiSwitch).not.toBeChecked();
  await expect(page.getByTestId("setting-ai-mcp-enabled")).toHaveCount(0);

  await page.getByTestId("setting-ai-enabled").locator(".vault-switch").click();
  const warning = page.getByTestId("ai-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Turn on AI?");
  await expect(warning).toContainText("no longer fully offline");
  await expect(aiSwitch).not.toBeChecked();

  await page.getByTestId("ai-warning-confirm").click();
  await expect(warning).toHaveCount(0);
  await expect(aiSwitch).toBeChecked();
  await expect(
    page.getByTestId("setting-ai-mcp-enabled").getByRole("switch"),
  ).toBeChecked();
  expect(errors).toEqual([]);
});
