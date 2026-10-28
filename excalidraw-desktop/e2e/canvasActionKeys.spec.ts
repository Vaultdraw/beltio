/**
 * Command audit (D5): an Excalidraw action key is a rebindable command.
 * Reached through visible UI only: the Settings button, the Hotkeys page, the
 * chip's remove button and "Add hotkey".
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

const DRAWING = "DSA/Graphs.excalidraw";

const rect = (id: string, x: number, y: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
});

const seedTwoRects = (page: Page) =>
  page.evaluate(
    ([path, a, b]) => {
      (window as any).__vaultRepo.seedDrawing(
        path,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [a, b],
          appState: {},
          files: {},
        }),
      );
    },
    [DRAWING, rect("a", 60, 60), rect("b", 300, 200)] as const,
  );

/** Saved group ids of the live elements, one entry per element. */
const savedGroups = async (page: Page) =>
  (await readScene(page, DRAWING)).elements
    .filter((el: any) => !el.isDeleted)
    .map((el: any) => el.groupIds.length);

test("Canvas: Group selection rebound on the Hotkeys page: the old key stops, the new one groups", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await seedTwoRects(page);
  await openDrawing(page, "Graphs");

  // Settings → Hotkeys, by clicking.
  await page
    .getByLabel("Vault file navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const modal = page.locator(".vault-settings-modal");
  await expect(modal).toBeVisible();
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  await page.getByLabel("Filter hotkeys").fill("Group selection");
  const row = page.locator(
    '.vault-hotkeys__row[data-command-id="canvas.group"]',
  );
  const chips = row.locator(".vault-hotkeys__chip-key");
  await expect(chips).toHaveCount(1);

  // Replace Mod+G with Alt+G.
  await chips
    .first()
    .getByRole("button", { name: /^Remove / })
    .click();
  await expect(chips).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Add hotkey for Canvas: Group selection",
      exact: true,
    })
    .click();
  await expect(page.getByText("Press keys…")).toBeVisible();
  await page.keyboard.press("Alt+KeyG");
  await expect(chips).toHaveCount(1);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(modal).toHaveCount(0);

  // Select both rectangles on the canvas.
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await page.keyboard.press("Meta+KeyA");

  // The old key no longer groups (Excalidraw's own Mod+G is off too).
  await page.keyboard.press("Meta+KeyG");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect(await savedGroups(page)).toEqual([0, 0]);

  // The new key does.
  await page.keyboard.press("Alt+KeyG");
  await expect.poll(() => savedGroups(page), { timeout: 8000 }).toEqual([1, 1]);
  expect(errors).toEqual([]);
});
