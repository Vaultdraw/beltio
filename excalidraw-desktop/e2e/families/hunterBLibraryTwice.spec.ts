import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault, trackErrors } from "../helpers";
import { focusCanvas } from "../pageHelpers";

// Hunter B round 4: a library item with a labelled shape and a grouped pair, inserted three times by
// name: fresh ids each time, every label bound to its own shape, groups not shared.
const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  frameId: null,
  roundness: null,
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  updated: 1,
};
const ITEM = {
  id: "lab",
  status: "unpublished",
  created: 1,
  name: "Labelled pair",
  elements: [
    {
      ...base,
      id: "r1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      seed: 1,
      groupIds: ["g1"],
      boundElements: [{ type: "text", id: "t1" }],
    },
    {
      ...base,
      id: "t1",
      type: "text",
      x: 10,
      y: 20,
      width: 60,
      height: 25,
      seed: 2,
      text: "Hi",
      originalText: "Hi",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: "r1",
      autoResize: true,
      lineHeight: 1.25,
      groupIds: ["g1"],
      boundElements: null,
    },
    {
      ...base,
      id: "r2",
      type: "ellipse",
      x: 200,
      y: 0,
      width: 60,
      height: 60,
      seed: 3,
      groupIds: ["g1"],
      boundElements: null,
    },
  ],
};
const palette = (p: Page) => p.getByRole("dialog", { name: "Command palette" });
const els = (p: Page) =>
  p.evaluate(() =>
    (window as any)
      .__editorApis()[0]
      .getSceneElements()
      .filter((e: any) => !e.isDeleted)
      .map((e: any) => ({
        id: e.id,
        type: e.type,
        containerId: e.containerId,
        groupIds: e.groupIds,
        bound: (e.boundElements ?? []).map((b: any) => b.id),
      })),
  );

test("hunter B: inserting a labelled, grouped library item three times keeps ids, labels and groups apart", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page.evaluate(
    (item) =>
      (window as any).__libraryRepo.setFile(
        "personal",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source: "https://excalidraw.com",
          libraryItems: [item],
        }),
      ),
    ITEM,
  );
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await focusCanvas(page);
  const start = (await els(page)).length;
  for (let i = 0; i < 3; i++) {
    await expect(async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Meta+Shift+KeyP");
      await expect(palette(page)).toBeVisible();
      await page.keyboard.type("Insert: Labelled");
      await expect(palette(page).getByRole("option").first()).toContainText(
        "Insert: Labelled pair",
        { timeout: 500 },
      );
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect
      .poll(async () => (await els(page)).length)
      .toBe(start + 3 * (i + 1));
  }
  const all = await els(page);
  expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  const added = all.slice(start);
  const texts = added.filter((e) => e.type === "text");
  const rects = added.filter((e) => e.type === "rectangle");
  expect(texts).toHaveLength(3);
  for (const t of texts) {
    const r = rects.find((x) => x.id === t.containerId)!;
    expect(
      r,
      "label's container is one of the inserted rectangles",
    ).toBeTruthy();
    expect(r.bound).toContain(t.id);
  }
  expect(new Set(texts.map((t) => t.containerId)).size).toBe(3);
  const groups = new Set(added.map((e) => e.groupIds[0]));
  expect(groups.size).toBe(3);
  expect(groups.has("g1")).toBe(false);
  expect(errors).toEqual([]);
});
