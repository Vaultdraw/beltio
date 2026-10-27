import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

const PREFS_KEY = "excalidraw-vault-preferences-v1";

/** Seed preferences before the app boots (plain-browser settings use localStorage). */
const seedPreferences = (page: Page, prefs: Record<string, unknown>) =>
  page.addInitScript(
    ([key, value]) => {
      if (!window.sessionStorage.getItem("p2-seeded")) {
        window.localStorage.setItem(key as string, JSON.stringify(value));
        window.sessionStorage.setItem("p2-seeded", "1");
      }
    },
    [PREFS_KEY, prefs] as const,
  );

/** Root-level drawings with pinned modified times (b oldest, c newest). */
const seedRootDrawings = async (page: Page) => {
  await page.evaluate(() => {
    const repo = (window as any).__vaultRepo;
    const json = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [],
      appState: {},
      files: {},
    });
    const base = Date.now() - 100_000;
    for (const [name, offset] of [
      ["Bravo", 0],
      ["alpha", 20_000],
      ["Charlie", 10_000],
    ] as const) {
      repo.seedDrawing(`${name}.excalidraw`, json);
      repo.setModified(`${name}.excalidraw`, base + offset);
    }
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  });
};

const rootDrawingOrder = async (page: Page) => {
  const names = await page
    .locator(
      ".vault-tree-item--drawing .vault-tree-item__name, .vault-tree-item__name",
    )
    .allTextContents();
  return names
    .map((n) => n.trim().replace(/\.excalidraw$/, ""))
    .filter((n) => /^(alpha|Bravo|Charlie)$/.test(n));
};

const chooseSort = async (page: Page, label: string) => {
  await page.getByRole("button", { name: "Sort order" }).click();
  await page
    .getByRole("menuitemradio", { name: label })
    .or(page.getByRole("menuitem", { name: label }))
    .first()
    .click();
};

test("navigator sort menu reorders the tree", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedRootDrawings(page);
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Charlie" }),
  ).toBeVisible();

  await chooseSort(page, "Name (A to Z)");
  await expect
    .poll(() => rootDrawingOrder(page))
    .toEqual(["alpha", "Bravo", "Charlie"]);

  await chooseSort(page, "Name (Z to A)");
  await expect
    .poll(() => rootDrawingOrder(page))
    .toEqual(["Charlie", "Bravo", "alpha"]);

  await chooseSort(page, "Modified (new to old)");
  await expect
    .poll(() => rootDrawingOrder(page))
    .toEqual(["alpha", "Charlie", "Bravo"]);

  await chooseSort(page, "Modified (old to new)");
  await expect
    .poll(() => rootDrawingOrder(page))
    .toEqual(["Bravo", "Charlie", "alpha"]);

  // Folders stay first whatever the order.
  const first = await page
    .locator(".vault-tree-item__name")
    .first()
    .textContent();
  expect(first?.trim()).toBe("DSA");
  expect(errors).toEqual([]);
});

test("confirm delete off trashes without a dialog", async ({ page }) => {
  const errors = trackErrors(page);
  await seedPreferences(page, { confirmDelete: false });
  await openVault(page);
  await seedRootDrawings(page);
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^Bravo/ }),
    })
    .first();
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("menuitem", { name: "Move to Trash", exact: true })
    .click();

  await expect(
    page.locator(".vault-tree-item__name", { hasText: /^Bravo/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exists = await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    return (await repo.listDirectory(repo.handle, "")).some(
      (e: any) => e.path === "Bravo.excalidraw",
    );
  });
  expect(exists).toBe(false);
  expect(errors).toEqual([]);
});

test("default folder is created and receives the new drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await seedPreferences(page, { newDrawingFolder: "Inbox/Deep" });
  await openVault(page);
  // The header button is gone; the command (Mod+N) creates in the default folder.
  await page.keyboard.press("Meta+KeyN");
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();

  const listing = await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    const root = await repo.listDirectory(repo.handle, "");
    const inbox = await repo.listDirectory(repo.handle, "Inbox");
    const deep = await repo.listDirectory(repo.handle, "Inbox/Deep");
    return {
      root: root.map((e: any) => e.path),
      inbox: inbox.map((e: any) => e.path),
      deep: deep.map((e: any) => e.path),
    };
  });
  expect(listing.root).toContain("Inbox");
  expect(listing.inbox).toContain("Inbox/Deep");
  expect(listing.deep).toHaveLength(1);
  expect(listing.deep[0]).toMatch(/^Inbox\/Deep\/Drawing-\d+\.excalidraw$/);
  expect(errors).toEqual([]);
});
