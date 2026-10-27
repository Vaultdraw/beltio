import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  canvasBox,
  exportDialogButton,
  openExportDialogFromMenu,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "./helpers";

const GRAPHS = "DSA/Graphs.excalidraw";
const INTRO = "DSA/Dynamic Programming/01 Introduction.excalidraw";

/** Tree row whose name is exactly `name` (avoids "Graphs" vs "Graphs copy"). */
const treeRow = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${escapeRe(name)}$`),
      }),
    })
    .first();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Row action buttons are display:none until the row is hovered. */
/** Row actions live in the "More actions" menu. */
const rowAction = async (page: Page, name: string, label: string) => {
  const row = treeRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: label, exact: true });
};

/** Expand a folder (by exact name) if it is currently collapsed. */
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
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(500);
};

/** Draw a rectangle on the editor canvas using the toolbar tool. */
const drawRectangle = async (page: Page, dx = 0) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.25 + dx;
  const y0 = box.y + box.height * 0.3;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 60, y0 + 40, { steps: 5 });
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("1"); // back to selection tool
};

const rectanglesOf = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter(
    (el: any) => el.type === "rectangle" && !el.isDeleted,
  );

const liveElementCount = async (page: Page, path: string) =>
  (await readScene(page, path)).elements.filter((el: any) => !el.isDeleted)
    .length;

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
    return (await repo.listDirectory(repo.handle, p)).map((e: any) => ({
      path: e.path,
      kind: e.kind,
    }));
  }, path);

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

test("1. create a folder at root via UI", async ({ page }, info) => {
  const errors = trackErrors(page);
  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Notes");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(treeRow(page, "Notes")).toBeVisible();
  await expect
    .poll(async () => listDir(page, ""), { timeout: 5000 })
    .toContainEqual({ path: "Notes", kind: "folder" });
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-1.png`,
  });
  expect(errors).toEqual([]);
});

test("2. create a drawing inside a folder, draw, and save", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await page.getByRole("button", { name: "New Folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Notes");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create" })
    .click();
  await expect(treeRow(page, "Notes")).toBeVisible();

  await (await rowAction(page, "Notes", "New drawing here")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Sketch");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);

  const path = "Notes/Sketch.excalidraw";
  await expect.poll(() => pathExists(page, path), { timeout: 5000 }).toBe(true);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Sketch" }),
  ).toBeVisible();

  await drawRectangle(page);
  await expect
    .poll(async () => (await rectanglesOf(page, path)).length, {
      timeout: 5000,
    })
    .toBeGreaterThan(0);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-2.png`,
  });
  expect(errors).toEqual([]);
});

test("2b. create a subfolder from a folder's menu", async ({ page }) => {
  const errors = trackErrors(page);
  await (await rowAction(page, "DSA", "New folder here")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("New Folder in /DSA");
  await dialog.getByLabel("Name").fill("Trees");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(treeRow(page, "Trees")).toBeVisible();
  await expect
    .poll(async () => listDir(page, "DSA"), { timeout: 5000 })
    .toContainEqual({ path: "DSA/Trees", kind: "folder" });
  expect(errors).toEqual([]);
});

test("2c. keyboard only: palette command and menu key create inside the focused folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await treeRow(page, "DSA").click();
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("new drawing in selected");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("in /DSA");
  // #19: Escape closes the dialog even though it was opened from the palette.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await treeRow(page, "DSA").focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "New drawing here", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("2d. Escape closes every dialog, however it was opened", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const dialog = page.getByRole("dialog");

  // New folder (toolbar button), focus in the name input.
  await page.getByRole("button", { name: "New Folder" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Same dialog from the palette command, focus anywhere.
  await treeRow(page, "DSA").click();
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("new drawing in selected");
  await page.keyboard.press("Enter");
  await expect(dialog).toContainText("New Drawing in /DSA");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await expandFolder(page, "DSA");
  // Rename, Move and the trash confirmation, from the row menu.
  await (await rowAction(page, "Graphs", "Rename")).click();
  await expect(dialog).toContainText("Rename Drawing");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await (await rowAction(page, "Graphs", "Move to…")).click();
  await expect(dialog).toContainText("Move Drawing");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await (await rowAction(page, "Graphs", "Move to Trash")).click();
  await expect(dialog).toContainText("to the trash");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Nothing happened to the drawing.
  expect(await pathExists(page, GRAPHS)).toBe(true);
  expect(errors).toEqual([]);
});

test("3. rename a drawing", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await openFromTree(page, "Graphs");
  const before = await liveElementCount(page, GRAPHS);

  await (await rowAction(page, "Graphs", "Rename")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("New name").fill("Graphs Renamed");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(treeRow(page, "Graphs Renamed")).toBeVisible();
  await expect(treeRow(page, "Graphs")).toHaveCount(0);
  const newPath = "DSA/Graphs Renamed.excalidraw";
  await expect
    .poll(() => pathExists(page, newPath), { timeout: 5000 })
    .toBe(true);
  await expect.poll(() => pathExists(page, GRAPHS)).toBe(false);

  // Editor still shows the same drawing content under its new name.
  await expect(
    page.locator(".vault-breadcrumbs__item--active", {
      hasText: "Graphs Renamed",
    }),
  ).toBeVisible();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  expect(await liveElementCount(page, newPath)).toBe(before);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-3.png`,
  });
  expect(errors).toEqual([]);
});

