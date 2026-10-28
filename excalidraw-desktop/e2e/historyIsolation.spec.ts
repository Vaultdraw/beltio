import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, trackErrors } from "./helpers";
import {
  BLUE,
  diag,
  colorOn,
  expectColor,
  GREEN,
  MAIN,
  ORANGE,
  openPanelByShortcut,
  panel,
  PREVIEW,
  preview,
  RED,
  rectEl,
  rows,
  savedRaw,
  sceneJson,
  setup,
  writeCount,
  type Rgb,
} from "./historyHelpers";

// PLAN M5: the preview is a read-only window. Whatever is typed or dragged in
// it must not touch the preview's own scene, the main scene, the drawing file
// or the library, and must not reach the main editor's shortcuts.
const anchor = rectEl("anc", 0, 0, null, 620, 420, 9);
const a = rectEl("a", 40, 40, RED, 140, 100, 1);
const b = rectEl("b", 220, 40, BLUE, 140, 100, 2);
const c = rectEl("c", 400, 40, ORANGE, 140, 100, 3);
const g = rectEl("g", 40, 260, GREEN, 140, 100, 4);

const LIBRARY_ITEM = JSON.stringify({
  type: "excalidrawlib",
  version: 2,
  source: "e2e",
  libraryItems: [
    {
      id: "lib-1",
      status: "published",
      created: 1,
      name: "box",
      elements: [rectEl("lib-box", 0, 0, null, 40, 40, 77)],
    },
  ],
});

test.beforeEach(async ({ page }) => {
  await setup(
    page,
    [anchor, g],
    [
      { json: sceneJson([anchor, a, b]) },
      { json: sceneJson([anchor, a, b, c]) },
    ],
  );
  await page.evaluate((json) => {
    (window as any).__libraryRepo.setFile("personal", json);
  }, LIBRARY_ITEM);
});

const COLORS: Rgb[] = [RED, BLUE, ORANGE, GREEN];

const pixels = async (page: Page, scope: string) =>
  Promise.all(COLORS.map((rgb) => colorOn(page, scope, rgb)));

const libraryState = (page: Page) =>
  page.evaluate(() => {
    const lib = (window as any).__libraryRepo;
    return {
      writes: lib.writes.length as number,
      personal: lib.getJson("personal") as string | null,
      vault: lib.getJson("vault", (window as any).__vaultRepo.handle) as
        | string
        | null,
    };
  });

/** Is the main toolbar's `testid` tool the active one (input, class or aria). */
const toolActive = (page: Page, testid: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(
      `.vault-editor [data-testid='${id}']`,
    );
    if (!el) {
      return null;
    }
    const input =
      el instanceof HTMLInputElement ? el : el.querySelector("input");
    if (input) {
      return input.checked;
    }
    return (
      el.classList.contains("selected") ||
      el.classList.contains("is-selected") ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("data-state") === "on" ||
      el.getAttribute("aria-pressed") === "true"
    );
  }, testid);

const selectionToolChecked = (page: Page) =>
  toolActive(page, "toolbar-selection");

/** Where the clear-canvas style confirm buttons live, for diagnostics. */
const confirmWhere = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .filter((b) => /confirm/i.test(b.textContent ?? ""))
      .map((b) => ({
        inPreview: !!b.closest("[data-testid='history-preview']"),
        inMain: !!b.closest(".vault-editor"),
        cls: b.closest("[class*='dialog'], [class*='Dialog'], [role='dialog']")
          ?.className,
      })),
  );

