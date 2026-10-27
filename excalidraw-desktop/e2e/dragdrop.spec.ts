import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "./helpers";

// Pointer-event drag and drop in the navigator tree (not HTML5 DnD).

const GRAPHS = "DSA/Graphs.excalidraw";
const DP = "DSA/Dynamic Programming";
const INTRO = `${DP}/01 Introduction.excalidraw`;

/** Tree-view row by its vault path (search results carry no data-tree-path). */
const row = (page: Page, path: string): Locator =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );

const ghost = (page: Page) => page.locator(".vault-tree-drag-ghost");
const container = (page: Page) => page.locator(".vault-tree-container");

const center = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("element not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Grab point on a row: its name, away from the hover-only action buttons. */
const grabPoint = async (page: Page, path: string) => {
  const r = row(page, path);
  await expect(r).toBeVisible();
  return center(r.locator(".vault-tree-item__name"));
};

/**
 * Press on `sourcePath`, move past the drag threshold, then glide to
 * `target`. Leaves the button held so callers can assert mid-drag state.
 */
const startDrag = async (page: Page, sourcePath: string, target: Locator) => {
  const from = await grabPoint(page, sourcePath);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 4 });
  await expect(target).toBeVisible();
  const to = await center(target);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  return to;
};

const dragAndDrop = async (page: Page, sourcePath: string, target: Locator) => {
  await startDrag(page, sourcePath, target);
  await page.mouse.up();
};

const expandFolder = async (page: Page, path: string) => {
  const r = row(page, path);
  await expect(r).toBeVisible();
  if ((await r.getAttribute("aria-expanded")) !== "true") {
    await r.locator(".vault-tree-item__toggle").click();
  }
  await expect(r).toHaveAttribute("aria-expanded", "true");
};

const pathExists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    try {
      await repo.readDrawing(repo.handle, p);
      return true;
    } catch {
      return false;
    }
  }, path);

const listDir = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    return (await repo.listDirectory(repo.handle, p)).map(
      (e: any) => e.path as string,
    );
  }, path);

/** Seed the fake vault directly, then let the navigator pick it up. */
const seed = async (
  page: Page,
  items: { folders?: string[]; drawings?: string[] },
) => {
  await page.evaluate(async ({ folders = [], drawings = [] }) => {
    const repo = (window as any).__vaultRepo;
    const json = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "e2e",
      elements: [],
      appState: {},
      files: {},
    });
    folders.forEach((f) => repo.seedFolder(f));
    drawings.forEach((d) => repo.seedDrawing(d, json));
  }, items);
  // Refresh lives in the command palette now (no header button).
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("navigator: refresh files");
  await page.keyboard.press("Enter");
  for (const p of [...(items.folders ?? []), ...(items.drawings ?? [])]) {
    if (!p.includes("/")) {
      await expect(row(page, p)).toBeVisible();
    }
  }
};

const expectIdle = async (page: Page) => {
  await expect(page.locator("body")).not.toHaveClass(/vault-tree-dragging/);
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.locator(".vault-tree-item--drop-target")).toHaveCount(0);
  await expect(container(page)).not.toHaveClass(
    /vault-tree-container--drop-root/,
  );
};

const liveRectangles = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter(
    (el: any) => el.type === "rectangle" && !el.isDeleted,
  ).length;

const drawRectangle = async (page: Page) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.55;
  const y0 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

