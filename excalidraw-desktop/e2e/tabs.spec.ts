import { expect } from "@playwright/test";

import { test } from "./fixture";

import {
  A,
  B,
  PAIR,
  activeTab,
  clickTree,
  expectShown,
  mounted,
  onScreenIds,
  openSeededVault,
  tabByName,
  tabEls,
  tabNames,
  trackErrors,
  zoomLabel,
} from "./tabsHelpers";

// The ONE visible-UI tabs test (clicks only: no shortcut, no palette). The
// keyboard / behaviour cases live in tabsKeys.spec.ts.
test("tabs: click two drawings into two tabs, click the first tab, its shapes and zoom are back", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, PAIR);

  // Drawing A in the first tab, zoomed in with the on-screen zoom button.
  await clickTree(page, A);
  await expectShown(page, ["a-rect"]);
  await expect(zoomLabel(page)).toContainText("100%");
  await page.locator(".vault-editor .zoom-in-button").click();
  await page.locator(".vault-editor .zoom-in-button").click();
  await expect(zoomLabel(page)).not.toContainText("100%");
  const zoomA = (await zoomLabel(page).innerText()).trim();
  expect(zoomA).toMatch(/^\d+%$/);
  expect(await tabNames(page)).toEqual([A]);

  // "+" opens a new home tab; a navigator click then opens B in that tab.
  await page.getByTestId("vault-tab-new").click();
  await expect(tabEls(page)).toHaveCount(2);
  await clickTree(page, B);
  await expectShown(page, ["b-ellipse"]);

  expect(await tabNames(page)).toEqual([A, B]);
  expect(await activeTab(page)).toBe(B);
  await expect(tabByName(page, B)).toHaveAttribute("aria-selected", "true");
  await expect(tabByName(page, A)).toHaveAttribute("aria-selected", "false");
  expect(await onScreenIds(page)).toEqual(["b-ellipse"]);
  await expect(zoomLabel(page)).toContainText("100%");
  // A background tab holds data only: one live canvas pair, no second editor.
  expect(await mounted(page)).toBe(1);

  // Back to A: its shape is on screen again at the zoom the user set.
  await tabByName(page, A).click();
  await expectShown(page, ["a-rect"]);
  await expect(tabByName(page, A)).toHaveAttribute("aria-selected", "true");
  expect(await onScreenIds(page)).toEqual(["a-rect"]);
  await expect(zoomLabel(page)).toHaveText(zoomA);
  expect(errors).toEqual([]);
});

// Phase 3: the ONE visible-UI test (mouse only: no shortcut, no palette).
test("tabs phase 3: pin a tab from its context menu, a navigator click opens the next drawing in a new tab", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeededVault(page, PAIR);
  await clickTree(page, A);
  await expectShown(page, ["a-rect"]);
  expect(await tabNames(page)).toEqual([A]);

  // Right-click the tab, click "Pin" in the menu.
  await tabByName(page, A).click({ button: "right" });
  const menu = page.getByTestId("vault-tab-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(menu).toHaveCount(0);
  const pinned = page.getByTestId("vault-tab").first();
  await expect(pinned).toHaveAttribute("aria-label", `${A} (pinned)`);
  await expect(pinned).toHaveClass(/vault-tabs__tab--pinned/);
  await expect(pinned.getByTestId("vault-tab-close")).toHaveCount(0);

  // A navigator click on B must not replace the pinned tab: B gets a new tab.
  await clickTree(page, B);
  await expectShown(page, ["b-ellipse"]);
  await expect(tabEls(page)).toHaveCount(2);
  await expect(pinned).toHaveAttribute("aria-label", `${A} (pinned)`);
  await expect(pinned).toHaveAttribute("data-path", `${A}.excalidraw`);
  await expect(pinned).toHaveAttribute("aria-selected", "false");
  // The pinned tab shows only its icon (no name element text).
  expect(await tabNames(page)).toEqual(["", B]);
  expect(await activeTab(page)).toBe(B);
  expect(await onScreenIds(page)).toEqual(["b-ellipse"]);

  // Clicking the pinned tab shows A's shapes again.
  await pinned.click();
  await expectShown(page, ["a-rect"]);
  await expect(pinned).toHaveAttribute("aria-selected", "true");
  expect(await onScreenIds(page)).toEqual(["a-rect"]);
  expect(errors).toEqual([]);
});
