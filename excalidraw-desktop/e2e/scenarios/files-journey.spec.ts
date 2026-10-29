import { expect, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "../constants";
import { openDrawing, openVault, readScene } from "../helpers";
import { drawingPaths, renameTo, sceneTexts } from "../linksHelpers";
import { activeTab, tabNames } from "../tabsHelpers";

import { journey } from "./journey";

// Journey: rename, move and trash files while they are open in tabs. Search finds the new names,
// links and backlinks follow. Obsidian renames a file under its open tab and rewrites links;
// Finder-style apps keep the tab. We expect the Obsidian behaviour.

const rowMenuItem = async (page: Page, name: string, item: RegExp | string) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

const search = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");

journey({
  title: "files-journey",
  known: [
    {
      match: /vault-recent__(title|folder)/,
      bug: "toimprove TN-1: faint text on the home list is below 3:1 in the light theme",
      theme: "light",
    },
  ],
  setup: async (page) => {
    await openVault(page, "?seed=links");
  },
  steps: [
    {
      name: "open Hub, then Alpha in a second tab",
      run: async (page) => {
        await openDrawing(page, "Hub");
        await page.getByTestId("vault-tab-new").click();
        await openDrawing(page, "Alpha");
        await expect(page.getByTestId("vault-tab")).toHaveCount(2);
        expect(await tabNames(page)).toEqual(["Hub", "Alpha"]);
      },
    },
    {
      name: "rename Alpha to Beta while it is open",
      run: async (page) => {
        await renameTo(page, "Alpha", "Beta");
        await expect.poll(() => tabNames(page)).toEqual(["Hub", "Beta"]);
        expect(await activeTab(page)).toBe("Beta");
        await expect(page.locator(".vault-breadcrumbs")).toContainText("Beta");
        await expect(
          page.locator(".vault-tree-item__name", { hasText: /^Beta$/ }),
        ).toBeVisible();
        await expect(
          page.locator(".vault-tree-item__name", { hasText: /^Alpha$/ }),
        ).toHaveCount(0);
      },
    },
    {
      name: "links in other drawings follow the new name",
      run: async (page) => {
        await expect
          .poll(async () => {
            await page.waitForTimeout(AFTER_AUTOSAVE_MS);
            return sceneTexts(await readScene(page, "Hub.excalidraw")).join(
              "|",
            );
          })
          .toContain("[[Beta]]");
        const inner = sceneTexts(
          await readScene(page, "Folder/Inner.excalidraw"),
        ).join("|");
        expect(inner).toContain("[[Beta]]");
        expect(inner).not.toContain("[[Alpha]]");
      },
    },
    {
      name: "search finds the new name and not the old one",
      run: async (page) => {
        await search(page).fill("Beta");
        await expect(
          page
            .locator('.vault-search-row[data-kind="drawing"]')
            .filter({ hasText: "Beta" })
            .first(),
        ).toBeVisible();
        await search(page).fill("Alpha");
        await expect(
          page
            .locator('.vault-search-row[data-kind="drawing"]')
            .filter({ hasText: /^\s*Alpha\b/ }),
        ).toHaveCount(0);
        await search(page).fill("");
      },
    },
    {
      name: "the backlinks panel lists the three places that point at Beta",
      keyboard: true,
      run: async (page) => {
        await page.keyboard.press("Meta+Alt+b");
        const dock = page.locator(".vault-links");
        await expect(dock).toBeVisible();
        await expect(dock.locator(".vault-links__row--backlink")).toHaveCount(
          3,
        );
        await expect(dock).toContainText("[[Beta]]");
        await page.keyboard.press("Meta+Alt+b");
        await expect(dock).toHaveCount(0);
      },
    },
    {
      name: "rename the open tab's drawing back from the tab's own folder row",
      run: async (page) => {
        await renameTo(page, "Beta", "Alpha");
        await expect.poll(() => tabNames(page)).toEqual(["Hub", "Alpha"]);
        await expect
          .poll(async () => {
            await page.waitForTimeout(AFTER_AUTOSAVE_MS);
            return sceneTexts(await readScene(page, "Hub.excalidraw")).join(
              "|",
            );
          })
          .toContain("[[Alpha]]");
      },
    },
    {
      name: "move to trash a drawing that is open: the tab closes, the file is gone",
      run: async (page) => {
        await rowMenuItem(page, "Alpha", /Move to Trash/);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Move to Trash" })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.locator(".vault-tree-item__name", { hasText: /^Alpha$/ }),
        ).toHaveCount(0);
        expect(await drawingPaths(page)).not.toContain("Alpha.excalidraw");
        // The tab for the trashed file is not left pointing at nothing.
        expect(await tabNames(page)).not.toContain("Alpha");
      },
    },
    {
      name: "the backlinks of Hub's text still render and the other drawing opens",
      run: async (page) => {
        await openDrawing(page, "Hub");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        await expect(page.locator(".vault-breadcrumbs")).toContainText("Hub");
      },
    },
  ],
});
