import { mkdirSync, writeFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { IMAGE_SCENE } from "../src/tests/fixtures";

import { test } from "./fixture";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";

const GRAPHS = "DSA/Graphs.excalidraw";
const INTRO = "DSA/Dynamic Programming/01 Introduction.excalidraw";

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const exportedCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.exported.length as number);

/** Picks a row menu item (right-click or the ⋮ button) and waits for the file. */
const exportFromRow = async (
  page: Page,
  path: string,
  label: string,
  via: "context" | "button" = "context",
) => {
  const before = await exportedCount(page);
  if (via === "context") {
    await row(page, path).click({ button: "right" });
  } else {
    await row(page, path).hover();
    await row(page, path).getByRole("button", { name: "More actions" }).click();
  }
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: label }).click();
  await expect
    .poll(() => exportedCount(page), { timeout: 20000 })
    .toBe(before + 1);
  return page.evaluate(() => {
    const files = (window as any).__vaultRepo.exported;
    const last = files[files.length - 1];
    return {
      name: last.name as string,
      bytes: Array.from(last.bytes as Uint8Array) as number[],
    };
  });
};

const text = (bytes: number[]) => Buffer.from(bytes).toString("utf8");

/** Decodes a PNG in the page: width/height or throws. */
const pngSize = (page: Page, bytes: number[]) =>
  page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(data)], { type: "image/png" }),
    );
    return { w: bitmap.width, h: bitmap.height };
  }, bytes);

const isValidSvg = (page: Page, svg: string) =>
  page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return (
      doc.documentElement.nodeName === "svg" &&
      doc.getElementsByTagName("parsererror").length === 0
    );
  }, svg);

const svgColours = (svg: string) =>
  [...new Set(svg.toLowerCase().match(/#[0-9a-f]{6}\b/g) ?? [])].sort();

const openSettings = async (page: Page) => {
  await page
    .getByLabel("Vault File Navigator")
    .getByRole("button", { name: "Settings" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

/** A large generated drawing: `n` labelled rectangles in a grid. */
const largeScene = (n: number) => {
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#a5d8ff",
    fillStyle: "hachure",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    link: null,
    locked: false,
    isDeleted: false,
  };
  const elements: unknown[] = [];
  for (let i = 0; i < n / 2; i += 1) {
    const x = (i % 32) * 110;
    const y = Math.floor(i / 32) * 60;
    elements.push(
      { ...base, id: `r${i}`, type: "rectangle", x, y, width: 100, height: 50 },
      {
        ...base,
        id: `t${i}`,
        type: "text",
        x: x + 10,
        y: y + 15,
        width: 80,
        height: 20,
        text: `Node ${i}`,
        originalText: `Node ${i}`,
        fontSize: 16,
        fontFamily: 5,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        lineHeight: 1.25,
        backgroundColor: "transparent",
      },
    );
  }
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-explorer-export",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
};

/** Adds a drawing at the vault root and waits for its row. */
const addDrawing = async (page: Page, path: string, json: string) => {
  await page.evaluate(
    ({ p, j }) => (window as any).__vaultRepo.externalWrite(p, j),
    { p: path, j: json },
  );
  await expect(row(page, path)).toBeVisible({ timeout: 15000 });
};

test.beforeEach(async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await page
    .locator(".vault-tree-item__name", { hasText: "Dynamic Programming" })
    .first()
    .click();
  await expect(row(page, INTRO)).toBeVisible();
});

test("1. drawing rows offer export in the context menu and the ⋮ menu; folders don't", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const labels = ["Export as PNG…", "Export as SVG…", "Save a copy…"];
  await row(page, GRAPHS).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  for (const label of labels) {
    await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await row(page, GRAPHS).hover();
  await row(page, GRAPHS).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  for (const label of labels) {
    await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await row(page, "DSA").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export as PNG…" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("2. PNG and SVG from the navigator are valid files", async ({ page }) => {
  const errors = trackErrors(page);
  const png = await exportFromRow(page, INTRO, "Export as PNG…");
  expect(png.name).toBe("01 Introduction.png");
  expect(png.bytes.slice(0, 4)).toEqual([137, 80, 78, 71]);
  const size = await pngSize(page, png.bytes);
  expect(size.w).toBeGreaterThan(10);
  expect(size.h).toBeGreaterThan(10);

  const svg = await exportFromRow(page, INTRO, "Export as SVG…", "button");
  expect(svg.name).toBe("01 Introduction.svg");
  expect(await isValidSvg(page, text(svg.bytes))).toBe(true);
  expect(errors).toEqual([]);
});

test("3. Save a copy writes the original bytes unchanged", async ({ page }) => {
  const errors = trackErrors(page);
  const original = await page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    return (await repo.readDrawing(repo.handle, p)).json as string;
  }, INTRO);
  const copy = await exportFromRow(page, INTRO, "Save a copy…");
  expect(copy.name).toBe("01 Introduction.excalidraw");
  expect(Buffer.from(copy.bytes).equals(Buffer.from(original, "utf8"))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test("4. exporting does not disturb the open drawing", async ({ page }) => {
  const errors = trackErrors(page);
  const before = await readScene(page, GRAPHS);
  // Another drawing and the open one itself.
  await exportFromRow(page, INTRO, "Export as PNG…");
  await exportFromRow(page, GRAPHS, "Export as SVG…");
  await exportFromRow(page, GRAPHS, "Save a copy…");
  await expect(row(page, GRAPHS)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, INTRO)).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".ImageExportModal")).toHaveCount(0);
  expect(await readScene(page, GRAPHS)).toEqual(before);
  await expect(page.locator(".vault-editor canvas.interactive")).toBeVisible();
  expect(errors).toEqual([]);
});

test("5. exports use standard colours even with canvas sync on", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Dracula" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const plain = text(
    (await exportFromRow(page, GRAPHS, "Export as SVG…")).bytes,
  );

  const dialog2 = await openSettings(page);
  await dialog2.getByRole("switch", { name: /Sync canvas with theme/ }).click();
  const themeCanvas = (
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--vault-canvas")
        .trim(),
    )
  ).toLowerCase();
  await page.keyboard.press("Escape");
  await expect(dialog2).toHaveCount(0);
  const synced = text(
    (await exportFromRow(page, GRAPHS, "Export as SVG…")).bytes,
  );

  expect(svgColours(synced)).toEqual(svgColours(plain));
  expect(svgColours(synced)).not.toContain(themeCanvas);
  expect(errors).toEqual([]);
});

