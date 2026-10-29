import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { runCommand } from "../pageHelpers";
import { openDrawing, openVault, trackErrors } from "../helpers";

// Hunter C round 2 (2026-10-30): switching vault (palette command) while tabs, a search, a
// tag filter and folders are open. The new vault must show only its own files and none of the
// old vault's tabs, search text or folder state (Obsidian opens a vault in a clean window).
const name = (page: Page, n: string) =>
  page.locator(".vault-tree-item__name", { hasText: n }).first();

test("switching vault leaves nothing of the old vault on screen", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=search");
  await name(page, "DSA").click();
  await openDrawing(page, "Graphs");
  await expect(page.getByTestId("vault-tab")).toHaveCount(1);
  await page.getByPlaceholder("Search drawings and text…").fill("graph");

  await page.evaluate(() =>
    (window as any).__vaultRepo.queueVault({
      name: "Second Vault",
      path: "/fake/Second Vault",
      seed: (r: any) =>
        r.seedDrawing(
          "Only here.excalidraw",
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "t",
            elements: [],
            appState: {},
            files: {},
          }),
        ),
    }),
  );
  await runCommand(page, "Open another vault");

  // C-7: the old search text must not stay in the box (it hid every file of the new vault).
  const box = page.getByPlaceholder("Search drawings and text…");
  await expect(page.getByTestId("vault-tab")).toHaveCount(1); // one empty tab, none of the old
  await expect(page.getByTestId("vault-tab")).not.toContainText("Graphs");
  await expect(box).toHaveValue("");
  await box.fill("");
  await expect(name(page, "Only here")).toBeVisible({ timeout: 10_000 });
  await expect(name(page, "DSA")).toHaveCount(0);
  expect(errors).toEqual([]);
});

const seedSecond = () =>
  (window as any).__vaultRepo.queueVault({
    name: "Second Vault",
    path: "/fake/Second Vault",
    seed: (r: any) =>
      r.seedDrawing(
        "Only here.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "t",
          elements: [],
          appState: {},
          files: {},
        }),
      ),
  });

test("gallery, tags pane and the graph follow a vault switch", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=tags");
  await page.getByTestId("activity-bar-gallery").click();
  const view = page.getByTestId("gallery-view");
  await expect(view).toContainText("DSA");
  await page.evaluate(seedSecond);
  await runCommand(page, "Open another vault");
  await expect(view).toContainText("Only here", { timeout: 10_000 });
  await expect(view).not.toContainText("DSA");
  // The tags pane of the new vault has no tags of the old one.
  await page.getByTestId("activity-bar-tags").click();
  await expect(page.getByRole("button", { name: /^Tag dsa,/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
