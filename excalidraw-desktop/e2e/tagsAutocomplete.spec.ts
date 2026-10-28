import { expect } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import { readScene, trackErrors } from "./helpers";
import { scenePoint } from "./linksHelpers";
import {
  editArea,
  openTagsVault,
  paneTagNames,
  popup,
  popupRows,
  startTyping,
  tagRow,
} from "./tagsHelpers";

const DRAWING = "Tagged Arrays";
const PATH = "DSA/Tagged Arrays.excalidraw";

test.beforeEach(async ({ page }) => {
  await openTagsVault(page);
});

const rowTexts = (page: Parameters<typeof popupRows>[0]) =>
  popupRows(page).locator(".vault-suggest__name").allTextContents();

test("# lists tags with counts, #ds filters, #dsa/ shows children", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startTyping(page, DRAWING);
  await page.keyboard.type("#");
  await expect(popup(page)).toBeVisible();
  const all = await rowTexts(page);
  expect(all.sort()).toEqual(["#Interview", "#dsa", "#dsa/graphs"].sort());
  // Every tag row carries its drawing count.
  await expect(popupRows(page).locator(".vault-suggest__count")).toHaveCount(3);
  await expect(
    popupRows(page)
      .filter({ hasText: "#dsa/graphs" })
      .locator(".vault-suggest__count"),
  ).toHaveText("1");
  await expect(
    popupRows(page)
      .filter({ hasText: /^#dsa\d$/ })
      .locator(".vault-suggest__count"),
  ).toHaveText("2");

  await page.keyboard.type("ds");
  await expect.poll(() => rowTexts(page)).toEqual(["#dsa", "#dsa/graphs"]);
  await page.keyboard.type("a/");
  await expect.poll(() => rowTexts(page)).toEqual(["#dsa/graphs"]);
  expect(errors).toEqual([]);
});

test("ArrowDown + Enter inserts #Display and a trailing space", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startTyping(page, DRAWING);
  await page.keyboard.type("go #int");
  await expect.poll(() => rowTexts(page)).toEqual(["#Interview"]);
  await page.keyboard.press("Enter");
  await expect(popup(page)).toHaveCount(0);
  await expect(editArea(page)).toHaveValue("go #Interview ");
  await expect(editArea(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test("Ctrl+N moves the selection, Tab accepts", async ({ page }) => {
  await startTyping(page, DRAWING);
  await page.keyboard.type("#ds");
  await expect.poll(() => rowTexts(page)).toEqual(["#dsa", "#dsa/graphs"]);
  await expect(popupRows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+n");
  await expect(popupRows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(popupRows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+n");
  await page.keyboard.press("Tab");
  await expect(editArea(page)).toHaveValue("#dsa/graphs ");
  await expect(popup(page)).toHaveCount(0);
});

test("Escape closes the popup and keeps the typed text", async ({ page }) => {
  await startTyping(page, DRAWING);
  await page.keyboard.type("#in");
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  await expect(editArea(page)).toBeFocused();
  await expect(editArea(page)).toHaveValue("#in");
});

for (const text of ["abc#x", "http://a/#b", "&#"]) {
  test(`no popup for ${text}`, async ({ page }) => {
    await startTyping(page, DRAWING);
    await page.keyboard.type(text, { delay: 15 });
    await page.waitForTimeout(150);
    await expect(popup(page)).toHaveCount(0);
    await expect(editArea(page)).toHaveValue(text);
  });
}

test("[[x# stays the link popup (no tag rows)", async ({ page }) => {
  await startTyping(page, DRAWING);
  await page.keyboard.type("[[Gr#", { delay: 15 });
  await page.waitForTimeout(150);
  // Either no popup or link rows; never tag rows with counts.
  await expect(page.locator(".vault-suggest__count")).toHaveCount(0);
  await expect(editArea(page)).toHaveValue("[[Gr#");
});

test("accepted tag survives commit and shows in the Tags pane", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await startTyping(page, DRAWING);
  await page.keyboard.type("new #dsa/gr");
  await expect.poll(() => rowTexts(page)).toEqual(["#dsa/graphs"]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("and #fresh/idea");
  // No match for #fresh: the popup is gone; the text is typed as-is.
  await expect(popup(page)).toHaveCount(0);
  // Blur commits the text.
  const away = await scenePoint(page, 900, 700);
  await page.mouse.click(away.x, away.y);
  await expect(editArea(page)).toHaveCount(0);
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect
    .poll(async () =>
      (
        await readScene(page, PATH)
      ).elements.map((e: any) => e.originalText ?? ""),
    )
    .toContain("new #dsa/graphs and #fresh/idea");
  // The fake index only refreshes on demand (the native one emits on write).
  await page.evaluate(() =>
    (window as any).__vaultSearch.setIndexState(
      null,
      (window as any).__vaultRepo.handle,
    ),
  );
  // The index refresh (debounced) adds the new tag to the pane.
  await expect(tagRow(page, "fresh")).toBeVisible();
  await expect(tagRow(page, "fresh/idea")).toBeVisible();
  await expect(tagRow(page, "dsa/graphs")).toHaveAttribute(
    "aria-label",
    "Tag dsa/graphs, 2 drawings",
  );
  expect(await paneTagNames(page)).toContain("fresh");
  expect(errors).toEqual([]);
});
