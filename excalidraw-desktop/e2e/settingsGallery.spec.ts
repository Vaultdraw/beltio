import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

// Settings visual gallery (not assertions). Skipped unless REDESIGN_SHOTS is
// set to an absolute output directory:
//   REDESIGN_SHOTS=/abs/dir npx playwright test e2e/settingsGallery.spec.ts --project=webkit
const OUT = process.env.REDESIGN_SHOTS;
const PREFS_KEY = "excalidraw-vault-preferences-v1";

const THEMES = [
  { slug: "cendre-dark", colourTheme: "Cendre", mode: "Dark" },
  { slug: "default-light", colourTheme: "Default", mode: "Light" },
] as const;

const PAGES = [
  "General",
  "Appearance",
  "Interface",
  "Drawing",
  "Tools",
  "Page",
  "Files",
  "Links",
  "Hotkeys",
] as const;

const openSettings = async (page: Page) => {
  await page.keyboard.press("Meta+Comma");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

for (const theme of THEMES) {
  test(`settings gallery ${theme.slug}`, async ({ page, browserName }) => {
    test.skip(!OUT, "set REDESIGN_SHOTS to an output directory");
    test.skip(browserName !== "webkit", "webkit only");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1100, height: 780 });
    // A conflict (New drawing on the Open settings chord) for the Hotkeys shots.
    await page.addInitScript(
      ([key]) => {
        if (!window.sessionStorage.getItem("sg-seeded")) {
          window.localStorage.setItem(
            key as string,
            JSON.stringify({
              hotkeys: { "vault.newDrawing": ["Mod+N", "Mod+Comma"] },
            }),
          );
          window.sessionStorage.setItem("sg-seeded", "1");
        }
      },
      [PREFS_KEY] as const,
    );
    await openVault(page);

    const dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "Appearance" }).click();
    await dialog
      .getByRole("radio", { name: theme.colourTheme, exact: true })
      .click();
    await dialog
      .locator(".vault-segmented-btn", { hasText: theme.mode })
      .first()
      .click();
    await page.waitForTimeout(300);

    const shot = (name: string) =>
      page.screenshot({ path: `${OUT}/${theme.slug}-settings-${name}.png` });
    for (const name of PAGES) {
      await dialog.getByRole("tab", { name }).click();
      await page.waitForTimeout(350);
      await shot(name.toLowerCase());
    }

    // Hotkeys: recording on an unassigned row, then the Conflicts filter.
    await dialog.getByRole("tab", { name: "Hotkeys" }).click();
    await dialog
      .getByRole("button", { name: /^Add hotkey for/ })
      .first()
      .click();
    await page.waitForTimeout(200);
    await shot("hotkeys-recording");
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: /^Conflicts/ }).click();
    await page.waitForTimeout(200);
    await shot("hotkeys-conflicts");
  });
}
