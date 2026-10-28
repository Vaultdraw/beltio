import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// A failed action shows a small themed notice (not a full-width bar) in plain
// words; the X closes it, and it closes by itself after interface.notice_seconds.

const failTrash = (page: Page) =>
  page.evaluate(() => {
    (window as any).__vaultRepo.trash = async () => {
      throw new Error("disk is full");
    };
  });

const trashGraphs = async (page: Page) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^Graphs$/ }),
    })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("menuitem", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Trash" })
    .click();
};

test("a failed action shows a plain notice that closes with X and by itself", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^DSA$/ }),
    })
    .first()
    .locator(".vault-tree-item__toggle")
    .click();
  await failTrash(page);

  // Appears: plain wording, a small toast, no full-width bar.
  await trashGraphs(page);
  const notice = page.getByRole("alert").filter({ hasText: "to the Trash" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    /Couldn't move "Graphs(\.excalidraw)?" to the Trash: .*disk is full/,
  );
  await expect(page.locator(".vault-global-alert")).toHaveCount(0);

  // Closes on X.
  await notice.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notice).toHaveCount(0);

  // Closes by itself after interface.notice_seconds.
  await page.evaluate(() =>
    (window as any).__updatePreferences({ noticeSeconds: 1 }),
  );
  await trashGraphs(page);
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 6000 });
  expect(errors).toEqual([]);
});
