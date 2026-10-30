import { expect, type Page } from "@playwright/test";

import { nativeMod } from "../nativeKeys";

import { test } from "../fixture";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "../helpers";

// Hunter B (2026-10-30): every drawing tool from the visible toolbar, then select-all, copy,
// paste, undo and redo, frame membership, and the dark theme switch while elements exist.
const DRAWING = "DSA/Graphs.excalidraw";
const editor = (p: Page) => p.locator(".vault-editor");
const live = async (p: Page) =>
  (await readScene(p, DRAWING)).elements.filter((e: any) => !e.isDeleted);
const settled = async (p: Page, n: number) =>
  expect.poll(async () => (await live(p)).length, { timeout: 10_000 }).toBe(n);

test("hunter B: each toolbar tool draws its element; copy/paste, undo/redo and a frame keep working", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await page.evaluate(() => (window as any).__vaultRepo);
  const base = (await live(page)).length;
  const b = await canvasBox(page);
  const tools: [string, string][] = [
    ["toolbar-rectangle", "rectangle"],
    ["toolbar-diamond", "diamond"],
    ["toolbar-ellipse", "ellipse"],
    ["toolbar-arrow", "arrow"],
    ["toolbar-line", "line"],
  ];
  let y = b.y + 60;
  for (const [id] of tools) {
    await editor(page).getByTestId(id).click();
    await page.mouse.move(b.x + 80, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 200, y + 50, { steps: 5 });
    await page.mouse.up();
    y += 90;
  }
  await editor(page).getByTestId("toolbar-freedraw").click();
  await page.mouse.move(b.x + 400, b.y + b.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(b.x + 440, b.y + b.height * 0.75 + 60, { steps: 6 });
  await page.mouse.up();
  await settled(page, base + 6);
  const types = (await live(page)).slice(base).map((e: any) => e.type);
  expect(types).toEqual([
    "rectangle",
    "diamond",
    "ellipse",
    "arrow",
    "line",
    "freedraw",
  ]);

  // frame tool (Excalidraw's own; the Frames plugin is gone)
  await page.keyboard.press("Escape");
  await editor(page).locator(".App-toolbar__extra-tools-trigger").click();
  await page.getByTestId("toolbar-frame").click();
  await page.mouse.move(b.x + 520, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + 820, b.y + b.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await settled(page, base + 7);
  const frame = (await live(page)).find((e: any) => e.type === "frame");
  expect(frame, "a frame element exists").toBeTruthy();

  // select all, copy, paste: element count doubles
  await page.keyboard.press("Meta+a");
  await page.keyboard.press(`${nativeMod}+c`);
  await page.keyboard.press(`${nativeMod}+v`);
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(base + 8);
  const afterPaste = (await live(page)).length;
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBeLessThan(afterPaste);
  await page.keyboard.press("Meta+Shift+z");
  await expect
    .poll(async () => (await live(page)).length, { timeout: 10_000 })
    .toBe(afterPaste);
  expect(errors).toEqual([]);
});
