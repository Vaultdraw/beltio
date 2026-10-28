import { expect } from "@playwright/test";

import { test } from "./fixture";

import {
  dblclickElement,
  dialog,
  images,
  insertViaPalette,
  openEmpty,
  SRC,
} from "./formulaHelpers";
import { trackErrors } from "./helpers";
import { focusCanvas } from "./pageHelpers";

// Formulas are an official extension, reached by clicking: Settings > Extensions switches it off
// (the formula stays as its picture, a double-click no longer opens the editor) and on again
// (the editor opens from the plugin).
test("Formula extension: the switch removes and restores editing; the picture stays", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEmpty(page, "FormulaExt.excalidraw");
  await insertViaPalette(page, SRC);
  await focusCanvas(page);

  const toggle = async () => {
    await page.getByTestId("activity-bar-settings").click();
    const settings = page.locator(".vault-settings-modal");
    await settings.getByRole("tab", { name: "Extensions" }).click();
    await page
      .getByTestId("extension-row-formula")
      .locator(".vault-switch")
      .click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".vault-settings-modal")).toHaveCount(0);
  };

  await toggle(); // off
  await focusCanvas(page);
  const el = (await images(page))[0];
  expect(el.customData.latex.source).toBe(SRC);
  await dblclickElement(page, el);
  await expect(dialog(page)).toHaveCount(0);

  await toggle(); // on
  await focusCanvas(page);
  await dblclickElement(page, (await images(page))[0]);
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
