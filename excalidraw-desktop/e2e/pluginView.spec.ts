import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// The checklist-view example (sdk/examples/checklist-view) through the real UI:
// a note named *.checklist.md opens in the plugin's view instead of the note
// view, and the plugin loads only then. Ticking a box saves through the guarded
// note write.

const mainRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/e2e-plugins\/checklist-view\/main\.js/.test(r.url())) {
      urls.push(r.url());
    }
  });
  return urls;
};

test("a *.checklist.md note opens in the plugin view and a tick is saved", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const mains = mainRequests(page);
  await openVault(page, "?plugins=checklist-view&seed=checklist");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  expect(mains).toEqual([]);

  await page
    .locator(".vault-tree-item__name", { hasText: /^Groceries\.checklist$/ })
    .click();
  const milk = page.getByLabel("milk");
  await expect(milk).toBeVisible();
  await expect(milk).not.toBeChecked();
  await expect(page.getByLabel("eggs")).toBeChecked();
  expect(mains).toHaveLength(1);
  // Not the Markdown note view.
  await expect(page.getByTestId("note-reading")).toHaveCount(0);

  await milk.check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __noteFiles: { textOf(p: string): string } }
        ).__noteFiles.textOf("Groceries.checklist.md"),
      ),
    )
    .toContain("- [x] milk");
  expect(errors).toEqual([]);
});
