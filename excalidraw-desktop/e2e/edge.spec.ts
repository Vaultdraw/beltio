import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "./helpers";
import { AFTER_AUTOSAVE_MS } from "./constants";

const GRAPHS = "DSA/Graphs.excalidraw";
const INTRO = "DSA/Dynamic Programming/01 Introduction.excalidraw";
const toolRect = ".vault-editor [data-testid='toolbar-rectangle']";
const toolSelection = ".vault-editor [data-testid='toolbar-selection']";
const canvas = ".vault-editor canvas.interactive";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tree row whose name is exactly `name`. */
const treeRow = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${escapeRe(name)}$`),
      }),
    })
    .first();

/** Row action buttons are display:none until the row is hovered. */
/** Row actions live in the "More actions" menu. */
const rowAction = async (page: Page, name: string, label: string) => {
  const row = treeRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: label, exact: true });
};

const expandFolder = async (page: Page, name: string) => {
  const row = treeRow(page, name);
  await expect(row).toBeVisible();
  const toggle = row.locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

const openFromTree = async (page: Page, name: string) => {
  await treeRow(page, name).locator(".vault-tree-item__name").click();
  await expect(page.locator(canvas)).toBeVisible();
  await page.waitForTimeout(500);
};

/** Draw a rectangle with the toolbar tool, then return to selection. */
const drawRectangle = async (page: Page, dx = 0) => {
  const box = await canvasBox(page);
  await page.locator(toolRect).click();
  const x0 = box.x + box.width * 0.25 + dx;
  const y0 = box.y + box.height * 0.3;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

const liveRectangles = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter(
    (el: any) => el.type === "rectangle" && !el.isDeleted,
  );

const liveElements = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter((el: any) => !el.isDeleted);

const waitForSaved = (page: Page) =>
  expect(page.locator(".vault-status--saved")).toBeVisible({ timeout: 5000 });

const listDir = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    return (await repo.listDirectory(repo.handle, p)).map((e: any) => ({
      path: e.path,
      kind: e.kind,
    }));
  }, path);

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await expandFolder(page, "DSA");
  await expandFolder(page, "Dynamic Programming");
});

test("1. undo survives autosave", async ({ page }, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const baseline = (await liveRectangles(page, GRAPHS)).length;

  await drawRectangle(page);
  await expect
    .poll(async () => (await liveRectangles(page, GRAPHS)).length, {
      timeout: 5000,
    })
    .toBe(baseline + 1);
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await waitForSaved(page);

  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await waitForSaved(page);
  await expect
    .poll(async () => (await liveRectangles(page, GRAPHS)).length, {
      timeout: 5000,
    })
    .toBe(baseline);
  await screenshot(page, { path: `${SHOTS}/edge-1-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("2. external edit with no local changes reloads the editor", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const current = await readScene(page, GRAPHS);
  const external = {
    ...current,
    elements: [
      ...current.elements,
      {
        ...current.elements.find((el: any) => el.id === "rect-1"),
        id: "rect-external",
        x: 500,
        y: 320,
      },
    ],
  };
  await page.evaluate(
    async ([p, json]) => {
      (window as any).__vaultRepo.externalWrite(p, json);
    },
    [GRAPHS, JSON.stringify(external)],
  );

  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect(page.locator(".vault-badge--conflict")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".vault-status--saved")).toBeVisible();
  // The editor must show the disk version, and no stale autosave may clobber it.
  const ids = (await liveElements(page, GRAPHS)).map((el: any) => el.id);
  expect(ids).toContain("rect-external");
  await screenshot(page, { path: `${SHOTS}/edge-2-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("3. external edit while local edits are pending is a conflict, not silent loss", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const baseline = (await liveRectangles(page, GRAPHS)).length;

  // Draw, then immediately write externally before the 600ms serialize window.
  await drawRectangle(page);
  await page.evaluate(
    async ([p]) => {
      const repo = (window as any).__vaultRepo;
      const disk = await repo.readDrawing(repo.handle, p);
      const scene = JSON.parse(disk.json);
      scene.elements.push({
        ...scene.elements[0],
        id: "rect-external",
        x: 900,
        y: 500,
      });
      repo.externalWrite(p, JSON.stringify(scene));
    },
    [GRAPHS],
  );

  const badge = page.locator(".vault-badge--conflict");
  await expect(badge).toBeVisible({ timeout: 5000 });
  await screenshot(page, { path: `${SHOTS}/edge-3-${info.project.name}.png` });

  // The disk file keeps the external version; the local rectangle is not written over it.
  const disk = await liveRectangles(page, GRAPHS);
  expect(disk.map((el: any) => el.id)).toContain("rect-external");
  expect(disk.length).toBe(baseline + 1);

  // Local work must still be recoverable: "Save as copy" must include the local rectangle.
  await badge.click();
  const dialog = page.getByRole("dialog", { name: /Conflict/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save as copy" }).click();
  const copyPath = await dialog.locator("#copy-path-input").inputValue();
  await dialog
    .getByRole("button", { name: "Save a copy and continue" })
    .click();
  await expect
    .poll(async () => (await liveRectangles(page, copyPath)).length, {
      timeout: 5000,
    })
    .toBe(baseline + 1);
  const copyIds = (await liveRectangles(page, copyPath)).map(
    (el: any) => el.id,
  );
  expect(copyIds).not.toContain("rect-external");
  expect(errors).toEqual([]);
});

test("4. external delete of the open drawing shows a clear message", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  await page.evaluate(
    (p) => (window as any).__vaultRepo.externalDelete(p),
    GRAPHS,
  );

  const badge = page.locator(".vault-badge--conflict");
  await expect(badge).toBeVisible({ timeout: 5000 });
  await badge.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/deleted|changed/i);
  await screenshot(page, { path: `${SHOTS}/edge-4-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("5. rapid switching keeps edits in both drawings", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const graphsBaseline = (await liveRectangles(page, GRAPHS)).length;
  const introBaseline = (await liveElements(page, INTRO)).length;

  await drawRectangle(page);
  await page.waitForTimeout(200);
  await treeRow(page, "01 Introduction")
    .locator(".vault-tree-item__name")
    .click();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", {
      hasText: "01 Introduction",
    }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  await treeRow(page, "Graphs").locator(".vault-tree-item__name").click();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Graphs" }),
  ).toBeVisible();

  await expect
    .poll(async () => (await liveRectangles(page, GRAPHS)).length, {
      timeout: 5000,
    })
    .toBe(graphsBaseline + 1);
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect((await liveElements(page, INTRO)).length).toBe(introBaseline);
  await screenshot(page, { path: `${SHOTS}/edge-5-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("6. renaming the open drawing with unsaved edits keeps the edits", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const baseline = (await liveRectangles(page, GRAPHS)).length;

  await drawRectangle(page);
  await (await rowAction(page, "Graphs", "Rename…")).click();
  const dialog = page.getByRole("dialog", { name: "Rename Drawing" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("New name").fill("Graphs Edited");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toHaveCount(0);

  const newPath = "DSA/Graphs Edited.excalidraw";
  await expect
    .poll(async () => (await listDir(page, "DSA")).map((e: any) => e.path), {
      timeout: 5000,
    })
    .toContain(newPath);
  await expect
    .poll(async () => (await liveRectangles(page, newPath)).length, {
      timeout: 5000,
    })
    .toBe(baseline + 1);
  await screenshot(page, { path: `${SHOTS}/edge-6-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("7. typing in rename and new-folder inputs never triggers canvas tools", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  await expect(page.locator(toolSelection)).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await (await rowAction(page, "Graphs", "Rename…")).click();
  const rename = page.getByRole("dialog", { name: "Rename Drawing" });
  await expect(rename).toBeVisible();
  await rename.getByLabel("New name").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("rectangle", { delay: 30 });
  await expect(rename.getByLabel("New name")).toHaveValue("rectangle");
  await expect(page.locator(toolRect)).toHaveAttribute("aria-pressed", "false");
  await rename.getByRole("button", { name: "Close" }).click();
  await expect(rename).toHaveCount(0);

  await page.getByRole("button", { name: "New folder" }).click();
  const folder = page.getByRole("dialog");
  await expect(folder).toBeVisible();
  await folder.getByLabel("Name").click();
  await page.keyboard.type("rectangle", { delay: 30 });
  await expect(folder.getByLabel("Name")).toHaveValue("rectangle");
  await folder
    .getByRole("button", { name: /Cancel|Close/ })
    .first()
    .click();
  await expect(folder).toHaveCount(0);

  await expect(page.locator(toolRect)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(toolSelection)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await screenshot(page, { path: `${SHOTS}/edge-7-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("8. keyboard shortcuts work immediately on a new drawing", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  // The header button is gone; the command (Mod+N) creates in the current folder.
  await page.keyboard.press("Meta+KeyN");
  await expect(page.locator(canvas)).toBeVisible();
  await page.waitForTimeout(500);

  const created = await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    const entries = await repo.listDirectory(repo.handle, "");
    return entries
      .filter((e: any) => e.kind === "drawing" || /\.excalidraw$/.test(e.path))
      .map((e: any) => e.path);
  });
  expect(created.length).toBeGreaterThan(0);
  const path = created[created.length - 1];

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.keyboard.press("r");
  await expect(page.locator(toolRect)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.3 + 80,
    box.y + box.height * 0.4 + 50,
    {
      steps: 5,
    },
  );
  await page.mouse.move(
    box.x + box.width * 0.3 + 160,
    box.y + box.height * 0.4 + 100,
    {
      steps: 5,
    },
  );
  await page.mouse.up();

  await expect
    .poll(async () => (await liveRectangles(page, path)).length, {
      timeout: 5000,
    })
    .toBe(1);
  await screenshot(page, { path: `${SHOTS}/edge-8-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("9. library sidebar button opens the library", async ({ page }, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const trigger = page.locator(
    ".vault-editor button[title*='Library'], .vault-editor [title*='Library'].default-sidebar-trigger",
  );
  await expect(trigger.first()).toBeVisible();
  await trigger.first().click();
  await expect(page.locator(".vault-editor .default-sidebar")).toBeVisible();
  await expect(
    page
      .locator(
        ".vault-editor .default-sidebar .library-menu, .vault-editor .default-sidebar",
      )
      .first(),
  ).toContainText(/Library|Add to library|Publish/i);
  await screenshot(page, { path: `${SHOTS}/edge-9-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test("10. zoom shortcut changes the zoom label and drawing still works", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await openFromTree(page, "Graphs");
  const label = page.locator(".vault-editor .reset-zoom-button");
  await expect(label).toContainText("100%");

  await page.keyboard.press("Meta+=");
  await expect(label).not.toContainText("100%", { timeout: 3000 });
  await expect(label).toContainText(/110%/);

  const baseline = (await liveRectangles(page, GRAPHS)).length;
  await drawRectangle(page);
  await expect
    .poll(async () => (await liveRectangles(page, GRAPHS)).length, {
      timeout: 5000,
    })
    .toBe(baseline + 1);
  await screenshot(page, { path: `${SHOTS}/edge-10-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
