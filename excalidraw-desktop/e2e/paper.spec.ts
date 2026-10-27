import { expect, test, type Page } from "@playwright/test";

import { AFTER_AUTOSAVE_MS } from "./constants";
import {
  closeTopDialog,
  exportDialogButton,
  openDrawing,
  openExportDialogFromMenu,
  openVault,
  readScene,
  SHOTS,
  trackErrors,
} from "./helpers";

// F20 notebook backgrounds: settings, per-drawing override, pixel checks of
// every style on the static canvas, persistence, export and the snap grid.

const PREFS_KEY = "excalidraw-vault-preferences-v1";
const STYLES = ["grid", "lines", "dots", "graph", "isometric"] as const;
type Style = typeof STYLES[number];
const BLANK = "Blank.excalidraw";

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Pixel analysis (runs in the page, on the static canvas backing store).
// ---------------------------------------------------------------------------
type Analysis = {
  dpr: number;
  bg: number[];
  /** Per device row: min over the rect's columns of the diff from bg. */
  rows: number[];
  /** Per device column: min over the rect's rows. */
  cols: number[];
  /** Pixels differing from bg / pixels in the rect. */
  fraction: number;
  /** 8-connected blobs of non-bg pixels: centroids (device px). */
  blobs: { x: number; y: number; n: number }[];
  /** Mean luminance of non-bg pixels minus bg luminance (sign = lighter/darker). */
  lumDelta: number;
};

const analyse = (
  page: Page,
  rect = { x: 0.35, y: 0.2, w: 0.5, h: 0.6 },
  selector = ".vault-editor canvas.static",
): Promise<Analysis> =>
  page.evaluate(
    ([r, sel]) => {
      const c = document.querySelector<HTMLCanvasElement>(sel as string)!;
      const ctx = c.getContext("2d")!;
      const rc = r as { x: number; y: number; w: number; h: number };
      const x0 = Math.floor(c.width * rc.x);
      const y0 = Math.floor(c.height * rc.y);
      const w = Math.floor(c.width * rc.w);
      const h = Math.floor(c.height * rc.h);
      const d = ctx.getImageData(x0, y0, w, h).data;
      const counts = new Map<number, number>();
      for (let i = 0; i < d.length; i += 4) {
        const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let bgKey = 0;
      let best = -1;
      counts.forEach((n, k) => {
        if (n > best) {
          best = n;
          bgKey = k;
        }
      });
      const bg = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];
      const diff = new Uint8Array(w * h);
      let nonBg = 0;
      let lumSum = 0;
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const v = Math.max(
          Math.abs(d[i] - bg[0]),
          Math.abs(d[i + 1] - bg[1]),
          Math.abs(d[i + 2] - bg[2]),
        );
        diff[p] = v;
        if (v > 0) {
          nonBg++;
          lumSum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
      }
      const rows: number[] = [];
      for (let y = 0; y < h; y++) {
        let m = 255;
        for (let x = 0; x < w && m > 0; x++) {
          m = Math.min(m, diff[y * w + x]);
        }
        rows.push(m);
      }
      const cols: number[] = [];
      for (let x = 0; x < w; x++) {
        let m = 255;
        for (let y = 0; y < h && m > 0; y++) {
          m = Math.min(m, diff[y * w + x]);
        }
        cols.push(m);
      }
      // Blobs (only worth computing for sparse patterns).
      const blobs: { x: number; y: number; n: number }[] = [];
      if (nonBg / (w * h) < 0.2) {
        const seen = new Uint8Array(w * h);
        for (let p = 0; p < w * h; p++) {
          if (!diff[p] || seen[p]) {
            continue;
          }
          const stack = [p];
          seen[p] = 1;
          let sx = 0;
          let sy = 0;
          let n = 0;
          while (stack.length) {
            const q = stack.pop()!;
            const qx = q % w;
            const qy = (q / w) | 0;
            sx += qx;
            sy += qy;
            n++;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = qx + dx;
                const ny = qy + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                  continue;
                }
                const np = ny * w + nx;
                if (diff[np] && !seen[np]) {
                  seen[np] = 1;
                  stack.push(np);
                }
              }
            }
          }
          blobs.push({ x: sx / n, y: sy / n, n });
        }
      }
      const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
      return {
        dpr: c.width / c.clientWidth,
        bg,
        rows,
        cols,
        fraction: nonBg / (w * h),
        blobs,
        lumDelta: nonBg ? lumSum / nonBg - bgLum : 0,
      };
    },
    [rect, selector] as const,
  );

