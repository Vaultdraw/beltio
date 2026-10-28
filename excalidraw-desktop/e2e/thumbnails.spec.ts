import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import { canvasBox, openDrawing, openVault, trackErrors } from "./helpers";

// Drawing thumbnails (F2) over the in-memory fake store (?thumbs=1): real
// scene rendering, blob urls instead of the native vdthumb: scheme.
const PREFS_KEY = "excalidraw-vault-preferences-v1";
const thumbs = (page: Page) => page.locator("img.vault-thumb");
const putCount = (page: Page) =>
  page.evaluate(() => (window as any).__thumbStore.calls.put as number);

const searchBox = (page: Page) =>
  page.getByPlaceholder("Search drawings and text…");
const switcher = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

test.describe("home recent tiles", () => {
  test("show thumbnails for the recent drawings", async ({ page }) => {
    const errors = trackErrors(page);
    await openVault(page, "?seed=search&thumbs=1");
    const recent = page.getByLabel("Recent drawings");
    await expect(recent).toBeVisible();
    await expect(
      recent.locator("button.vault-recent__item").first(),
    ).toBeVisible();
    await expect(recent.locator("img.vault-thumb").first()).toBeVisible({
      timeout: 15_000,
    });
    // Same open behaviour as the text rows.
    const first = recent.locator("button.vault-recent__item").first();
    await first.click();
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("without the store the text rows stay (no thumbnails)", async ({
    page,
  }) => {
    await openVault(page, "?seed=search");
    await expect(page.getByLabel("Recent drawings")).toBeVisible();
    await expect(thumbs(page)).toHaveCount(0);
    await expect(page.locator(".vault-thumb")).toHaveCount(0);
  });
});

test.describe("search results", () => {
  test("a drawing row shows its thumbnail", async ({ page }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await searchBox(page).fill("shortest");
    const row = page
      .locator('.vault-search-row[data-kind="drawing"]')
      .filter({ hasText: "Shortest Paths" });
    await expect(row).toBeVisible();
    await expect(row.locator("img.vault-thumb--sm")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("palette preview", () => {
  test("shows the highlighted drawing beside the palette", async ({ page }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await page.keyboard.press("Meta+KeyP");
    await expect(switcher(page)).toBeVisible();
    await page.keyboard.type("shortest");
    await expect(
      switcher(page).locator('[role="option"][aria-selected="true"]'),
    ).toContainText("Shortest");
    const preview = page.getByTestId("palette-preview");
    await expect(preview.locator("img.vault-thumb--lg")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("setting and commands", () => {
  test("thumbnails off: no thumbnail anywhere, text UI", async ({ page }) => {
    await page.addInitScript(
      ([key]) => {
        if (!window.sessionStorage.getItem("thumbs-seeded")) {
          window.localStorage.setItem(
            key as string,
            JSON.stringify({ thumbnails: false }),
          );
          window.sessionStorage.setItem("thumbs-seeded", "1");
        }
      },
      [PREFS_KEY] as const,
    );
    await openVault(page, "?seed=search&thumbs=1");
    await expect(page.getByLabel("Recent drawings")).toBeVisible();
    await searchBox(page).fill("shortest");
    await expect(
      page.locator('.vault-search-row[data-kind="drawing"]').first(),
    ).toBeVisible();
    await expect(page.locator(".vault-thumb")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).__thumbStore.calls.lookup),
    ).toBe(0);
  });

  test("the commands are in the palette; Show/hide turns thumbnails off", async ({
    page,
  }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await expect(thumbs(page).first()).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(switcher(page)).toBeVisible();
    await page.keyboard.type("Thumbnails:");
    const options = switcher(page).getByRole("option");
    await expect(
      options.filter({ hasText: "Thumbnails: Show/hide thumbnails" }),
    ).toBeVisible();
    await expect(
      options.filter({ hasText: "Thumbnails: Clear cache for this vault" }),
    ).toBeVisible();
    await options.filter({ hasText: "Show/hide thumbnails" }).click();
    await expect(switcher(page)).toHaveCount(0);
    await expect(page.locator(".vault-thumb")).toHaveCount(0);
    await expect(
      page.locator("button.vault-recent__item").first(),
    ).toBeVisible();
  });

  test("Clear cache empties the store and thumbnails render again", async ({
    page,
  }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await expect(thumbs(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await putCount(page);
    await page.keyboard.press("Meta+Shift+KeyP");
    await page.keyboard.type("Clear cache for this vault");
    await switcher(page)
      .getByRole("option")
      .filter({ hasText: "Clear cache" })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__thumbStore.calls.clear))
      .toBe(1);
    await expect
      .poll(() => putCount(page), { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect(thumbs(page).first()).toBeVisible();
  });
});

test("saving a drawing refreshes the thumbnail a surface is showing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=search&thumbs=1");
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Shortest Paths");

  await searchBox(page).fill("shortest");
  const row = page
    .locator('.vault-search-row[data-kind="drawing"]')
    .filter({ hasText: "Shortest Paths" });
  const img = row.locator("img.vault-thumb--sm");
  await expect(img).toBeVisible({ timeout: 15_000 });
  const srcBefore = await img.getAttribute("src");
  const putsBefore = await putCount(page);

  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.6;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 80, y0 + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);

  await expect
    .poll(() => putCount(page), { timeout: 15_000 })
    .toBeGreaterThan(putsBefore);
  await expect
    .poll(() => row.locator("img.vault-thumb--sm").getAttribute("src"), {
      timeout: 15_000,
    })
    .not.toBe(srcBefore);
  expect(errors).toEqual([]);
});
