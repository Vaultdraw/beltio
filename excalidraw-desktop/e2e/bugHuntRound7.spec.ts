import { expect, test } from "@playwright/test";

import { openVault } from "./helpers";

// Bug hunter round 7: click verification of BH-3 and BH-11. Both are fixed; this keeps them fixed.

const row = (page: any, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

test("BH-3: a folder with files removed outside raises no search index error", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  await row(page, "DSA").click();
  await row(page, "DSA/Dynamic Programming").click();
  await expect(
    row(page, "DSA/Dynamic Programming/01 Introduction.excalidraw"),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__vaultRepo.outside({
      op: "delete",
      path: "DSA/Dynamic Programming",
    }),
  );
  await expect(row(page, "DSA/Dynamic Programming")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.locator(".vault-global-alert")).toHaveCount(0);
  await expect(page.getByText(/update the search index/)).toHaveCount(0);
});

test("BH-11: two New Drawing clicks make two drawings (Untitled, Untitled 1), never a clash", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixed = 1_800_000_001_234;
    Date.now = () => fixed;
  });
  await openVault(page, "?seed=empty");
  const btn = page.getByRole("button", { name: "New Drawing" }).first();
  await btn.click();
  await expect(row(page, "Untitled.excalidraw")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("tab").getByRole("button").first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /New drawing/i }).first().click();
  await page.waitForTimeout(2000);
  const names = await page
    .locator("[data-tree-path^='Untitled']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-tree-path")));
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  expect(names.length).toBe(2);
});
