import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, trackErrors } from "./helpers";
import { panel as historyPanel } from "./historyHelpers";
import { openTagsVault, searchBox, tagsPanel } from "./tagsHelpers";

// The activity bar, reached only by clicking its visible buttons (one
// click-through test per feature): each entry opens what the user expects.
const entry = (page: Page, id: string) =>
  page.getByTestId(`activity-bar-${id}`);
const pressed = (page: Page, id: string, on: boolean) =>
  expect(entry(page, id)).toHaveAttribute(
    "aria-pressed",
    on ? "true" : "false",
  );
const library = (page: Page) => page.locator(".default-sidebar");
const settings = (page: Page) => page.locator(".vault-settings-modal");

test("activity bar: every entry opens its panel, view or dialog", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  await expect(page.getByTestId("activity-bar")).toBeVisible();
  await expect(
    page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: "Graph view", exact: true }),
  ).toHaveCount(0);

  // No drawing open: Library and History are disabled with the reason.
  for (const [id, label] of [
    ["library", "Library"],
    ["history", "History"],
  ]) {
    await expect(entry(page, id)).toHaveAttribute("aria-disabled", "true");
    await expect(entry(page, id)).toHaveAttribute(
      "title",
      new RegExp(`^${label}.*Open a drawing first`),
    );
  }
  await entry(page, "history").click({ force: true });
  await expect(historyPanel(page)).toHaveCount(0);

  await openDrawing(page, "Graphs");
  await expect(entry(page, "library")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(entry(page, "history")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // Tooltip carries the shortcut of an entry with a default key.
  await expect(entry(page, "graph")).toHaveAttribute(
    "title",
    /^Graph view \((Cmd\+Option\+G|Ctrl\+Alt\+G)\)$/,
  );

  // Library sidebar.
  await pressed(page, "library", false);
  await entry(page, "library").click();
  await expect(library(page)).toBeVisible();
  await pressed(page, "library", true);
  await entry(page, "library").click();
  await expect(library(page)).toBeHidden();
  await pressed(page, "library", false);

  // History panel.
  await entry(page, "history").click();
  await expect(historyPanel(page)).toBeVisible();
  await pressed(page, "history", true);
  await entry(page, "history").click();
  await expect(historyPanel(page)).toHaveCount(0);
  await pressed(page, "history", false);

  // Gallery.
  await entry(page, "gallery").click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await pressed(page, "gallery", true);
  await entry(page, "gallery").click();
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  await pressed(page, "gallery", false);
  // Escape still closes it.
  await entry(page, "gallery").click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  await pressed(page, "gallery", false);

  // Search focuses the navigator's search box.
  await entry(page, "search").click();
  await expect(searchBox(page)).toBeFocused();

  // Tags shows the Tags pane and moves focus into it.
  await entry(page, "tags").click();
  await expect(tagsPanel(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest('[aria-label="Tags"], .vault-tags'),
      ),
    )
    .toBe(true);

  // Templates picker.
  await entry(page, "templates").click();
  const picker = page.getByRole("dialog", {
    name: "New drawing from template",
  });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Hotkeys settings page, then the settings modal.
  await entry(page, "hotkeys").click();
  await expect(settings(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hotkeys" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);

  await entry(page, "settings").click();
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);

  // Graph view: an official plugin, so a fresh load with the graph plugin enabled.
  await openTagsVault(page, "?seed=tags&plugins=graph");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await entry(page, "graph").click();
  await expect(page.getByTestId("graph-view")).toBeVisible();
  await pressed(page, "graph", true);
  await entry(page, "graph").click();
  await expect(page.getByTestId("graph-view")).toHaveCount(0);
  await pressed(page, "graph", false);

  expect(errors).toEqual([]);
});

test("activity bar: short windows scroll the top group, bottom entries stay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 220 });
  await openTagsVault(page);
  const bar = page.getByTestId("activity-bar");
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(220);
  // The bar's own groups scroll instead of overflowing the window.
  const top = page.locator(".vault-activity-bar__group--top");
  expect(await top.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  // Bottom entries are visible without scrolling and do not overlap the top group.
  for (const id of ["hotkeys", "settings"]) {
    await expect(entry(page, id)).toBeInViewport({ ratio: 1 });
  }
  const topBox = (await top.boundingBox())!;
  const hotkeys = (await entry(page, "hotkeys").boundingBox())!;
  expect(topBox.y + topBox.height).toBeLessThanOrEqual(hotkeys.y + 0.5);
  // The last top entry scrolls into view and works.
  await entry(page, "templates").scrollIntoViewIfNeeded();
  await expect(entry(page, "templates")).toBeInViewport({ ratio: 1 });
  await entry(page, "templates").click();
  const picker = page.getByRole("dialog", {
    name: "New drawing from template",
  });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});

test("activity bar: Settings > Interface hides and reorders entries", async ({
  page,
}) => {
  await openTagsVault(page);
  const order = () =>
    page
      .getByTestId("activity-bar")
      .locator("button[data-entry]")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry));
  // Built-ins register through the slot registry: the default order is unchanged (official plugins add their own entries).
  await expect
    .poll(order)
    .toEqual([
      "library",
      "history",
      "graph",
      "gallery",
      "search",
      "tags",
      "templates",
      "favourites.list",
      "frames.list",
      "hotkeys",
      "settings",
    ]);

  await entry(page, "settings").click();
  await expect(settings(page)).toBeVisible();
  await page.getByRole("tab", { name: "Interface" }).click();
  const list = settings(page).getByRole("list", {
    name: "Activity bar entries",
  });
  await list.scrollIntoViewIfNeeded();

  await page.getByRole("button", { name: "Move Graph view up" }).click();
  await expect
    .poll(order)
    .toEqual(expect.arrayContaining(["graph", "history"]));
  expect((await order()).indexOf("graph")).toBeLessThan(
    (await order()).indexOf("history"),
  );

  await page
    .getByRole("switch", { name: "Show Tags" })
    .uncheck({ force: true });
  await expect(entry(page, "tags")).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Show Tags" }),
  ).not.toBeChecked();

  // Hidden entries still work through the palette; reset restores the bar.
  await page
    .getByRole("button", { name: "Reset order and visibility" })
    .click();
  await expect(entry(page, "tags")).toBeVisible();
  // Built-ins register through the slot registry: the default order is unchanged.
  await expect
    .poll(order)
    .toEqual([
      "library",
      "history",
      "graph",
      "gallery",
      "search",
      "tags",
      "templates",
      "favourites.list",
      "frames.list",
      "hotkeys",
      "settings",
    ]);
  expect((await order()).indexOf("history")).toBeLessThan(
    (await order()).indexOf("graph"),
  );
});

