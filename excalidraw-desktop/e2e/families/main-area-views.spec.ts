import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openDrawing, trackErrors } from "../helpers";
import { openTagsVault, searchBox } from "../tagsHelpers";

// Family: every view that takes the main area (gallery, graph) gives way when the
// user opens a file, however they open it (explorer, tab, quick switcher, search
// result, opening the file that is already shown), and Back brings the view back.
// One row per view x one row per way to open a file. See personal/feature/views/FAMILY.md.

type View = { name: string; entry: string; testId: string };
const VIEWS: View[] = [
  { name: "gallery", entry: "activity-bar-gallery", testId: "gallery-view" },
  { name: "graph", entry: "activity-bar-graph", testId: "graph-view" },
];

const GRAPHS = "DSA/Graphs.excalidraw";
const SECOND = "DSA/Tagged Graphs.excalidraw";

type Way = {
  name: string;
  /** Opens a file (through visible UI) while the view covers the main area. */
  open: (page: Page) => Promise<void>;
  /** The drawing that must be showing afterwards. */
  shows: string;
  /** Needs a second tab open before the view is opened. */
  twoTabs?: boolean;
};

const treeItem = (page: Page, name: string) =>
  page.locator(".vault-tree-item__name", { hasText: name }).first();

const WAYS: Way[] = [
  {
    name: "explorer, another file",
    open: (page) => treeItem(page, "Tagged Graphs").click(),
    shows: SECOND,
  },
  {
    name: "explorer, the file already shown",
    open: (page) => treeItem(page, "Graphs").click(),
    shows: GRAPHS,
  },
  {
    name: "tab strip",
    twoTabs: true,
    open: (page) =>
      page
        .getByTestId("vault-tab")
        .filter({ hasText: "Tagged Graphs" })
        .click(),
    shows: SECOND,
  },
  {
    name: "quick switcher",
    open: async (page) => {
      await page.keyboard.press("Meta+KeyP");
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await palette.getByRole("combobox").fill("Tagged Graphs");
      await palette.getByRole("option").first().click();
    },
    shows: SECOND,
  },
  {
    name: "search result",
    open: async (page) => {
      await searchBox(page).fill("Tagged Graphs");
      await page
        .locator('.vault-search-row[data-kind="drawing"]')
        .filter({ hasText: "Tagged Graphs" })
        .click();
    },
    shows: SECOND,
  },
];

const shown = (page: Page, path: string) =>
  expect(page.locator(".vault-editor")).toHaveAttribute(
    "data-document-id",
    new RegExp(`:${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  );

for (const view of VIEWS) {
  for (const way of WAYS) {
    test(`${view.name} gives way to a file opened from: ${way.name}`, async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await openTagsVault(page);
      await openDrawing(page, "Graphs");
      if (way.twoTabs) {
        await page.getByTestId("vault-tab-new").click();
        await treeItem(page, "Tagged Graphs").click();
        await expect(page.getByTestId("vault-tab")).toHaveCount(2);
        await page
          .getByTestId("vault-tab")
          .filter({ hasText: /^\s*Graphs/ })
          .click();
      }
      await page.getByTestId(view.entry).click();
      await expect(page.getByTestId(view.testId)).toBeVisible();

      await way.open(page);

      await expect(page.getByTestId(view.testId)).toHaveCount(0);
      await expect(page.locator(".vault-editor-body--covered")).toHaveCount(0);
      await shown(page, way.shows);
      await expect(page.getByTestId(view.entry)).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // Back brings the view back; Escape-style close still works afterwards.
      await page.keyboard.press("Meta+Alt+ArrowLeft");
      await expect(page.getByTestId(view.testId)).toBeVisible();
      await page.getByTestId(view.entry).click();
      await expect(page.getByTestId(view.testId)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

test("Back only returns to a view the latest navigation dismissed", async ({
  page,
}) => {
  await openTagsVault(page);
  await openDrawing(page, "Graphs");
  await page.getByTestId("activity-bar-gallery").click();
  await expect(page.getByTestId("gallery-view")).toBeVisible();
  await treeItem(page, "Tagged Graphs").click();
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
  // Another file is opened first: the gallery is forgotten.
  await treeItem(page, "Graphs").click();
  await shown(page, GRAPHS);
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(page.getByTestId("gallery-view")).toHaveCount(0);
});
