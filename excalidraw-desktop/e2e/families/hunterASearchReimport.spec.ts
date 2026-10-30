import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { clickMainMenuItem, openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 3: search follows what a re-import writes. A vault import puts words in a table
// cell, a heading and an accented list item; search finds them (case and accents as typed); the
// note changes at the source; Re-import replaces the words, search finds the new ones and no longer
// the old ones.
const V1 = [
  "# Café notes",
  "",
  "| Term | Meaning |",
  "|---|---|",
  "| Alpha | quasarmemory |",
  "",
  "- Ünïcode walrusword 🚀 rocket",
  "",
].join("\n");
const V2 = V1.replace("quasarmemory", "nebulacache").replace(
  "walrusword",
  "otterword",
);

const row = (page: Page, path: string) =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );
const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");
const snippet = (page: Page, word: string) =>
  page
    .locator('.vault-search-row[data-kind="snippet"]')
    .filter({ hasText: word });
const found = async (page: Page, word: string, anyRow = false) => {
  await searchBox(page).fill(word);
  await page.waitForTimeout(700);
  // an accent-insensitive hit shows the accented text, so the shown row cannot repeat the query
  return anyRow
    ? (await page.locator(".vault-search-row").count()) > 0
    : (await snippet(page, word).count()) > 0;
};

test("search follows import, re-import of a note with a table, accents and emoji", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  const pick = (t: string) =>
    page.evaluate((note) => {
      (window as any).__plugins.backend.folders.sourcePick = {
        name: "Vault",
        files: { "Notes/Café Ünï.md": note },
      };
    }, t);
  await pick(V1);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    expect(await found(page, "quasarmemory"), "table cell").toBe(true);
  }).toPass({ timeout: 20_000 });
  const problems: string[] = [];
  const check = async (
    word: string,
    want: boolean,
    what: string,
    anyRow = false,
  ) => {
    const got = await found(page, word, anyRow);
    if (got !== want) problems.push(`${what}: "${word}" found=${got}, want ${want}`);
  };
  await check("QUASARMEMORY", true, "upper-case query");
  await check("walrusword", true, "list item next to accents and emoji");
  await check("rocket", true, "word after an emoji");
  await check("Ünïcode", true, "accented word as typed");
  await check("unicode", true, "accented word without accents (Obsidian ignores accents)", true);
  await check("cafe", true, "heading with an accent, query without", true);

  // change at the source, re-import
  await searchBox(page).fill("");
  await pick(V2);
  if (!(await row(page, "Vault/Notes").isVisible())) {
    await row(page, "Vault").locator(".vault-tree-item__toggle").click();
  }
  await row(page, "Vault/Notes").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Re-import unchanged imported notes here" })
    .click();
  await expect(page.getByText(/Re-imported/)).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    expect(await found(page, "nebulacache"), "new table word").toBe(true);
  }).toPass({ timeout: 20_000 });
  await check("otterword", true, "new list word");
  await check("quasarmemory", false, "old table word after re-import");
  await check("walrusword", false, "old list word after re-import");
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors).toEqual([]);
});
