import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// flow-diagram example plugin (sdk/examples/flow-diagram) through the real UI:
// click its panel's button, a connected flow appears (boxes, bound arrows, one
// group), and ONE click on the toolbar's Undo removes all of it.

const DRAWING = "Flow.excalidraw";

/** Live elements, read from the editor instance (found through React's fibers). */
const readScene = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.scene && s.state && typeof s.state.scrollX === "number") {
        return s.scene.getNonDeletedElements().map((e: any) => ({
          id: e.id,
          type: e.type,
          text: e.text,
          groupIds: e.groupIds,
          start: e.startBinding?.elementId ?? null,
          end: e.endBinding?.elementId ?? null,
        }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

test("flow-diagram: the panel's button draws a bound, grouped flow; one Undo removes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=flow-diagram");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, DRAWING);
  expect(await readScene(page)).toEqual([]);

  await page.getByRole("button", { name: "Flow diagram" }).click();
  await page.getByRole("button", { name: "Insert flow" }).click();

  await expect.poll(async () => (await readScene(page)).length).toBe(4 + 4 + 3); // boxes, their labels, arrows
  const els = await readScene(page);
  const boxes = els.filter((e) => e.type === "rectangle");
  const arrows = els.filter((e) => e.type === "arrow");
  expect(els.filter((e) => e.type === "text").map((e) => e.text)).toEqual([
    "Idea",
    "Draft",
    "Review",
    "Ship",
  ]);
  // Each arrow is bound from one box to the next.
  arrows.forEach((a, i) => {
    expect(a.start).toBe(boxes[i].id);
    expect(a.end).toBe(boxes[i + 1].id);
  });
  // Everything is one group.
  expect(new Set(els.map((e) => e.groupIds.join(","))).size).toBe(1);
  expect(els[0].groupIds).toHaveLength(1);

  // One click on the toolbar Undo, as the user does.
  await page.locator("[data-testid='button-undo']").first().click();
  await expect.poll(async () => (await readScene(page)).length).toBe(0);
  expect(errors).toEqual([]);
});