test("keys, clipboard, drag and double-click in the preview change nothing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openPanelByShortcut(page);
  await rows(page).nth(0).click();
  await expect(preview(page)).toBeVisible();
  await expectColor(page, PREVIEW, ORANGE, true);
  await expectColor(page, MAIN, GREEN, true);

  const fileBefore = await savedRaw(page);
  const writesBefore = await writeCount(page);
  const mainBefore = await pixels(page, MAIN);
  const previewBefore = await pixels(page, PREVIEW);
  const libBefore = await libraryState(page);
  const toolBefore = await selectionToolChecked(page);

  const orange = await colorOn(page, PREVIEW, ORANGE);
  const blue = await colorOn(page, PREVIEW, BLUE);
  const box = await preview(page).locator("canvas.interactive").boundingBox();
  const empty = { x: box!.x + box!.width - 60, y: box!.y + box!.height - 60 };

  // Select, select all, then every destructive key.
  await page.mouse.click(orange.x, orange.y);
  diag(`after click panel=${await panel(page).count()}`);
  await page.keyboard.press("Meta+KeyA");
  diag(`after Mod+A panel=${await panel(page).count()}`);
  for (const key of [
    "Delete",
    "Backspace",
    "Meta+KeyX",
    "Meta+KeyV",
    "Meta+KeyD",
    "Meta+KeyZ",
    "Meta+Shift+KeyZ",
    "Meta+KeyG",
    "Meta+Alt+KeyC",
    "ArrowRight",
    "Shift+ArrowDown",
  ]) {
    await page.keyboard.press(key);
    diag(
      `key ${key} panel=${await panel(page).count()} preview=${await preview(
        page,
      ).count()} url=${page.url()}`,
    );
  }
  // Clear canvas shortcut must not reach any confirm dialog.
  await page.keyboard.press("Meta+Delete");
  await page.waitForTimeout(400);
  diag(`confirm ${JSON.stringify(await confirmWhere(page))}`);
  // BUG-I1: Mod+Delete in the preview opens the clear-canvas confirm.
  await expect
    .soft(page.getByRole("button", { name: "Confirm" }))
    .toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    if (await page.getByRole("button", { name: "Confirm" }).count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  }

  // Typing letters: tool shortcuts and text entry.
  await page.mouse.click(orange.x, orange.y);
  diag(
    `before-typing panel=${await panel(page).count()} preview=${await preview(
      page,
    ).count()}`,
  );
  for (const ch of "rtdoelpxw1234567890") {
    await page.keyboard.press(ch);
    diag(
      `after ${ch} panel=${await panel(page).count()} preview=${await preview(
        page,
      ).count()}`,
    );
  }
  await page.keyboard.press("Enter");
  diag(
    `after Enter panel=${await panel(page).count()} preview=${await preview(
      page,
    ).count()}`,
  );
  await page.keyboard.type("hello");
  diag(
    `after hello panel=${await panel(page).count()} preview=${await preview(
      page,
    ).count()}`,
  );
  await page.keyboard.press("Escape");
  diag(
    `after Escape panel=${await panel(page).count()} preview=${await preview(
      page,
    ).count()}`,
  );
  // Escape inside the preview may leave it; get back in if so.
  if (!(await preview(page).isVisible())) {
    await rows(page).nth(0).click();
    await expect(preview(page)).toBeVisible();
    await expectColor(page, PREVIEW, ORANGE, true);
  }

  // Drag a shape and double-click shape and empty canvas.
  await page.mouse.move(orange.x, orange.y);
  await page.mouse.down();
  await page.mouse.move(orange.x - 90, orange.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.mouse.dblclick(blue.x, blue.y);
  await page.keyboard.type("text");
  await page.mouse.dblclick(empty.x, empty.y);
  await page.keyboard.type("text");
  await page.keyboard.press("Escape");
  if (!(await preview(page).isVisible())) {
    await rows(page).nth(0).click();
    await expect(preview(page)).toBeVisible();
  }
  await page.waitForTimeout(600); // longer than the autosave delay

  // Preview scene unchanged (pixel counts and positions of every shape).
  const previewAfter = await pixels(page, PREVIEW);
  previewAfter.forEach((p, i) => {
    expect(p.count, `preview colour ${i} count`).toBe(previewBefore[i].count);
    expect(Math.round(p.x), `preview colour ${i} x`).toBe(
      Math.round(previewBefore[i].x),
    );
    expect(Math.round(p.y), `preview colour ${i} y`).toBe(
      Math.round(previewBefore[i].y),
    );
  });
  // Main scene, file bytes, library untouched.
  expect(await pixels(page, MAIN)).toEqual(mainBefore);
  expect(await writeCount(page)).toBe(writesBefore);
  expect(await savedRaw(page)).toBe(fileBefore);
  expect(await libraryState(page)).toEqual(libBefore);
  expect(await selectionToolChecked(page)).toBe(toolBefore);
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(page.locator(".excalidraw-wysiwyg")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keys in the preview do not reach the main editor's shortcuts", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await rows(page).nth(0).click();
  await expectColor(page, PREVIEW, ORANGE, true);
  const orange = await colorOn(page, PREVIEW, ORANGE);
  await page.mouse.click(orange.x, orange.y);

  // Main tool shortcuts (r = rectangle, 2 = ... ) and Mod+A would show in the
  // main toolbar if they leaked.
  diag(
    `tool sel=${await selectionToolChecked(page)} rect=${await toolActive(
      page,
      "toolbar-rectangle",
    )}`,
  );
  for (const key of ["KeyR", "KeyO", "KeyT", "Meta+KeyA"]) {
    await page.keyboard.press(key);
    const sel = await selectionToolChecked(page);
    diag(`after ${key} main selection tool active=${sel}`);
    // BUG-I2: a tool key typed in the preview changes the main editor's tool.
    expect.soft(sel, `main tool after ${key}`).toBe(true);
    if (!sel) {
      await page
        .locator(".vault-editor [data-testid='toolbar-selection']")
        .click();
    }
  }

  // Palette and panel shortcuts still work from the preview (app level).
  await page.keyboard.press("Meta+Shift+KeyH");
  await expect(
    page.getByRole("complementary", { name: "History" }),
  ).toHaveCount(0);
});

test("the main editor keeps working after the preview closes", async ({
  page,
}) => {
  await openPanelByShortcut(page);
  await rows(page).nth(0).click();
  await expectColor(page, PREVIEW, ORANGE, true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(preview(page)).toHaveCount(0);

  const box = await canvasBox(page);
  const before = await writeCount(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * 0.6 + 80,
    box.y + box.height * 0.7 + 50,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  await expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);
});
