import { expect, test, type Page } from "@playwright/test";

import { openVault, readScene, trackErrors } from "./helpers";

const SHORTEST = "DSA/Shortest Paths.excalidraw";

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");
const results = (page: Page) =>
  page.getByRole("listbox", { name: "Search results" });
const drawingRow = (page: Page, name: string) =>
  page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: name });
const snippetRows = (page: Page) =>
  page.locator('.vault-search-row[data-kind="snippet"]');
const activeRow = (page: Page) =>
  page.locator('.vault-search-row[aria-selected="true"]');

/** Typing is racy with the debounce: always wait for the rows before pressing keys. */
const searchFor = async (
  page: Page,
  text: string,
  waitFor: () => ReturnType<Page["locator"]>,
) => {
  await searchBox(page).fill(text);
  await expect(waitFor()).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await openVault(page, "?seed=search");
});

test("typing 'dijk' shows the drawing group with a highlighted snippet", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await searchFor(page, "dijk", () => snippetRows(page).first());
  await expect(drawingRow(page, "Shortest Paths")).toBeVisible();
  await expect(snippetRows(page)).toHaveCount(1);
  await expect(snippetRows(page).first()).toContainText(
    "Dijkstra shortest path",
  );
  await expect(
    snippetRows(page).first().locator("mark.vault-search-mark"),
  ).toHaveText("Dijk");
  await expect(page.getByText("1 drawing", { exact: true })).toBeVisible();
  // the folder context is shown on the drawing row
  await expect(drawingRow(page, "Shortest Paths")).toContainText("DSA");
  expect(errors).toEqual([]);
});

test("ArrowDown to the snippet + Enter opens the drawing and selects the rectangle", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await searchFor(page, "dijk", () => snippetRows(page).first());
  // First row (the drawing) is active initially; wait until it is, then move.
  await expect(activeRow(page)).toHaveAttribute("data-kind", "drawing");
  await page.keyboard.press("ArrowDown");
  await expect(activeRow(page)).toHaveAttribute("data-kind", "snippet");
  await page.keyboard.press("Enter");

  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", {
      hasText: "Shortest Paths",
    }),
  ).toBeVisible();
  // Selected element shows the shape properties panel.
  await expect(page.locator(".selected-shape-actions")).toBeVisible({
    timeout: 10_000,
  });

  // Prove WHICH element is selected: Delete removes the selection. Selecting the
  // container (not just the label) must delete both rectangle and its label.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("Delete");
  await expect
    .poll(
      async () => {
        const scene = await readScene(page, SHORTEST);
        const deleted = (id: string) =>
          scene.elements.find((e: { id: string }) => e.id === id)?.isDeleted;
        return [
          deleted("algo-rect"),
          deleted("algo-label"),
          deleted("algo-frame"),
        ];
      },
      { timeout: 10_000 },
    )
    .toEqual([true, true, false]);
  expect(errors).toEqual([]);
});

test("clicking a snippet row opens the drawing and selects the container", async ({
  page,
}) => {
  await searchFor(page, "shortest path", () => snippetRows(page).first());
  await snippetRows(page).first().click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(page.locator(".selected-shape-actions")).toBeVisible({
    timeout: 10_000,
  });
});

test("Enter on the drawing row opens it without selecting anything", async ({
  page,
}) => {
  await searchFor(page, "dijk", () => snippetRows(page).first());
  await expect(activeRow(page)).toHaveAttribute("data-kind", "drawing");
  await page.keyboard.press("Enter");
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator(".selected-shape-actions")).toHaveCount(0);
});

