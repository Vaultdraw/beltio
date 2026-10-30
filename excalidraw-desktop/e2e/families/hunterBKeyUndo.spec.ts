import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { focusCanvas } from "../pageHelpers";
import {
  openSeededVault,
  sceneJson,
  trackErrors,
  treeName,
} from "../tabsHelpers";

// Family (hunter B-7): every keyboard edit of elements is exactly ONE undo step:
// one Cmd+Z restores the scene as it was, one Cmd+Shift+Z applies it again.
const shapes = [0, 1, 2, 3].map((i) => ({
  id: `e${i}`,
  x: i * 140 + (i % 2) * 7,
  y: 40 + i * 90 + (i % 2) * 11,
  w: 90 + i * 5,
  h: 60 + i * 3,
}));

const snap = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__editorApis()[0];
    return a
      .getSceneElements()
      .map(
        (e: any) =>
          `${e.id}|${e.isDeleted}|${e.x}|${e.y}|${e.width}|${
            e.height
          }|${e.groupIds.join(",")}|${e.locked}|${e.angle}`,
      )
      .join(";");
  });
const order = (p: Page) =>
  p.evaluate(() =>
    (window as any)
      .__editorApis()[0]
      .getSceneElements()
      .map((e: any) => e.id)
      .join(","),
  );

// [title, chord, how many times to press it]
// z-order needs a part of the scene selected: the first two shapes, or the last two to go backward
const ORDER_ROWS = new Map([
  ["send to back", -2],
  ["bring to front", 0],
  ["send backward", -2],
  ["bring forward", 0],
]);
const KEYS: [string, string, number][] = [
  ["nudge left", "ArrowLeft", 1],
  ["nudge right", "ArrowRight", 1],
  ["nudge up", "ArrowUp", 1],
  ["nudge down", "ArrowDown", 1],
  ["big nudge left", "Shift+ArrowLeft", 1],
  ["big nudge down", "Shift+ArrowDown", 1],
  ["align top", "Meta+Shift+ArrowUp", 1],
  ["align left", "Meta+Shift+ArrowLeft", 1],
  ["distribute horizontally", "Alt+h", 1],
  ["distribute vertically", "Alt+v", 1],
  ["send to back", "Meta+Alt+BracketLeft", 1],
  ["bring to front", "Meta+Alt+BracketRight", 1],
  ["send backward", "Meta+BracketLeft", 1],
  ["bring forward", "Meta+BracketRight", 1],
  ["flip horizontal", "Shift+h", 1],
  ["flip vertical", "Shift+v", 1],
  ["group", "Meta+g", 1],
  ["lock", "Meta+Shift+l", 1],
  ["duplicate", "Meta+d", 1],
  ["delete", "Delete", 1],
];

test("hunter B family: each keyboard edit of elements is one undo step", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openSeededVault(page, { "Keys.excalidraw": sceneJson(shapes) });
  await treeName(page, "Keys").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__editorApis()[0]?.getSceneElements().length,
      ),
    )
    .toBe(shapes.length);
  await focusCanvas(page);
  const bad: string[] = [];
  for (const [title, chord, times] of KEYS) {
    if (ORDER_ROWS.has(title)) {
      await page.evaluate((from) => {
        const a = (window as any).__editorApis()[0];
        const ids = a
          .getSceneElements()
          .slice(from < 0 ? from : 0, from < 0 ? undefined : 2)
          .map((e: any) => e.id);
        a.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              ids.map((i: string) => [i, true]),
            ),
          },
        });
      }, ORDER_ROWS.get(title)!);
    } else {
      await page.keyboard.press("Meta+a");
    }
    const start = await snap(page);
    const startOrder = await order(page);
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(chord);
    }
    await page.waitForTimeout(150);
    const changed =
      (await snap(page)) !== start || (await order(page)) !== startOrder;
    if (!changed) {
      bad.push(`${title}: the key changed nothing`);
      continue;
    }
    const done = await snap(page);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(150);
    const undone = await snap(page);
    if (undone !== start || (await order(page)) !== startOrder) {
      bad.push(`${title}: one undo did not restore the scene`);
      // clear leftovers so the next row starts clean
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Meta+z");
      }
      continue;
    }
    await page.keyboard.press("Meta+Shift+z");
    await page.waitForTimeout(150);
    if ((await snap(page)) !== done) {
      bad.push(`${title}: redo did not apply the edit again`);
    }
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(100);
  }
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test("hunter B family: a held arrow key is one undo step, two presses are two", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, { "Keys.excalidraw": sceneJson(shapes) });
  await treeName(page, "Keys").click();
  await focusCanvas(page);
  await page.keyboard.press("Meta+a");
  const start = await snap(page);
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.down("ArrowRight"); // key repeat
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(100);
  expect(await snap(page)).not.toBe(start);
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(100);
  expect(await snap(page)).toBe(start);
  expect(errors).toEqual([]);
});
