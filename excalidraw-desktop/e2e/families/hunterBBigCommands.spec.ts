import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { focusCanvas } from "../pageHelpers";
import {
  openSeededVault,
  sceneJson,
  treeName,
  trackErrors,
} from "../tabsHelpers";

// Hunter B round 4: every selection command on 2,000 selected elements: it runs without an error and
// one Cmd+Z puts the scene back exactly (positions, sizes, flips, groups, order, locks).
const N = Number(process.env.HB_N ?? 2000);
const shapes = Array.from({ length: N }, (_, i) => ({
  id: `e${i}`,
  x: (i % 50) * 130 + (i % 7) * 3,
  y: Math.floor(i / 50) * 100 + (i % 5) * 4,
  w: 90 + (i % 11),
  h: 50 + (i % 13),
}));
const snap = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__editorApis()[0];
    const els = a.getSceneElements();
    let h = 0;
    for (const e of els) {
      const s = `${e.id}|${e.isDeleted}|${e.x.toFixed(2)}|${e.y.toFixed(
        2,
      )}|${e.width.toFixed(2)}|${e.height.toFixed(2)}|${e.groupIds.join(",")}|${
        e.locked
      }|${e.angle}`;
      for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
      }
    }
    return `${els.length}:${els.map((e: any) => e.id).join(",").length}:${h}`;
  });
const selected = (p: Page) =>
  p.evaluate(
    () =>
      Object.keys(
        (window as any).__editorApis()[0].getAppState().selectedElementIds,
      ).length,
  );

const COMMANDS: [string, string][] = [
  ["align top", "Meta+Shift+ArrowUp"],
  ["align left", "Meta+Shift+ArrowLeft"],
  ["distribute horizontally", "Alt+h"],
  ["distribute vertically", "Alt+v"],
  ["send to back", "Meta+Shift+BracketLeft"],
  ["bring to front", "Meta+Shift+BracketRight"],
  ["flip horizontal", "Shift+h"],
  ["flip vertical", "Shift+v"],
  ["group", "Meta+g"],
  ["lock", "Meta+Shift+l"],
  ["duplicate", "Meta+d"],
];

test("hunter B: selection commands on 2,000 elements run cleanly and one undo restores the scene", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await openSeededVault(page, { "Big.excalidraw": sceneJson(shapes) });
  await treeName(page, "Big").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as any).__editorApis()[0]?.getSceneElements().length,
        ),
      { timeout: 20_000 },
    )
    .toBe(N);
  await focusCanvas(page);
  const start = await snap(page);
  const bad: string[] = [];
  for (const [title, chord] of COMMANDS) {
    await page.keyboard.press("Meta+a");
    await expect.poll(() => selected(page), { timeout: 20_000 }).toBe(N);
    await page.keyboard.press(chord);
    await page.waitForTimeout(300);
    const changed = await snap(page);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(500);
    let after = await snap(page);
    if (after !== start) {
      // one more undo may be needed if the command made two history entries; report which
      bad.push(
        `${title}: after 1 undo ${after} != ${start} (changed: ${
          changed !== start
        })`,
      );
      for (let i = 0; i < 3 && after !== start; i++) {
        await page.keyboard.press("Meta+z");
        await page.waitForTimeout(300);
        after = await snap(page);
      }
      if (after !== start) {
        bad.push(`${title}: never restored`);
        break;
      }
    }
  }
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});
