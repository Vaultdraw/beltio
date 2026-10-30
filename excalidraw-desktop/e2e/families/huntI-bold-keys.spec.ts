import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Hunter I (2026-10-30), [canvas]: "Markdown: Toggle bold" (Cmd+B) through visible UI.
// Docs (configuration.md): it "flips the box being edited, or every selected text, between
// bold and its regular font. It works with the mode off too." Every row types with the text
// tool and the keyboard, and reads the saved drawing.
const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");

const textWith = async (page: Page, text: string) =>
  (await readScene(page, DRAWING)).elements.find(
    (el: any) => !el.isDeleted && el.type === "text" && el.text === text,
  );

const open = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const typeBox = async (page: Page, x: number, y: number, text: string) => {
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
};

const fontOf = async (page: Page, text: string) =>
  expect.poll(async () => (await textWith(page, text))?.fontFamily ?? null, {
    timeout: 10_000,
  });

test("hunter I: Cmd+B while typing a box with Markdown mode on makes it bold (coverage)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await editor(page).getByTestId("markdown-chip").click();
  await typeBox(page, 0.3, 0.8, "loud");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Escape");
  await (await fontOf(page, "loud")).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("hunter I: Cmd+B while typing a box with Markdown mode off makes it bold, as documented (coverage)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await typeBox(page, 0.3, 0.8, "plain");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Escape");
  await (await fontOf(page, "plain")).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("hunter I-5 (toimprove 220): Cmd+B typed in the navigator search box does not change the selected canvas text", async ({
  page,
}) => {
  test.fail();
  const errors = trackErrors(page);
  await open(page);
  await typeBox(page, 0.3, 0.8, "keep");
  // Escape ends editing and leaves the box selected
  await page.keyboard.press("Escape");
  await (await fontOf(page, "keep")).toBeLessThan(100);
  const search = page.getByPlaceholder("Search drawings and text…");
  await search.click();
  await search.type("gra");
  await page.keyboard.press("ControlOrMeta+b");
  // give a wrong toggle time to land and save
  await page.waitForTimeout(3500);
  expect((await textWith(page, "keep"))?.fontFamily).toBeLessThan(100);
  expect(errors).toEqual([]);
});
