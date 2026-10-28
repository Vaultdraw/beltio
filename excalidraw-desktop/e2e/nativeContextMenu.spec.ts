import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// toimprove #45: release builds suppress the native WebView menu (Reload).
// The harness enables the suppression with ?nativemenu=suppress.

/** Records `defaultPrevented` as seen after every other handler (late window listener). */
const recordContextMenus = (page: Page) =>
  page.evaluate(() => {
    const seen: boolean[] = [];
    (window as any).__ctxSeen = seen;
    window.addEventListener("contextmenu", (e) =>
      seen.push(e.defaultPrevented),
    );
  });
const seen = (page: Page) =>
  page.evaluate(() => (window as any).__ctxSeen as boolean[]);

test("native menu is suppressed outside editable fields; the canvas menu still opens", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?nativemenu=suppress");
  await seedAndOpen(page, "Menu.excalidraw");
  await recordContextMenus(page);

  // Non-editable chrome: the suppression prevents the default.
  await page
    .getByLabel("Vault File Navigator")
    .click({ button: "right", position: { x: 4, y: 4 } });
  expect((await seen(page)).at(-1)).toBe(true);

  // Editable field: the native menu (Cut/Copy/Paste) stays available.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "probe-input";
    document.body.appendChild(input);
  });
  await page.locator("#probe-input").click({ button: "right" });
  expect((await seen(page)).at(-1)).toBe(false);

  // The app's own canvas menu still opens, with "Import file…".
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4, {
    button: "right",
  });
  await expect(
    page.locator(".context-menu").getByRole("button", { name: "Import file…" }),
  ).toBeVisible();
  expect((await seen(page)).at(-1)).toBe(true);
  expect(errors).toEqual([]);
});

test("without the flag (dev) the native menu is left alone", async ({
  page,
}) => {
  await openVault(page);
  await recordContextMenus(page);
  await page
    .getByLabel("Vault File Navigator")
    .click({ button: "right", position: { x: 4, y: 4 } });
  expect((await seen(page)).at(-1)).toBe(false);
});
