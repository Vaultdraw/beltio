import { expect, test, type Page } from "@playwright/test";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";

// The stamp example through the real UI. Canvas text is not readable, so the
// drawing is checked through the vault's saved copy (autosave follows edits).

const GRAPHS = "DSA/Graphs.excalidraw";

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const liveElements = async (page: Page) =>
  (await readScene(page, GRAPHS)).elements.filter((el: any) => !el.isDeleted);

const count = (page: Page) => async () => (await liveElements(page)).length;

test("stamp: flow and note are one undo step each", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=stamp");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const before = await count(page)();

  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("stamp: insert flow");
  await expect(palette(page).getByRole("option").first()).toContainText(
    "Stamp: insert flow",
  );
  await page.keyboard.press("Enter");
  await expect.poll(count(page)).toBe(before + 5 + 3);
  const texts = (await liveElements(page))
    .filter((el: any) => el.type === "text")
    .map((el: any) => el.text);
  expect(texts).toEqual(expect.arrayContaining(["Start", "Step", "Done"]));

  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect.poll(count(page)).toBe(before);

  await page.keyboard.press("ControlOrMeta+Alt+Shift+KeyS");
  await expect.poll(count(page)).toBe(before + 2);
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect.poll(count(page)).toBe(before);
  expect(errors).toEqual([]);
});