/** Centres of runs where profile > thr. */
const centres = (profile: number[], thr = 2) => {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > thr;
    if (on && start < 0) {
      start = i;
    } else if (!on && start >= 0) {
      out.push((start + i - 1) / 2);
      start = -1;
    }
  }
  return out;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

const gaps = (xs: number[]) => xs.slice(1).map((v, i) => v - xs[i]);
/** Median distance between consecutive centres. */
const period = (profile: number[], thr = 2) =>
  median(gaps(centres(profile, thr)));

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

const seedBlank = (page: Page, name = BLANK, appState: object = {}) =>
  page.evaluate(
    ([n, a]) => {
      const repo = (window as any).__vaultRepo;
      repo.seedDrawing(
        n,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: [],
          appState: { viewBackgroundColor: "#ffffff", ...(a as object) },
          files: {},
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [name, appState] as const,
  );

const openBlank = async (page: Page, appState: object = {}) => {
  await seedBlank(page, BLANK, appState);
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "Blank" }),
  ).toBeVisible();
  await openDrawing(page, "Blank");
  await page.waitForTimeout(300);
};

const expandDSA = async (page: Page) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", { hasText: /^DSA$/ }),
    })
    .first();
  const toggle = row.locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};

const openMenu = async (page: Page) => {
  if (!(await page.locator(".paper-menu").isVisible())) {
    await page.getByTestId("main-menu-trigger").click();
  }
  await expect(page.locator(".paper-menu")).toBeVisible();
};

const closeMenu = async (page: Page) => {
  if (await page.locator(".paper-menu").isVisible()) {
    await page.getByTestId("main-menu-trigger").click();
    await expect(page.locator(".paper-menu")).toHaveCount(0);
  }
};

/** Pick a style (or "plain") in the canvas menu's Paper row. */
const pickPaper = async (page: Page, style: Style | "plain") => {
  await openMenu(page);
  await page
    .locator(`.paper-menu label.paper-style[title="${label(style)}"]`)
    .click();
  await closeMenu(page);
  await page.waitForTimeout(150);
};