test("activity bar: hiding every entry removes the rail, showing one brings it back", async ({
  page,
}) => {
  await openTagsVault(page);
  const bar = page.getByTestId("activity-bar");
  await expect(bar).toBeVisible();
  const railWidth = (await bar.boundingBox())!.width;
  expect(railWidth).toBeGreaterThan(30);
  const paneLeft = async () =>
    (await page.locator(".vault-editor-pane").boundingBox())!.x;
  const withRail = await paneLeft();

  await entry(page, "settings").click();
  await expect(settings(page)).toBeVisible();
  await page.getByRole("tab", { name: "Interface" }).click();
  const list = settings(page).getByRole("list", {
    name: "Activity bar entries",
  });
  await list.scrollIntoViewIfNeeded();
  const switches = list.getByRole("switch");
  const count = await switches.count();
  expect(count).toBeGreaterThanOrEqual(9);
  for (let i = 0; i < count; i++) {
    const toggle = switches.nth(i);
    await toggle.scrollIntoViewIfNeeded();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
  }

  // No empty rail: the element is gone and the editor pane moved left.
  await expect(bar).toHaveCount(0);
  await expect.poll(paneLeft).toBeLessThanOrEqual(withRail - railWidth + 1);

  // Showing a single entry brings the rail back with just that entry.
  const search = list.getByRole("switch", { name: "Show Search", exact: true });
  await search.scrollIntoViewIfNeeded();
  await search.check();
  await expect(search).toBeChecked();
  await expect(bar).toBeVisible();
  await expect(bar.locator("button[data-entry]")).toHaveCount(1);
  await expect(entry(page, "search")).toBeVisible();
});
