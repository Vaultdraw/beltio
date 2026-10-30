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

test("hunter I: Cmd+B on a selected text is one undo step; Cmd+Shift+Z redoes it (coverage)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await typeBox(page, 0.3, 0.8, "step");
  await page.keyboard.press("Escape");
  await (await fontOf(page, "step")).toBeLessThan(100);
  await page.keyboard.press("ControlOrMeta+b");
  await (await fontOf(page, "step")).toBeGreaterThan(100);
  await page.keyboard.press("ControlOrMeta+z");
  await (await fontOf(page, "step")).toBeLessThan(100);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await (await fontOf(page, "step")).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("hunter I: Cmd+L ticks the task of the selected text and ticks it back (coverage)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page);
  await editor(page).getByTestId("markdown-chip").click();
  await typeBox(page, 0.3, 0.8, "- [ ] buy milk");
  await expect(page.locator(textarea)).toHaveValue("☐ buy milk");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => !!(await textWith(page, "☐ buy milk")), {
      timeout: 10_000,
    })
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+l");
  await expect
    .poll(async () => !!(await textWith(page, "☑ buy milk")), {
      timeout: 10_000,
    })
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+l");
  await expect
    .poll(async () => !!(await textWith(page, "☐ buy milk")), {
      timeout: 10_000,
    })
    .toBe(true);
  expect(errors).toEqual([]);
});

// Family sweep for I-5: drawing-changing keys pressed in a text field outside the canvas.
// Each row: what is typed on the canvas, the key, and how the saved text must still read.
const FIELD_KEYS = [
  {
    key: "ControlOrMeta+l",
    typed: "- [ ] call Ana",
    shown: "☐ call Ana",
    same: (el: any) => el?.text === "☐ call Ana",
  },
  {
    key: "ControlOrMeta+b",
    typed: "plain words",
    shown: "plain words",
    same: (el: any) => el?.fontFamily < 100,
  },
];

for (const row of FIELD_KEYS) {
  test(`hunter I-5 family: ${row.key} typed in the navigator search box leaves the selected canvas text alone`, async ({
    page,
  }) => {
    test.fail();
    const errors = trackErrors(page);
    await open(page);
    await editor(page).getByTestId("markdown-chip").click();
    await typeBox(page, 0.3, 0.8, row.typed);
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => !!(await textWith(page, row.shown)), {
        timeout: 10_000,
      })
      .toBe(true);
    const search = page.getByPlaceholder("Search drawings and text…");
    await search.click();
    await search.type("gra");
    await page.keyboard.press(row.key);
    await page.waitForTimeout(3500);
    const all = (await readScene(page, DRAWING)).elements.filter(
      (el: any) => !el.isDeleted && el.type === "text",
    );
    const mine = all.find(
      (el: any) => el.text === row.shown || el.text === "☑ call Ana",
    );
    expect(row.same(mine)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("hunter I-12 (toimprove 237): Cmd+Z right after Enter on a heading takes the Enter back (Obsidian undoes the new line)", async ({
  page,
}) => {
  test.fail();
  const errors = trackErrors(page);
  await open(page);
  await editor(page).getByTestId("markdown-chip").click();
  await typeBox(page, 0.3, 0.7, "# Plan");
  await expect(page.locator(textarea)).toHaveValue("Plan");
  await page.keyboard.press("Enter");
  // a new, empty body box is being edited below the heading
  await expect(page.locator(textarea)).toHaveValue("");
  await page.keyboard.press("ControlOrMeta+z");
  // back in the heading, at its end, as before the Enter
  await expect(page.locator(textarea)).toHaveValue("Plan", { timeout: 3000 });
  expect(errors).toEqual([]);
});
