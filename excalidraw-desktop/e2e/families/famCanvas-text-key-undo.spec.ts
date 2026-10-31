import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { focusCanvas } from "../pageHelpers";
import {
  openSeededVault,
  sceneJson,
  trackErrors,
  treeName,
} from "../tabsHelpers";

// Family hunter canvas (2026-10-31): hunterBKeyUndo.spec.ts says "every keyboard edit of
// elements is exactly ONE undo step" but its snapshot has no text properties and its table has
// none of the text keys: font size up and down, Copy and Paste styles, Ungroup. Same check, a
// snapshot that includes size, colour and groups.
const text = (
  id: string,
  x: number,
  y: number,
  size: number,
  color: string,
) => ({
  id,
  type: "text",
  x,
  y,
  width: size * 4,
  height: Math.round(size * 1.25),
  angle: 0,
  strokeColor: color,
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [] as string[],
  frameId: null,
  roundness: null,
  seed: 5,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  text: id,
  originalText: id,
  fontSize: size,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  lineHeight: 1.25,
  autoResize: true,
  index: null,
});

const SCENE = sceneJson(
  [
    { id: "r1", x: 400, y: 300, w: 80, h: 50 },
    { id: "r2", x: 520, y: 320, w: 80, h: 50 },
  ],
  [text("t1", 60, 60, 20, "#e03131"), text("t2", 60, 140, 28, "#2f9e44")],
);

const snap = (p: Page) =>
  p.evaluate(() =>
    (window as any)
      .__editorApis()[0]
      .getSceneElements()
      .map(
        (e: any) =>
          `${e.id}|${e.isDeleted}|${e.x}|${e.y}|${e.width}|${e.height}|${(
            e.groupIds ?? []
          ).join(",")}|${e.fontSize ?? ""}|${e.strokeColor}`,
      )
      .join(";"),
  );

const select = (p: Page, ids: string[]) =>
  p.evaluate((list) => {
    (window as any).__editorApis()[0].updateScene({
      appState: {
        selectedElementIds: Object.fromEntries(list.map((i) => [i, true])),
        selectedGroupIds: {},
      },
    });
  }, ids);

type Row = {
  title: string;
  /** what to select, and keys to press before the edit (not part of the check) */
  select: string[];
  prepare?: (p: Page) => Promise<void>;
  chord: string;
};

const ROWS: Row[] = [
  {
    title: "increase font size",
    select: ["t1", "t2"],
    chord: "Meta+Shift+Period",
  },
  {
    title: "decrease font size",
    select: ["t1", "t2"],
    chord: "Meta+Shift+Comma",
  },
  {
    title: "paste styles",
    select: ["t2"],
    prepare: async (p) => {
      await select(p, ["t1"]);
      await p.keyboard.press("Meta+Alt+c");
      await select(p, ["t2"]);
    },
    chord: "Meta+Alt+v",
  },
  {
    title: "ungroup",
    select: ["r1", "r2"],
    prepare: async (p) => {
      await select(p, ["r1", "r2"]);
      await p.keyboard.press("Meta+g");
      await p.keyboard.press("Meta+Shift+z"); // keep history tidy: redo is a no-op
      await p.waitForTimeout(100);
    },
    chord: "Meta+Shift+g",
  },
];

test("family canvas: text and style keys are one undo step", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await openSeededVault(page, { "TextKeys.excalidraw": SCENE });
  await treeName(page, "TextKeys").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__editorApis()[0]?.getSceneElements().length,
      ),
    )
    .toBe(4);
  await focusCanvas(page);
  const bad: string[] = [];
  for (const row of ROWS) {
    await select(page, row.select);
    await row.prepare?.(page);
    const start = await snap(page);
    await page.keyboard.press(row.chord);
    await page.waitForTimeout(250);
    const done = await snap(page);
    if (done === start) {
      bad.push(`${row.title}: the key changed nothing`);
      continue;
    }
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(250);
    if ((await snap(page)) !== start) {
      bad.push(`${row.title}: one undo did not restore the scene`);
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Meta+z");
      }
      continue;
    }
    await page.keyboard.press("Meta+Shift+z");
    await page.waitForTimeout(250);
    if ((await snap(page)) !== done) {
      bad.push(`${row.title}: redo did not apply the edit again`);
    }
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(150);
  }
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});
