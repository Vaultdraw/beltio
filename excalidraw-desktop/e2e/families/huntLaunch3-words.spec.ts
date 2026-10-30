import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openVault } from "../helpers";

// Launch hunter 3: the word filter (246) in Settings, used
// through visible UI. Words in any order, case and accents folded, like Obsidian's switcher.
test.describe("launch hunter 3: type-to-filter lists", () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, "?seed=obsidian");
  });

  test("settings search: words in any order and accents folded", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Settings" }).first().click();
    const dialog = page.getByRole("dialog");
    const search = dialog
      .getByRole("searchbox")
      .or(dialog.getByRole("textbox"))
      .first();
    await expect(search).toBeVisible();
    const found: Record<string, number> = {};
    for (const q of [
      "theme dark",
      "dark theme",
      "THÉME",
      "zzzzqq",
      "theme   ",
    ]) {
      await search.fill(q);
      await page.waitForTimeout(300);
      found[q] = await dialog
        .locator(
          "[data-setting-id], [data-setting], .settings-row, [role=group]",
        )
        .count();
    }
    expect(found["dark theme"]).toBe(found["theme dark"]);
    expect(found["THÉME"]).toBeGreaterThan(0);
    expect(found.zzzzqq).toBe(0);
  });
});
