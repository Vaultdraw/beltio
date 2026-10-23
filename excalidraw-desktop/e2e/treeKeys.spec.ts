import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// The file tree's keys are list.* commands: after a click into the tree,
// j/k/h/l move, collapse and expand, Enter opens and r renames, while the
// same letters on the canvas still pick Excalidraw tools.
const ROWS = ".vault-tree-item[data-tree-path]";
const focusedRow = (page: Page) => page.locator(".vault-tree-item--focused");
const row = (page: Page, path: string) =>
  page.locator(`.vault-tree-item[data-tree-path="${path}"]`);

test("j/k/h/l move through the tree, Enter opens, keys stay off the canvas", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);

  // Click the DSA folder: it opens and becomes the cursor row.
  await row(page, "DSA").click();
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", "DSA");
  const paths = await page
    .locator(ROWS)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-tree-path")));
  const firstChild = paths[paths.indexOf("DSA") + 1]!;
  expect(firstChild.startsWith("DSA/")).toBe(true);

  // j/k step down and up.
  await page.keyboard.press("j");
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", firstChild);
  await page.keyboard.press("k");
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", "DSA");

  // h closes the open folder, l opens it again, l once more steps inside.
  await page.keyboard.press("h");
  await expect(row(page, firstChild)).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(row(page, firstChild)).toBeVisible();
  await page.keyboard.press("l");
  await expect(focusedRow(page)).toHaveAttribute("data-tree-path", firstChild);

  // Walk to Graphs and open it with Enter.
  for (let i = 0; i < 40; i++) {
    if (
      (await focusedRow(page).getAttribute("data-tree-path")) ===
      "DSA/Graphs.excalidraw"
    ) {
      break;
    }
    await page.keyboard.press("j");
  }
  await expect(focusedRow(page)).toHaveAttribute(
    "data-tree-path",
    "DSA/Graphs.excalidraw",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".vault-tree-item--active[data-tree-path]"),
  ).toHaveAttribute("data-tree-path", "DSA/Graphs.excalidraw");

  // r asks to rename the focused row; Escape closes the dialog.
  await row(page, "DSA/Graphs.excalidraw").click();
  await page.keyboard.press("r");
  const rename = page.getByRole("dialog");
  await expect(rename).toBeVisible();
  await expect(rename.getByRole("textbox")).toHaveValue(/Graphs/);
  // Typing j in the (pre-selected) name field types it; the cursor stays.
  await page.keyboard.type("j");
  await expect(rename.getByRole("textbox")).toHaveValue("j");
  await expect(focusedRow(page)).toHaveAttribute(
    "data-tree-path",
    "DSA/Graphs.excalidraw",
  );
  await page.keyboard.press("Escape");
  await expect(rename).toHaveCount(0);

  // On the canvas, r is Excalidraw's rectangle tool, not a tree rename.
  await page.locator(".vault-editor .excalidraw-container").click({
    position: { x: 300, y: 300 },
  });
  await page.keyboard.press("r");
  await expect(page.locator("#rename-input")).toHaveCount(0);
  await expect(
    page.locator('.vault-editor [data-testid="toolbar-rectangle"]'),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
