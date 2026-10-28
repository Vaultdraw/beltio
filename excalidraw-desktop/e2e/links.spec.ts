import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import { canvasBox, readScene, trackErrors } from "./helpers";
import {
  breadcrumbs,
  cmdClick,
  drawingPaths,
  expectOpen,
  linksCalls,
  openLinksVault,
  openRenameDialog,
  renameTo,
  scenePoint,
  SEED,
  sceneTexts,
  settled,
  withMeta,
} from "./linksHelpers";

const textarea = "textarea.excalidraw-wysiwyg";
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const modal = (page: Page) => page.locator(".vault-modal");

/** Double-click empty canvas, returns once the text editor has focus. */
const startText = async (page: Page, sx = 600, sy = 400) => {
  const p = await scenePoint(page, sx, sy);
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.locator(textarea)).toBeFocused();
};

const drawRect = async (page: Page, sx = 700, sy = 300) => {
  const p = await scenePoint(page, sx, sy);
  await page.keyboard.press("r");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 120, p.y + 70, { steps: 6 });
  await page.mouse.up();
};

const confirmButton = (page: Page) =>
  modal(page).locator(".vault-btn--primary");
const dialogTitle = (page: Page) => page.locator("#confirm-dialog-title");

test("the dock is closed by default and links cost nothing until used", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page, "Alpha");
  await expect(page.locator(".vault-links")).toHaveCount(0);
  await startText(page, 500, 300);
  await page.keyboard.type("plain text, no brackets", { delay: 10 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect(await linksCalls(page)).toEqual({
    links: 0,
    unlinkedMentions: 0,
    resolve: 0,
  });
  expect(errors).toEqual([]);
});

test("typing [[ suggests drawings; Enter inserts the link", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page);
  await startText(page);
  await page.keyboard.type("[[Alp");
  await expect(page.locator(".vault-suggest")).toBeVisible();
  await expect(page.locator(".vault-suggest__row--active")).toContainText(
    "Alpha",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".vault-suggest")).toHaveCount(0);
  await expect(page.locator(textarea)).toHaveValue("[[Alpha]]");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  const texts = sceneTexts(await readScene(page, "Hub.excalidraw"));
  expect(texts).toContain("[[Alpha]]");
  expect(errors).toEqual([]);
});

test("the autocomplete Create row creates the drawing in the new-drawing folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page, "Hub", { newDrawingFolder: "Folder" });
  await startText(page);
  await page.keyboard.type("[[Brand New");
  const create = page.locator(".vault-suggest__row--create");
  await expect(create).toContainText("Brand New");
  await create.click();
  await expect
    .poll(() => drawingPaths(page))
    .toContain("Folder/Brand New.excalidraw");
  await expectOpen(page, "Brand New");
  // The link text must survive in the source drawing after the switch.
  await expect
    .poll(async () => sceneTexts(await readScene(page, "Hub.excalidraw")))
    .toContain("[[Brand New]]");
  expect(errors).toEqual([]);
});

test("Cmd+hover underlines a link, Cmd+click opens the target", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page);
  const p = await scenePoint(page, SEED.alphaText.x, SEED.alphaText.y);
  await withMeta(page, async () => {
    await page.mouse.move(p.x, p.y);
    await expect(page.locator(".vault-link-underline").first()).toBeVisible();
    await page.mouse.click(p.x, p.y);
  });
  await expectOpen(page, "Alpha");
  await expect(page.locator(".vault-link-underline")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("without the modifier a click on link text only selects", async ({
  page,
}) => {
  await openLinksVault(page);
  const p = await scenePoint(page, SEED.alphaText.x, SEED.alphaText.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(".vault-link-underline")).toHaveCount(0);
  await expectOpen(page, "Hub");
});

test("Mod+Alt+K links a selected shape; its link opens the target in place", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const popups: string[] = [];
  page.on("popup", (pop) => popups.push(pop.url()));
  await openLinksVault(page);
  const startUrl = page.url();
  await drawRect(page);
  await page.waitForTimeout(300);
  await page.keyboard.press("Meta+Alt+k");
  const switcher = page.getByPlaceholder("Link selection to drawing…");
  await expect(switcher).toBeVisible();
  await page.keyboard.type("Inner");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect(switcher).toHaveCount(0);
  await expect
    .poll(async () =>
      (await readScene(page, "Hub.excalidraw")).elements
        .filter((e: any) => e.type === "rectangle")
        .map((e: any) => e.link),
    )
    .toContain("[[Inner]]");

  // The drawn rectangle spans scene (700,300)-(820,370); its link icon sits at
  // the top-right corner.
  await page.keyboard.press("Escape");
  const icon = await scenePoint(page, 827, 292);
  await page.mouse.move(icon.x - 30, icon.y + 30);
  await page.mouse.move(icon.x, icon.y, { steps: 4 });
  await page.mouse.click(icon.x, icon.y);
  await expectOpen(page, "Inner");
  expect(page.url()).toBe(startUrl);
  expect(popups).toEqual([]);
  expect(errors).toEqual([]);
});