test("1. drag a drawing into a folder", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  const target = row(page, DP);
  const pointer = await startDrag(page, GRAPHS, target);

  await expect(page.locator("body")).toHaveClass(/vault-tree-dragging/);
  await expect(ghost(page)).toBeVisible();
  await expect(ghost(page)).toContainText("Graphs");
  await expect(ghost(page)).not.toHaveAttribute("data-allowed", "false");
  await expect(target).toHaveClass(/vault-tree-item--drop-target/);
  // The ghost follows the pointer.
  const g = await ghost(page).boundingBox();
  expect(g).not.toBeNull();
  expect(Math.abs(g!.x - pointer.x)).toBeLessThan(150);
  expect(Math.abs(g!.y - pointer.y)).toBeLessThan(80);
  await screenshot(page, { path: `${SHOTS}/${info.project.name}-dnd-1.png` });

  await page.mouse.up();
  await expectIdle(page);

  const dest = `${DP}/Graphs.excalidraw`;
  await expect.poll(() => pathExists(page, dest), { timeout: 5000 }).toBe(true);
  expect(await pathExists(page, GRAPHS)).toBe(false);
  await expect(row(page, GRAPHS)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("2. drag a folder into another folder", async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page, { folders: ["Archive"] });
  await expandFolder(page, "DSA");
  await dragAndDrop(page, DP, row(page, "Archive"));
  await expectIdle(page);

  await expect
    .poll(() => listDir(page, "Archive"), { timeout: 5000 })
    .toContain("Archive/Dynamic Programming");
  expect(await listDir(page, "DSA")).not.toContain(DP);
  expect(
    await pathExists(
      page,
      "Archive/Dynamic Programming/01 Introduction.excalidraw",
    ),
  ).toBe(true);
  expect(await pathExists(page, INTRO)).toBe(false);
  await expect(row(page, DP)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("3. drag an item to the vault root (empty space below rows)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  const filler = page.locator(".vault-tree-container .vault-tree-root-drop");
  await startDrag(page, GRAPHS, filler);
  await expect(container(page)).toHaveClass(/vault-tree-container--drop-root/);
  await expect(ghost(page)).not.toHaveAttribute("data-allowed", "false");
  await page.mouse.up();
  await expectIdle(page);

  await expect
    .poll(() => pathExists(page, "Graphs.excalidraw"), { timeout: 5000 })
    .toBe(true);
  expect(await pathExists(page, GRAPHS)).toBe(false);
  await expect(row(page, "Graphs.excalidraw")).toBeVisible();
  expect(errors).toEqual([]);
});

test("4. dropping on a drawing row moves into that drawing's folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seed(page, { drawings: ["Notes.excalidraw"] });
  await expandFolder(page, "DSA");
  const target = row(page, GRAPHS);
  await startDrag(page, "Notes.excalidraw", target);
  // The highlighted drop target is the drawing's folder, not the drawing.
  await expect(row(page, "DSA")).toHaveClass(/vault-tree-item--drop-target/);
  await page.mouse.up();
  await expectIdle(page);

  await expect
    .poll(() => pathExists(page, "DSA/Notes.excalidraw"), { timeout: 5000 })
    .toBe(true);
  expect(await pathExists(page, "Notes.excalidraw")).toBe(false);
  expect(errors).toEqual([]);
});

test("5. folder into its own descendant is blocked", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  const before = await listDir(page, "");
  await startDrag(page, "DSA", row(page, DP));

  await expect(ghost(page)).toBeVisible();
  await expect(ghost(page)).toHaveAttribute("data-allowed", "false");
  await expect(ghost(page)).toContainText(/subfolder/i);
  await screenshot(page, { path: `${SHOTS}/${info.project.name}-dnd-5.png` });
  await page.mouse.up();
  await expectIdle(page);

  await page.waitForTimeout(300);
  expect(await listDir(page, "")).toEqual(before);
  expect(await pathExists(page, INTRO)).toBe(true);
  expect(await pathExists(page, GRAPHS)).toBe(true);
  await expect(row(page, "DSA")).toBeVisible();
  expect(errors).toEqual([]);
});

test("6. dropping into the current parent is a no-op", async ({ page }) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await startDrag(page, GRAPHS, row(page, "DSA"));
  await expect(ghost(page)).toHaveAttribute("data-allowed", "false");
  await page.mouse.up();
  await expectIdle(page);
  await page.waitForTimeout(300);
  expect(await pathExists(page, GRAPHS)).toBe(true);
  expect(errors).toEqual([]);
});

test("7. Escape cancels the drag", async ({ page }) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await startDrag(page, GRAPHS, row(page, DP));
  await expect(page.locator("body")).toHaveClass(/vault-tree-dragging/);
  await page.keyboard.press("Escape");
  await expectIdle(page);
  await page.mouse.up();
  await expectIdle(page);

  await page.waitForTimeout(300);
  expect(await pathExists(page, GRAPHS)).toBe(true);
  expect(await pathExists(page, `${DP}/Graphs.excalidraw`)).toBe(false);
  // The release after Escape must not count as a click on the target folder.
  await expect(row(page, DP)).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("7b. Escape then release over the dragged row does not open it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  const from = await grabPoint(page, GRAPHS);
  await startDrag(page, GRAPHS, row(page, DP));
  await page.keyboard.press("Escape");
  await expectIdle(page);
  await page.mouse.move(from.x, from.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page.locator(".vault-editor canvas.interactive")).toHaveCount(0);
  await expect(row(page, GRAPHS)).not.toHaveClass(/vault-tree-item--active/);
  expect(errors).toEqual([]);
});

