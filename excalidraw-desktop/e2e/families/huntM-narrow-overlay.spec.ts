import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openDrawing, openVault, trackErrors } from "../helpers";

// Hunter M (2026-10-30 night): the narrow-window file list overlay (19a948b3, toimprove 138).
// Reached through visible UI: the header's "Show navigator" button, rows clicked by mouse.
// Reference: Obsidian's file drawer (narrow window / mobile): the drawer is a view state of a
// narrow window; widening brings the docked sidebar back as it was; tapping a file (also the
// open one) closes the drawer; renaming in it keeps it open.

const nav = (page: Page) => page.getByLabel("Vault file navigator");
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const openOverlay = async (page: Page) => {
  await page.getByRole("button", { name: "Show navigator" }).click();
  await expect(nav(page)).toBeVisible();
};

test.use({ actionTimeout: 6000 });

// Sanity: a window that was narrow but never opened the overlay gets the docked list back.
test("narrow then wide, overlay never opened: the file list is back beside the drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await expect(nav(page)).toBeHidden();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(nav(page)).toBeVisible();
  expect(errors).toEqual([]);
});

// toimprove M-1: closing the overlay writes a session "navigator hidden" that outlives the
// narrow window, so a wide window keeps the file list hidden.
test("narrow window: open and close the overlay, then widen: the file list is back beside the drawing", async ({
  page,
}) => {
  test.fail(
    true,
    "toimprove M-1: the overlay's close is a session choice that outlives the narrow window",
  );
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await openOverlay(page);
  await page.keyboard.press("Escape");
  await expect(nav(page)).toBeHidden();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(nav(page), "wide window shows the docked list").toBeVisible();
  expect(errors).toEqual([]);
});

// toimprove M-2: clicking the drawing that is already open does nothing; the overlay stays over
// the drawing the user asked to see.
test("narrow window: clicking the open drawing in the overlay closes it", async ({
  page,
}) => {
  test.fail(
    true,
    "toimprove M-2: the overlay closes only when the open path changes",
  );
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await openOverlay(page);
  await row(page, "DSA").locator(".vault-tree-item__toggle").click();
  await openDrawing(page, "Graphs");
  await expect(nav(page)).toBeHidden();
  await openOverlay(page);
  await row(page, "DSA/Graphs.excalidraw").click();
  await expect(nav(page), "overlay closes after picking a file").toBeHidden();
  expect(errors).toEqual([]);
});

// toimprove M-3: renaming the open drawing changes the open path, which the overlay reads as
// "a file was opened" and closes under the user.
test("narrow window: renaming the open drawing in the overlay keeps the overlay open", async ({
  page,
}) => {
  test.fail(
    true,
    "toimprove M-3: a rename of the open file closes the overlay",
  );
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await openOverlay(page);
  await row(page, "DSA").locator(".vault-tree-item__toggle").click();
  await openDrawing(page, "Graphs");
  await openOverlay(page);
  await row(page, "DSA/Graphs.excalidraw").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox").first();
  await input.fill("Graphs renamed");
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(row(page, "DSA/Graphs renamed.excalidraw")).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(nav(page), "overlay stays open after a rename").toBeVisible();
  expect(errors).toEqual([]);
});

// Sanity: Escape on a row menu inside the overlay closes only the menu.
test("narrow window: Escape on a row menu in the overlay closes the menu, not the overlay", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await openOverlay(page);
  await row(page, "DSA").click({ button: "right" });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(nav(page)).toBeVisible();
  expect(errors).toEqual([]);
});

// toimprove M-6: the search box's own rule is "first Escape clears the query, the next one leaves
// the box" (VaultNavigator.tsx search onKeyDown), as Neovim leaves one layer per Esc. In the
// overlay the same Escape also reaches the overlay's document listener (nothing calls
// preventDefault), so the query is cleared and the whole list closes at once.
test("narrow window: Escape in the overlay's search box clears the query and keeps the list", async ({
  page,
}) => {
  test.fail(
    true,
    "toimprove M-6: one Escape clears the search and closes the overlay",
  );
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  await openOverlay(page);
  const search = nav(page).getByPlaceholder("Search drawings and text…");
  await search.click();
  await search.fill("Graph");
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await page.waitForTimeout(200);
  await expect(
    nav(page),
    "the list stays open after clearing the query",
  ).toBeVisible();
  expect(errors).toEqual([]);
});
