import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

// Markdown mode, through visible UI only (toimprove 174): the chip turns it
// on, the text tool and the keyboard type **Bold** and `code` in two boxes.
// The asterisks and backticks go, the boxes take the bold variant and the
// monospaced font, Cmd+B flips the selected bold box back, Cmd+Z right after
// typing brings the marks back.
const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter(
    (el: any) => !el.isDeleted && el.type === "text",
  );
const textWith = async (page: Page, text: string) =>
  (await live(page)).find((el: any) => el.text === text);

const typeBox = async (page: Page, x: number, y: number, text: string) => {
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
};

test("Markdown mode: **Bold** and `code` typed alone in a box render, Cmd+B and Cmd+Z behave", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await editor(page).getByTestId("markdown-chip").click();

  await typeBox(page, 0.3, 0.8, "**Bold**");
  await expect(page.locator(textarea)).toHaveValue("Bold");
  await page.keyboard.press("Escape");

  await typeBox(page, 0.6, 0.8, "`code`");
  await expect(page.locator(textarea)).toHaveValue("code");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => !!(await textWith(page, "code")), { timeout: 10_000 })
    .toBe(true);
  const bold = await textWith(page, "Bold");
  const code = await textWith(page, "code");
  // bold: the regular id + 100; code: Cascadia (3)
  expect(bold.fontFamily).toBeGreaterThan(100);
  expect(code.fontFamily).toBe(3);

  // a half-typed pair and an unmatched one stay as typed
  await typeBox(page, 0.3, 0.9, "**open");
  await expect(page.locator(textarea)).toHaveValue("**open");
  await page.keyboard.press("Escape");

  // Cmd+Z right after the closing mark brings the marks back
  await typeBox(page, 0.6, 0.9, "**x**");
  await expect(page.locator(textarea)).toHaveValue("x");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(textarea)).toHaveValue("**x**");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => !!(await textWith(page, "**x**")), { timeout: 10_000 })
    .toBe(true);
  expect((await textWith(page, "**x**")).fontFamily).toBeLessThan(100);

  // Toggle bold (Cmd+B) on the selected bold box makes it regular, again makes it bold
  await typeBox(page, 0.8, 0.8, "**t**");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await textWith(page, "t"))?.fontFamily > 100)
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+b");
  await expect
    .poll(async () => (await textWith(page, "t"))?.fontFamily < 100)
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+b");
  await expect
    .poll(async () => (await textWith(page, "t"))?.fontFamily > 100)
    .toBe(true);
  expect(errors).toEqual([]);
});
