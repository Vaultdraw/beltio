import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Favourites (official plugin): right-click a drawing, open the panel from the activity bar,
// reorder and remove. One spec, reached only through visible UI.
const rows = (page: Page) => page.getByTestId("favourite-row");
const nameOf = (page: Page, name: string) =>
  page.locator(".vault-tree-item__name", { hasText: name }).first();

test("favourites: add from the tree menu, see them in the panel, reorder, remove", async ({
  page,
}) => {
  await openVault(page, "?seed=search");
  await nameOf(page, "DSA").click();
  await nameOf(page, "Dynamic Programming").click();
  await openDrawing(page, "Graphs");

  await nameOf(page, "Graphs").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Favourite: add or remove" })
    .click();
  await nameOf(page, "Introduction").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Favourite: add or remove" })
    .click();

  await page.getByTestId("activity-bar-favourites.list").click();
  await expect(page.getByTestId("favourites-panel")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText("Graphs");
  await expect(rows(page).nth(1)).toContainText("Introduction");

  // Alt+Down moves the focused favourite below the next one.
  await rows(page)
    .nth(0)
    .getByRole("button", { name: /Graphs/ })
    .first()
    .focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(rows(page).nth(0)).toContainText("Introduction");

  await page.getByRole("button", { name: /Remove 01 Introduction/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0)).toContainText("Graphs");
});
