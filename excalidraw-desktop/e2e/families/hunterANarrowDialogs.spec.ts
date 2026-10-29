import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";
import { openVault, trackErrors } from "../helpers";

// Hunter A round 2: at 360x640 the command palette, Settings, Hotkeys and the search panel stay
// inside the window and their close controls are reachable.
const inside = async (page: Page, sel: string, what: string) => {
  const el = page.locator(sel).first();
  await expect(el, what).toBeVisible();
  const b = (await el.boundingBox())!;
  expect(b.x, `${what} left`).toBeGreaterThanOrEqual(-1);
  expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(361);
  expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(641);
};

test("narrow 360x640: palette, settings, hotkeys fit the window", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await openVault(page);
  await page.keyboard.press("Meta+Shift+KeyP");
  await inside(
    page,
    '[role="dialog"][aria-label="Command palette"]',
    "palette",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).first().click();
  await inside(page, ".vault-settings-modal", "settings");
  const close = page
    .locator(".vault-settings-modal")
    .getByRole("button", { name: /close/i })
    .first();
  await expect(close, "settings close button").toBeVisible();
  const cb = (await close.boundingBox())!;
  expect(cb.x + cb.width).toBeLessThanOrEqual(361);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hotkeys" }).first().click();
  await expect(page.getByRole("dialog").first()).toBeVisible();
  const d = (await page.getByRole("dialog").first().boundingBox())!;
  expect(d.x + d.width, "hotkeys right").toBeLessThanOrEqual(361);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
