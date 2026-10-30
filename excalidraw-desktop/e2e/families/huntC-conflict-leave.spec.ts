import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { canvasBox, openVault } from "../helpers";

// Hunter C (2026-10-30, C-8): the open drawing is in "Conflict" (unsaved edit plus an outside change).
// Obsidian and Neovim let you leave the buffer: the other note opens, nothing is lost. Here the click on
// another drawing must either open it or visibly explain (dialog or notice). Silence is the bug:
// the control API reports "Could not open X (IO_ERROR)" for the same step.

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

test("a drawing in conflict: clicking another drawing opens it or says why, never does nothing", async ({
  page,
}) => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, "DSA/Graphs.excalidraw").click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Graphs",
  );
  const box = await canvasBox(page);
  await page.getByTestId("toolbar-rectangle").click();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 360);
  await page.mouse.up();
  await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    const p = "DSA/Graphs.excalidraw";
    const disk = await repo.readDrawing(repo.handle, p);
    const scene = JSON.parse(disk.json);
    scene.elements.push({ ...scene.elements[0], id: "ext", x: 900, y: 500 });
    repo.externalWrite(p, JSON.stringify(scene));
  });
  await expect(page.locator(".vault-badge--conflict")).toBeVisible({
    timeout: 5000,
  });
  await row(page, "DSA/Dynamic Programming").click();
  await row(page, "DSA/Dynamic Programming/01 Introduction.excalidraw").click();
  await page.waitForTimeout(1500);
  const opened = await page
    .getByRole("tab", { selected: true })
    .filter({ hasText: "Introduction" })
    .count();
  const explained =
    (await page.getByRole("dialog").count()) +
    (await page.locator("[role=alert], [role=status], .vault-toast").count());
  expect(opened + explained).toBeGreaterThan(0);
});
