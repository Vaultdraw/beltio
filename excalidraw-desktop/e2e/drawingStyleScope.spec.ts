import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";
import { personalPath } from "./mainCheckout";

// toimprove #48: a tool default (Settings > Tools > Text > Font) reaches every
// drawing, new and existing; a style picked inside a drawing is a per-drawing
// override that is saved in the file, survives switching drawings, and can be
// dropped with "Use default". Visible UI only (clicks), no shortcuts/palette.
const DRAWING = "DSA/Graphs.excalidraw";
const SHOTS = personalPath("feature/drawing-style-scope/shots");
const CASCADIA = 3;
const NUNITO = 6;
// The style panel only shows the "Use default" marker in its full layout, which
// needs an editor wider than 1180 px (tablet breakpoint) beside the navigator.
test.use({ viewport: { width: 1700, height: 900 } });

const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");
const marker = (page: Page) => page.getByTestId("style-use-default-fontFamily");

const live = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted);

const textWith = async (page: Page, text: string) =>
  (await live(page)).find((el: any) => el.type === "text" && el.text === text);

/** Active text tool (toolbar click), click the canvas, type, commit. */
const createText = async (page: Page, text: string, fy: number) => {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * fy);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);
  await expect.poll(async () => !!(await textWith(page, text))).toBe(true);
  return textWith(page, text);
};

const pickTextTool = async (page: Page) => {
  await editor(page).getByTestId("toolbar-text").click();
  await expect(editor(page).getByTestId("toolbar-text")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
};

const trigger = (page: Page) =>
  editor(page).getByRole("button", { name: "Show font picker" });

/** The font the picker's list marks as selected (null: none, e.g. Cascadia). */
const pickerSelection = async (page: Page) => {
  await trigger(page).click();
  const list = page.locator("button.dropdown-menu-item--selected[value]");
  await expect(page.getByRole("button", { name: "Nunito" })).toBeVisible();
  const value = await list
    .first()
    .getAttribute("value", { timeout: 500 })
    .catch(() => null);
  await page.keyboard.press("Escape");
  await pickTextTool(page);
  return value;
};

/** Pick a font; it is an override, so the pick took once the marker shows. */
const pickFont = async (page: Page, family: number) => {
  // Under heavy load the first click can land before the list is interactive.
  await expect(async () => {
    if (!(await page.getByText("Available fonts").isVisible())) {
      await trigger(page).click();
    }
    await page.locator(`button[value="${family}"]`).click({ timeout: 2000 });
    await expect(marker(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
};

/** Cascadia is not in the picker list until a text uses it: "not Nunito". */
const expectCascadiaPicked = async (page: Page) => {
  expect(await pickerSelection(page)).not.toBe(String(NUNITO));
  await expect(marker(page)).toHaveCount(0);
};

const openOther = async (page: Page) => {
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await openDrawing(page, "Introduction");
};

test("tool default font applies to an existing drawing; a pick is a per-drawing override with Use default", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();

  // (1) the existing drawing has old text, no vaultdraw block
  const before = await readScene(page, DRAWING);
  expect(before.vaultdraw).toBeUndefined();
  const oldText = before.elements.find((el: any) => el.type === "text");
  expect(oldText).toBeTruthy();
  const oldFont = oldText.fontFamily;

  // (2) Settings > Tools > Text > Font = Cascadia
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Tools", exact: true }).click();
  await dialog
    .getByRole("tablist", { name: "Tools" })
    .getByRole("tab", { name: "Text" })
    .click();
  await dialog
    .getByTestId("tool-default-text-font_family")
    .selectOption(String(CASCADIA));
  await expect(dialog.getByTestId("tool-default-text-font_family")).toHaveValue(
    String(CASCADIA),
  );
  await page.screenshot({ path: `${SHOTS}/01-settings-default-font.png` });
  await page.getByRole("button", { name: "Close Settings" }).click();

  // (3) existing drawing: new text uses the default, old text is unchanged
  await openDrawing(page, "Graphs");
  await pickTextTool(page);
  await expectCascadiaPicked(page);
  await expect(marker(page)).toHaveCount(0);
  const first = await createText(page, "Cascadia one", 0.62);
  expect(first.fontFamily).toBe(CASCADIA);
  expect((await textWith(page, oldText.text)).fontFamily).toBe(oldFont);
  await page.screenshot({ path: `${SHOTS}/02-existing-drawing-cascadia.png` });

  // (4) pick Nunito in the style panel: override + marker
  await pickTextTool(page);
  await pickFont(page, NUNITO);
  await expect(marker(page)).toBeVisible();
  const second = await createText(page, "Nunito two", 0.72);
  expect(second.fontFamily).toBe(NUNITO);
  await pickTextTool(page);
  await expect(marker(page)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-override-marker.png` });

  // saved in the file as a top-level vaultdraw block
  await expect
    .poll(async () => (await readScene(page, DRAWING)).vaultdraw?.styles, {
      timeout: 8000,
    })
    .toBeTruthy();
  const saved = (await readScene(page, DRAWING)).vaultdraw.styles;
  expect(JSON.stringify(saved)).toContain(`"font_family":${NUNITO}`);

  // (5) another drawing, then back: the override is still there
  await openOther(page);
  await pickTextTool(page);
  await expectCascadiaPicked(page);
  await expect(marker(page)).toHaveCount(0);
  await page
    .locator(".vault-tree-item__name", { hasText: "Graphs" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await pickTextTool(page);
  expect(await pickerSelection(page)).toBe(String(NUNITO));
  await expect(marker(page)).toBeVisible();
  const third = await createText(page, "Nunito three", 0.82);
  expect(third.fontFamily).toBe(NUNITO);

  // (6) Use default: Cascadia again, marker gone
  await pickTextTool(page);
  await marker(page).click();
  await expect(marker(page)).toHaveCount(0);
  await expectCascadiaPicked(page);
  const fourth = await createText(page, "Cascadia four", 0.92);
  expect(fourth.fontFamily).toBe(CASCADIA);
  await pickTextTool(page);
  await expect(marker(page)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/04-after-use-default.png` });
  await expect
    .poll(async () => (await readScene(page, DRAWING)).vaultdraw?.styles?.text)
    .toBeFalsy();
  expect(errors).toEqual([]);
});