test("6. drawings with embedded images export with the image", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await addDrawing(page, "Photo.excalidraw", IMAGE_SCENE);
  const svg = text(
    (await exportFromRow(page, "Photo.excalidraw", "Export as SVG…")).bytes,
  );
  expect(svg).toContain("data:image/png");
  const png = await exportFromRow(page, "Photo.excalidraw", "Export as PNG…");
  expect(png.bytes.slice(0, 4)).toEqual([137, 80, 78, 71]);
  expect(errors).toEqual([]);
});

test("8. the paper pattern is exported, following the remembered option", async ({
  page,
}) => {
  const errors = trackErrors(page);
  const scene = JSON.parse(IMAGE_SCENE);
  scene.files = {};
  scene.elements = scene.elements.filter((e: any) => e.type !== "image");
  scene.elements.push({
    id: "paper-rect",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    roundness: null,
    link: null,
    locked: false,
    isDeleted: false,
  });
  scene.appState = {
    viewBackgroundColor: "#ffffff",
    viewBackgroundPattern: {
      type: "grid",
      spacing: 20,
      color: null,
      opacity: 1,
      majorEvery: 5,
    },
  };
  await addDrawing(page, "Paper.excalidraw", JSON.stringify(scene));
  const setOptions = (pattern: boolean) =>
    page.evaluate(
      (p) =>
        (window as any).__updatePreferences({
          exportOptions: {
            scale: 1,
            background: true,
            embedScene: false,
            pattern: p,
          },
        }),
      pattern,
    );
  await setOptions(true);
  const withPattern = text(
    (await exportFromRow(page, "Paper.excalidraw", "Export as SVG…")).bytes,
  );
  expect(withPattern).toContain("<pattern");
  await setOptions(false);
  const plain = text(
    (await exportFromRow(page, "Paper.excalidraw", "Export as SVG…")).bytes,
  );
  expect(plain).not.toContain("<pattern");
  expect(errors).toEqual([]);
});

test("7. perf: large drawing export time and longest main-thread gap", async ({
  page,
  browserName,
}, info) => {
  const errors = trackErrors(page);
  await addDrawing(page, "Large.excalidraw", largeScene(2000));
  const rates = browserName === "chromium" ? [1, 6] : [1];
  const cdp =
    browserName === "chromium"
      ? await page.context().newCDPSession(page)
      : null;
  const results: Record<string, unknown> = {};
  for (const rate of rates) {
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
    for (const [label, key] of [
      ["Export as PNG…", "png"],
      ["Export as SVG…", "svg"],
    ] as const) {
      await page.evaluate(() => {
        const w = window as any;
        const repo = w.__vaultRepo;
        w.__perf = { clicked: 0, saved: 0, maxGap: 0 };
        let last = performance.now();
        const beat = () => {
          const now = performance.now();
          w.__perf.maxGap = Math.max(w.__perf.maxGap, now - last);
          last = now;
          if (!w.__perf.saved) {
            setTimeout(beat, 0);
          }
        };
        document.addEventListener(
          "click",
          () => {
            w.__perf.clicked = performance.now();
            last = w.__perf.clicked;
            setTimeout(beat, 0);
          },
          { capture: true, once: true },
        );
        if (!repo.__origExport) {
          repo.__origExport = repo.exportFile.bind(repo);
          repo.exportFile = (name: string, bytes: Uint8Array) => {
            w.__perf.saved = performance.now();
            return repo.__origExport(name, bytes);
          };
        }
      });
      // Right-click fires contextmenu, not click: the timer starts at the
      // menu item click.
      await row(page, "Large.excalidraw").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Export", exact: true }).click();
      await page.getByRole("menuitem", { name: label }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).__perf.saved), {
          timeout: 60000,
        })
        .toBeGreaterThan(0);
      const m = await page.evaluate(() => (window as any).__perf);
      results[`${key}@${rate}x`] = {
        totalMs: Math.round(m.saved - m.clicked),
        maxGapMs: Math.round(m.maxGap),
      };
    }
  }
  await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  info.annotations.push({
    type: "perf",
    description: JSON.stringify(results),
  });
  mkdirSync("../.cache", { recursive: true });
  writeFileSync(
    `../.cache/explorer-export-perf-${browserName}.json`,
    JSON.stringify(results, null, 2),
  );
  expect(errors).toEqual([]);
});
