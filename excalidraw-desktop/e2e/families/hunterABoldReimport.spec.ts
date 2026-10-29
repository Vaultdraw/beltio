import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { clickMainMenuItem, openVault, readScene, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Hunter A round 2: import with bold headings and whole-bold paragraphs, re-import untouched,
// stamps stay true, so the untouched note is rewritten and keeps its bold fonts.
const row = (page: Page, path: string) =>
  page.locator(`.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`);
const fonts = async (page: Page, path: string) =>
  Object.fromEntries(
    (await readScene(page, path)).elements
      .filter((e: any) => e.type === "text" && !e.isDeleted)
      .map((e: any) => [String(e.text).slice(0, 12), e.fontFamily]),
  );
const NOTE = "# Big title\n\n**All bold paragraph here**\n\nPlain words and **some** bold.\n";

test("bold headings and paragraphs survive re-import", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Start.excalidraw");
  await page.evaluate((n) => {
    (window as any).__plugins.backend.folders.sourcePick = { name: "Vault", files: { "Notes/Alpha.md": n } };
  }, NOTE);
  await clickMainMenuItem(page, "Import Obsidian vault…");
  await expect(row(page, "Vault")).toBeVisible({ timeout: 30_000 });
  await row(page, "Vault/Notes").locator(".vault-tree-item__toggle").click();
  const path = "Vault/Notes/Alpha.excalidraw";
  await expect(row(page, path)).toBeVisible();
  const first = await fonts(page, path);
  const ids = Object.values(first) as number[];
  const bold = (id: number) => id > 100;
  expect(bold(first["Big title"]), "heading is bold").toBe(true);
  expect(bold(first["All bold par"]), "whole-bold paragraph is bold").toBe(true);
  expect(bold(first["Plain words "]), "mixed paragraph is not bold").toBe(false);

  // Re-import untouched notes: must be allowed (stamps true) and keep the fonts.
  await row(page, "Vault/Notes").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Re-import unchanged imported notes here" }).click();
  await expect(page.getByText("Re-imported 1 note")).toBeVisible({ timeout: 30_000 });
  expect(await fonts(page, path)).toEqual(first);
  expect(ids.length).toBeGreaterThan(2);

  // (Rename-then-re-import is not testable here: the stand-in plugin backend keeps its own
  // file table that a tree rename does not touch; its listing would still name the old file.)
  expect(errors).toEqual([]);
});
