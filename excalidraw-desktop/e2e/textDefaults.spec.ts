import { expect, test, type Page } from "@playwright/test";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

// Text tool defaults (vault layer) reach every way text is created: the T
// tool, a double-click on the canvas and a label typed into a shape.
const DRAWING = "DSA/Graphs.excalidraw";
const SHOTS = "../personal/feature/text-defaults-fix";
const ORANGE = "#f08c00";
const textarea = "textarea.excalidraw-wysiwyg";

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

const textWith = async (page: Page, text: string) =>
  (await live(page)).find((el: any) => el.type === "text" && el.text === text);

const at = async (page: Page, fx: number, fy: number) => {
  const box = await canvasBox(page);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};

/** Types `text` into the open text editor and commits it. */
const typeAndCommit = async (page: Page, text: string) => {
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);
  await expect.poll(async () => !!(await textWith(page, text))).toBe(true);
  return textWith(page, text);
};

/** Settings (This vault scope) > Tools > Text: stroke colour orange. */
const setVaultTextColour = async (page: Page) => {
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("radio", { name: "This vault" }).click();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Tools" })
    .getByRole("tab", { name: "Text" })
    .click();
  const section = page.getByTestId("tool-default-text");
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("data-scope-state", "inherited");
  await page.getByTestId("tool-default-text-stroke_color").fill(ORANGE);
  await expect(section).toHaveAttribute("data-scope-state", "overridden");
  await expect(page.getByTestId("tool-preview-text")).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/settings-text-preview.png` });
  await page.getByRole("button", { name: "Close Settings" }).click();
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("vault text colour applies to T tool, double-click and shape labels", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await setVaultTextColour(page);
  const parked = await at(page, 0.9, 0.95);
  await page.mouse.move(parked.x, parked.y);

  // a. the T tool
  await page.keyboard.press("t");
  const p1 = await at(page, 0.55, 0.62);
  await page.mouse.click(p1.x, p1.y);
  const viaTool = await typeAndCommit(page, "Tool text");
  expect(viaTool.strokeColor.toLowerCase()).toBe(ORANGE);

  // b. double-click on the canvas with the selection tool
  await page.keyboard.press("v");
  const p2 = await at(page, 0.55, 0.78);
  await page.mouse.dblclick(p2.x, p2.y);
  const viaDblClick = await typeAndCommit(page, "Double text");
  expect(viaDblClick.strokeColor.toLowerCase()).toBe(ORANGE);

  // c. a label typed into a shape (Enter on the selected rectangle)
  await page.keyboard.press("r");
  const r0 = await at(page, 0.2, 0.7);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await page.mouse.move(r0.x + 90, r0.y + 40, { steps: 5 });
  await page.mouse.move(r0.x + 180, r0.y + 80, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  const label = await typeAndCommit(page, "Label");
  expect(label.containerId).toBeTruthy();
  expect(label.strokeColor.toLowerCase()).toBe(ORANGE);

  await page.screenshot({
    path: `${SHOTS}/${info.project.name}-orange-text.png`,
  });
  expect(errors).toEqual([]);
});
