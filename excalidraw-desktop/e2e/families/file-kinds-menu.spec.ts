import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";

// Family: every kind of file in the tree gets the same row menu and the same working
// rename, move and trash, like Obsidian and Finder (BH-7, toimprove 94). One row per
// kind; add a kind = add a row. Reached through the visible row menu and its dialogs.

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const exists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const entries = await repo.listDirectory(repo.handle, dir);
    return entries.some((e: any) => e.path === p);
  }, path);

const menuItem = async (page: Page, path: string, label: string) => {
  const r = row(page, path);
  await r.hover();
  await r.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: label });
};

type Kind = {
  name: string;
  file: string;
  renamed: string;
  seed: (page: Page, path: string) => Promise<void>;
  word: string;
};

const seedNote = (page: Page, path: string) =>
  page.evaluate((p) => (window as any).__vaultRepo.seedNote(p), path);
const seedDrawing = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as any).__vaultRepo.seedDrawing(
        p,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [],
          appState: {},
          files: {},
        }),
      ),
    path,
  );

const KINDS: Kind[] = [
  {
    name: "note",
    file: "Plan.md",
    renamed: "Roadmap.md",
    seed: seedNote,
    word: "Note",
  },
  {
    name: "drawing",
    file: "Sketch.excalidraw",
    renamed: "Diagram.excalidraw",
    seed: seedDrawing,
    word: "Drawing",
  },
  {
    name: "Obsidian Excalidraw file",
    file: "Board.excalidraw.md",
    renamed: "Canvas.excalidraw.md",
    seed: seedNote,
    word: "Drawing",
  },
];

for (const kind of KINDS) {
  test(`row menu: a ${kind.name} can be renamed, moved and trashed`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?seed=empty");
    await page.evaluate(() => (window as any).__vaultRepo.seedFolder("Dest"));
    await kind.seed(page, kind.file);
    await page.getByRole("button", { name: "Refresh files" }).click();
    await expect(row(page, kind.file)).toBeVisible();

    // The menu offers all three, with the plain labels.
    for (const label of ["Rename…", "Move to…", "Move to Trash"]) {
      await expect(await menuItem(page, kind.file, label)).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // Rename keeps the extension.
    await (await menuItem(page, kind.file, "Rename…")).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Rename ${kind.word.toLowerCase()}`);
    await dialog.getByLabel("New name").fill(kind.renamed.split(".")[0]);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => exists(page, kind.renamed)).toBe(true);
    await expect.poll(() => exists(page, kind.file)).toBe(false);

    // Move into a folder.
    await (await menuItem(page, kind.renamed, "Move to…")).click();
    await expect(dialog).toContainText(`Move ${kind.word.toLowerCase()}`);
    await page.keyboard.type("dest");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    const moved = `Dest/${kind.renamed}`;
    await expect.poll(() => exists(page, moved)).toBe(true);
    await expect.poll(() => exists(page, kind.renamed)).toBe(false);

    // Trash.
    await expect(row(page, moved)).toBeVisible();
    await (await menuItem(page, moved, "Move to Trash")).click();
    await expect(dialog).toContainText(`Delete ${kind.word.toLowerCase()}`);
    await dialog.getByRole("button", { name: "Move to Trash" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => exists(page, moved)).toBe(false);
    await expect(row(page, moved)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
