import { expect, test } from "@playwright/test";

import { openDrawing, openVault, trackErrors } from "./helpers";

// files.speculative_open: pressing the mouse on a tree row reads that drawing
// before the button is released (nothing changes on screen); the click then
// opens it from that read. Settings > Files switches it off live.
test("pressing on a drawing reads it ahead; the setting turns that off", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  const name = (text: string) =>
    page.locator(".vault-tree-item__name", { hasText: text }).first();
  await name("DSA").click();
  await name("Dynamic Programming").click();
  await openDrawing(page, "Graphs");

  await page.evaluate(() => {
    const w = window as any;
    const repo = w.__vaultRepo;
    const original = repo.readDrawing.bind(repo);
    w.__reads = [];
    repo.readDrawing = (handle: string, path: string) => {
      w.__reads.push(path);
      return original(handle, path);
    };
  });
  const reads = (path: string) =>
    page.evaluate(
      (p) => (window as any).__reads.filter((r: string) => r === p).length,
      path,
    );
  const intro = "DSA/Dynamic Programming/01 Introduction.excalidraw";
  const active = page.locator(
    ".vault-tree-item--active .vault-tree-item__name",
  );

  await name("01 Introduction").hover();
  await page.mouse.down();
  await expect.poll(() => reads(intro)).toBe(1);
  await expect(active).toHaveText("Graphs"); // still the old drawing: only a read
  await page.mouse.up();
  await expect(active).toHaveText("01 Introduction");
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  expect(await reads(intro)).toBe(1); // the click opened from the read ahead

  await page.keyboard.press("Meta+Comma");
  const modal = page.locator(".vault-settings-modal");
  await expect(modal).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();
  const toggle = modal.getByRole("switch", {
    name: "Read drawings ahead on mouse-down",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);

  const graphs = "DSA/Graphs.excalidraw";
  await name("Graphs").hover();
  await page.mouse.down();
  await page.waitForTimeout(200);
  expect(await reads(graphs)).toBe(0); // off: nothing read before the click
  await page.mouse.up();
  await expect(active).toHaveText("Graphs");
  expect(errors).toEqual([]);
});
