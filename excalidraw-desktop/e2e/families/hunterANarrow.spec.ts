import { expect } from "@playwright/test";

import { stepProblems } from "../scenarios/checks";

import { test } from "../fixture";
import { runCommand } from "../pageHelpers";
import { openDrawing, openVault, trackErrors } from "../helpers";

// Hunter A round 2: narrow windows. At phone-like widths no page scrolls sideways, a context menu
// (file row, tab) lies fully inside the window, and nothing throws.
// Below the default `[layout] narrow_width` (600 px) the file list folds and opens over the
// drawing (toimprove 138); 640 and 900 px keep it beside the drawing.
const SIZES = [
  { width: 360, height: 640 },
  { width: 480, height: 700 },
  { width: 640, height: 800 },
  { width: 900, height: 800 },
];
const FOLDS_BELOW = 600;

test.use({ actionTimeout: 6000 });
for (const size of SIZES) {
  for (const theme of ["light", "dark"] as const) {
    test(`narrow window ${size.width}x${size.height} ${theme}: file list, tabs, menus fit; no sideways scroll`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(size);
      await openVault(page);
      const nav = page.getByLabel("Vault file navigator");
      const narrow = size.width < FOLDS_BELOW;
      if (narrow) {
        // Folded by default: the drawing keeps the whole window.
        await expect(nav).toBeHidden();
        await runCommand(page, "Toggle navigator");
        await expect(nav).toBeVisible();
        const b = (await nav.boundingBox())!;
        expect(b.x, "overlay inside the window").toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, "overlay inside the window").toBeLessThanOrEqual(
          size.width + 1,
        );
        expect(
          b.x,
          "a strip of the drawing is left to click away the overlay",
        ).toBeGreaterThanOrEqual(40);
      }
      await page
        .locator(".vault-tree-item__name", { hasText: "DSA" })
        .first()
        .click();
      await openDrawing(page, "Graphs");
      if (narrow) {
        // Opening a file closes the overlay.
        await expect(nav).toBeHidden();
      }

      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
      expect(await overflow(), "page scrolls sideways").toBeLessThanOrEqual(0);

      const menuInside = async (what: string) => {
        const menu = page.locator(".vault-menu").last();
        await expect(menu, what).toBeVisible();
        const b = (await menu.boundingBox())!;
        expect(b.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
        expect(b.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
        expect(b.x + b.width, `${what}: right edge`).toBeLessThanOrEqual(
          size.width + 1,
        );
        expect(b.y + b.height, `${what}: bottom edge`).toBeLessThanOrEqual(
          size.height + 1,
        );
        await page.keyboard.press("Escape");
      };

      const row = page
        .locator(".vault-tree-item__name", { hasText: "Graphs" })
        .first();
      if (await row.isVisible()) {
        await row.click({ button: "right" });
        await menuInside("file row menu");
      }
      // A tab is clickable where the user sees it: its middle and its close button are not under
      // another control (hunter A-7: at 360 px the "1 / 1" count sat on top of the only tab).
      const covered = await page.evaluate(() => {
        const tab = document.querySelector('[data-testid="vault-tab"]')!;
        const hit = (el: Element | null) => {
          if (!el) {
            return false;
          }
          const b = el.getBoundingClientRect();
          const top = document.elementFromPoint(
            b.x + b.width / 2,
            b.y + b.height / 2,
          );
          return !!top && el.contains(top);
        };
        return {
          tab: !hit(tab),
          close: !hit(tab.querySelector("button")),
        };
      });
      expect(covered, "something covers the tab or its close button").toEqual({
        tab: false,
        close: false,
      });
      const tab = page.locator('[role="tab"]').first();
      if (await tab.isVisible()) {
        await tab.click({ button: "right" });
        await menuInside("tab menu");
      }
      expect(
        await overflow(),
        "page scrolls sideways after menus",
      ).toBeLessThanOrEqual(0);
      // Every tab, toolbar and control of the editor fits: nothing cut off, overlapping or outside.
      const problems = await stepProblems(page, {
        dialogs: 0,
        skipFocus: true,
        minContrast: 2.5,
      });
      expect(problems, problems.join("\n")).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

// The overlay's other ways out: Esc and a click on the drawing strip close it, and focus goes
// back to where it was; Toggle navigator opens it again.
test("narrow window 480: Esc and a click outside close the file list overlay", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 480, height: 700 });
  await openVault(page);
  const nav = page.getByLabel("Vault file navigator");
  await expect(nav).toBeHidden();
  await runCommand(page, "Toggle navigator");
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await runCommand(page, "Toggle navigator");
  await expect(nav).toBeVisible();
  await page
    .getByTestId("navigator-scrim")
    .click({ position: { x: 5, y: 300 } });
  await expect(nav).toBeHidden();
  expect(errors).toEqual([]);
});
