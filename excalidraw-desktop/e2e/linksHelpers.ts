import { expect, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "./helpers";

export const PREFS_KEY = "excalidraw-vault-preferences-v1";

/** Seeds preferences before the app boots (once per browser session). */
export const seedPrefs = (page: Page, prefs: Record<string, unknown>) =>
  page.addInitScript(
    ([key, value]) => {
      if (!window.sessionStorage.getItem("links-seeded")) {
        window.localStorage.setItem(key as string, JSON.stringify(value));
        window.sessionStorage.setItem("links-seeded", "1");
      }
    },
    [PREFS_KEY, prefs] as const,
  );

/** The graph is an official plugin: its specs start the fake plugin host with it (`?plugins=graph`). */
export const GRAPH_PLUGIN = "&plugins=graph";

export const openLinksVault = async (
  page: Page,
  drawing: string | null = "Hub",
  prefs: Record<string, unknown> | null = null,
  /** More query parameters, for example `&plugins=graph` for the graph specs. */
  extra = "",
) => {
  if (prefs) {
    await seedPrefs(page, prefs);
  }
  await openVault(page, `?seed=links${extra}`);
  if (extra.includes("plugins=")) {
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
  }
  if (drawing) {
    await openDrawing(page, drawing);
  }
};

/** Viewport point of scene (sx, sy): drawings open at zoom 1, scroll 0. */
export const scenePoint = async (page: Page, sx: number, sy: number) => {
  const box = await canvasBox(page);
  return { x: box.x + sx, y: box.y + sy };
};

/** Where the seeded links sit (scene coordinates, Excalifont 20px). */
export const SEED = {
  alphaText: { x: 290, y: 231 }, // "See [[Alpha]] now" (hub-t1)
  missingText: { x: 340, y: 292 }, // "Todo [[Missing Note]]" (hub-t2)
  dupeText: { x: 285, y: 350 }, // "Which [[Dupe]]?" (hub-t3)
  shape: { x: 280, y: 460 }, // hub-shape rectangle centre
};

export const breadcrumbs = (page: Page) => page.locator(".vault-breadcrumbs");

export const expectOpen = (page: Page, name: string) =>
  expect(breadcrumbs(page)).toContainText(name);

/** Cmd (the open modifier) held while `run` executes. */
export const withMeta = async (page: Page, run: () => Promise<void>) => {
  await page.keyboard.down("Meta");
  try {
    await run();
  } finally {
    await page.keyboard.up("Meta");
  }
};

export const cmdClick = async (page: Page, sx: number, sy: number) => {
  const p = await scenePoint(page, sx, sy);
  await withMeta(page, async () => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  });
};

export const linksCalls = (page: Page) =>
  page.evaluate(() => ({ ...(window as any).__vaultLinks.calls }));

export const settled = (page: Page) =>
  page.evaluate(() => (window as any).__vaultLinks.settled());

export const sceneTexts = (scene: any) =>
  scene.elements
    .filter((e: any) => !e.isDeleted)
    .map((e: any) => e.originalText ?? e.link ?? "");

export const drawingPaths = (page: Page) =>
  page.evaluate(
    () => [...(window as any).__vaultRepo.files.keys()] as string[],
  );

export const openRenameDialog = async (page: Page, name: string) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  return page.getByRole("dialog");
};

export const renameTo = async (page: Page, from: string, to: string) => {
  const dialog = await openRenameDialog(page, from);
  await dialog.getByLabel("New name").fill(to);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toHaveCount(0);
};
