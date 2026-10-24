import { expect, test } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// A vaultdraw:// link that creates a drawing must ask first. Rust parsed the link and sends
// the window a `uri.run` plan; the e2e page has no Tauri bridge, so the plan goes to the
// window method table directly (see useControlBridge `__controlMethodsSink`).

test("a link that creates a drawing asks first", async ({ page }) => {
  const errors = trackErrors(page);
  await openVault(page);
  // The vault has a folder DSA: the link will write into it.

  // The link arrives from outside: it must not create anything by itself.
  const status = await page.evaluate(async () => {
    const methods = (window as any).__controlMethods;
    return methods["uri.run"]({
      action: "new",
      path: "DSA/Idea",
      allowed: false,
      allowSwitch: false,
      origin: "os",
    });
  });
  expect(status).toEqual({ status: "asking" });

  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("Create drawing?");
  await expect(modal).toContainText('Create the drawing "DSA/Idea.excalidraw"');
  await expect(
    page.locator('[data-tree-path="DSA/Idea.excalidraw"]'),
  ).toHaveCount(0);

  // The user clicks Create: the drawing exists, is in the tree and is the active tab.
  await modal.getByRole("button", { name: "Create" }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.locator('[data-tree-path="DSA/Idea.excalidraw"]'),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("tab", { selected: true })).toContainText("Idea");
  expect(errors).toEqual([]);
});
