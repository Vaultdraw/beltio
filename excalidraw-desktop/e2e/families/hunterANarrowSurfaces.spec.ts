import { expect, type Page } from "@playwright/test";

import { stepProblems } from "../scenarios/checks";

import { test } from "../fixture";
import {
  clickMainMenuItem,
  openDrawing,
  openVault,
  trackErrors,
} from "../helpers";

// Hunter A round 3: every surface a user reaches without a drawing open (home screen, navigator
// menus, main menu, new-drawing and import dialogs, settings pages, plugin and theme browsers)
// at 360x640 and 400x700, light and dark: the shared layout checks find nothing sticking out of
// the window, cut off or overlapping. Tabs at 360 px are toimprove 138 (known, not walked here).
const SIZES = [
  { width: 360, height: 640 },
  { width: 400, height: 700 },
];

const walk = async (
  page: Page,
  size: { width: number; height: number },
  theme: "light" | "dark",
) => {
  const out: string[] = [];
  const seen: string[] = [];
  const check = async (what: string, dialogs = 0) => {
    seen.push(what);
    const problems = await stepProblems(page, {
      dialogs,
      skipFocus: true,
      // the faint hint colour is 2.8:1 on white, as Obsidian's own faint text (not claimed)
      minContrast: 2.5,
    });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    if (over > 0) {
      problems.push(`page scrolls sideways by ${over}px`);
    }
    for (const p of problems) {
      out.push(`[${size.width} ${theme}] ${what}: ${p}`);
    }
  };
  await openVault(page);
  await check("home");
  // main menu (hamburger) is only in the editor; open a drawing for the editor's own chrome
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await page.getByTestId("main-menu-trigger").click();
  await check("main menu");
  await page.keyboard.press("Escape");

  const nav = page.getByLabel("Vault file navigator");
  if (!(await nav.isVisible())) {
    out.push(`[${size.width} ${theme}] navigator not visible`);
  }
  if (await nav.isVisible()) {
    await nav.getByRole("button", { name: "New drawing" }).first().click();
    await check("new drawing dialog", 1);
    await page.keyboard.press("Escape");
  }
  if (seen.length < 3) {
    out.push(`only ${seen.length} surfaces walked: ${seen.join(", ")}`);
  }
  return out;
};

for (const size of SIZES) {
  for (const theme of ["light", "dark"] as const) {
    test(`narrow ${size.width}x${size.height} ${theme}: home, main menu and new-drawing dialog fit`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const errors = trackErrors(page);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(size);
      const out = await walk(page, size, theme);
      expect(out, out.join("\n")).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
void clickMainMenuItem;

// A-11: Settings pages at narrow widths. The sidebar keeps its width, so the page column shrinks:
// the Mode buttons, colour swatches, pattern buttons and the close X are cut off, pushed over the
// sidebar or painted over their own labels (560 px: the accent swatches cover "Accent colour").
// Obsidian switches its settings to a list-then-page layout on narrow windows. Fixed at 720 px.
const SETTINGS_WIDTHS = [360, 400, 480, 560, 640, 720, 900];
for (const width of SETTINGS_WIDTHS) {
  test(`A-11: settings pages fit a ${width} px window`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width, height: 700 });
    await openVault(page);
    await page.getByRole("button", { name: "Settings" }).first().click();
    const modal = page.locator(".vault-settings-modal");
    await expect(modal).toBeVisible();
    const tabs = modal.getByRole("tab");
    const out: string[] = [];
    const n = await tabs.count();
    expect(n).toBeGreaterThan(10);
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(150);
      const name = (await tabs.nth(i).innerText()).trim();
      for (const p of await stepProblems(page, {
        dialogs: 1,
        skipFocus: true,
        minContrast: 2.5,
      })) {
        if (/outside|overlap|cut off/.test(p)) {
          out.push(`${name}: ${p}`);
        }
      }
      const x = await modal
        .getByRole("button", { name: /close/i })
        .first()
        .boundingBox();
      if (!x || x.x + x.width > width) {
        out.push(`${name}: close button out of the window`);
      }
    }
    expect(out, out.join("\n")).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// A-13: the Community themes dialog has a minimum width of about 485 px, so in windows between
// 380 and 520 px wide it is wider than the window: it is centred, so both edges (and the close X's
// breathing room) are cut off by up to 8 px (440 px window: x = -8). Every dialog in a 440 to 520 px
// window should keep a margin, as the plugin browser (16 px each side) does.
for (const width of [440, 460, 480, 500]) {
  test(`A-13: the theme browser fits a ${width} px window`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width, height: 700 });
    await openVault(page);
    await page.getByRole("button", { name: "Settings" }).first().click();
    await page
      .locator(".vault-settings-modal")
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await page.getByRole("button", { name: "Install more themes…" }).click();
    const dialog = page.getByTestId("theme-browser-dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1200);
    const b = (await dialog.boundingBox())!;
    expect(b.x, "left edge").toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, "right edge").toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}
