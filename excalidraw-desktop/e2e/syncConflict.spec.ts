import { expect, test, type Page } from "@playwright/test";

import { clickTree, openSeededVault, sceneJson } from "./tabsHelpers";

// A vault in a sync folder: a conflict copy shows a badge, opens side by side with its
// original, and keeping the original moves the copy out of the tree (the other version goes
// to History, the copy to the Trash).
const ORIGINAL = "Plan";
const COPY = "Plan (conflicted copy 2026-01-01)";
const copyRow = (page: Page) =>
  page.locator(`[data-tree-path="${COPY}.excalidraw"]`);

test("a conflict copy has a badge, compares side by side with its original, and keep resolves it", async ({
  page,
}) => {
  await openSeededVault(page, {
    [`${ORIGINAL}.excalidraw`]: sceneJson([{ id: "o-rect" }]),
    [`${COPY}.excalidraw`]: sceneJson([
      { id: "c-rect" },
      { id: "c-ellipse", type: "ellipse", x: 400, y: 300 },
    ]),
  });

  // The copy is listed with a "conflict" badge; the original has none.
  await expect(copyRow(page)).toBeVisible();
  const badge = page.getByTestId("sync-conflict-badge");
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText("conflict");

  // Row menu -> Compare with original.
  await copyRow(page).hover();
  await copyRow(page).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Compare with original…" }).click();

  const dialog = page.getByTestId("sync-compare-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("sync-pane-original")).toContainText(
    "1 element",
  );
  await expect(page.getByTestId("sync-pane-copy")).toContainText("2 elements");
  await expect(dialog.locator("canvas").first()).toBeVisible();

  // Keep the original: the copy leaves the tree, the original stays and opens as before.
  await page.getByTestId("sync-keep-original").click();
  await expect(dialog).toBeHidden();
  await expect(copyRow(page)).toHaveCount(0);
  await expect(page.getByTestId("sync-conflict-badge")).toHaveCount(0);
  await expect(page.getByText(/Kept Plan/)).toBeVisible();
  await clickTree(page, ORIGINAL);
});
