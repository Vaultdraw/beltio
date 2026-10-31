import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openDrawing, openVault, trackErrors } from "../helpers";

// Family hunter canvas (2026-10-31), [canvas]: Cmd+Z right after an automatic edit of Markdown
// typing takes it back (Obsidian undoes the list bullet an Enter added in one step). The unit
// table is src/tests/famCanvasAutoEditUndo.family.test.ts; this is the same table in the real
// editor, where a programmatic textarea value also kills the browser's own undo stack.
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");

const open = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const typeBox = async (page: Page, text: string) => {
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
};

type Row = {
  name: string;
  typed: string;
  /** keys pressed after `typed`, the last one is the automatic edit */
  keys: string[];
  /** the text before the last key */
  before: string;
  /** toimprove number when broken */
  broken?: number;
};

const ROWS: Row[] = [
  {
    name: "Enter continues a bullet list",
    typed: "- a",
    keys: ["Enter"],
    before: "• a",
    broken: 301,
  },
  {
    name: "Enter continues a numbered list",
    typed: "1. a",
    keys: ["Enter"],
    before: "1. a",
    broken: 301,
  },
  {
    name: "Enter on an empty item ends the list",
    typed: "- a",
    keys: ["Enter", "Enter"],
    before: "• a\n• ",
    broken: 301,
  },
];

for (const row of ROWS) {
  (row.broken !== undefined ? test.fail : test)(
    `family canvas: Cmd+Z takes back "${row.name}"`,
    async ({ page }) => {
      const errors = trackErrors(page);
      await open(page);
      await editor(page).getByTestId("markdown-chip").click();
      await typeBox(page, row.typed);
      for (const k of row.keys) {
        await page.keyboard.press(k);
      }
      await expect(page.locator(textarea)).not.toHaveValue(row.before);
      await page.keyboard.press("Meta+z");
      await expect(page.locator(textarea)).toHaveValue(row.before, {
        timeout: 3000,
      });
      expect(errors).toEqual([]);
    },
  );
}