test("the active row survives result refreshes while typing more characters", async ({
  page,
}) => {
  await searchBox(page).click();
  await page.keyboard.type("dij", { delay: 40 });
  // Array form: retries until the rows show exactly this query's marks. On a
  // loaded machine a keystroke gap can exceed the debounce, so results for an
  // earlier prefix ("d": two marks) may still be on screen, and a single-value
  // toHaveText fails at once on that strict-mode violation instead of waiting.
  await expect(snippetRows(page).first().locator("mark")).toHaveText(["Dij"]);
  await page.keyboard.type("kstra", { delay: 40 });
  await expect(snippetRows(page).first().locator("mark")).toHaveText([
    "Dijkstra",
  ]);
  await page.keyboard.press("ArrowDown");
  await expect(activeRow(page)).toHaveAttribute("data-kind", "snippet");
  // the same query again (no change) must not reset the selection
  await page.waitForTimeout(400);
  await expect(activeRow(page)).toHaveAttribute("data-kind", "snippet");
});

test("frame names are searchable: 'graph alg' finds the frame match", async ({
  page,
}) => {
  await searchFor(page, "graph alg", () => snippetRows(page).first());
  await expect(drawingRow(page, "Shortest Paths")).toBeVisible();
  await expect(snippetRows(page).first()).toContainText("Graph algorithms");
  await expect(snippetRows(page).first().locator("mark")).toHaveText([
    "Graph",
    "alg",
  ]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".selected-shape-actions")).toBeVisible({
    timeout: 10_000,
  });
});

test("multi-term search finds a drawing by name plus content", async ({
  page,
}) => {
  await searchFor(page, "shortest dijkstra", () => snippetRows(page).first());
  await expect(drawingRow(page, "Shortest Paths")).toBeVisible();
});

test("accent- and case-insensitive: 'DÍJKSTRÁ' finds Dijkstra", async ({
  page,
}) => {
  await searchFor(page, "DÍJKSTRÁ", () => snippetRows(page).first());
  await expect(snippetRows(page).first()).toContainText(
    "Dijkstra shortest path",
  );
});

test("no match shows a message and no rows", async ({ page }) => {
  await searchBox(page).fill("zzzzqqqq");
  await expect(page.getByText("No matches")).toBeVisible();
  await expect(page.locator(".vault-search-row")).toHaveCount(0);
  // and recovers when the query is fixed
  await searchBox(page).fill("dijk");
  await expect(snippetRows(page).first()).toBeVisible();
  await expect(page.getByText("No matches")).toHaveCount(0);
});

test("Escape clears the query and restores the tree", async ({ page }) => {
  await searchFor(page, "dijk", () => snippetRows(page).first());
  await page.keyboard.press("Escape");
  await expect(searchBox(page)).toHaveValue("");
  await expect(results(page)).toHaveCount(0);
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "DSA" }).first(),
  ).toBeVisible();
});

test("ArrowUp/ArrowDown move the active row and focus stays in the input", async ({
  page,
}) => {
  await searchFor(page, "dijk", () => snippetRows(page).first());
  await page.keyboard.press("ArrowDown");
  await expect(activeRow(page)).toHaveAttribute("data-kind", "snippet");
  await page.keyboard.press("ArrowUp");
  await expect(activeRow(page)).toHaveAttribute("data-kind", "drawing");
  await expect(searchBox(page)).toBeFocused();
});

test("Cmd/Ctrl+Shift+F focuses the search box from the canvas", async ({
  page,
}) => {
  // open a drawing and focus the canvas first
  await searchFor(page, "dijk", () => drawingRow(page, "Shortest Paths"));
  await drawingRow(page, "Shortest Paths").click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page
    .locator(".vault-editor canvas.interactive")
    .click({ position: { x: 600, y: 500 } });
  await expect(searchBox(page)).not.toBeFocused();
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(searchBox(page)).toBeFocused();
});

test("Cmd/Ctrl+Shift+F expands a collapsed navigator", async ({ page }) => {
  const nav = page.getByLabel("Vault File Navigator");
  await page.getByRole("button", { name: "Hide Navigator" }).click();
  await expect(nav).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(nav).toHaveAttribute("aria-hidden", "false");
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type("dijk");
  await expect(snippetRows(page).first()).toBeVisible();
});
