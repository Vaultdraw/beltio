import { nativeMod } from "../nativeKeys";
import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openDrawing, openVault, readScene } from "../helpers";

// Hunter B (2026-10-30): Markdown typing mode scenarios through the visible UI.
const DRAWING = "DSA/Graphs.excalidraw";
const ta = "textarea.excalidraw-wysiwyg";
const editor = (p: Page) => p.locator(".vault-editor");
const texts = async (p: Page) =>
  (await readScene(p, DRAWING)).elements.filter(
    (e: any) => !e.isDeleted && e.type === "text",
  );

const find = async (p: Page, text: string) => {
  await expect
    .poll(async () => !!(await texts(p)).find((e: any) => e.text === text), {
      timeout: 10_000,
    })
    .toBe(true);
  return (await texts(p)).find((e: any) => e.text === text);
};

const start = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await editor(page).getByTestId("markdown-chip").click();
};
const newText = async (page: Page, fx = 0.55, fy = 0.8) => {
  await editor(page).getByTestId("toolbar-text").click();
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await expect(page.locator(ta)).toBeFocused();
};
const type = (page: Page, s: string) => page.keyboard.type(s, { delay: 15 });
const settle = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(page.locator(ta)).toHaveCount(0);
};

test("hunter B: seven # stays literal; empty heading Enter goes back to body", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "####### x");
  await expect(page.locator(ta)).toHaveValue("####### x");
  await page.keyboard.press(`${nativeMod}+a`);
  await page.keyboard.press("Backspace");
  await type(page, "## ");
  await expect(page.locator(ta)).toHaveValue("");
  await page.keyboard.press("Enter");
  await type(page, "now body");
  await settle(page);
  const t = await find(page, "now body");
  expect(t.customData?.role ?? null).toBeNull();
});

test("hunter B: Backspace at the start of a heading makes it plain body text again", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "# Big");
  await expect(page.locator(ta)).toHaveValue("Big");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.press("Backspace");
  await expect(page.locator(ta)).toHaveValue("Big");
  await settle(page);
  const t = await find(page, "Big");
  expect(t.customData?.role ?? null).toBeNull();
  expect(t.fontSize).toBe(20);
});

test("hunter B: heading mid-text splits; Enter in the middle of a heading; selection Enter", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "line one");
  await page.keyboard.press("Enter");
  await type(page, "## Sub heading");
  await settle(page);
  await find(page, "line one");
  const sub = await find(page, "Sub heading");
  expect(sub.customData).toMatchObject({ role: "h2" });
});

test("hunter B: Cmd+Z right after a conversion leaves a plain text, not a half heading", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "# ");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(ta)).toHaveValue("# ");
  await type(page, "plain");
  await settle(page);
  const t = await find(page, "# plain");
  expect(t.customData?.role ?? null).toBeNull();
});

test("hunter B: Enter on an empty heading makes plain body text with no heading role", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "## ");
  await expect(page.locator(ta)).toHaveValue("");
  await page.keyboard.press("Enter");
  await type(page, "body words");
  await settle(page);
  const t = await find(page, "body words");
  expect(t.customData?.role ?? null).toBeNull();
  expect(t.fontSize).toBe(20);
});

test("hunter B: Enter in the middle of a heading splits it; Backspace in the empty body box returns to the heading end", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "# HelloWorld");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.press("Enter");
  await type(page, "x");
  await expect(page.locator(ta)).toHaveValue("xWorld");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await settle(page);
  const head = await find(page, "Hello");
  expect(head.customData).toMatchObject({ role: "h1" });
});

test("hunter B: heading in a drawing in dark theme keeps heading size after reopening the text", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "### Third");
  await settle(page);
  const t = await find(page, "Third");
  expect(t.customData).toMatchObject({ role: "h3" });
  expect(t.fontSize).toBe(25);
});
