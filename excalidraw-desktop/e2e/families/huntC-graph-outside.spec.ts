import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { GRAPH_PLUGIN, openLinksVault } from "../linksHelpers";

// Hunter C (2026-10-30): the graph opened, then the vault changes behind the app's back.
// Obsidian's graph drops a deleted file's node and shows a new file at once.

type Win = Window & {
  __graphApp?: { nodeCount: number; pathOf(i: number): string | null } | null;
};

const paths = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Win).__graphApp;
    if (!s) {
      return [] as string[];
    }
    return Array.from({ length: s.nodeCount }, (_, i) => s.pathOf(i) ?? "");
  });

test("a drawing deleted outside while the graph is open loses its node", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await page.keyboard.press("Meta+Alt+g");
  await expect(page.getByTestId("graph-view")).toBeVisible();
  await expect.poll(async () => (await paths(page)).length).toBeGreaterThan(2);
  expect(await paths(page)).toContain("Alpha.excalidraw");
  await page.evaluate(() =>
    (window as any).__vaultRepo.outside({
      op: "delete",
      path: "Alpha.excalidraw",
    }),
  );
  await expect
    .poll(async () => await paths(page), { timeout: 8000 })
    .not.toContain("Alpha.excalidraw");
});

test("a drawing created outside while the graph is open gets a node", async ({
  page,
}) => {
  await openLinksVault(page, "Hub", null, GRAPH_PLUGIN);
  await page.keyboard.press("Meta+Alt+g");
  await expect(page.getByTestId("graph-view")).toBeVisible();
  await expect.poll(async () => (await paths(page)).length).toBeGreaterThan(2);
  await page.evaluate(() =>
    (window as any).__vaultRepo.outside({
      op: "create",
      path: "Brand new.excalidraw",
    }),
  );
  await expect
    .poll(async () => await paths(page), { timeout: 8000 })
    .toContain("Brand new.excalidraw");
});
