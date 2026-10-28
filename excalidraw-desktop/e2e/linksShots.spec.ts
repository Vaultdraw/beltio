import { mkdirSync, writeFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openLinksVault, scenePoint, SEED, withMeta } from "./linksHelpers";
import { readScene } from "./helpers";

// Visual review shots for Links P1 (not assertions). Only runs with
// LINKS_SHOTS=1; WebKit only. Saved under personal/feature/links-graph.
const ON = process.env.LINKS_SHOTS === "1";
const DIR =
  process.env.LINKS_SHOTS_DIR ??
  "../personal/feature/links-graph/screenshots/p1";
const COMPAT_FIXTURE =
  process.env.LINKS_COMPAT_FIXTURE ?? "../.cache/links-compat-hub.excalidraw";

test.skip(!ON, "set LINKS_SHOTS=1 to take the Links P1 screenshots");
test.skip(({ browserName }) => browserName !== "webkit", "webkit only");

const THEMES = [
  { tag: "cendre-dark", colorTheme: "Cendre", scheme: "dark" as const },
  { tag: "default-light", colorTheme: "Default", scheme: "light" as const },
];

const shot = (page: Page, name: string, tag: string) =>
  page.screenshot({ path: `${DIR}/${name}-${tag}.png` });

for (const theme of THEMES) {
  test.describe(theme.tag, () => {
    test.beforeEach(async ({ page }) => {
      mkdirSync(DIR, { recursive: true });
      await page.emulateMedia({ colorScheme: theme.scheme });
    });

    const open = (
      page: Page,
      drawing: string | null = "Hub",
      extra: Record<string, unknown> = {},
    ) =>
      openLinksVault(page, drawing, {
        colorTheme: theme.colorTheme,
        ...extra,
      });

    test("autocomplete popup", async ({ page }) => {
      await open(page);
      const p = await scenePoint(page, 600, 300);
      await page.mouse.dblclick(p.x, p.y);
      await page.keyboard.type("Link to [[Al");
      await expect(page.locator(".vault-suggest__row").first()).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "autocomplete", theme.tag);
    });

    test("backlinks panel", async ({ page }) => {
      await open(page, "Alpha");
      await page.keyboard.press("Meta+Alt+b");
      await expect(
        page.locator(".vault-links__row--backlink").first(),
      ).toBeVisible();
      await page.locator(".vault-links").focus();
      await page.keyboard.press("j");
      await page.waitForTimeout(300);
      await shot(page, "backlinks", theme.tag);
    });

    test("Cmd+hover underline", async ({ page }) => {
      await open(page);
      const p = await scenePoint(page, SEED.alphaText.x, SEED.alphaText.y);
      await withMeta(page, async () => {
        await page.mouse.move(p.x - 20, p.y + 10);
        await page.mouse.move(p.x, p.y, { steps: 3 });
        await expect(
          page.locator(".vault-link-underline").first(),
        ).toBeVisible();
        await page.waitForTimeout(200);
        await shot(page, "cmd-hover", theme.tag);
      });
    });

    test("hint mode", async ({ page }) => {
      await open(page);
      const empty = await scenePoint(page, 700, 500);
      await page.mouse.click(empty.x, empty.y);
      await page.keyboard.press("Shift+F");
      await expect(page.locator(".vault-link-hint").first()).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "hints", theme.tag);
    });

    test("settings links section", async ({ page }) => {
      await open(page);
      await page.keyboard.press("Meta+Comma");
      await page.getByRole("tab", { name: "Links" }).click();
      await expect(page.locator("#vault-link-update")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "settings-links", theme.tag);
    });

    test("hotkeys drawing shortcuts", async ({ page }) => {
      await open(page, "Hub", {
        hotkeys: { "drawing.open:Alpha.excalidraw": ["Mod+Alt+1"] },
      });
      await page.keyboard.press("Meta+Comma");
      await page.getByRole("tab", { name: "Hotkeys" }).click();
      const section = page.getByTestId("drawing-shortcuts");
      await section.scrollIntoViewIfNeeded();
      await expect(section).toContainText("Alpha");
      await page.waitForTimeout(300);
      await shot(page, "hotkeys-drawing-shortcuts", theme.tag);
    });
  });
}

// The linked Hub drawing as the app saved it, for the plain-editor check
// (excalidraw.com compatibility): see spikes/compat/harness/run-compat.mjs.
test("compat fixture export", async ({ page }) => {
  await openLinksVault(page);
  const scene = await readScene(page, "Hub.excalidraw");
  mkdirSync(COMPAT_FIXTURE.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(COMPAT_FIXTURE, JSON.stringify(scene));
});
