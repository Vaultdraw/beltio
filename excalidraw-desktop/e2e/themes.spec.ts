import { createHash } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  screenshot,
  SHOTS,
  trackErrors,
} from "./helpers";
import { MIDNIGHT_THEME } from "./fixtures/themeServer";

const DRAWING = "DSA/Graphs.excalidraw";

const hexToRgb = (hex: string) => {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const islandBackground = (page: Page) =>
  page.evaluate(() => {
    const island = document.querySelector(".excalidraw .Island");
    return island ? getComputedStyle(island).backgroundColor : null;
  });

/** RGB of a static-canvas pixel near the bottom-right corner (empty area). */
const emptyCanvasPixel = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const ctx = canvas.getContext("2d")!;
    const d = ctx.getImageData(canvas.width - 6, canvas.height - 6, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

const closeTo = (a: number[], b: number[], tolerance = 2) =>
  a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
});

test("Dracula via Settings themes the app, Excalidraw UI and (with sync) the canvas", async ({
  page,
}, info) => {
  const errors = trackErrors(page);
  const before = await readScene(page, DRAWING);
  const defaultBg = await rootVar(page, "--vault-bg");
  const defaultIsland = await islandBackground(page);
  const defaultPixel = await emptyCanvasPixel(page);

  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await expect(dialog.getByRole("radio", { name: "Dracula" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // App chrome tokens
  await expect.poll(() => rootVar(page, "--vault-bg")).not.toBe(defaultBg);
  const surfaceBg = await rootVar(page, "--vault-surface");
  const canvasColor = await rootVar(page, "--vault-canvas");
  expect(surfaceBg).toMatch(/^#/);

  // Excalidraw's islands follow the theme
  const [r, g, b] = hexToRgb(surfaceBg);
  await expect.poll(() => islandBackground(page)).toBe(`rgb(${r}, ${g}, ${b})`);
  expect(await islandBackground(page)).not.toBe(defaultIsland);

  // Sync off: canvas still renders standard colours
  expect(closeTo(await emptyCanvasPixel(page), defaultPixel)).toBe(true);

  // Sync on: empty canvas shows the theme surface
  await dialog.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  await expect(
    dialog
      .getByTestId("settings-canvas-background")
      .locator("input[type=color]"),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      closeTo(await emptyCanvasPixel(page), hexToRgb(canvasColor)),
    )
    .toBe(true);
  await screenshot(page, {
    path: `${SHOTS}/${info.project.name}-themes-dracula-sync.png`,
  });

  // Draw while synced: the file keeps standard colours.
  await page.keyboard.press("r");
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, {
    steps: 5,
  });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await expect
    .poll(async () => (await readScene(page, DRAWING)).elements.length)
    .toBe(before.elements.length + 1);
  const after = await readScene(page, DRAWING);
  expect(after.appState.viewBackgroundColor).toBe(
    before.appState.viewBackgroundColor,
  );
  for (const el of before.elements) {
    const saved = after.elements.find((e: any) => e.id === el.id);
    expect(saved.strokeColor).toBe(el.strokeColor);
    expect(saved.backgroundColor).toBe(el.backgroundColor);
  }
  const added = after.elements.find(
    (e: any) => !before.elements.some((o: any) => o.id === e.id),
  );
  expect(added.strokeColor).toBe("#1e1e1e");

  // Sync off again: normal rendering
  const dialog2 = await openSettings(page);
  await dialog2.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => closeTo(await emptyCanvasPixel(page), defaultPixel))
    .toBe(true);

  // Back to Default: stock look (no inline tokens)
  const dialog3 = await openSettings(page);
  await dialog3.getByRole("radio", { name: "Default" }).click();
  await expect.poll(() => rootVar(page, "--vault-bg")).toBe(defaultBg);
  await expect.poll(() => islandBackground(page)).toBe(defaultIsland);
  expect(errors).toEqual([]);
});

test("with sync on, a drawing with a dark custom background shows the theme canvas", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const darkBg = "#18191c";
  // A drawing whose stored background is not one of Excalidraw's canvas picks.
  await page.evaluate((bg) => {
    const repo = (window as any).__vaultRepo;
    repo.seedDrawing(
      "DSA/Dynamic Programming/01 Introduction.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: { viewBackgroundColor: bg },
        files: {},
      }),
    );
  }, darkBg);
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await openDrawing(page, "01 Introduction");
  await expect
    .poll(async () => closeTo(await emptyCanvasPixel(page), hexToRgb(darkBg)))
    .toBe(true);

  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await dialog.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  const canvasColor = await rootVar(page, "--vault-canvas");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      closeTo(await emptyCanvasPixel(page), hexToRgb(canvasColor)),
    )
    .toBe(true);
  // On screen only: the file keeps its own background.
  const saved = await readScene(
    page,
    "DSA/Dynamic Programming/01 Introduction.excalidraw",
  );
  expect(saved.appState.viewBackgroundColor).toBe(darkBg);
  expect(errors).toEqual([]);
});

