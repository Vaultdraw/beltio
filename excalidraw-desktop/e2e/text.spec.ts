import { expect, test } from "@playwright/test";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "./helpers";
import { AFTER_AUTOSAVE_MS } from "./constants";

const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";

const textElements = async (page: Parameters<typeof readScene>[0]) =>
  (await readScene(page, DRAWING)).elements
    .filter((el: any) => el.type === "text" && !el.isDeleted)
    .map((el: any) => el.text);

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("typing survives autosave pauses and is saved", async ({ page }, info) => {
  const errors = trackErrors(page);
  const box = await canvasBox(page);
  await page.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await expect(page.locator(textarea)).toBeFocused();

  await page.keyboard.type("Hello", { delay: 30 });
  // Longer than the idle autosave so at least one save + watcher echo happens.
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(" vault rocks", { delay: 30 });
  await expect(page.locator(textarea)).toHaveValue("Hello vault rocks");

  // Typing letters must never switch tools (r = rectangle, etc).
  await expect(
    page.locator(".vault-editor [data-testid='toolbar-rectangle']"),
  ).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);
  await expect
    .poll(() => textElements(page), { timeout: 5000 })
    .toContain("Hello vault rocks");
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-text-saved.png`,
  });
  expect(errors).toEqual([]);
});

test("window losing OS focus mid-edit commits the text without losing characters", async ({
  page,
}) => {
  // WebKit blurs the focused element when the window stops being key (app
  // switch, window manager focus moves); Excalidraw commits on blur. This is
  // what closed the packaged smoke's editor, not autosave.
  const errors = trackErrors(page);
  const box = await canvasBox(page);
  await page.mouse.dblclick(box.x + box.width * 0.4, box.y + box.height * 0.75);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("Focus lost", { delay: 20 });
  await page.locator(textarea).evaluate((el) => {
    el.dispatchEvent(new FocusEvent("blur"));
    window.dispatchEvent(new FocusEvent("blur"));
  });
  await expect(page.locator(textarea)).toHaveCount(0);
  await expect
    .poll(() => textElements(page), { timeout: 5000 })
    .toContain("Focus lost");
  expect(errors).toEqual([]);
});

test("Cmd/Ctrl+S while typing commits and saves (matches excalidraw.com)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const box = await canvasBox(page);
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.8);
  await page.keyboard.type("Saved mid-edit", { delay: 20 });
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() => textElements(page), { timeout: 5000 })
    .toContain("Saved mid-edit");
  await expect(page.locator(".vault-status--saved")).toBeVisible();
  expect(errors).toEqual([]);
});

test("text tool via toolbar + editing existing text", async ({ page }) => {
  const errors = trackErrors(page);
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-text']").click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.8);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("Tool text", { delay: 20 });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => textElements(page), { timeout: 5000 })
    .toContain("Tool text");

  // Re-enter editing on the existing element by double-clicking it.
  await page.mouse.dblclick(
    box.x + box.width * 0.3 + 10,
    box.y + box.height * 0.8 + 5,
  );
  await expect(page.locator(textarea)).toBeFocused();
  // Move the caret to the end (End is not end-of-line on macOS WebKit).
  await page
    .locator(textarea)
    .evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length, el.value.length),
    );
  await page.keyboard.type(" edited", { delay: 20 });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => textElements(page), { timeout: 5000 })
    .toContain("Tool text edited");
  expect(errors).toEqual([]);
});

test("inputs outside the canvas accept typing", async ({ page }) => {
  const search = page.getByPlaceholder("Search drawings and text…");
  await search.click();
  await page.keyboard.type("Graphs");
  await expect(search).toHaveValue("Graphs");
  // Canvas shortcuts must not fire while typing in the search box.
  await expect(
    page.locator(".vault-editor [data-testid='toolbar-rectangle']"),
  ).toHaveAttribute("aria-pressed", "false");
});
