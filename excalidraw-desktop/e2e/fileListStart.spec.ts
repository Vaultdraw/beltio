import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// files.list_start: Settings > General > Startup > "Start file list" switches
// the vault file walk's start mode live, and the home page's Recent list
// still shows drawings from inside folders (found by that walk, not by the
// collapsed tree).
test("Start file list setting switches by click and Recent still lists nested drawings", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "General" }).click();
  const group = dialog.getByRole("group", { name: "Start file list" });
  await expect(
    group.getByRole("button", { name: "When idle" }),
  ).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "On first use" }).click();
  await expect(
    group.getByRole("button", { name: "On first use" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const recent = page.getByLabel("Recent drawings");
  await expect(recent).toContainText("Graphs");
  await expect(recent).toContainText("DSA");
  expect(errors).toEqual([]);
});
