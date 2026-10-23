import { expect, type Page } from "@playwright/test";

import { openDrawing, openVault, reloadVault } from "./helpers";

/** Shared fixtures for the history panel, isolation and perf specs. */
export const PATH = "DSA/Graphs.excalidraw";

export type Rgb = [number, number, number];
export const RED: Rgb = [224, 49, 49];
export const BLUE: Rgb = [25, 113, 194];
export const GREEN: Rgb = [47, 158, 68];
export const ORANGE: Rgb = [247, 103, 7];
export const GRAPE: Rgb = [156, 54, 181];

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** A solid, opaque rectangle (exact fill colour, so pixels can be matched). */
export const rectEl = (
  id: string,
  x: number,
  y: number,
  color: Rgb | null,
  w = 140,
  h = 100,
  seed = 1,
) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: w,
  height: h,
  angle: 0,
  strokeColor: color ? hex(color) : "#1e1e1e",
  backgroundColor: color ? hex(color) : "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  seed,
  version: 1,
  versionNonce: 5000 + seed,
  index: null,
  updated: 1,
});

export const sceneJson = (elements: unknown[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements,
    appState: {},
    files: {},
  });

/** n small rectangles on a grid (bulk scenes for perf and thumbnails). */
export const gridScene = (n: number, color: Rgb | null = null) =>
  Array.from({ length: n }, (_, i) =>
    rectEl(
      `g${i}`,
      20 + (i % 50) * 30,
      20 + Math.floor(i / 50) * 24,
      color,
      24,
      18,
      i + 1,
    ),
  );

export interface SeedVersion {
  json: string;
  partial?: Record<string, unknown>;
}

/**
 * Opens the vault with `current` as the drawing's saved scene, then adds
 * `versions` (oldest first) to the fake history as if earlier runs wrote them.
 * `{ reload: true }` reloads the open page instead of navigating to it.
 */
export const setup = async (
  page: Page,
  current: unknown[],
  versions: SeedVersion[] = [],
  { reload = false }: { reload?: boolean } = {},
) => {
  // `reload`: the page is already open; reload it (never reload then goto).
  await (reload ? reloadVault(page) : openVault(page));
  await page.evaluate(
    ({ path, json }) => {
      (window as any).__vaultRepo.seedDrawing(path, json);
    },
    { path: PATH, json: sceneJson(current) },
  );
  const folder = page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first();
  await expect(folder).toBeVisible();
  // After a page reload the folder may still be expanded (persisted tree state).
  const drawing = page
    .locator(".vault-tree-item__name", { hasText: "Graphs" })
    .first();
  if (!(await drawing.isVisible())) {
    await folder.click();
  }
  await openDrawing(page, "Graphs");
  if (versions.length) {
    await seedVersions(page, versions);
  }
};

export const seedVersions = (page: Page, versions: SeedVersion[]) =>
  page.evaluate(
    ({ path, versions }) => {
      const repo = (window as any).__historyRepo;
      return versions.map(
        (v) => repo.inject(path, v.json, v.partial ?? {}).id as string,
      );
    },
    { path: PATH, versions },
  );

export const panel = (page: Page) =>
  page.getByRole("complementary", { name: "History" });
export const preview = (page: Page) => page.getByTestId("history-preview");
export const rows = (page: Page) => panel(page).getByRole("listitem");

export const openPanelByShortcut = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyH");
  await expect(panel(page)).toBeVisible();
};

export const runPaletteCommand = async (
  page: Page,
  title: string,
  query = title,
) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(`>${query}`);
  // Click the option itself: Enter would run whichever row is highlighted.
  const option = palette.getByRole("option").filter({ hasText: title }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(palette).toHaveCount(0);
};

/** Main-editor scene as last saved (live elements only). */
export const savedLive = (page: Page) =>
  page.evaluate(async (path) => {
    const repo = (window as any).__vaultRepo;
    const file = await repo.readDrawing(repo.handle, path);
    return (JSON.parse(file.json).elements as any[])
      .filter((e) => !e.isDeleted)
      .map((e) => e.id as string)
      .sort();
  }, PATH);

export const savedRaw = (page: Page) =>
  page.evaluate(async (path) => {
    const repo = (window as any).__vaultRepo;
    return (await repo.readDrawing(repo.handle, path)).json as string;
  }, PATH);

export const writeCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.writeCalls.length as number);

export const waitSaved = async (page: Page, before: number) =>
  expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);

/**
 * Pixels of `rgb` (tolerance 8) on the first static canvas inside `scope`:
 * the count and the client-space centroid of the matches.
 */
export const colorOn = (page: Page, scope: string, rgb: Rgb) =>
  page.evaluate(
    ({ scope, rgb }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `${scope} canvas.static`,
      );
      if (!canvas) {
        return { count: 0, x: 0, y: 0 };
      }
      const ctx = canvas.getContext("2d")!;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let count = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - rgb[0]) <= 8 &&
          Math.abs(data[i + 1] - rgb[1]) <= 8 &&
          Math.abs(data[i + 2] - rgb[2]) <= 8 &&
          data[i + 3] > 240
        ) {
          const p = i / 4;
          sx += p % width;
          sy += Math.floor(p / width);
          count++;
        }
      }
      const rect = canvas.getBoundingClientRect();
      const k = rect.width / width;
      return {
        count,
        x: count ? rect.left + (sx / count) * k : 0,
        y: count ? rect.top + (sy / count) * k : 0,
      };
    },
    { scope, rgb },
  );

export const MAIN = ".vault-editor";
export const PREVIEW = "[data-testid='history-preview']";

export const expectColor = (
  page: Page,
  scope: string,
  rgb: Rgb,
  present: boolean,
) =>
  expect
    .poll(async () => (await colorOn(page, scope, rgb)).count > 50, {
      timeout: 8000,
    })
    .toBe(present);

/** Wraps the fake's exportFile / restoreCopy so the ids passed are recorded. */
export const recordRepoCalls = (page: Page) =>
  page.evaluate(() => {
    const repo = (window as any).__historyRepo;
    const log: Array<{ method: string; id: string }> = [];
    (window as any).__historyCallLog = log;
    for (const method of ["exportFile", "restoreCopy"]) {
      const original = repo[method].bind(repo);
      repo[method] = (handle: string, id: string) => {
        log.push({ method, id });
        return original(handle, id);
      };
    }
  });

export const callLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as any).__historyCallLog as Array<{ method: string; id: string }>,
  );

/** Where keyboard focus is (class names), for failure diagnostics. */
export const focusInfo = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el
      ? `${`${el.tagName}.${el.className}`.slice(
          0,
          120,
        )} inPanel=${!!el.closest(".vault-history-panel")}` +
          ` inPreview=${!!el.closest("[data-testid='history-preview']")}`
      : "none";
  });

/** Diagnostic line for the lead's report (printed in the test output). */
export const diag = (message: string) =>
  // eslint-disable-next-line no-console
  console.log(`DIAG ${message}`);