const openPaperDialog = async (page: Page) => {
  await openMenu(page);
  await page.getByRole("button", { name: "Paper settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Paper settings" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const storedPrefs = (page: Page) =>
  page.evaluate(
    (k) => JSON.parse(window.localStorage.getItem(k) ?? "{}"),
    PREFS_KEY,
  );

const savedPattern = async (page: Page, path = BLANK) =>
  (await readScene(page, path)).appState.viewBackgroundPattern ?? null;

const waitSaved = (page: Page, path: string, type: string | null) =>
  expect
    .poll(async () => (await savedPattern(page, path))?.type ?? null, {
      timeout: 8000,
    })
    .toBe(type);

const shot = (page: Page, style: string, theme: string) =>
  page.screenshot({ path: `${SHOTS}/paper-${style}-${theme}.png` });

/** The expected on-screen period of pattern lines/dots in device px. */
const devicePeriod = (spacing: number, a: Analysis, zoom = 1) =>
  spacing * zoom * a.dpr;

/** Asserts the style's signature on a fresh analysis (zoom 1, default scroll). */
const expectStyle = (style: Style | "plain", a: Analysis, spacing?: number) => {
  const tol = 1.5;
  switch (style) {
    case "plain": {
      expect(a.fraction).toBe(0);
      break;
    }
    case "lines": {
      // Horizontal rules only (the rect avoids the margin line).
      expect(centres(a.cols).length).toBe(0);
      expect(
        Math.abs(period(a.rows) - devicePeriod(spacing ?? 32, a)),
      ).toBeLessThan(tol);
      break;
    }
    case "grid": {
      const p = devicePeriod(spacing ?? 20, a);
      expect(Math.abs(period(a.rows) - p)).toBeLessThan(tol);
      expect(Math.abs(period(a.cols) - p)).toBeLessThan(tol);
      break;
    }
    case "graph": {
      // Minor lines every 16 px at full strength; majors every 5.
      const rows = centres(a.rows, 0);
      expect(rows.length).toBeGreaterThan(5);
      expect(
        Math.abs(period(a.rows, 0) - devicePeriod(spacing ?? 16, a)),
      ).toBeLessThan(tol);
      expect(
        Math.abs(period(a.cols, 0) - devicePeriod(spacing ?? 16, a)),
      ).toBeLessThan(tol);
      break;
    }
    case "dots": {
      // Isolated pixels on a lattice: no full lines, small ink share.
      expect(centres(a.rows).length).toBe(0);
      expect(centres(a.cols).length).toBe(0);
      expect(a.blobs.length).toBeGreaterThan(30);
      expect(a.fraction).toBeLessThan(0.05);
      const xs = [...new Set(a.blobs.map((b) => Math.round(b.x)))].sort(
        (p, q) => p - q,
      );
      const clustered = centres(
        Array.from({ length: Math.max(...xs) + 1 }, (_, i) =>
          xs.some((x) => Math.abs(x - i) <= 1) ? 10 : 0,
        ),
        0,
      );
      expect(
        Math.abs(median(gaps(clustered)) - devicePeriod(spacing ?? 20, a)),
      ).toBeLessThan(tol);
      break;
    }
    case "isometric": {
      expect(centres(a.rows).length).toBe(0);
      expect(centres(a.cols).length).toBe(0);
      expect(a.blobs.length).toBeGreaterThan(30);
      expect(a.fraction).toBeLessThan(0.05);
      // Staggered rows: some neighbouring rows are offset by half a gap.
      const ys = [...new Set(a.blobs.map((b) => Math.round(b.y / 2)))];
      expect(ys.length).toBeGreaterThan(3);
      break;
    }
  }
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
});

// ---------------------------------------------------------------------------
// Settings > Appearance > Background Pattern
// ---------------------------------------------------------------------------
test("Settings: every style shows a live preview and its own tuning controls", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const dialog = await openSettings(page);
  const row = dialog.locator('[data-setting-id="paper"]');
  await expect(row).toBeVisible();

  // Plain: no preview, no tuning.
  await row.getByRole("button", { name: "Plain", exact: true }).click();
  await expect(row.locator("canvas.paper-preview")).toHaveCount(0);
  await expect(row.getByLabel("Spacing", { exact: true })).toHaveCount(0);

  for (const style of STYLES) {
    await row.getByRole("button", { name: label(style), exact: true }).click();
    const preview = row.locator("canvas.paper-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute(
      "aria-label",
      `Paper preview: ${style}`,
    );
    await page.waitForTimeout(100);
    const a = await analyse(
      page,
      { x: 0, y: 0, w: 1, h: 1 },
      "canvas.paper-preview",
    );
    expect(a.fraction, `${style} preview ink`).toBeGreaterThan(0.001);

    await expect(row.getByLabel("Spacing", { exact: true })).toBeVisible();
    await expect(row.getByLabel("Opacity", { exact: true })).toBeVisible();
    const major = row.getByLabel("Major line every", { exact: true });
    const margin = row.getByLabel("Margin line");
    await expect(major).toHaveCount(
      style === "grid" || style === "graph" ? 1 : 0,
    );
    await expect(margin).toHaveCount(style === "lines" ? 1 : 0);
  }

  // Back to plain: preview is blank again (control disappears).
  await row.getByRole("button", { name: "Plain", exact: true }).click();
  await expect(row.locator("canvas.paper-preview")).toHaveCount(0);
  expect((await storedPrefs(page)).paperStyle).toBe("plain");
  expect(errors).toEqual([]);
});

test("Settings: the preview follows spacing changes", async ({ page }) => {
  const errors = trackErrors(page);
  const dialog = await openSettings(page);
  const row = dialog.locator('[data-setting-id="paper"]');
  await row.getByRole("button", { name: "Grid", exact: true }).click();
  await row.locator("canvas.paper-preview").waitFor();
  const r = { x: 0, y: 0, w: 1, h: 1 };
  const before = await analyse(page, r, "canvas.paper-preview");
  await row.getByLabel("Spacing", { exact: true }).fill("40");
  await expect
    .poll(async () => {
      const a = await analyse(page, r, "canvas.paper-preview");
      return Math.round(period(a.cols) / a.dpr);
    })
    .toBe(40);
  expect(Math.round(period(before.cols) / before.dpr)).toBe(20);
  expect((await storedPrefs(page)).paperSpacing).toBe(40);
  expect(errors).toEqual([]);
});

test("a new drawing gets the chosen default stamped into its file", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const dialog = await openSettings(page);
  const row = dialog.locator('[data-setting-id="paper"]');
  await row.getByRole("button", { name: "Graph", exact: true }).click();
  await row.getByLabel("Major line every", { exact: true }).fill("4");
  // Enter commits the field; Escape inside a field only reverts it.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "New Drawing" })
    .first()
    .click();
  const nd = page.getByRole("dialog");
  await nd.getByLabel("Name").fill("Fresh");
  await nd.getByRole("button", { name: "Create" }).click();
  await expect(nd).toHaveCount(0);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(500);

  const pattern = await savedPattern(page, "Fresh.excalidraw");
  expect(pattern.type).toBe("graph");
  expect(pattern.majorEvery).toBe(4);
  // ...and it is on screen
  const a = await analyse(page);
  expect(a.fraction).toBeGreaterThan(0.001);
  expect(errors).toEqual([]);
});

