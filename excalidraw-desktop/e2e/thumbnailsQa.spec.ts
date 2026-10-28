import { expect, test, type Locator, type Page } from "@playwright/test";

import { thumbDensity } from "../src/thumbnails/fit";
import { failMarkerVersion, pngRenderVersion } from "../src/thumbnails/render";

import { openDrawing, openVault, trackErrors } from "./helpers";

// F2 thumbnails QA (functional, fake store ?thumbs=1): the editor is not
// repainted per thumbnail render, rename keeps the thumbnail, delete drops the
// tile, scenes over the element cap show the placeholder with one fail marker,
// dark mode puts the invert class once on the container.
const calls = (page: Page) =>
  page.evaluate(() => ({ ...(window as any).__thumbStore.calls }));
const putCount = async (page: Page) => (await calls(page)).put as number;
const storeSize = (page: Page) =>
  page.evaluate(() => (window as any).__thumbStore.size() as number);

const treeRow = (page: Page, name: string): Locator =>
  page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
const rowAction = async (page: Page, name: string, label: string) => {
  const row = treeRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menuitem", { name: label, exact: true });
};
const expandFolder = async (page: Page, name: string) => {
  const toggle = treeRow(page, name).locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

const gallery = (page: Page) => page.getByTestId("gallery-view");
const cells = (page: Page) => page.getByRole("gridcell");
const openGallery = async (page: Page) => {
  await page.keyboard.press("Meta+Alt+KeyE");
  await expect(gallery(page)).toBeVisible();
  await expect(page.getByRole("grid", { name: /Gallery/ })).toBeFocused();
};

test.describe("render bursts and the live editor", () => {
  test("a burst of thumbnail renders repaints the synced editor at most once", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?seed=bigfolder&n=12&el=3&thumbs=1");
    // Sync canvas with theme on (Dracula): the case where each render used to
    // flash the editor through standard colours and back.
    await page
      .getByLabel("Vault File Navigator")
      .getByRole("button", { name: "Settings" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Dracula" }).click();
    await dialog
      .getByRole("switch", { name: /Sync canvas with theme/ })
      .click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await expandFolder(page, "DSA");
    await openDrawing(page, "Graphs");
    await page.waitForTimeout(500);

    // Observable: full-width background paints of the editor's static canvas
    // (one per repaint of the scene). Sanity-checked with a zoom below.
    await page.evaluate(() => {
      const w = window as any;
      w.__paints = 0;
      const count = function (this: CanvasRenderingContext2D, ...a: number[]) {
        const c = this.canvas as HTMLCanvasElement;
        if (
          c.classList.contains("static") &&
          a[2] >= c.clientWidth - 1 &&
          a[3] >= c.clientHeight - 1
        ) {
          w.__paints++;
        }
      };
      for (const fn of ["fillRect", "clearRect"] as const) {
        const orig = CanvasRenderingContext2D.prototype[fn];
        CanvasRenderingContext2D.prototype[fn] = function (...a: any[]) {
          count.apply(this, a);
          return (orig as any).apply(this, a);
        };
      }
    });
    const paints = () =>
      page.evaluate(() => (window as any).__paints as number);
    const p0 = await paints();
    await page.keyboard.press("Meta+Equal"); // zoom in: one real repaint
    await expect.poll(paints).toBeGreaterThan(p0);

    // Burst: 12 uncached drawings appear in the search results at once.
    await page.waitForTimeout(300);
    const puts0 = await putCount(page);
    const p1 = await paints();
    await page.getByPlaceholder("Search drawings and text…").fill("note");
    await expect
      .poll(() => putCount(page), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(puts0 + 6);
    // Wait until the queue has drained (no new put for 1 s).
    for (let last = -1, n = await putCount(page); n !== last; ) {
      last = n;
      await page.waitForTimeout(1000);
      n = await putCount(page);
    }
    const renders = (await putCount(page)) - puts0;
    const repaints = (await paints()) - p1;
    expect(renders).toBeGreaterThanOrEqual(6);
    expect(
      repaints,
      `static canvas repaints during a ${renders}-render burst: ${repaints}`,
    ).toBeLessThanOrEqual(1);

    // And the editor is still themed after the burst (Dracula surface, not white).
    const px = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      )!;
      const d = c
        .getContext("2d")!
        .getImageData(c.width - 6, c.height - 6, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    expect(px).not.toEqual([255, 255, 255]);
    expect(errors).toEqual([]);
  });
});

test.describe("tree changes", () => {
  test("a renamed drawing keeps its thumbnail (no new render)", async ({
    page,
  }) => {
    await openVault(page, "?seed=search&thumbs=1");
    const recent = page.getByLabel("Recent drawings");
    // The file list arrives after idle: re-read both counts until every item has its image.
    await expect
      .poll(
        async () => {
          const items = await recent
            .locator("button.vault-recent__item")
            .count();
          const thumbs = await recent.locator("img.vault-thumb").count();
          return items > 0 && items === thumbs;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.waitForTimeout(500);
    const imgs = await recent.locator("img.vault-thumb").count();
    const before = await calls(page);
    await expandFolder(page, "DSA");
    await (await rowAction(page, "Graphs", "Rename")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New name").fill("Graphs Renamed");
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(treeRow(page, "Graphs Renamed")).toBeVisible();
    await expect(
      recent.locator("button.vault-recent__item", {
        hasText: "Graphs Renamed",
      }),
    ).toBeVisible();
    await expect(recent.locator("img.vault-thumb")).toHaveCount(imgs, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
    expect((await calls(page)).put).toBe(before.put);
  });

  const openGalleryInDsa = async (page: Page) => {
    await openVault(page, "?seed=search&thumbs=1");
    await expandFolder(page, "DSA");
    await openGallery(page);
    await page.keyboard.press("Enter"); // into DSA
    await expect(cells(page)).toHaveCount(3);
    await expect(
      cells(page).filter({ hasText: "Graphs" }).locator("img.vault-thumb"),
    ).toBeVisible({ timeout: 15_000 });
  };

  test("a deleted drawing's tile disappears from the gallery", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openGalleryInDsa(page);
    await (await rowAction(page, "Graphs", "Move to Trash")).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Move to Trash" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cells(page).filter({ hasText: "Graphs" })).toHaveCount(0);
    await expect(cells(page)).toHaveCount(2);
    await expect(page.getByTestId("gallery-count")).toHaveText("2 items");
    expect(errors).toEqual([]);
  });

  // Regression (QA E): the gallery pane (z 5) once painted over the navigator's
  // (z 4) confirm dialog. The graph view had the same layering.
  test("the delete confirmation is clickable while the gallery is open", async ({
    page,
  }) => {
    await openGalleryInDsa(page);
    await (await rowAction(page, "Graphs", "Move to Trash")).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash" })
      .click({ timeout: 3000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the delete confirmation is clickable while the graph view is open", async ({
    page,
  }) => {
    await openVault(page, "?seed=links&plugins=graph");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.keyboard.press("Meta+Alt+g");
    await expect(page.getByTestId("graph-view")).toBeVisible();
    await (await rowAction(page, "Hub", "Move to Trash")).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash" })
      .click({ timeout: 3000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("render cap", () => {
  test("a drawing over the element cap shows the placeholder and writes one fail marker, then renders when the cap is raised", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?seed=search&scene=huge&thumbs=1");
    await openGallery(page);
    await page.keyboard.press("End"); // Huge (after DSA)
    await page.keyboard.press("Enter");
    const tile = cells(page).filter({ hasText: "Huge" });
    await expect(tile).toBeVisible();
    await expect(tile.locator(".vault-thumb--placeholder")).toHaveAttribute(
      "data-state",
      "none",
      { timeout: 15_000 },
    );
    await expect(tile.locator("img.vault-thumb")).toHaveCount(0);
    // The store answers "failed" for it: one fail marker, no image.
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const density = thumbDensity(dpr);
    const versions = {
      png: pngRenderVersion(density),
      fail: failMarkerVersion(density),
    };
    const state = () =>
      page.evaluate(async (v) => {
        const w = window as any;
        const r = await w.__thumbStore.lookup(
          w.__vaultRepo.handle,
          ["Huge/Huge.excalidraw"],
          v.png,
          v.fail,
        );
        return r.items[0].state as string;
      }, versions);
    await expect.poll(state).toBe("failed");
    // Re-open the gallery: the marker is honoured, nothing is rendered again.
    const settled = await calls(page);
    const size = await storeSize(page);
    await page.keyboard.press("Escape");
    await expect(gallery(page)).toHaveCount(0);
    await openGallery(page);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(
      cells(page)
        .filter({ hasText: "Huge" })
        .locator(".vault-thumb--placeholder"),
    ).toHaveAttribute("data-state", "none");
    await page.waitForTimeout(500);
    expect((await calls(page)).put).toBe(settled.put);
    expect(await storeSize(page)).toBe(size);
    // Raising `interface.thumbnail_max_elements` (live) retries it: the
    // marker was written under the old cap, so the drawing now renders.
    await page.evaluate(() =>
      (window as any).__updatePreferences({ thumbnailMaxElements: 20000 }),
    );
    await expect(
      cells(page).filter({ hasText: "Huge" }).locator("img.vault-thumb"),
    ).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("dark mode", () => {
  test("the invert class is applied once, on the gallery container", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openVault(page, "?seed=bigfolder&n=6&el=3&thumbs=1");
    await openGallery(page);
    await page.keyboard.press("End"); // Zbig
    await page.keyboard.press("Enter");
    await expect(cells(page)).toHaveCount(6);
    await expect(gallery(page).locator("img.vault-thumb").first()).toBeVisible({
      timeout: 15_000,
    });
    const info = await gallery(page).evaluate((root) => {
      const marked = [...root.querySelectorAll(".vault-thumb-dark-invert")];
      const img = root.querySelector("img.vault-thumb")!;
      return {
        marked: marked.length,
        markedIsGrid: marked[0]?.getAttribute("role") === "grid",
        imgOwnClass: img.className.includes("invert"),
        imgFilter: getComputedStyle(img).filter,
      };
    });
    expect(info.marked).toBe(1);
    expect(info.markedIsGrid).toBe(true);
    expect(info.imgOwnClass).toBe(false);
    expect(info.imgFilter).toContain("invert");
  });
});
