import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// D8: with search.start = "use" the index stays stopped (no idle start);
// Settings > General > Startup > "On open" starts it at once (live), and
// the search the user types then shows results.
test("search index stays stopped on first-use mode until Startup is switched to On open, then finds a drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=search&lazysearch=1");
  const startCalls = () =>
    page.evaluate(() => (window as any).__vaultSearch.startCalls);

  // Well past the idle window: "use" never starts it by itself.
  await page.waitForTimeout(1500);
  expect(await startCalls()).toEqual([]);

  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "General" }).click();
  await expect(dialog.getByText("Startup", { exact: true })).toBeVisible();
  const group = dialog.getByRole("group", { name: "Start search index" });
  await expect(
    group.getByRole("button", { name: "On first use" }),
  ).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "On open" }).click();
  await expect(group.getByRole("button", { name: "On open" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(startCalls).toEqual(["start"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByPlaceholder("Search drawings and text…").fill("dijk");
  const row = page.locator('.vault-search-row[data-kind="snippet"]').first();
  await expect(row).toContainText("Dijkstra shortest path");
  await expect(row.locator("mark.vault-search-mark")).toHaveText("Dijk");
  expect(await startCalls()).toEqual(["start"]);
  expect(errors).toEqual([]);
});
