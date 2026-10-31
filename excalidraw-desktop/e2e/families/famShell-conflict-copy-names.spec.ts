import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { canvasBox, openVault, readScene } from "../helpers";

// Family hunter shell (2026-10-31), "name rules: dialog = core": the File conflict dialog's
// "Save as copy" takes a free path with no check of its own. A name the New and Rename dialogs
// refuse (`a?b`, `..`, a taken name) must not create a file here either, must say why in plain
// words, and must not lose the edits (the dialog stays open, the conflict stays). A typed name
// without the extension gets one, as the New dialog does (Obsidian adds .md the same way).

const GRAPHS = "DSA/Graphs.excalidraw";
const INTRO = "DSA/Dynamic Programming/01 Introduction.excalidraw";
const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const toCopyField = async (page: Page) => {
  await openVault(page);
  await row(page, "DSA").click();
  await row(page, GRAPHS).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Graphs",
  );
  const box = await canvasBox(page);
  await page.getByTestId("toolbar-rectangle").click();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 360);
  await page.mouse.up();
  await page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const disk = await repo.readDrawing(repo.handle, p);
    const scene = JSON.parse(disk.json);
    scene.elements.push({
      ...scene.elements[0],
      id: "rect-ext",
      x: 900,
      y: 500,
    });
    repo.externalWrite(p, JSON.stringify(scene));
  }, GRAPHS);
  const badge = page.locator(".vault-badge--conflict");
  await expect(badge).toBeVisible({ timeout: 5000 });
  await badge.click();
  const dialog = page.getByRole("dialog", { name: /conflict/i });
  await dialog.getByRole("button", { name: "Save as copy" }).click();
  return { dialog, badge, field: dialog.locator("#copy-path-input") };
};

const exists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    try {
      await repo.readDrawing(repo.handle, p);
      return true;
    } catch {
      return false;
    }
  }, path);

const REFUSED: [label: string, typed: string][] = [
  ["a question mark", "DSA/a?b.excalidraw"],
  ["a parent folder", "../escape.excalidraw"],
  ["a taken name", INTRO],
  ["the file itself", GRAPHS],
];

test.describe(
  "File conflict > Save as copy takes the name rules of the core",
  () => {
    for (const [label, typed] of REFUSED) {
      const run = async ({ page }: { page: Page }) => {
        const { dialog, badge, field } = await toCopyField(page);
        const introBefore = (await readScene(page, INTRO)).elements.length;
        await field.fill(typed);
        await dialog
          .getByRole("button", { name: "Save a copy and continue" })
          .click();
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(/\S/);
        const text = (await dialog.innerText()).toLowerCase();
        expect(text).not.toMatch(
          /os error|errno|enoent|invalid_argument|\[object|undefined/,
        );
        await expect(
          dialog
            .getByText(
              /can.?t|cannot|already|invalid|not allowed|exists|refuse/i,
            )
            .first(),
        ).toBeVisible();
        await expect(badge).toBeVisible();
        expect((await readScene(page, INTRO)).elements.length).toBe(
          introBefore,
        );
        expect(await exists(page, "escape.excalidraw")).toBe(false);
      };
      // `..`: the fake words it in jargon (toimprove 317); the Mac user reads the native words.
      const title = `${label}: refused in plain words, nothing created, edits kept`;
      test(title, run);
    }

    // toimprove 318: the dialog refuses it instead of adding the extension like the New dialog.
    test("a name typed without the extension becomes a drawing the tree shows", async ({
      page,
    }) => {
      const { dialog, field } = await toCopyField(page);
      await field.fill("DSA/My kept edits");
      await dialog
        .getByRole("button", { name: "Save a copy and continue" })
        .click();
      await expect(page.getByRole("dialog", { name: /conflict/i })).toHaveCount(
        0,
      );
      await expect(row(page, "DSA/My kept edits.excalidraw")).toBeVisible();
      expect(await exists(page, "DSA/My kept edits")).toBe(false);
    });
  },
);
