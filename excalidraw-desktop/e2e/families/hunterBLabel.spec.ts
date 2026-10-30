import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Hunter B round 4: Markdown typing inside a shape label (text bound to a rectangle).
const DRAWING = "DSA/Graphs.excalidraw";
const ta = "textarea.excalidraw-wysiwyg";
const editor = (p: Page) => p.locator(".vault-editor");
const live = async (p: Page) =>
  (await readScene(p, DRAWING)).elements.filter((e: any) => !e.isDeleted);
const type = (page: Page, s: string) => page.keyboard.type(s, { delay: 15 });

const labelled = async (page: Page) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await editor(page).getByTestId("markdown-chip").click();
  const base = (await live(page)).length;
  const b = await canvasBox(page);
  await editor(page).getByTestId("toolbar-rectangle").click();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5 + 260, b.y + b.height * 0.7 + 160, {
    steps: 5,
  });
  await page.mouse.up();
  await page.mouse.dblclick(
    b.x + b.width * 0.5 + 130,
    b.y + b.height * 0.7 + 80,
  );
  await expect(page.locator(ta)).toBeFocused();
  return base;
};

test("hunter B: a heading, a list and Enter inside a shape label stay bound to the shape", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const base = await labelled(page);
  await type(page, "# Title");
  await page.keyboard.press("Enter");
  await type(page, "- one");
  await page.keyboard.press("Enter");
  await type(page, "two");
  await page.keyboard.press("Escape");
  await expect(page.locator(ta)).toHaveCount(0);
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(base);
  const els = (await live(page)).slice(base);
  const rect = els.find((e: any) => e.type === "rectangle");
  const texts = els.filter((e: any) => e.type === "text");
  // every typed line lives in text elements bound to the rectangle or inside it, never lost
  const all = texts.map((t: any) => t.text).join("\n");
  expect(all).toContain("Title");
  expect(all).toContain("one");
  expect(all).toContain("two");
  expect(rect.boundElements.some((b: any) => b.type === "text")).toBe(true);
  expect(errors).toEqual([]);
});

// B-6: a label cannot hold a second box, so Enter after "# Title" ends the heading: the label goes
// back to body size (Obsidian: a heading is one line, the next line is body).
test("hunter B: lines after a heading in a shape label are body size, not heading size", async ({
  page,
}) => {
  const base = await labelled(page);
  await type(page, "# Title");
  await page.keyboard.press("Enter");
  await type(page, "- one");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(base);
  const label = (await live(page))
    .slice(base)
    .find((e: any) => e.type === "text");
  expect(label.customData?.role ?? null).toBeNull();
  expect(label.fontSize).toBeLessThan(40);
});

test("hunter B: a quote in a shape label drops back to body text with Backspace and stays bound", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const base = await labelled(page);
  await type(page, "> wise");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(base);
  const labelOf = async () =>
    (await live(page)).slice(base).find((e: any) => e.type === "text");
  await expect
    .poll(async () => (await labelOf())?.customData?.role)
    .toBe("quote");
  expect((await labelOf()).containerId).toBeTruthy();
  // reopen the label, Backspace at the start of the quote line: back to body text, still bound
  const b = await canvasBox(page);
  await page.mouse.dblclick(
    b.x + b.width * 0.5 + 130,
    b.y + b.height * 0.7 + 80,
  );
  await expect(page.locator(ta)).toBeFocused();
  await page.keyboard.press("Meta+ArrowLeft");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await labelOf())?.customData?.role ?? null, {
      timeout: 10_000,
    })
    .toBeNull();
  expect((await labelOf()).text).toBe("wise");
  expect((await labelOf()).containerId).toBeTruthy();
  expect(errors).toEqual([]);
});
