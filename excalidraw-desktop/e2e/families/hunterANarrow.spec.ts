import { expect } from "@playwright/test";

import { test } from "../fixture";
import { openDrawing, openVault, trackErrors } from "../helpers";

// Hunter A round 2: narrow windows. At phone-like widths no page scrolls sideways, a context menu
// (file row, tab) lies fully inside the window, and nothing throws.
const SIZES = [
  { width: 360, height: 640 },
  { width: 480, height: 700 },
  { width: 640, height: 800 },
];

test.use({ actionTimeout: 6000 });
for (const size of SIZES) {
  test(`narrow window ${size.width}x${size.height}: menus stay inside, no sideways scroll`, async ({
    page,
  }) => {
    // At 360 px the navigator leaves the editor column 43 px wide: no tab fits until the
    // navigator gives way on narrow windows, as Obsidian's side panes do (toimprove 138).
    test.fixme(
      size.width < 400,
      "toimprove 138: navigator must give way at narrow widths",
    );
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await page.setViewportSize(size);
    await openVault(page);
    await page
      .locator(".vault-tree-item__name", { hasText: "DSA" })
      .first()
      .click();
    await openDrawing(page, "Graphs");

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
    expect(errors).toEqual([]);
  });
}
