import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// Family (bug hunter K, 2026-10-30, from K-5): a button inside a clickable row acts alone.
// The tree row's "More actions" button is in the Tab order, but Enter and Space on it do nothing
// (the keydown never reaches the document: something above the button takes it), so the menu it
// promises (aria-haspopup) never opens from the keyboard. A button that is focusable must work with
// Enter and Space (WAI-ARIA button); Shift+F10 on the row is the other way in.

const PATH = "DSA/Graphs.excalidraw";

const focusMore = async (page: Page) => {
  const dsa = page.locator(`[data-tree-path="DSA"]`);
  if ((await dsa.getAttribute("aria-expanded")) !== "true") {
    await dsa.locator(".vault-tree-item__toggle").click();
  }
  const r = page.locator(`[data-tree-path="${PATH}"]`);
  await r.hover();
  const more = r.getByRole("button", { name: "More actions" });
  await more.focus();
  await expect(more).toBeFocused();
};

test("sanity: a click on More actions opens the row menu", async ({ page }) => {
  await openVault(page);
  await focusMore(page);
  await page
    .locator(`[data-tree-path="${PATH}"]`)
    .getByRole("button", { name: "More actions" })
    .click();
  await expect(
    page.getByRole("menu", { name: /Actions for Graphs/ }),
  ).toBeVisible();
});

for (const key of ["Enter", "Space"]) {
  test(`toimprove 239: ${key} on a focused More actions button opens the row menu`, async ({
    page,
  }) => {
    await openVault(page);
    await focusMore(page);
    await page.keyboard.press(key === "Space" ? " " : key);
    await expect(page.locator(`[data-tree-path="DSA"]`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByRole("menu", { name: /Actions for Graphs/ }),
    ).toBeVisible({ timeout: 2000 });
  });
}
