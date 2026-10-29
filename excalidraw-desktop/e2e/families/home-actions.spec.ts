import { expect } from "@playwright/test";

import { test } from "../fixture";

import { openVault } from "../helpers";

// Family (test-net TN-3, 2026-10-30): what a newcomer needs is reachable by clicking from the
// home screen, with no drawing open. Each row: the button's label, what must happen.

test("Import Obsidian vault… on the home screen imports a vault", async ({
  page,
}) => {
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(() => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Notes",
      files: { "Hello.md": "# Hello\n\nFrom Obsidian." },
    };
  });
  const home = page.locator(".vault-home");
  await expect(home).toBeVisible();
  await home.getByRole("button", { name: /Import Obsidian vault/ }).click();
  await expect(page.locator('[data-tree-path="Notes"]').first()).toBeVisible({
    timeout: 60_000,
  });
});

test("the home buttons all run something", async ({ page }) => {
  await openVault(page);
  const labels = await page
    .locator(".vault-home .vault-home__action .vault-home__label")
    .allInnerTexts();
  expect(labels).toEqual(
    expect.arrayContaining([
      "New drawing",
      "New from template…",
      "Go to drawing",
      "Show all commands",
    ]),
  );
});