test("a new drawing stays plain when the default is plain", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "New Drawing" })
    .first()
    .click();
  const nd = page.getByRole("dialog");
  await nd.getByLabel("Name").fill("Plainer");
  await nd.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await savedPattern(page, "Plainer.excalidraw")).toBeNull();
  expect((await analyse(page)).fraction).toBe(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Per-drawing override + pixel checks
// ---------------------------------------------------------------------------
test("canvas menu: each style renders its pattern on the static canvas (light)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBlank(page);
  expectStyle("plain", await analyse(page));
  await shot(page, "plain", "light");

  for (const style of STYLES) {
    await pickPaper(page, style);
    // Lines need a rect right of the margin line; the default rect does that.
    const a = await analyse(page);
    expectStyle(style, a);
    // light mode: ink is darker than the white page
    expect(a.lumDelta, `${style} ink vs bg`).toBeLessThan(0);
    await shot(page, style, "light");
    await waitSaved(page, BLANK, style);
  }
  await pickPaper(page, "plain");
  expectStyle("plain", await analyse(page));
  await waitSaved(page, BLANK, null);
  expect(errors).toEqual([]);
});

test("canvas menu: each style renders in dark mode with light-on-dark ink", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const settings = await openSettings(page);
  await settings
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await openBlank(page);
  const plain = await analyse(page);
  expect(plain.fraction).toBe(0);
  // Dark page: well below mid grey.
  expect(plain.bg[0]).toBeLessThan(80);
  await shot(page, "plain", "dark");

  for (const style of STYLES) {
    await pickPaper(page, style);
    const a = await analyse(page);
    expect(a.bg[0]).toBeLessThan(80);
    expectStyle(style, a);
    expect(a.lumDelta, `${style} ink vs bg (dark)`).toBeGreaterThan(0);
    await shot(page, style, "dark");
  }
  expect(errors).toEqual([]);
});

