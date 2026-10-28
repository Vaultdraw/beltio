import { expect, test } from "@playwright/test";

import { canvasBox, openVault, trackErrors } from "./helpers";
import { rect, seedAndOpen } from "./pageHelpers";

// Auto-export, reached by clicking: Settings > Plugins > Auto-export, turn "Export on save" on, edit
// and save a drawing, and see the toast and the .svg appear next to it (the in-memory vault's
// exports, read through window.__exportFiles). Nothing is written while the switch is off.
test("Auto-export: turning it on in Settings writes an .svg when a drawing is saved", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAndOpen(page, "Sketch.excalidraw", {
    elements: [rect("r1", 40, 40)],
  });
  const exported = () =>
    page.evaluate(() => (window as any).__exportFiles?.() ?? {});

  await page.getByTestId("activity-bar-settings").click();
  const settings = page.locator(".vault-settings-modal");
  await settings.getByRole("tab", { name: "Plugins" }).click();
  const row = page.getByTestId("plugin-auto-export");
  await expect(row).toContainText("Auto-export");
  await row.getByRole("button", { name: "Auto-export settings" }).click();
  await row.getByRole("switch", { name: "Export on save" }).click();
  await row
    .getByRole("switch", { name: "Show a message for each export" })
    .click();
  await expect(
    row.getByRole("switch", { name: "Export on save" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-settings-modal")).toHaveCount(0);

  // Draw a second rectangle: the autosave fires drawing.saved, the export follows after the wait.
  const box = await canvasBox(page);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 280, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByText("Exported Sketch")).toBeVisible({
    timeout: 20_000,
  });
  const files = await exported();
  expect(Object.keys(files)).toEqual(["Sketch.svg"]);
  expect(files["Sketch.svg"]).toContain("<svg");
  expect(errors).toEqual([]);
});
