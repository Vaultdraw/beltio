import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, trackErrors } from "./helpers";
import { colorOn } from "./historyHelpers";

import type { Rgb } from "./historyHelpers";

// `vaultdraw scene apply` reaches the window as the `scene.apply` method. The e2e page has no
// Tauri bridge, so the call goes to the window method table directly (see useControlBridge
// `__controlMethodsSink`). The user then clicks the toolbar Undo: one call is one undo step.

const MAGENTA: Rgb = [201, 42, 170];
const FILL = "#c92aaa";

const painted = (page: Parameters<typeof colorOn>[0]) =>
  expect.poll(
    async () => (await colorOn(page, ".vault-editor", MAGENTA)).count,
    { timeout: 8000 },
  );

test("shapes applied by a script appear and one toolbar Undo removes them", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  // The folder may start collapsed: open it like a user would.
  const folder = page.getByRole("treeitem", { name: "Expand DSA" });
  if (await folder.isVisible()) {
    await folder.click();
  }
  await openDrawing(page, "Graphs");
  await painted(page).toBe(0);

  const result = await page.evaluate(async (fill) => {
    const methods = (window as any).__controlMethods;
    const read = await methods["scene.read"]({ limit: 1 });
    const { x, y, width, height } = read.viewport;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const box = (dx: number) => ({
      op: "add",
      element: {
        type: "rectangle",
        x: cx + dx,
        y: cy - 40,
        width: 80,
        height: 80,
        backgroundColor: fill,
      },
    });
    return methods["scene.apply"]({
      ops: [box(-150), box(-40), box(70)],
      ifVersion: read.version,
      by: "cli",
    });
  }, FILL);
  expect(result.applied).toBe(3);
  expect(result.ids).toHaveLength(3);

  // The user sees the shapes and the notice that names the change.
  await painted(page).toBeGreaterThan(3 * 2000);
  await expect(
    page.getByText("A script made 3 changes to Graphs"),
  ).toBeVisible();

  // One click on the toolbar Undo removes all three.
  await page.getByRole("button", { name: "Undo" }).click();
  await painted(page).toBe(0);
  expect(errors).toEqual([]);
});
