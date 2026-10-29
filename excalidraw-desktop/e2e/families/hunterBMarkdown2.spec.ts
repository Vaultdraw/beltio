import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { canvasBox, openDrawing, openVault, readScene } from "../helpers";
import { runCommand } from "../pageHelpers";

// Hunter B round 3 (2026-10-30): lists, tasks, quotes, Cmd+L and a theme switch while typing.
const DRAWING = "DSA/Graphs.excalidraw";
const ta = "textarea.excalidraw-wysiwyg";
const editor = (p: Page) => p.locator(".vault-editor");
const texts = async (p: Page) =>
  (await readScene(p, DRAWING)).elements.filter(
    (e: any) => !e.isDeleted && e.type === "text",
  );
const start = async (page: Page) => {
  await openVault(page);
  await page.locator(".vault-tree-item__name", { hasText: "DSA" }).first().click();
  await openDrawing(page, "Graphs");
  await editor(page).getByTestId("markdown-chip").click();
};
const newText = async (page: Page) => {
  await editor(page).getByTestId("toolbar-text").click();
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.8);
  await expect(page.locator(ta)).toBeFocused();
};
const type = (page: Page, s: string) => page.keyboard.type(s, { delay: 15 });

test("hunter B: bullets, numbers and tasks continue, nest with Tab and end on an empty item", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "- one");
  await page.keyboard.press("Enter");
  await type(page, "two");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await type(page, "nested");
  await expect(page.locator(ta)).toHaveValue("• one\n• two\n    • nested");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator(ta)).toHaveValue("• one\n• two\n    • nested\n");
  await page.keyboard.press("Enter");
  await type(page, "1. a");
  await page.keyboard.press("Enter");
  await type(page, "b");
  await page.keyboard.press("Enter");
  await expect(page.locator(ta)).toHaveValue(/1\. a\n2\. b\n3\. $/);
});

test("hunter B: Cmd+L toggles the task on the caret line and undo keeps the text", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "[ ] buy");
  await expect(page.locator(ta)).toHaveValue("☐ buy");
  await page.keyboard.press("Meta+l");
  await expect(page.locator(ta)).toHaveValue("☑ buy");
  await page.keyboard.press("Meta+l");
  await expect(page.locator(ta)).toHaveValue("☐ buy");
});

test("hunter B: > makes a quote and Enter on its empty last line ends it", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "> wise");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await type(page, "plain");
  await page.keyboard.press("Escape");
  await expect(page.locator(ta)).toHaveCount(0);
  await expect
    .poll(async () => (await texts(page)).some((e: any) => e.text === "plain"), {
      timeout: 10_000,
    })
    .toBe(true);
  const t = await texts(page);
  const q = t.find((e: any) => e.text === "wise");
  const p = t.find((e: any) => e.text === "plain");
  expect(q?.customData?.role).toBe("quote");
  expect(p?.customData?.role ?? null).toBeNull();
});

test("hunter B: switching light/dark while editing a heading commits the text with its role", async ({
  page,
}) => {
  await start(page);
  await newText(page);
  await type(page, "# Titl");
  await runCommand(page, "Toggle light/dark mode");
  await expect(page.locator(ta)).toHaveCount(0);
  await expect
    .poll(async () => (await texts(page)).find((e: any) => e.text === "Titl")?.customData?.role, {
      timeout: 10_000,
    })
    .toBe("h1");
});
