import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import {
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
  trackErrors,
} from "../helpers";
import { focusCanvas } from "../pageHelpers";
import { openSeededVault, sceneJson, treeName } from "../tabsHelpers";

// Hunter B round 4: canvas tools on a drawing with 2,000 elements.
const N = Number(process.env.HB_N ?? 2000);
const shapes = Array.from({ length: N }, (_, i) => ({
  id: `e${i}`,
  x: (i % 50) * 120,
  y: Math.floor(i / 50) * 90,
  w: 100,
  h: 60,
}));
const PATH = "Big.excalidraw";
const api = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__editorApis()[0];
    const els = a.getSceneElements().filter((e: any) => !e.isDeleted);
    return {
      n: els.length,
      sel: Object.keys(a.getAppState().selectedElementIds).length,
      x0: els[0]?.x,
      y0: els[0]?.y,
      xl: els[els.length - 1]?.x,
    };
  });

test("hunter B: 2,000 elements: select all, move, undo, redo, copy-paste and export all stay correct", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openSeededVault(page, { [PATH]: sceneJson(shapes) });
  await treeName(page, "Big").click();
  await expect
    .poll(async () => (await api(page)).n, { timeout: 20_000 })
    .toBe(N);
  await focusCanvas(page);
  await page.keyboard.press("Meta+a");
  await expect
    .poll(async () => (await api(page)).sel, { timeout: 20_000 })
    .toBe(N);
  const before = await api(page);
  // move with the arrow key (5 px with Shift)
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await api(page)).x0).toBe(before.x0 + 5);
  expect((await api(page)).y0).toBe(before.y0 + 5);
  expect((await api(page)).xl).toBe(before.xl + 5);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await api(page)).y0).toBe(before.y0);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await api(page)).x0).toBe(before.x0);
  await expect.poll(async () => (await api(page)).x0).toBe(before.x0);
  expect((await api(page)).y0).toBe(before.y0);
  await page.keyboard.press("Meta+Shift+z");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => (await api(page)).x0).toBe(before.x0 + 5);
  // copy and paste: doubles
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await page.keyboard.press("Meta+v");
  await expect
    .poll(async () => (await api(page)).n, { timeout: 20_000 })
    .toBe(2 * N);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await api(page)).n, { timeout: 20_000 })
    .toBe(N);
  // delete all, undo
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await api(page)).n, { timeout: 20_000 })
    .toBe(0);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await api(page)).n, { timeout: 20_000 })
    .toBe(N);
  // export PNG and SVG
  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 60_000 })
    .toContain("Big.png");
  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 60_000 })
    .toContain("Big.svg");
  const sizes = await page.evaluate(() =>
    (window as any).__vaultRepo.exported.map((e: any) => [
      e.name,
      e.bytes.length,
    ]),
  );
  for (const [, bytes] of sizes) {
    expect(bytes).toBeGreaterThan(10_000);
  }
  expect(errors).toEqual([]);
});
