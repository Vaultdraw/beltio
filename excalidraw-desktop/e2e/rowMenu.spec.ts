import { expect } from "@playwright/test";
import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

test("right-click a folder: grouped menu, a submenu, then New drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item")
    .filter({ hasText: "DSA" })
    .first()
    .click({ button: "right" });

  const menu = page.getByRole("menu", { name: /Actions for DSA/ });
  await expect(menu).toBeVisible();
  // Groups in Obsidian's order, split by dividers; Move to Trash is last.
  const items = await menu.getByRole("menuitem").allTextContents();
  const labels = items.map((t) => t.replace(/\s+/g, " ").trim());
  expect(labels[0]).toMatch(/^New drawing/);
  expect(labels[1]).toMatch(/^New folder/);
  expect(labels.some((l) => l.startsWith("Copy path"))).toBe(true);
  expect(labels[labels.length - 2]).toMatch(/^Rename…/);
  expect(labels[labels.length - 1]).toMatch(/^Move to Trash/);
  expect(await menu.getByRole("separator").count()).toBeGreaterThanOrEqual(3);

  // Submenu with a chevron: ArrowRight opens it, ArrowLeft closes it.
  const copy = menu.getByRole("menuitem", { name: /^Copy path/ });
  await expect(copy).toHaveAttribute("aria-haspopup", "menu");
  await copy.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "Absolute path" }),
  ).toBeVisible();
  // Focus moves into the submenu's first item.
  await expect(
    page.getByRole("menuitem", { name: "Relative to vault" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("menuitem", { name: "Absolute path" }),
  ).toHaveCount(0);

  // Type-ahead jumps to an item, Enter runs it: the new drawing dialog opens.
  await page.keyboard.type("new d");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("in /DSA");
  expect(errors).toEqual([]);
});