test("Install from URL in Settings asks once, downloads the theme and applies it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const fixtureRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/e2e-themes/")) {
      fixtureRequests.push(r.url());
    }
  });
  const defaultBg = await rootVar(page, "--vault-bg");

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Install from URL..." }).click();
  const install = page.getByTestId("theme-install-dialog");
  await expect(install.getByTestId("theme-install-consent")).toBeVisible();
  expect(fixtureRequests).toEqual([]);
  await install.getByRole("button", { name: "Allow" }).click();

  await install
    .getByLabel("Address or GitHub repo")
    .fill(`${new URL(page.url()).origin}/e2e-themes/Midnight.json`);
  await install.getByRole("button", { name: "Look up" }).click();
  await expect(install.getByText("Midnight", { exact: true })).toBeVisible();
  await install.getByRole("button", { name: "Install", exact: true }).click();
  await expect(install.getByTestId("theme-install-done")).toContainText(
    "Midnight",
  );
  await install.getByRole("button", { name: "Use it" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.dataset.vaultTheme),
    )
    .toBe("Midnight");
  await expect.poll(() => rootVar(page, "--vault-bg")).not.toBe(defaultBg);
  await expect(
    settings.getByRole("radio", { name: "Midnight", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  expect(fixtureRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("Install more themes in Settings opens the browser, filters, installs and applies a theme", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const DAYBREAK = JSON.stringify({
    name: "Daybreak",
    author: "E2E",
    light: {
      mPrimary: "#d9480f",
      mOnPrimary: "#ffffff",
      mSurface: "#fff8f0",
      mOnSurface: "#2b2118",
    },
  });
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const index = JSON.stringify({
    schemaVersion: 1,
    themes: [
      {
        name: "Daybreak",
        path: "Daybreak/Daybreak.json",
        author: "E2E",
        description: "A warm light theme",
        tags: ["light", "warm"],
        modes: ["light"],
        swatch: { light: ["#fff8f0", "#2b2118", "#d9480f"] },
        sha256: sha(DAYBREAK),
        previews: [],
        credit: "E2E fixtures",
        licence: "MIT",
      },
      {
        name: "Midnight",
        path: "Midnight/Midnight.json",
        author: "E2E",
        description: "A cool dark theme",
        tags: ["dark", "cool"],
        modes: ["dark"],
        swatch: { dark: ["#101820", "#e8eef5", "#4aa3ff"] },
        sha256: sha(MIDNIGHT_THEME),
        previews: [],
      },
    ],
  });
  const files: Record<string, string> = {
    "/Vaultdraw/themes/main/index.json": index,
    "/Vaultdraw/themes/main/Daybreak/Daybreak.json": DAYBREAK,
    "/Vaultdraw/themes/main/Midnight/Midnight.json": MIDNIGHT_THEME,
  };
  const requested: string[] = [];
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    const body = files[path];
    await route.fulfill(
      body === undefined
        ? { status: 404, body: "not found" }
        : {
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body,
          },
    );
  });
  const defaultBg = await rootVar(page, "--vault-bg");

  const settings = await openSettings(page);
  // Install Themes sits right below the picker, above Themes Folder.
  const picker = settings.getByRole("radio", { name: "Dracula" });
  const installRow = settings.getByTestId("settings-install-theme");
  const pickerBox = await picker.boundingBox();
  const installBox = await installRow.boundingBox();
  const folders = settings.getByTestId("themes-folder");
  const foldersBox =
    (await folders.count()) > 0 ? await folders.boundingBox() : null;
  expect(installBox!.y).toBeGreaterThan(pickerBox!.y);
  if (foldersBox) {
    expect(installBox!.y).toBeLessThan(foldersBox.y);
  }
  await settings
    .getByRole("button", { name: "Install more themes..." })
    .click();
  const browser = page.getByTestId("theme-browser-dialog");
  await expect(browser.getByTestId("theme-browser-consent")).toBeVisible();
  expect(requested).toEqual([]);
  await browser.getByRole("button", { name: "Allow" }).click();

  await expect(browser.getByTestId("theme-browser-status")).toContainText(
    "2 of 2 themes",
  );
  const midnight = browser.getByTestId("theme-card-Midnight");
  const daybreak = browser.getByTestId("theme-card-Daybreak");
  await expect(midnight).toBeVisible();
  // The same mini-window preview as the built-in picker, from the palette.
  await expect(daybreak.locator(".vault-theme-card__half")).toHaveCount(2);
  await expect(daybreak).toContainText("Licence: MIT".replace("Licence: ", ""));
  await expect(daybreak.locator(".vault-tb__credit")).toHaveAttribute(
    "title",
    /Credit: E2E fixtures/,
  );

  await browser.getByLabel("Search themes").fill("cool");
  await expect(daybreak).toHaveCount(0);
  await expect(browser.getByTestId("theme-browser-status")).toContainText(
    "1 of 2 themes",
  );

  await midnight.getByRole("button", { name: "Install", exact: true }).click();
  await expect(browser.getByTestId("theme-browser-status")).toContainText(
    "Installed Midnight",
  );
  await expect(midnight).toContainText("Installed");
  await midnight.getByRole("button", { name: "Use", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.dataset.vaultTheme),
    )
    .toBe("Midnight");
  await expect.poll(() => rootVar(page, "--vault-bg")).not.toBe(defaultBg);
  expect(requested).toEqual([
    "/Vaultdraw/themes/main/index.json",
    "/Vaultdraw/themes/main/Midnight/Midnight.json",
  ]);
  expect(errors).toEqual([]);
});
