import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// Folder gallery (F2 surface a): windowed thumbnail grid over the fake store.
const PREFS_KEY = "excalidraw-vault-preferences-v1";
const gallery = (page: Page) => page.getByTestId("gallery-view");
const grid = (page: Page) => page.getByRole("grid", { name: /Gallery/ });
const cells = (page: Page) => page.getByRole("gridcell");
const active = (page: Page) =>
  grid(page).evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    return id ? document.getElementById(id)?.textContent ?? null : null;
  });
const switcher = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });

const openGallery = async (page: Page) => {
  await page.keyboard.press("Meta+Alt+KeyE");
  await expect(gallery(page)).toBeVisible();
  await expect(grid(page)).toBeFocused();
};

test.describe("gallery grid", () => {
  test("opens by chord, navigates, shows thumbnails, Enter opens a drawing", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await openVault(page, "?seed=search&thumbs=1");
    await openGallery(page);
    // Vault root: the DSA folder only.
    await expect(cells(page)).toHaveCount(1);
    await expect(active(page)).resolves.toBe("DSA");
    await page.keyboard.press("Enter");
    await expect(gallery(page)).toContainText("DSA");
    // Dynamic Programming (folder) first, then Graphs and Shortest Paths.
    await expect(cells(page)).toHaveCount(3);
    await expect(page.getByTestId("gallery-count")).toHaveText("3 items");
    await expect(gallery(page).locator("img.vault-thumb").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("j"); // single row: stays
    await expect(active(page)).resolves.toContain("Dynamic Programming");
    await page.keyboard.press("l");
    await expect(active(page)).resolves.toContain("Graphs");
    await page.keyboard.press("End");
    await expect(active(page)).resolves.toContain("Shortest Paths");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(gallery(page)).toHaveCount(0);
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Backspace goes to the parent (selecting where we came from); Escape closes", async ({
    page,
  }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await openGallery(page);
    await page.keyboard.press("Enter"); // into DSA
    await expect(cells(page)).toHaveCount(3);
    await page.keyboard.press("Backspace");
    await expect(cells(page)).toHaveCount(1);
    await expect(active(page)).resolves.toBe("DSA");
    await page.keyboard.press("Backspace"); // at root: no-op
    await expect(gallery(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gallery(page)).toHaveCount(0);
  });

  test("the folder context menu opens the grid; the toggle command closes it", async ({
    page,
  }) => {
    await openVault(page, "?seed=search&thumbs=1");
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Show as grid" }).click();
    await expect(gallery(page)).toContainText("DSA");
    await expect(cells(page)).toHaveCount(3);
    await page.keyboard.press("Meta+Shift+KeyP");
    await expect(switcher(page)).toBeVisible();
    await page.keyboard.type("Gallery:");
    const options = switcher(page).getByRole("option");
    await expect(
      options.filter({ hasText: "Gallery: Show folder as grid" }),
    ).toBeVisible();
    await options.filter({ hasText: "Gallery: Toggle grid view" }).click();
    await expect(gallery(page)).toHaveCount(0);
  });

  test("a 3000-drawing folder mounts a small window and scrolls", async ({
    page,
  }) => {
    await openVault(page, "?seed=bigfolder&n=3000&thumbs=1");
    await openGallery(page);
    await page.keyboard.press("l"); // DSA -> Zbig
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("gallery-count")).toHaveText("3000 items");
    await expect(cells(page).first()).toBeVisible();
    const mounted = await cells(page).count();
    test.info().annotations.push({
      type: "mounted-tiles",
      description: String(mounted),
    });
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(150);
    await page.keyboard.press("End");
    await expect(active(page)).resolves.toBe("note 2999");
    expect(await grid(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await cells(page).count()).toBeLessThanOrEqual(150);
    await page.keyboard.press("PageUp");
    await expect(active(page)).resolves.not.toBe("note 2999");
    await page.keyboard.press("Home");
    await expect(cells(page).first()).toContainText("note 000");
    expect(await cells(page).count()).toBeLessThanOrEqual(150);
  });

  test("thumbnails off: the grid still works, with no images", async ({
    page,
  }) => {
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
    await openGallery(page);
    await page.keyboard.press("Enter");
    await expect(cells(page)).toHaveCount(3);
    await expect(gallery(page).locator("img.vault-thumb")).toHaveCount(0);
    await expect(
      page.locator(".vd-gallery .vault-thumb--placeholder"),
    ).toHaveCount(3);
  });
});