test("the seeded shape link opens its target through the link icon", async ({
  page,
}) => {
  const popups: string[] = [];
  page.on("popup", (pop) => popups.push(pop.url()));
  await openLinksVault(page);
  const startUrl = page.url();
  // Rectangle hub-shape: scene (200,420)-(360,500).
  const icon = await scenePoint(page, 367, 412);
  await page.mouse.click(icon.x, icon.y);
  await expectOpen(page, "Alpha");
  expect(page.url()).toBe(startUrl);
  expect(popups).toEqual([]);
});

test("the backlinks dock shows snippets, j/k + Enter opens the source focused", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page, "Alpha");
  await page.keyboard.press("Meta+Alt+b");
  const dock = page.locator(".vault-links");
  await expect(dock).toBeVisible();
  const rows = dock.locator(".vault-links__row--backlink");
  await expect(rows).toHaveCount(3); // Hub text, Hub shape, Folder/Inner
  await expect(dock).toContainText("See [[Alpha]] now");
  await expect(dock).toContainText("Points at [[Alpha]]");
  await expect(dock.locator(".vault-links__badge")).toHaveCount(1);

  // Unlinked mentions are not even queried while collapsed.
  expect((await linksCalls(page)).unlinkedMentions).toBe(0);

  await dock.focus();
  // The cursor starts on the "Backlinks" section header; j walks the rows.
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toHaveClass(/vault-links__row--selected/);
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveClass(/vault-links__row--selected/);
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toHaveClass(/vault-links__row--selected/);
  for (let i = 0; i < 2; i++) {
    if (
      (await dock
        .locator(".vault-links__row--selected")
        .textContent())!.includes("See [[Alpha]] now")
    ) {
      break;
    }
    await page.keyboard.press("j");
  }
  await expect(dock.locator(".vault-links__row--selected")).toContainText(
    "See [[Alpha]] now",
  );
  await page.keyboard.press("Enter");
  await expectOpen(page, "Hub");
  // The linking element is focused (selected): "Open link under selection"
  // follows its link.
  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+Alt+Enter");
  await expectOpen(page, "Alpha");
  expect((await linksCalls(page)).unlinkedMentions).toBe(0);
  expect(errors).toEqual([]);
});

test("Unlinked mentions query only once expanded", async ({ page }) => {
  await openLinksVault(page, "Alpha");
  await page.keyboard.press("Meta+Alt+b");
  const dock = page.locator(".vault-links");
  await expect(dock).toBeVisible();
  await expect(
    dock.locator(".vault-links__row--backlink").first(),
  ).toBeVisible();
  expect((await linksCalls(page)).unlinkedMentions).toBe(0);
  await dock
    .locator(".vault-links__row--header")
    .filter({ hasText: "Unlinked mentions" })
    .click();
  await expect
    .poll(async () => (await linksCalls(page)).unlinkedMentions)
    .toBeGreaterThan(0);
});

test("renaming the target rewrites closed drawings; renaming back undoes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page, "Hub");
  await renameTo(page, "Alpha", "Beta");
  await settled(page);
  await expect
    .poll(async () =>
      sceneTexts(await readScene(page, "Folder/Inner.excalidraw")).join("|"),
    )
    .toContain("[[Beta]]");
  expect(await drawingPaths(page)).toContain("Beta.excalidraw");
  // The open drawing (Hub) is updated through the editor.
  await expect
    .poll(async () => {
      await page.waitForTimeout(AFTER_AUTOSAVE_MS);
      return sceneTexts(await readScene(page, "Hub.excalidraw")).join("|");
    })
    .toContain("[[Beta]]");
  const hub = sceneTexts(await readScene(page, "Hub.excalidraw")).join("|");
  expect(hub).not.toContain("[[Alpha]]");
  expect(hub).toContain("[[Missing Note]]");

  // Undo by renaming back.
  await renameTo(page, "Beta", "Alpha");
  await settled(page);
  await expect
    .poll(async () =>
      sceneTexts(await readScene(page, "Folder/Inner.excalidraw")).join("|"),
    )
    .toContain("[[Alpha]]");
  await expect
    .poll(async () => {
      await page.waitForTimeout(AFTER_AUTOSAVE_MS);
      return sceneTexts(await readScene(page, "Hub.excalidraw")).join("|");
    })
    .not.toContain("[[Beta]]");
  expect(errors).toEqual([]);
});

