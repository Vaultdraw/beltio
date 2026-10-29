import { expect } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family: the shared look. Rows are one height, floating layers stack in one
// order (toasts above menus), the toast progress bar has an accent colour, and
// the toast carries a status icon. Read from the page as the user sees it, in
// both colour modes.

for (const theme of ["light", "dark"] as const) {
  test(`chrome audit: row height, stacking order, toast look (${theme})`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ colorScheme: theme });
    await openVault(page);

    // Tree rows and menu items share one row height (26 px).
    const row = page.locator(".vault-tree-item").first();
    await expect(row).toBeVisible();
    expect((await row.boundingBox())?.height).toBe(26);
    await row.hover();
    await row.getByRole("button", { name: "More actions" }).click();
    const menuItem = page.getByRole("menuitem").first();
    await expect(menuItem).toBeVisible();
    expect((await menuItem.boundingBox())?.height).toBe(26);

    // A toast with progress while a menu is open: the toast is above the menu,
    // its status icon is drawn, and the progress bar has a real colour.
    await page.evaluate(() =>
      (window as any).__vaultToasts.push({
        message: "Working",
        progress: { done: 2, total: 5 },
      }),
    );
    const toast = page.locator(".vd-toast").first();
    await expect(toast).toBeVisible();
    await expect(toast.locator(".vd-toast__icon svg")).toBeVisible();
    const stack = await page.evaluate(() => {
      const z = (sel: string) =>
        Number(getComputedStyle(document.querySelector(sel)!).zIndex);
      return {
        toast: z(".vd-toasts"),
        menu: z(".vault-menu"),
        accent: getComputedStyle(
          document.querySelector(".vd-toast__progress progress")!,
        ).accentColor,
      };
    });
    expect(stack.toast).toBeGreaterThan(stack.menu);
    expect(stack.accent).not.toBe("auto");
    expect(stack.accent).not.toBe("");
    expect(errors).toEqual([]);
  });
}