test("8. moving the open drawing keeps editing and saving at the new path", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await openDrawing(page, "Graphs");
  const before = await liveRectangles(page, GRAPHS);

  await dragAndDrop(page, GRAPHS, row(page, DP));
  await expectIdle(page);
  const dest = `${DP}/Graphs.excalidraw`;
  await expect.poll(() => pathExists(page, dest), { timeout: 5000 }).toBe(true);
  expect(await pathExists(page, GRAPHS)).toBe(false);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Graphs" }),
  ).toBeVisible();

  await drawRectangle(page);
  await expect
    .poll(() => liveRectangles(page, dest), { timeout: 5000 })
    .toBe(before + 1);
  // Saving must not resurrect the old path.
  await page.waitForTimeout(500);
  expect(await pathExists(page, GRAPHS)).toBe(false);
  expect(errors).toEqual([]);
});

test("9. hovering a collapsed folder auto-expands it", async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page, { drawings: ["Notes.excalidraw"] });
  const dsa = row(page, "DSA");
  await expect(dsa).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, DP)).toHaveCount(0);

  await startDrag(page, "Notes.excalidraw", dsa);
  // Small jiggle so hover timers keyed on pointermove are not starved.
  const c = await center(dsa);
  await page.mouse.move(c.x + 2, c.y, { steps: 2 });
  await page.waitForTimeout(900);
  await expect(dsa).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, DP)).toBeVisible();

  // Continue the same drag into the freshly revealed subfolder.
  const to = await center(row(page, DP));
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(row(page, DP)).toHaveClass(/vault-tree-item--drop-target/);
  await page.mouse.up();
  await expectIdle(page);

  await expect
    .poll(() => pathExists(page, `${DP}/Notes.excalidraw`), { timeout: 5000 })
    .toBe(true);
  expect(await pathExists(page, "Notes.excalidraw")).toBe(false);
  expect(errors).toEqual([]);
});

test("10. a quick pass over a collapsed folder does not expand it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seed(page, { folders: ["Archive"], drawings: ["Notes.excalidraw"] });
  await expect(row(page, "DSA")).toHaveAttribute("aria-expanded", "false");
  await startDrag(page, "Notes.excalidraw", row(page, "DSA"));
  const to = await center(row(page, "Archive"));
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expectIdle(page);

  await expect
    .poll(() => pathExists(page, "Archive/Notes.excalidraw"), {
      timeout: 5000,
    })
    .toBe(true);
  await expect(row(page, "DSA")).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("11. a drag does not open the dragged drawing or toggle folders", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await expandFolder(page, DP);
  await openDrawing(page, "01 Introduction");
  const active = page.locator(".vault-breadcrumbs__item--active");
  await expect(active).toContainText("01 Introduction");

  // Drawing to root: the dragged drawing must not become the open one.
  await dragAndDrop(
    page,
    GRAPHS,
    page.locator(".vault-tree-container .vault-tree-root-drop"),
  );
  await expectIdle(page);
  await expect
    .poll(() => pathExists(page, "Graphs.excalidraw"), { timeout: 5000 })
    .toBe(true);
  await page.waitForTimeout(300);
  await expect(active).toContainText("01 Introduction");
  await expect(row(page, INTRO)).toHaveClass(/vault-tree-item--active/);

  // A blocked drag of an expanded folder released on itself must not
  // collapse it (no click).
  await startDrag(page, DP, row(page, DP));
  await page.mouse.up();
  await expectIdle(page);
  await page.waitForTimeout(300);
  await expect(row(page, DP)).toHaveAttribute("aria-expanded", "true");
  expect(errors).toEqual([]);
});

test("12. a plain click (no movement) still opens a drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  const p = await grabPoint(page, GRAPHS);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 1); // under the 4px threshold
  await page.mouse.up();
  await expectIdle(page);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Graphs" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("13. no drag from search results", async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page, { folders: ["Archive"] });
  await page.getByPlaceholder(/search/i).fill("Graphs");
  const result = page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: "Graphs" })
    .first();
  await expect(result).toBeVisible();
  const from = await center(result.locator(".vault-search-row__name"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 60, { steps: 8 });
  await expect(page.locator("body")).not.toHaveClass(/vault-tree-dragging/);
  await expect(ghost(page)).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await pathExists(page, GRAPHS)).toBe(true);
  expect(errors).toEqual([]);
});