test("renaming the open target updates its own self-links through the editor", async ({
  page,
}) => {
  await openLinksVault(page, "Alpha");
  await renameTo(page, "Alpha", "Gamma");
  await settled(page);
  await expect
    .poll(async () =>
      sceneTexts(await readScene(page, "Hub.excalidraw")).join("|"),
    )
    .toContain("[[Gamma]]");
  await expectOpen(page, "Gamma");
});

test("update_on_rename false renames without touching links", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", { linkUpdateOnRename: false });
  await renameTo(page, "Alpha", "Beta");
  await settled(page);
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  expect(await drawingPaths(page)).toContain("Beta.excalidraw");
  const inner = sceneTexts(await readScene(page, "Folder/Inner.excalidraw"));
  expect(inner.join("|")).toContain("[[Alpha]]");
  await expect(modal(page)).toHaveCount(0);
});

const askRename = async (page: Page, from: string, to: string) => {
  const dialog = await openRenameDialog(page, from);
  await dialog.getByLabel("New name").fill(to);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialogTitle(page)).toHaveText("Update links?");
};

test("update_on_rename ask: Don't update renames and leaves links", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", { linkUpdateOnRename: "ask" });
  await askRename(page, "Alpha", "Beta");
  await modal(page).getByRole("button", { name: "Don't update" }).click();
  await settled(page);
  expect(await drawingPaths(page)).toContain("Beta.excalidraw");
  expect(
    sceneTexts(await readScene(page, "Folder/Inner.excalidraw")).join("|"),
  ).toContain("[[Alpha]]");
});

test("update_on_rename ask: Update rewrites the links", async ({ page }) => {
  await openLinksVault(page, "Hub", { linkUpdateOnRename: "ask" });
  await askRename(page, "Alpha", "Beta");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await settled(page);
  await expect
    .poll(async () =>
      sceneTexts(await readScene(page, "Folder/Inner.excalidraw")).join("|"),
    )
    .toContain("[[Beta]]");
});

test("moving a folder with unique basenames needs no rewrite", async ({
  page,
}) => {
  await openLinksVault(page, "Hub");
  const before = await readScene(page, "Folder/Inner.excalidraw");
  await page.locator(".vault-tree-item__name", { hasText: /^Folder$/ }).click();
  const row = page.locator(
    '.vault-tree-container .vault-tree-item[data-tree-path="Folder/Inner.excalidraw"]',
  );
  await expect(row).toBeVisible();
  const target = page.locator(
    '.vault-tree-container .vault-tree-item[data-tree-path="Folder B"]',
  );
  const from = (await row.locator(".vault-tree-item__name").boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(from.x + 22, from.y + 11, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => drawingPaths(page))
    .toContain("Folder B/Inner.excalidraw");
  await settled(page);
  await expect(modal(page)).toHaveCount(0);
  const after = await readScene(page, "Folder B/Inner.excalidraw");
  expect(sceneTexts(after)).toEqual(sceneTexts(before));
  // No "Updated N links" toast.
  await expect(page.locator(".vd-toast")).toHaveCount(0);
});

test("Cmd+click on an unresolved link offers Create in the new-drawing folder", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page, "Hub", { newDrawingFolder: "Folder" });
  await cmdClick(page, SEED.missingText.x, SEED.missingText.y);
  await expect(dialogTitle(page)).toHaveText("Create drawing?");
  await confirmButton(page).click();
  await expect
    .poll(() => drawingPaths(page))
    .toContain("Folder/Missing Note.excalidraw");
  await expectOpen(page, "Missing Note");
  expect(errors).toEqual([]);
});

