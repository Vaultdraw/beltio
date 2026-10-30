import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { clickMainMenuItem, openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";
import { activeTab, tabNames } from "../tabsHelpers";

// Hunter A round 3: a long note imported in parts; the user has the last part open in a tab; the
// note shrinks and "Re-import" trashes the leftover parts. The tab for a trashed part must close
// (Obsidian closes a leaf whose file is deleted), the editor must not be left on a missing file,
// nothing may recreate the part afterwards, and no error may be raised.
const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );
const longNote = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Paragraph number ${i} with some words.`,
  ).join("\n\n");
const names = async (page: Page) =>
  (await page.locator(".vault-tree-item__name").allInnerTexts()).filter((n) =>
    /^Long/.test(n),
  );

test("leftover parts trashed by Re-import while their tab is open: tab closes, nothing comes back", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate(() =>
    (window as any).__updatePreferences({
      pluginSettings: { "markdown-import": { part_elements: 200 } },
    }),
  );
  await page.evaluate((t) => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: { "Long.md": t },
    };
  }, longNote(700));
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 60_000 });
  if (!(await row(page, "Vault/Long (part 2).excalidraw").isVisible())) {
    await row(page, "Vault").locator(".vault-tree-item__toggle").click();
  }
  await expect
    .poll(() => names(page), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["Long", "Long (part 2)"]));

  // part 1 in the first tab, part 2 in a second, active tab
  await row(page, "Vault/Long.excalidraw").click();
  await page.getByTestId("vault-tab-new").click();
  await row(page, "Vault/Long (part 2).excalidraw").click();
  await expect.poll(() => tabNames(page)).toContain("Long (part 2)");
  expect(await activeTab(page)).toContain("Long (part 2)");

  // the note is now one line; re-import from the folder's menu
  await page.evaluate(() => {
    (window as any).__plugins.backend.folders.sourcePick = {
      name: "Vault",
      files: { "Long.md": "Now just one line." },
    };
  });
  await row(page, "Vault").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported/)).toBeVisible({ timeout: 60_000 });

  await expect.poll(() => names(page), { timeout: 15_000 }).toEqual(["Long"]);
  const tabs = await tabNames(page);
  expect(tabs.join("|"), "tab of a trashed part").not.toContain("part 2");
  expect(tabs.length, "a tab is left to work in").toBeGreaterThan(0);
  // the editor shows a real drawing, not an error or an empty missing-file state
  await expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  // nothing writes the part back (autosave of the closed tab)
  await page.waitForTimeout(2500);
  expect(await names(page), "part came back").toEqual(["Long"]);
  expect(errors).toEqual([]);
});
