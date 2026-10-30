import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// Bug hunter J (2026-10-30 evening) [notes]: Vim keys in the note editor (`notes.vim`), reached
// through visible UI. Vim and Obsidian's Vim mode are the answer key: the editor starts in normal
// mode, `i`/`o` insert, Esc leaves insert, `:w` writes the note the cursor is in. Autosave is off
// (`notes.autosave_ms = 0`) so only `:w` can have saved. No spec drove these keys before
// (COVERAGE-G gap 2).

const seed = async (page: Page, notes: Record<string, string>) => {
  await page.evaluate((all) => {
    const w = window as any;
    for (const [path, text] of Object.entries(all)) {
      w.__noteFiles.setOnDisk(path, text);
      w.__vaultRepo.seedNote(path);
    }
    w.__vaultRepo.emit({
      handle: w.__vaultRepo.handle,
      paths: [],
      rescan: true,
    });
  }, notes);
};

const onDisk = (page: Page, path: string) =>
  page.evaluate(
    (p) => (window as any).__noteFiles.textOf(p) as string | undefined,
    path,
  );

const editWithVim = async (
  page: Page,
  path: string,
  name: string,
  newTab = false,
) => {
  await page
    .locator(`[data-tree-path="${path}"] .vault-tree-item__name`)
    .click(newTab ? { modifiers: ["Meta"] } : undefined);
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
  // A note opens in the mode the last one was left in (reading or editing).
  const edit = page.getByRole("button", { name: "Edit note" });
  const editor = page.getByTestId("note-editor");
  await expect(edit.or(editor)).toBeVisible();
  if (await edit.isVisible()) {
    await edit.click();
  }
  await editor.locator(".cm-content").click();
  // Vim keys are a lazy chunk: wait until the editor is in Vim's normal mode.
  await expect(editor.locator(".cm-vimMode")).toHaveCount(1);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { notes: { vim: true, autosave_ms: 0 } };
  });
  await openVault(page, "?seed=obsidian&config=1");
});

test("notes Vim keys: normal mode does not type, o opens a line, :w saves", async ({
  page,
}) => {
  await seed(page, { "Alpha.md": "# Alpha\n\nfirst line\n" });
  await editWithVim(page, "Alpha.md", "Alpha");
  // Normal mode: these letters are motions, not text.
  await page.keyboard.type("Gx");
  await page.keyboard.type("ovim line");
  await page.keyboard.press("Escape");
  expect(await onDisk(page, "Alpha.md")).toBe("# Alpha\n\nfirst line\n");
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await expect.poll(() => onDisk(page, "Alpha.md")).toContain("vim line");
  const saved = (await onDisk(page, "Alpha.md"))!;
  expect(saved).not.toContain("Gx");
  expect(saved).not.toContain("ovim");
});

test("notes Vim keys: :w in a note opened in a second tab saves that note (toimprove 212)", async ({
  page,
}) => {
  await seed(page, {
    "Alpha.md": "# Alpha\n\none\n",
    "Beta.md": "# Beta\n\ntwo\n",
  });
  await editWithVim(page, "Alpha.md", "Alpha");
  await page.keyboard.press("Escape");
  await editWithVim(page, "Beta.md", "Beta", true);
  await page.keyboard.type("Goline in beta");
  await page.keyboard.press("Escape");
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => onDisk(page, "Beta.md"), { timeout: 3000 })
    .toContain("line in beta");
});