test("zooming scales the pattern period; the snap grid replaces the pattern", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBlank(page);
  await pickPaper(page, "lines");
  const base = await analyse(page);
  expectStyle("lines", base);
  const baseCentres = centres(base.cols).length;
  expect(baseCentres).toBe(0);

  // Snap grid (Cmd/Ctrl + ') draws its own grid instead of the pattern.
  const box = (await page
    .locator(".vault-editor canvas.interactive")
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Meta+'");
  // Minor snap lines are dashed, so only the solid major lines (every
  // gridSize 20 x gridStep 5 = 100 px) span the whole rect.
  await expect
    .poll(async () => centres((await analyse(page)).cols, 1).length)
    .toBeGreaterThanOrEqual(4);
  const grid = await analyse(page);
  expect(Math.abs(period(grid.cols, 1) - 100 * grid.dpr)).toBeLessThan(1.5);
  await shot(page, "snapgrid", "light");

  await page.keyboard.press("Meta+'");
  await expect
    .poll(async () => centres((await analyse(page)).cols, 1).length)
    .toBe(0);
  expectStyle("lines", await analyse(page));

  // Zoom in: ctrl+wheel
  await page.keyboard.down("Meta");
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("Meta");
  await page.waitForTimeout(400);
  const zoomed = await analyse(page);
  const ratio = period(zoomed.rows) / period(base.rows);
  expect(ratio).toBeGreaterThan(1.2);
  // Line width stays one device-snapped pixel: still thin stripes
  expect(zoomed.fraction).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});

test("a custom spacing in the file draws at that spacing", async ({ page }) => {
  const errors = trackErrors(page);
  await openBlank(page, {
    viewBackgroundPattern: {
      type: "grid",
      spacing: 50,
      color: null,
      opacity: 1,
      majorEvery: 1,
      marginLine: false,
    },
  });
  const a = await analyse(page);
  expectStyle("grid", a, 50);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
test("the pattern autosaves and is still rendered after switching drawings", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBlank(page);
  await pickPaper(page, "dots");
  await page.waitForTimeout(AFTER_AUTOSAVE_MS);
  await waitSaved(page, BLANK, "dots");
  expect((await savedPattern(page)).spacing).toBe(20);

  // Another blank drawing without a pattern: nothing behind it.
  await seedBlank(page, "Other.excalidraw");
  await openDrawing(page, "Other");
  await page.waitForTimeout(300);
  expect((await analyse(page)).fraction).toBe(0);
  await openDrawing(page, "Blank");
  await page.waitForTimeout(300);
  expectStyle("dots", await analyse(page));
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Paper settings dialog
// ---------------------------------------------------------------------------
test("Paper settings dialog: spacing, app default round trip, Escape closes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openBlank(page);
  await pickPaper(page, "lines");
  expectStyle("lines", await analyse(page));

  const dialog = await openPaperDialog(page);
  await expect(dialog.locator("canvas.paper-preview")).toBeVisible();
  await dialog.getByLabel("Spacing", { exact: true }).fill("48");
  await expect
    .poll(async () => {
      const a = await analyse(page);
      return Math.round(period(a.rows) / a.dpr);
    })
    .toBe(48);
  await waitSaved(page, BLANK, "lines");
  await expect.poll(async () => (await savedPattern(page)).spacing).toBe(48);

  // Make app default -> prefs
  await dialog.getByRole("button", { name: "Make app default" }).click();
  await expect
    .poll(async () => (await storedPrefs(page)).paperStyle)
    .toBe("lines");
  expect((await storedPrefs(page)).paperSpacing).toBe(48);

  // Diverge, then "Use app default" snaps back.
  await dialog.locator('label.paper-style[title="Dots"]').click();
  await expect.poll(async () => (await savedPattern(page))?.type).toBe("dots");
  await dialog.getByRole("button", { name: "Use app default" }).click();
  await expect.poll(async () => (await savedPattern(page))?.type).toBe("lines");
  expect((await savedPattern(page)).spacing).toBe(48);

  // Escape closes the dialog but not the app.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const decodeExports = (page: Page) =>
  page.evaluate(async () => {
    const files = (window as any).__vaultRepo.exported as Array<{
      name: string;
      bytes: Uint8Array;
    }>;
    const out: any[] = [];
    for (const f of files) {
      if (f.name.endsWith(".svg")) {
        out.push({
          name: f.name,
          svg: new TextDecoder().decode(f.bytes),
        });
        continue;
      }
      const bitmap = await createImageBitmap(
        new Blob([f.bytes as BlobPart], { type: "image/png" }),
      );
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonWhite = 0;
      let h = 2166136261;
      const colours = new Map<number, number>();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) {
          nonWhite++;
        }
        const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        colours.set(k, (colours.get(k) ?? 0) + 1);
        h = Math.imul(h ^ k, 16777619);
      }
      out.push({
        name: f.name,
        w: c.width,
        h: c.height,
        nonWhite,
        hash: h >>> 0,
        distinct: colours.size,
      });
    }
    return out;
  });

const clearExports = (page: Page) =>
  page.evaluate(() => {
    (window as any).__vaultRepo.exported.length = 0;
  });

const exportNow = async (page: Page, kind: "PNG" | "SVG") => {
  const before = (await page.evaluate(
    () => (window as any).__vaultRepo.exported.length,
  )) as number;
  await exportDialogButton(page, kind).click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__vaultRepo.exported.length),
      { timeout: 15000 },
    )
    .toBe(before + 1);
};

