import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openDrawing, openVault, trackErrors } from "../helpers";

// Hunter C round 2 (2026-10-30): favourites follow in-app renames of a file and of the folder
// holding it, through visible UI. Obsidian's bookmarks follow renames.
const name = (page: Page, n: string) =>
  page.locator(".vault-tree-item__name", { hasText: n }).first();
const favs = (page: Page) => page.getByTestId("favourite-row");
const rename = async (page: Page, n: string, to: string) => {
  const r = page.locator(".vault-tree-item", { has: name(page, n) }).first();
  await r.hover();
  await r.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await page.getByRole("dialog").getByLabel("New name").fill(to);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

test("favourites follow a file rename and then the rename of its folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=search");
  await name(page, "DSA").click();
  await name(page, "Dynamic Programming").click();
  await openDrawing(page, "Graphs");
  await name(page, "Graphs").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Favourite: add or remove" })
    .click();
  await page.getByTestId("activity-bar-favourites.list").click();
  await expect(favs(page)).toHaveCount(1);

  await rename(page, "Graphs", "Graphs two");
  await expect(favs(page).first()).toContainText("Graphs two");

  await rename(page, "DSA", "DP renamed");
  await expect(name(page, "DP renamed")).toBeVisible();
  await favs(page)
    .first()
    .getByRole("button", { name: /Graphs two/ })
    .first()
    .click();
  await expect(page.getByTestId("vault-tab").first()).toHaveAttribute(
    "data-path",
    /^DP renamed\/Graphs two\.excalidraw$/,
  );
  expect(errors).toEqual([]);
});