test("Create with an empty new-drawing folder lands next to the open drawing", async ({
  page,
}) => {
  await openLinksVault(page, null, { newDrawingFolder: "" });
  await page.locator(".vault-tree-item__name", { hasText: /^Folder$/ }).click();
  await page.locator(".vault-tree-item__name", { hasText: "Inner" }).click();
  await expectOpen(page, "Inner");
  await page.waitForTimeout(500);
  await startText(page, 600, 400);
  await page.keyboard.type("[[Fresh Idea]]");
  await page.keyboard.press("Escape");
  if (await page.locator(textarea).count()) {
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(textarea)).toHaveCount(0);
  await cmdClick(page, 650, 412);
  await expect(dialogTitle(page)).toHaveText("Create drawing?");
  await confirmButton(page).click();
  await expect
    .poll(() => drawingPaths(page))
    .toContain("Folder/Fresh Idea.excalidraw");
});

test("hint mode: Shift+F shows badges, typing the letters opens the link", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page);
  // Focus the canvas without selecting anything linkable.
  const empty = await scenePoint(page, 700, 500);
  await page.mouse.click(empty.x, empty.y);
  await page.keyboard.press("Shift+F");
  const hints = page.locator(".vault-link-hint");
  await expect(hints.first()).toBeVisible();
  // [[Alpha]], [[Missing Note]], [[Dupe]] and the shape.
  await expect(hints).toHaveCount(4);
  const first = (await hints.first().textContent())!.trim();
  await page.keyboard.type(first);
  await expect(hints).toHaveCount(0);
  await expectOpen(page, "Alpha");
  expect(errors).toEqual([]);
});

test("hint mode is cancelled by Escape", async ({ page }) => {
  await openLinksVault(page);
  const empty = await scenePoint(page, 700, 500);
  await page.mouse.click(empty.x, empty.y);
  await page.keyboard.press("Shift+F");
  await expect(page.locator(".vault-link-hint").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-link-hint")).toHaveCount(0);
  await expectOpen(page, "Hub");
});

test("Back and Forward follow opened links", async ({ page }) => {
  await openLinksVault(page);
  await cmdClick(page, SEED.alphaText.x, SEED.alphaText.y);
  await expectOpen(page, "Alpha");
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expectOpen(page, "Hub");
  await page.keyboard.press("Meta+Alt+ArrowRight");
  await expectOpen(page, "Alpha");
});

test("an ambiguous [[Dupe]] opens a drawing and never errors", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openLinksVault(page);
  await cmdClick(page, SEED.dupeText.x, SEED.dupeText.y);
  await expect(breadcrumbs(page)).toContainText(/Dupe|Hub/);
  expect(errors).toEqual([]);
});

test("every links command is in the palette and on the Hotkeys page", async ({
  page,
}) => {
  await openLinksVault(page);
  await page.keyboard.press("Meta+Shift+p");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("links");
  const titles = [
    "Link selection to drawing…",
    "Insert link…",
    "Open link under selection",
    "Toggle backlinks panel",
    "Go back",
    "Go forward",
    "Copy link to this drawing",
    "Show link hints",
    "Assign hotkey to this drawing",
  ];
  for (const t of titles) {
    // The palette shows the list virtualised? Check text anywhere in it.
    await expect(palette(page)).toContainText(t);
  }
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Hotkeys" }).click();
  const list = page.getByRole("list", { name: "Hotkeys", exact: true });
  for (const id of [
    "links.linkSelection",
    "links.insert",
    "links.openUnderSelection",
    "links.toggleDock",
    "links.back",
    "links.forward",
    "links.copyLinkToDrawing",
    "links.hints",
    "links.bindDrawingHotkey",
  ]) {
    await expect(
      list.locator(`.vault-hotkeys__row[data-command-id="${id}"]`),
    ).toHaveCount(1);
  }
});

test("Settings has a Links page", async ({ page }) => {
  await openLinksVault(page);
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("tab", { name: "Links" }).click();
  await expect(page.locator("#vault-link-update")).toBeVisible();
  await page.locator("#vault-link-update").selectOption("false");
  await page.keyboard.press("Escape");
  const stored = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem("excalidraw-vault-preferences-v1") ?? "{}",
    ),
  );
  expect(stored.linkUpdateOnRename).toBe(false);
});

// Keep canvasBox referenced for specs that need raw geometry.
void canvasBox;
