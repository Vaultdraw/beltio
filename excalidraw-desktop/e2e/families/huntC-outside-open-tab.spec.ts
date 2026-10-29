import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { canvasBox, openDrawing, openVault } from "../helpers";

// Hunter C (2026-10-30, C-4; the open drawing follows since the utilizer's fix): a file renamed or moved outside the app while its tab is open.
// Obsidian: the tab follows the file to its new name. Never a dead "missing" tab for a file that exists.

const outside = (page: Page, change: object) =>
  page.evaluate((c) => (window as any).__vaultRepo.outside(c), change);
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

test("a drawing renamed outside while open in a tab: the tab follows it, not a missing tab", async ({
  page,
}) => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, "DSA/Graphs.excalidraw").click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Graphs",
  );
  await outside(page, {
    op: "rename",
    path: "DSA/Graphs.excalidraw",
    to: "DSA/Graphs renamed.excalidraw",
  });
  await expect(row(page, "DSA/Graphs renamed.excalidraw")).toBeVisible();
  await expect(page.locator(".vault-tabs__tab--missing")).toHaveCount(0);
  await expect(page.getByTestId("vault-tab")).toHaveCount(1);
  await expect(page.getByTestId("vault-tab")).toContainText("Graphs renamed");
});

test("a folder renamed outside while a drawing inside is open: the tab follows", async ({
  page,
}) => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, "DSA/Graphs.excalidraw").click();
  await outside(page, { op: "rename", path: "DSA", to: "Algorithms" });
  await expect(row(page, "Algorithms")).toBeVisible();
  await expect(page.locator(".vault-tabs__tab--missing")).toHaveCount(0);
  await expect(page.getByTestId("vault-tab")).toHaveAttribute(
    "data-path",
    "Algorithms/Graphs.excalidraw",
  );
});

test("editing a drawing that was renamed outside does not recreate it under the old name", async ({
  page,
}) => {
  await openVault(page);
  await row(page, "DSA").click();
  await openDrawing(page, "Graphs");
  await outside(page, {
    op: "rename",
    path: "DSA/Graphs.excalidraw",
    to: "DSA/Graphs renamed.excalidraw",
  });
  await expect(row(page, "DSA/Graphs renamed.excalidraw")).toBeVisible();
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(3000); // autosave
  await expect(row(page, "DSA/Graphs.excalidraw")).toHaveCount(0);
  const names = await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    return (await repo.listDirectory(repo.handle, "DSA")).map(
      (e: any) => e.path,
    );
  });
  expect(names).not.toContain("DSA/Graphs.excalidraw");
  // Obsidian: the tab follows the rename and the edit lands in the renamed file. Here the tab keeps
  await expect(page.getByTestId("vault-tab")).toHaveAttribute(
    "data-path",
    "DSA/Graphs renamed.excalidraw",
  );
  await expect(page.getByText("Conflict", { exact: true })).toHaveCount(0);
});

// Family member: a note (.md) open in a tab, and a drawing open in a background tab.
test("a note renamed outside while open: the tab follows or says so, never a silent stale tab", async ({
  page,
}) => {
  test.fixme(
    true,
    "toimprove 123 (rest): open notes do not follow an outside rename yet",
  );
  await openVault(page, "?seed=obsidian");
  await outside(page, { op: "create", path: "Fresh.md" });
  await expect(row(page, "Fresh.md")).toBeVisible();
  await row(page, "Fresh.md").click();
  await expect(page.getByTestId("vault-tab")).toHaveCount(1);
  await outside(page, { op: "rename", path: "Fresh.md", to: "Fresher.md" });
  await expect(row(page, "Fresher.md")).toBeVisible();
  await expect(page.getByTestId("vault-tab")).toHaveAttribute(
    "data-path",
    "Fresher.md",
  );
});

test("a drawing in a background tab renamed outside: the tab follows, it is not marked missing", async ({
  page,
}) => {
  test.fixme(
    true,
    "toimprove 123 (rest): background tabs keep no revision to pair the rename with",
  );
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, "DSA/Graphs.excalidraw").click();
  await row(page, "DSA/Dynamic Programming").click();
  await row(page, "DSA/Dynamic Programming/01 Introduction.excalidraw").click({
    modifiers: ["Meta"],
  });
  await expect(page.getByTestId("vault-tab")).toHaveCount(2);
  await outside(page, {
    op: "rename",
    path: "DSA/Graphs.excalidraw",
    to: "DSA/G2.excalidraw",
  });
  await expect(row(page, "DSA/G2.excalidraw")).toBeVisible();
  await expect(
    page.locator('[data-testid="vault-tab"][data-path="DSA/G2.excalidraw"]'),
  ).toHaveCount(1);
});
