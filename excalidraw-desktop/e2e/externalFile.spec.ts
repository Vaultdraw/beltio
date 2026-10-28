import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

// A drawing file the system opens from outside every vault asks three ways, and "Copy into
// vault" puts a copy in the tree. Rust checked the path and sends the window a `uri.run` plan
// (action "file"); the e2e page has no Tauri bridge, so the plan goes to the window method
// table directly and the file's text comes from a fake (see useControlBridge readExternal).

test("a file from outside the vaults asks, and Copy into vault adds it to the tree", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);

  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e",
    elements: [],
    appState: {},
    files: {},
  });
  const status = await page.evaluate(async (json) => {
    const w = window as any;
    w.__externalFiles = {
      "/outside/Sketch.excalidraw": { name: "Sketch.excalidraw", json },
    };
    return w.__controlMethods["uri.run"]({
      action: "file",
      kind: "drawing",
      path: "/outside/Sketch.excalidraw",
      origin: "os",
    });
  }, scene);
  expect(status).toEqual({ status: "asking" });

  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("Open a file from outside your vaults?");
  await expect(modal).toContainText("/outside/Sketch.excalidraw");
  await expect(modal.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(
    modal.getByRole("button", { name: "Open its folder as a vault" }),
  ).toBeVisible();
  // Nothing was copied by the file arriving.
  await expect(
    page.locator('[data-tree-path="Sketch.excalidraw"]'),
  ).toHaveCount(0);

  // The guard time keeps a held key from confirming; then the user clicks.
  await page.waitForTimeout(700);
  await modal.getByRole("button", { name: "Copy into vault" }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.locator('[data-tree-path="Sketch.excalidraw"]'),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Sketch",
  );
  expect(errors).toEqual([]);
});
