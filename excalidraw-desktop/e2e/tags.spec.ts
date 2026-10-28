import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, trackErrors } from "./helpers";
import { openTagsVault, paneTagNames, tagList } from "./tagsHelpers";

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text… (tag:#name)");
const panel = (page: Page) => page.getByRole("region", { name: "Tags" });
const tagButton = (page: Page, name: string) =>
  panel(page).getByRole("button", { name: new RegExp(`^Tag ${name},`) });
const drawingRow = (page: Page, name: string) =>
  page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: name });
const chip = (page: Page, name: string) =>
  page.getByRole("button", { name: `Filter by tag ${name}`, exact: true });

test.beforeEach(async ({ page }) => {
  await openVault(page, "?seed=tags");
  // Tree rows are only visible once the DSA folder is open.
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await expect(panel(page)).toBeVisible();
});

test("Tags panel shows nested tags with counts and collapses", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expect(tagButton(page, "dsa")).toHaveAttribute(
    "aria-label",
    "Tag dsa, 2 drawings",
  );
  await expect(tagButton(page, "dsa/graphs")).toHaveAttribute(
    "aria-label",
    "Tag dsa/graphs, 1 drawing",
  );
  await expect(tagButton(page, "Interview")).toBeVisible();

  await panel(page).getByRole("button", { name: "Collapse dsa" }).click();
  await expect(tagButton(page, "dsa/graphs")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Expand dsa" }).click();
  await expect(tagButton(page, "dsa/graphs")).toBeVisible();

  await panel(page).getByRole("button", { name: "Tags", exact: true }).click();
  await expect(tagButton(page, "dsa")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Tags", exact: true }).click();
  await expect(tagButton(page, "dsa")).toBeVisible();
  expect(errors).toEqual([]);
});

test("clicking a tag filters drawings; clearing the search restores the tree", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await tagButton(page, "dsa").click();
  await expect(searchBox(page)).toHaveValue("tag:#dsa");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toBeVisible();
  await expect(drawingRow(page, "Not Tags")).toHaveCount(0);
  // A plain tag filter keeps the panel; clicking the active tag clears it.
  await expect(tagButton(page, "dsa")).toHaveAttribute("aria-pressed", "true");
  await tagButton(page, "dsa").click();
  await expect(searchBox(page)).toHaveValue("");
  await expect(drawingRow(page, "Tagged Graphs")).toHaveCount(0);
  await expect(tagButton(page, "dsa")).toHaveAttribute("aria-pressed", "false");

  await tagButton(page, "dsa").click();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(searchBox(page)).toHaveValue("");

  await tagButton(page, "dsa/graphs").click();
  await expect(searchBox(page)).toHaveValue("tag:#dsa/graphs");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("tag chips show on tree rows and clicking one filters", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expect(chip(page, "dsa/graphs")).toBeVisible();
  await expect(chip(page, "Interview")).toBeVisible();
  await expect(chip(page, "dsa")).toBeVisible();

  await chip(page, "Interview").click();
  await expect(searchBox(page)).toHaveValue("tag:#interview");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("typing 'tag:#dsa graph' combines the tag filter with text", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await searchBox(page).fill("tag:#dsa graph");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  // Free-text searches give the results the room: no Tags panel.
  await expect(panel(page)).toHaveCount(0);
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  await expect(drawingRow(page, "Not Tags")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("URL fragments and hex colours are not tags", async ({ page }) => {
  const errors = trackErrors(page);
  await expect(tagButton(page, "dsa")).toBeVisible();
  for (const bad of ["frag", "ff00aa"]) {
    await expect(tagButton(page, bad)).toHaveCount(0);
    await expect(chip(page, bad)).toHaveCount(0);
  }
  await searchBox(page).fill("tag:#frag");
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  await searchBox(page).fill("tag:#ff00aa");
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("turning off tag chips in Settings hides them", async ({ page }) => {
  const errors = trackErrors(page);
  await expect(chip(page, "Interview")).toBeVisible();
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole("switch", {
    name: /Show tag chips in the file tree/,
  });
  if (!(await toggle.isVisible())) {
    await dialog.getByRole("tab", { name: "Interface" }).click();
  }
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, "Interview")).toHaveCount(0);
  // The Tags panel itself stays.
  await expect(tagButton(page, "Interview")).toBeVisible();
  expect(errors).toEqual([]);
});

// ---- P2: sort, persistence, keyboard, virtualisation, palette, dock chips ----

const sortButton = (page: Page, to: "name" | "count") =>
  panel(page).getByRole("button", { name: `Sort tags by ${to}` });
const cursorRow = (page: Page) =>
  tagList(page).locator(".vault-tags__row--cursor .vault-tags__label");

test("sort toggle orders siblings by name or count at every level", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page, "?tagcount=60");
  // Default: by name (grp, then its children a, b, c, then t0000, t0001, ...).
  const byName = await paneTagNames(page);
  expect(byName.slice(0, 6)).toEqual(["grp", "a", "b", "c", "t0000", "t0001"]);
  await sortButton(page, "count").click();
  // Count: grp(3) and t0000(3), t0003(3) before the single-drawing tags; the
  // children reorder too: b(3), c(2), a(1).
  await expect
    .poll(async () => (await paneTagNames(page)).slice(0, 6))
    .toEqual(["grp", "b", "c", "a", "t0000", "t0003"]);
  await sortButton(page, "name").click();
  await expect
    .poll(async () => (await paneTagNames(page)).slice(0, 3))
    .toEqual(["grp", "a", "b"]);
  expect(errors).toEqual([]);
});

test("sort and collapse state persist across reload, per vault", async ({
  page,
}) => {
  await openTagsVault(page, "?tagcount=60");
  await sortButton(page, "count").click();
  await panel(page).getByRole("button", { name: "Collapse grp" }).click();
  await expect(tagButton(page, "grp/b")).toHaveCount(0);
  await openTagsVault(page, "?tagcount=60");
  // Count order restored (the toggle now offers "name"), grp stays collapsed.
  await expect(sortButton(page, "name")).toBeVisible();
  await expect(tagButton(page, "grp")).toBeVisible();
  await expect(tagButton(page, "grp/b")).toHaveCount(0);
  expect((await paneTagNames(page)).slice(0, 3)).toEqual([
    "grp",
    "t0000",
    "t0003",
  ]);
  await panel(page).getByRole("button", { name: "Expand grp" }).click();
  await expect(tagButton(page, "grp/b")).toBeVisible();
  // The whole section collapse persists too.
  await panel(page).getByRole("button", { name: "Tags", exact: true }).click();
  await openTagsVault(page, "?tagcount=60");
  await expect(tagList(page)).toHaveCount(0);
});

test("keyboard: j/k/h/l/g/G move, Enter filters, Escape leaves", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await tagList(page).focus();
  await expect(cursorRow(page)).toHaveText("#dsa");
  await page.keyboard.press("j");
  await expect(cursorRow(page)).toHaveText("#graphs");
  await page.keyboard.press("j");
  await expect(cursorRow(page)).toHaveText("#Interview");
  await page.keyboard.press("k");
  await expect(cursorRow(page)).toHaveText("#graphs");
  // h on a leaf goes to the parent; h on an open parent collapses it.
  await page.keyboard.press("h");
  await expect(cursorRow(page)).toHaveText("#dsa");
  await page.keyboard.press("h");
  await expect(tagButton(page, "dsa/graphs")).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(tagButton(page, "dsa/graphs")).toBeVisible();
  await page.keyboard.press("Shift+G");
  await expect(cursorRow(page)).toHaveText("#Interview");
  await page.keyboard.press("g");
  await expect(cursorRow(page)).toHaveText("#dsa");
  await page.keyboard.press("Shift+G");
  await page.keyboard.press("Enter");
  await expect(searchBox(page)).toHaveValue("tag:#interview");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Escape in the tag list hands focus back", async ({ page }) => {
  await tagList(page).focus();
  await expect(tagList(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tagList(page)).not.toBeFocused();
});

test("600+ tags are virtualised and scrolling shows later rows", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page, "?tagcount=700");
  const rows = tagList(page).locator(".vault-tags__row");
  await expect(rows.first()).toBeVisible();
  const first = await rows.count();
  expect(first).toBeGreaterThan(5);
  expect(first).toBeLessThan(100);
  await expect(tagButton(page, "t0699")).toHaveCount(0);
  await tagList(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(tagButton(page, "t0699")).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  // Keyboard jump to the first row scrolls back.
  await tagList(page).focus();
  await page.keyboard.press("g");
  await expect(tagButton(page, "grp")).toBeVisible();
  await page.keyboard.press("Shift+G");
  await expect(tagButton(page, "t0699")).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test("palette lists Tag: #x entries and choosing one applies the filter", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.keyboard.press("Meta+Shift+KeyP");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill(">Tag: #Inter");
  const option = dialog.getByRole("option", { name: /Tag: #Interview \(1\)/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog).toHaveCount(0);
  await expect(searchBox(page)).toHaveValue("tag:#interview");
  await expect(drawingRow(page, "Tagged Graphs")).toBeVisible();
  await expect(drawingRow(page, "Tagged Arrays")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("palette entry via keyboard (Enter) applies a nested tag", async ({
  page,
}) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill(">Tag: #dsa/graphs");
  await expect(
    dialog.getByRole("option", { name: /Tag: #dsa\/graphs \(1\)/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(searchBox(page)).toHaveValue("tag:#dsa/graphs");
});

const dockChips = (page: Page) =>
  page.locator('.vault-links [aria-label="Drawing tags"] button');

test("Links dock header shows the drawing's tags; click filters", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openDrawing(page, "Tagged Graphs");
  // Collapsed dock renders nothing for tags.
  await expect(page.locator(".vault-links")).toHaveCount(0);
  await expect(page.locator(".vault-links__tags")).toHaveCount(0);
  await page.keyboard.press("Meta+Alt+b");
  await expect(page.locator(".vault-links")).toBeVisible();
  await expect(dockChips(page)).toHaveCount(2);
  await expect(
    page.locator('.vault-links button[aria-label="Filter by tag dsa/graphs"]'),
  ).toBeVisible();
  await expect(
    page.locator('.vault-links button[aria-label="Filter by tag Interview"]'),
  ).toBeVisible();
  await page
    .locator('.vault-links button[aria-label="Filter by tag Interview"]')
    .click();
  await expect(searchBox(page)).toHaveValue("tag:#interview");
  // Collapsing the dock removes the chips again.
  await page.keyboard.press("Meta+Alt+b").catch(() => {});
  expect(errors).toEqual([]);
});

test("a drawing without tags shows no chips in the dock", async ({ page }) => {
  await openDrawing(page, "Not Tags");
  await page.keyboard.press("Meta+Alt+b");
  await expect(page.locator(".vault-links")).toBeVisible();
  await expect(page.locator(".vault-links__tags")).toHaveCount(0);
});