test("export: pattern switch visibility, PNG on/off differs, SVG has <pattern>", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandDSA(page);
  await openDrawing(page, "Graphs");

  // No pattern: no switch.
  await openExportDialogFromMenu(page);
  await expect(
    page.locator(
      '.ImageExportModal input[name="exportBackgroundPatternSwitch"]',
    ),
  ).toHaveCount(0);
  await closeTopDialog(page);

  await pickPaper(page, "grid");
  await openExportDialogFromMenu(page);
  const sw = page.locator(
    '.ImageExportModal input[name="exportBackgroundPatternSwitch"]',
  );
  await expect(sw).toHaveCount(1);
  await expect(sw).toBeChecked();
  await expect(sw).toBeEnabled();

  // Background off disables the switch.
  const bg = page.locator(
    '.ImageExportModal input[name="exportBackgroundSwitch"]',
  );
  await bg.uncheck();
  await expect(sw).toBeDisabled();
  await bg.check();
  await expect(sw).toBeEnabled();

  // On
  await clearExports(page);
  await exportNow(page, "PNG");
  await exportNow(page, "SVG");
  // Off
  await sw.uncheck();
  await exportNow(page, "PNG");
  await exportNow(page, "SVG");

  const [pngOn, svgOn, pngOff, svgOff] = await decodeExports(page);
  expect(pngOn.w).toBe(pngOff.w);
  expect(pngOn.nonWhite).toBeGreaterThan(pngOff.nonWhite + 500);
  expect(pngOn.hash).not.toBe(pngOff.hash);
  expect(svgOn.svg).toContain("<pattern");
  expect(svgOff.svg).not.toContain("<pattern");
  expect(errors).toEqual([]);
});

test("export: with Sync canvas with theme on, pattern colours are the standard ones", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await expandDSA(page);
  await openDrawing(page, "Graphs");
  await pickPaper(page, "lines");

  await clearExports(page);
  await openExportDialogFromMenu(page);
  await exportNow(page, "PNG");
  await closeTopDialog(page);

  const settings = await openSettings(page);
  await settings.getByRole("radio", { name: "Dracula" }).click();
  await settings
    .getByRole("switch", { name: /Sync canvas with theme/ })
    .click();
  // Close with the button (the flow under test is the export, not Escape), and
  // wait for the closed state and the themed canvas instead of a clock.
  await settings.getByRole("button", { name: "Close Settings" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The screen now shows themed colours: the canvas differs from standard...
  await expect
    .poll(
      async () =>
        (
          await analyse(page, { x: 0.35, y: 0.7, w: 0.5, h: 0.25 })
        ).bg,
      { timeout: 8000 },
    )
    .not.toEqual([255, 255, 255]);

  await openExportDialogFromMenu(page);
  await exportNow(page, "PNG");
  const [plain, withSync] = await decodeExports(page);
  expect(withSync.hash).toBe(plain.hash);
  expect(withSync.distinct).toBe(plain.distinct);
  expect(errors).toEqual([]);
});