test("4. duplicate a drawing keeps element count", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await openFromTree(page, "Graphs");
  const original = await liveElementCount(page, GRAPHS);

  await (await rowAction(page, "Graphs", "Duplicate")).click();

  const copyPath = "DSA/Graphs copy.excalidraw";
  await expect
    .poll(() => pathExists(page, copyPath), { timeout: 5000 })
    .toBe(true);
  await expect(treeRow(page, "Graphs copy")).toBeVisible();
  expect(await liveElementCount(page, copyPath)).toBe(original);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-4.png`,
  });
  expect(errors).toEqual([]);
});

test("5. move a drawing into another folder", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await (await rowAction(page, "Graphs", "Move to…")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Type-ahead filter, then pick with the keyboard.
  await page.keyboard.type("dynamic");
  await expect(dialog.getByRole("treeitem")).toHaveCount(3);
  // The selection lands on the match itself, ancestors stay as context.
  await expect(
    dialog.getByRole("treeitem", {
      name: "Dynamic Programming",
      selected: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  const dest = "DSA/Dynamic Programming/Graphs.excalidraw";
  await expect.poll(() => pathExists(page, dest), { timeout: 5000 }).toBe(true);
  await expect.poll(() => pathExists(page, GRAPHS)).toBe(false);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-5.png`,
  });
  expect(errors).toEqual([]);
});

test("5b. moving an expanded folder keeps it open, with no error", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.getByRole("button", { name: "New Folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Archive");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create" })
    .click();
  await expandFolder(page, "DSA");
  await expandFolder(page, "Dynamic Programming");
  await expect(treeRow(page, "01 Introduction")).toBeVisible();

  await (await rowAction(page, "Dynamic Programming", "Move to…")).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("treeitem", { name: "Archive", exact: true }).click();
  await dialog.getByRole("button", { name: "Move Here" }).click();
  await expect(dialog).toHaveCount(0);
  // The native watcher reports the old and new paths (the fake rescans).
  await page.evaluate(() => {
    const repo = (window as any).__vaultRepo;
    repo.emit({
      handle: repo.handle,
      paths: ["DSA/Dynamic Programming", "Archive/Dynamic Programming"],
      rescan: false,
    });
  });

  await expandFolder(page, "Archive");
  await expect(treeRow(page, "01 Introduction")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("6. delete a drawing after confirmation", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await (await rowAction(page, "Graphs", "Move to Trash")).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Graphs.excalidraw");
  // Modal fades in (opacity 0 -> 1); wait so the screenshot is not mid-animation.
  await expect(dialog.locator(".vault-modal")).toHaveCSS("opacity", "1");
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-6a.png`,
  });
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(treeRow(page, "Graphs")).toHaveCount(0);
  await expect
    .poll(() => pathExists(page, GRAPHS), { timeout: 5000 })
    .toBe(false);
  const dsa = await listDir(page, "DSA");
  expect(dsa.map((e: { path: string }) => e.path)).not.toContain(GRAPHS);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-6.png`,
  });
  expect(errors).toEqual([]);
});

