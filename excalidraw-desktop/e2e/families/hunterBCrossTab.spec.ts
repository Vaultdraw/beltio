import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { focusCanvas } from "../pageHelpers";
import {
  clickTree,
  openSeededVault,
  sceneJson,
  trackErrors,
} from "../tabsHelpers";

// Hunter B round 4: copy in one drawing's tab, paste in another's: shapes, a labelled shape,
// a picture (its file travels) and Markdown text with its role.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
};
const extra = [
  {
    ...base,
    id: "lbl",
    type: "text",
    x: 160,
    y: 170,
    width: 60,
    height: 25,
    seed: 3,
    text: "Hello",
    originalText: "Hello",
    fontSize: 20,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "box",
    autoResize: true,
    lineHeight: 1.25,
    boundElements: [],
  },
  {
    ...base,
    id: "head",
    type: "text",
    x: 400,
    y: 100,
    width: 150,
    height: 45,
    seed: 4,
    text: "Title",
    originalText: "Title",
    fontSize: 36,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    boundElements: [],
    strokeColor: "#1e1e1f",
    customData: { role: "h1" },
  },
  {
    ...base,
    id: "pic",
    type: "image",
    x: 400,
    y: 300,
    width: 80,
    height: 80,
    seed: 5,
    fileId: "file1",
    status: "saved",
    scale: [1, 1],
    boundElements: [],
  },
];
const A = sceneJson([{ id: "box", x: 100, y: 150, w: 160, h: 80 }], extra, {
  file1: { id: "file1", mimeType: "image/png", dataURL: PNG, created: 1 },
}).replace(
  /"id":"box"([^}]*?)"boundElements":\[\]/,
  '"id":"box"$1"boundElements":[{"type":"text","id":"lbl"}]',
);
const B = sceneJson([{ id: "other", x: 100, y: 100 }]);

const dump = (p: Page) =>
  p.evaluate(() => {
    const a = (window as any).__editorApis()[0];
    const els = a.getSceneElements().filter((e: any) => !e.isDeleted);
    return {
      els: els.map((e: any) => ({
        id: e.id,
        type: e.type,
        text: e.text,
        containerId: e.containerId,
        role: e.customData?.role,
        fileId: e.fileId,
        bound: (e.boundElements ?? []).map((b: any) => b.id),
      })),
      files: Object.keys(a.getFiles()),
    };
  });

test("hunter B: copy in one drawing's tab and paste in another keeps labels, roles and pictures", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, { "A.excalidraw": A, "B.excalidraw": B });
  await clickTree(page, "A");
  await expect.poll(async () => (await dump(page)).els.length).toBe(4);
  await focusCanvas(page);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await clickTree(page, "B", ["Meta"]);
  await expect.poll(async () => (await dump(page)).els.length).toBe(1);
  await focusCanvas(page);
  await page.keyboard.press("Meta+v");
  await expect.poll(async () => (await dump(page)).els.length).toBe(5);
  const d = await dump(page);
  const box = d.els.find((e) => e.type === "rectangle" && e.id !== "other")!;
  const label = d.els.find((e) => e.text === "Hello")!;
  expect(label.containerId).toBe(box.id);
  expect(box.bound).toContain(label.id);
  expect(d.els.find((e) => e.text === "Title")!.role).toBe("h1");
  const pic = d.els.find((e) => e.type === "image")!;
  expect(d.files).toContain(pic.fileId);
  // the source drawing is unchanged and still has its label bound
  await clickTree(page, "A");
  await expect.poll(async () => (await dump(page)).els.length).toBe(4);
  expect(errors).toEqual([]);
});
