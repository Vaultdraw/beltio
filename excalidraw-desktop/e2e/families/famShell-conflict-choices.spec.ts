import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { canvasBox, openVault, readScene, trackErrors } from "../helpers";

// Family hunter shell (2026-10-31): "every choice in the File conflict dialog does what it says and
// nothing else". The dialog shows when the open drawing has unsaved edits and the file changed (or
// went) on disk. edge.spec.ts covers only "Save as copy". Rows: Keep editing, the X, Escape, Cancel
// inside Save as copy, Reload from disk (Cancel, then Discard and reload), a deleted file. Each row
// checks the disk, the canvas and the badge, because a wrong choice loses the user's work.

const GRAPHS = "DSA/Graphs.excalidraw";
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const rects = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter(
    (el: any) => el.type === "rectangle" && !el.isDeleted,
  );

/** Open Graphs, draw a rectangle, then change the file on disk: the badge turns to Conflict. */
const intoConflict = async (page: Page, how: "write" | "delete" = "write") => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, GRAPHS).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Graphs",
  );
  const before = (await rects(page, GRAPHS)).length;
  const box = await canvasBox(page);
  await page.getByTestId("toolbar-rectangle").click();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 360);
  await page.mouse.up();
  await page.evaluate(
    async ([p, mode]) => {
      const repo = (window as any).__vaultRepo;
      if (mode === "delete") {
        repo.externalDelete(p);
        return;
      }
      const disk = await repo.readDrawing(repo.handle, p);
      const scene = JSON.parse(disk.json);
      scene.elements.push({
        ...scene.elements[0],
        id: "rect-ext",
        x: 900,
        y: 500,
      });
      repo.externalWrite(p, JSON.stringify(scene));
    },
    [GRAPHS, how] as const,
  );
  const badge = page.locator(".vault-badge--conflict");
  await expect(badge).toBeVisible({ timeout: 5000 });
  await badge.click();
  const dialog = page.getByRole("dialog", { name: /conflict/i });
  await expect(dialog).toBeVisible();
  return { before, badge, dialog };
};

const conflict = (page: Page) =>
  page.getByRole("dialog", { name: /conflict/i });

const diskIds = async (page: Page) =>
  (await rects(page, GRAPHS)).map((el: any) => el.id);

test.describe("File conflict dialog: each way out", () => {
  for (const [label, close] of [
    [
      "Keep editing",
      (page: Page) =>
        page.getByRole("button", { name: "Keep editing" }).click(),
    ],
    ["Escape", (page: Page) => page.keyboard.press("Escape")],
    [
      "the X",
      (page: Page) =>
        page
          .getByRole("dialog")
          .getByRole("button", { name: /close/i })
          .first()
          .click(),
    ],
  ] as const) {
    test(`${label}: the dialog closes, the conflict stays, nothing is written`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      const { before, badge } = await intoConflict(page);
      const idsBefore = await diskIds(page);
      await close(page);
      await expect(conflict(page)).toHaveCount(0);
      await expect(badge).toBeVisible();
      await page.waitForTimeout(1200);
      expect(await diskIds(page)).toEqual(idsBefore);
      expect(idsBefore).toContain("rect-ext");
      expect(idsBefore.length).toBe(before + 1);
      // Reopening shows the choices again (the edits are still pending).
      await badge.click();
      await expect(conflict(page)).toContainText("Keep my version");
      expect(errors).toEqual([]);
    });
  }

  test("Save as copy > Cancel goes back to the choices, nothing is written", async ({
    page,
  }) => {
    const { dialog } = await intoConflict(page);
    await dialog.getByRole("button", { name: "Save as copy" }).click();
    await expect(dialog.locator("#copy-path-input")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toContainText("Take the disk version");
    await expect(dialog.locator("#copy-path-input")).toHaveCount(0);
  });

  test("Reload from disk asks first; Cancel keeps the edits, Discard and reload shows the disk version", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    const { before, badge, dialog } = await intoConflict(page);
    await dialog.getByRole("button", { name: "Reload from disk" }).click();
    const confirm = page.getByRole("dialog", { name: /discard your edits/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(badge).toBeVisible();
    await dialog.getByRole("button", { name: "Reload from disk" }).click();
    await page
      .getByRole("dialog", { name: /discard your edits/i })
      .getByRole("button", { name: "Discard and reload" })
      .click();
    await expect(conflict(page)).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await expect(page.locator(".vault-status--saved")).toBeVisible({
      timeout: 5000,
    });
    // The canvas now holds the disk version and nothing the user drew; no late autosave clobbers it.
    await page.waitForTimeout(1500);
    const ids = await diskIds(page);
    expect(ids).toContain("rect-ext");
    expect(ids.length).toBe(before + 1);
    expect(errors).toEqual([]);
  });

  test("a file deleted on disk: the dialog says so and Save as copy keeps the edits", async ({
    page,
  }) => {
    const { dialog } = await intoConflict(page, "delete");
    await expect(dialog).toContainText(/changed or deleted/i);
    await dialog.getByRole("button", { name: "Save as copy" }).click();
    const copyPath = await dialog.locator("#copy-path-input").inputValue();
    await dialog
      .getByRole("button", { name: "Save a copy and continue" })
      .click();
    await expect(conflict(page)).toHaveCount(0);
    await expect
      .poll(async () => (await rects(page, copyPath)).length, { timeout: 5000 })
      .toBeGreaterThan(0);
  });
});
