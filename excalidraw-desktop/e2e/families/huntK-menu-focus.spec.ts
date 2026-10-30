import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family (bug hunter K, 2026-10-30): a menu opened from the keyboard and closed with Escape
// hands focus back to what opened it, so the next key keeps working there (WAI-ARIA menu
// pattern; Neovim and Zed return to the buffer or panel). The tab menu does this
// (TabContextMenu `restoreFocus`); the file tree's row menu is checked here for a folder row
// and the drawing row below it, then the tab menu as the reference member.

const focusedRow = (page: Page) => page.locator(".vault-tree-item--focused");
const row = (page: Page, path: string) =>
  page.locator(`.vault-tree-item[data-tree-path="${path}"]`);

/** The DSA folder as the tree's cursor row, opened; returns the path of its first child. */
const cursorOnDsa = async (page: Page) => {
  await row(page, "DSA").click();
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", "DSA");
  const paths = await page
    .locator(".vault-tree-item[data-tree-path]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-tree-path")));
  return paths[paths.indexOf("DSA") + 1]!;
};

const activeInfo = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      tag: a?.tagName ?? null,
      inTree: !!a?.closest("[data-tree-path], .vault-tree, [role='tree']"),
    };
  });

test("sanity: Shift+F10 opens the row menu of the cursor row and Escape closes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await cursorOnDsa(page);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: /Actions for DSA/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("toimprove 221: after Escape on the row menu, focus is back in the tree and j moves the cursor", async ({
  page,
}) => {
  await openVault(page);
  const firstChild = await cursorOnDsa(page);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: /Actions for DSA/ });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await activeInfo(page)).toMatchObject({ inTree: true });
  await page.keyboard.press("j");
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", firstChild, {
    timeout: 2000,
  });
});

test("the tab menu hands focus back to its tab after Escape (reference member)", async ({
  page,
}) => {
  await openVault(page);
  await cursorOnDsa(page);
  const path = "DSA/Graphs.excalidraw";
  await row(page, path).locator(".vault-tree-item__name").click();
  const tab = page.locator(`[data-testid=vault-tab][data-path="${path}"]`);
  await expect(tab).toBeVisible();
  await tab.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByTestId("vault-tab-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(tab).toBeFocused();
});

test("toimprove 221: after Escape on the sort menu, focus is back on the Sort order button", async ({
  page,
}) => {
  await openVault(page);
  const button = page.getByRole("button", { name: "Sort order" });
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Sort order" });
  await expect(menu).toBeVisible();
  await expect(menu.locator("[role^=menuitem]").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused({ timeout: 2000 });
});
