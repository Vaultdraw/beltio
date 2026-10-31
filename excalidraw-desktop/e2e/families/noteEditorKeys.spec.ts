import { type Page } from "@playwright/test";

import { expect, test } from "../fixture";

import { openVault } from "../helpers";

// toimprove 280 (hunter L-12) [notes]: the note editor's Obsidian keys through visible UI.
// Enter continues a list (an empty item ends it), Mod+B / Mod+I wrap the selection (the window's
// command dispatcher runs Notes: Bold / Italic), Mod+F opens find in the note. Autosave off so
// the text checked is the editor's.

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const seed = async (page: Page, path: string, text: string) => {
  await page.evaluate(
    ([p, t]) => {
      const w = window as any;
      w.__noteFiles.setOnDisk(p, t);
      w.__vaultRepo.seedNote(p);
      w.__vaultRepo.emit({
        handle: w.__vaultRepo.handle,
        paths: [],
        rescan: true,
      });
    },
    [path, text],
  );
};

const edit = async (page: Page, path: string, name: string) => {
  await page
    .locator(`[data-tree-path="${path}"] .vault-tree-item__name`)
    .click();
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
  const button = page.getByRole("button", { name: "Edit note" });
  const editor = page.getByTestId("note-editor");
  await expect(button.or(editor)).toBeVisible();
  if (await button.isVisible()) {
    await button.click();
  }
  await editor.locator(".cm-content").click();
  return editor;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__e2eConfig = { notes: { autosave_ms: 0 } };
  });
  await openVault(page, "?seed=obsidian&config=1");
});

test("note editor: Enter continues a list, Mod+B / Mod+I wrap, Mod+F finds", async ({
  page,
}) => {
  await seed(page, "Keys.md", "- milk");
  const editor = await edit(page, "Keys.md", "Keys");
  const content = editor.locator(".cm-content");
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("eggs");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("word");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press(`${MOD}+b`);
  await expect(content).toHaveText(/- milk- eggs\*\*word\*\*$/);
  await page.keyboard.press(`${MOD}+i`);
  await expect(content).toHaveText(/\*\*\*word\*\*\*$/);
  await page.keyboard.press(`${MOD}+f`);
  await expect(editor.locator(".cm-search input[name=search]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor.locator(".cm-search")).toHaveCount(0);
});