test("7. search finds a drawing and clicking opens it", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  const search = page.getByPlaceholder("Search drawings and text…");
  await search.fill("Graphs");
  const result = page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: "Graphs" })
    .first();
  await expect(result).toBeVisible();
  await expect(page.getByText("1 drawing", { exact: true })).toBeVisible();
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-7a.png`,
  });

  await result.click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Graphs" }),
  ).toBeVisible();
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-7.png`,
  });
  expect(errors).toEqual([]);
});

test("8. edits in each drawing survive switching", async ({ page }, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await expandFolder(page, "Dynamic Programming");

  await openFromTree(page, "Graphs");
  // The fixture already contains one rectangle; count relative to baseline.
  const graphsBaseline = (await rectanglesOf(page, GRAPHS)).length;
  const introBaseline = (await rectanglesOf(page, INTRO)).length;
  await drawRectangle(page);
  await expect
    .poll(async () => (await rectanglesOf(page, GRAPHS)).length, {
      timeout: 5000,
    })
    .toBe(graphsBaseline + 1);

  await openFromTree(page, "01 Introduction");
  await expect(
    page.locator(".vault-breadcrumbs__item--active", {
      hasText: "01 Introduction",
    }),
  ).toBeVisible();
  await drawRectangle(page, 200);
  await expect
    .poll(async () => (await rectanglesOf(page, INTRO)).length, {
      timeout: 5000,
    })
    .toBe(introBaseline + 1);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-8a.png`,
  });

  await openFromTree(page, "Graphs");
  await expect(
    page.locator(".vault-breadcrumbs__item--active", { hasText: "Graphs" }),
  ).toBeVisible();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  // Edits made in Graphs must still be there, and must not leak into INTRO.
  expect((await rectanglesOf(page, GRAPHS)).length).toBe(graphsBaseline + 1);
  expect((await rectanglesOf(page, INTRO)).length).toBe(introBaseline + 1);

  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-8.png`,
  });
  expect(errors).toEqual([]);
});

test("9. PNG and SVG export go through the repository", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await expandFolder(page, "DSA");
  await openFromTree(page, "Graphs");

  await openExportDialogFromMenu(page);
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__vaultRepo.exported.map((e: any) => e.name),
        ),
      { timeout: 10000 },
    )
    .toContainEqual(expect.stringMatching(/\.png$/));

  await exportDialogButton(page, "SVG").click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__vaultRepo.exported.map((e: any) => e.name),
        ),
      { timeout: 10000 },
    )
    .toContainEqual(expect.stringMatching(/\.svg$/));

  const exported = await page.evaluate(() =>
    (window as any).__vaultRepo.exported.map((e: any) => ({
      name: e.name,
      size: e.bytes.length,
    })),
  );
  for (const e of exported) {
    expect(e.size).toBeGreaterThan(0);
  }
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-9.png`,
  });
  expect(errors).toEqual([]);
});

test("10. dark theme via settings applies to app and canvas", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark", exact: true })
    .click();

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expandFolder(page, "DSA");
  await openFromTree(page, "Graphs");
  await expect(page.locator(".excalidraw.theme--dark").first()).toBeVisible();
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-crud-10.png`,
  });
  expect(errors).toEqual([]);
});
