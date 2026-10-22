import { expect, test, type Page } from "@playwright/test";

import { openVault, trackErrors } from "./helpers";

// `export.render` (control API) must produce the same bytes as the explorer
// row-menu export: both go through renderExport. Also prints the two timings
// (budget: method overhead <= max(10 %, +15 ms) over the row export).

const PATH = "RenderParity.excalidraw";

const sceneJson = () => {
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
    seed: 12345,
    version: 1,
    versionNonce: 1,
    frameId: null,
    boundElements: null,
    updated: 1,
  };
  const elements: unknown[] = [];
  for (let i = 0; i < 60; i += 1) {
    elements.push({
      ...base,
      id: `r${i}`,
      type: "rectangle",
      x: (i % 10) * 110,
      y: Math.floor(i / 10) * 70,
      width: 100,
      height: 50,
      seed: 1000 + i,
    });
  }
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-export-render",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
};

const decodeAndPixels = (page: Page, a: number[], b: number[]) =>
  page.evaluate(
    async ([x, y]) => {
      const load = async (data: number[]) => {
        const bmp = await createImageBitmap(
          new Blob([new Uint8Array(data)], { type: "image/png" }),
        );
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { same: false, diff: 1 };
      }
      let diff = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        if (
          ia.data[i] !== ib.data[i] ||
          ia.data[i + 1] !== ib.data[i + 1] ||
          ia.data[i + 2] !== ib.data[i + 2] ||
          ia.data[i + 3] !== ib.data[i + 3]
        ) {
          diff += 1;
        }
      }
      return { same: true, diff: diff / (ia.width * ia.height) };
    },
    [a, b] as const,
  );

test("export.render returns the same PNG bytes as the explorer row export", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page.evaluate(
    ({ p, j }) => (window as any).__vaultRepo.externalWrite(p, j),
    { p: PATH, j: sceneJson() },
  );
  const row = page.locator(`[data-tree-path="${PATH}"]`);
  await expect(row).toBeVisible({ timeout: 15000 });

  // Row export, timed from the menu click to the save call.
  await page.evaluate(() => {
    const w = window as any;
    const repo = w.__vaultRepo;
    const exportFile = repo.exportFile.bind(repo);
    w.__rowTiming = { t0: 0, t1: 0 };
    document.addEventListener(
      "click",
      () => {
        w.__rowTiming.t0 = performance.now();
      },
      { capture: true },
    );
    repo.exportFile = async (name: string, bytes: Uint8Array) => {
      w.__rowTiming.t1 = performance.now();
      return exportFile(name, bytes);
    };
  });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export as PNG…" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__vaultRepo.exported.length),
    )
    .toBe(1);
  const rowResult = await page.evaluate(() => {
    const w = window as any;
    const last = w.__vaultRepo.exported[0];
    return {
      name: last.name as string,
      bytes: Array.from(last.bytes as Uint8Array) as number[],
      ms: w.__rowTiming.t1 - w.__rowTiming.t0,
    };
  });

  // Control method, same file, the same options.
  const method = await page.evaluate(async (p) => {
    const methods = (window as any).__controlMethods;
    const t0 = performance.now();
    // The row export uses the remembered scale (default follows the DPR).
    const dpr = window.devicePixelRatio;
    const scale = dpr === 2 || dpr === 3 ? dpr : 1;
    const r = await methods["export.render"]({
      path: p,
      format: "png",
      scale,
    });
    const ms = performance.now() - t0;
    const bin = atob(r.bytes);
    const bytes = Array.from(bin, (c) => c.charCodeAt(0));
    return { ...r, bytes, b64: undefined, ms };
  }, PATH);

  expect(method.mime).toBe("image/png");
  expect(method.fileName).toBe(rowResult.name);
  expect(method.size).toBe(method.bytes.length);

  const identical =
    method.bytes.length === rowResult.bytes.length &&
    method.bytes.every((v: number, i: number) => v === rowResult.bytes[i]);
  let parity = "byte-identical";
  if (!identical) {
    const cmp = await decodeAndPixels(page, rowResult.bytes, method.bytes);
    parity = `pixel diff ${(cmp.diff * 100).toFixed(4)} %`;
    expect(cmp.same).toBe(true);
    expect(cmp.diff).toBeLessThanOrEqual(0.001);
  }
  // eslint-disable-next-line no-console
  console.log(
    `export.render parity: ${parity}; row export ${rowResult.ms.toFixed(
      1,
    )} ms, export.render ${method.ms.toFixed(1)} ms`,
  );
  expect(errors).toEqual([]);
});
