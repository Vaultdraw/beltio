import { expect, type Page } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";
import { scenePoint } from "./linksHelpers";

export const tagsPanel = (page: Page) =>
  page.getByRole("region", { name: "Tags" });
export const tagList = (page: Page) =>
  tagsPanel(page).getByRole("tree", { name: "Tag list" });
export const tagRow = (page: Page, name: string) =>
  tagsPanel(page).getByRole("button", { name: new RegExp(`^Tag ${name},`) });
export const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");
export const popup = (page: Page) => page.locator(".vault-suggest");
export const popupRows = (page: Page) =>
  page.locator(".vault-suggest__row:not(.vault-suggest__row--create)");
export const editArea = (page: Page) =>
  page.locator("textarea.excalidraw-wysiwyg");

/** Names of the tag rows in the pane, in DOM order (display, no `#`). */
export const paneTagNames = (page: Page) =>
  tagList(page)
    .locator(".vault-tags__label")
    .allTextContents()
    .then((xs) => xs.map((x) => x.replace(/^#/, "")));

/** Opens a tags-seeded vault with the DSA folder open and the pane visible. */
export const openTagsVault = async (page: Page, query = "?seed=tags") => {
  await openVault(page, query);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await expect(tagsPanel(page)).toBeVisible();
};

/** Opens `drawing` and starts a new text element in empty canvas space. */
export const startTyping = async (page: Page, drawing: string) => {
  await openDrawing(page, drawing);
  const p = await scenePoint(page, 600, 420);
  await page.mouse.dblclick(p.x, p.y);
  await expect(editArea(page)).toBeFocused();
};

/** Opens the generated `Tagged` folder (?tagcount=N vaults). */
export const openTaggedFolder = (page: Page) =>
  page.locator(".vault-tree-item__name", { hasText: "Tagged" }).first().click();
