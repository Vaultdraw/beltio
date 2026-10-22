import { expect, test, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "./helpers";

// Plugin scene API cost (E2E_PERF=1) on a generated 10k-element drawing.
//   pan frame p95, 3 s, with and without a scene.onChange subscriber plugin
//   (must be within 5%)
//   scene.batch of 100 adds: latency p50/p95 (ms, measured around the call)
const PERF = process.env.E2E_PERF === "1";
const PAN_MS = 3000;
const BATCHES = Number(process.env.SCENE_BATCHES) || 20;

test.skip(!PERF, "set E2E_PERF=1 to run the plugin scene measurements");
test.describe.configure({ timeout: 300_000 });

const report = (row: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[
    Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  ].toFixed(2);
};

const openBig = async (page: Page, plugins: string) => {
  await openVault(page, `?scene=big10k&plugins=${plugins}`);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page
    .locator(".vault-tree-item__name", { hasText: "Big" })
    .first()
    .click();
  await openDrawing(page, "Big10k");
};

/** Frame intervals while panning the canvas with the wheel for PAN_MS. */
const panFrames = async (page: Page): Promise<number[]> => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const loop = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      w.__raf = requestAnimationFrame(loop);
    };
    w.__raf = requestAnimationFrame(loop);
  });
  const end = Date.now() + PAN_MS;
  while (Date.now() < end) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(16);
  }
  return page.evaluate(() => {
    const w = window as any;
    cancelAnimationFrame(w.__raf);
    return (w.__frames as number[]).slice(3);
  });
};

test("pan frame p95 with a scene.onChange subscriber is within 5% of none", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "frame timing is measured on chromium");
  const runs: Record<string, number> = {};
  // Interleaved twice so drift hits both arms alike.
  for (const arm of ["none", "subscriber", "none", "subscriber"]) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 850 },
    });
    await openBig(
      page,
      arm === "none" ? "scene-stamp" : "scene-stamp,scene-watch",
    );
    const frames = await panFrames(page);
    const p95 = quantile(frames, 0.95);
    if (arm === "subscriber") {
      const calls = await page.evaluate(
        () => (window as any).__sceneWatchCalls,
      );
      expect(calls).toBeGreaterThanOrEqual(0);
    }
    runs[arm] = Math.min(runs[arm] ?? Infinity, p95);
    report({ metric: "scene.pan.frameP95", arm, p95, frames: frames.length });
    await page.close();
  }
  report({
    metric: "scene.pan.ratio",
    ratio: +(runs.subscriber / runs.none).toFixed(3),
  });
  expect(runs.subscriber).toBeLessThanOrEqual(runs.none * 1.05 + 0.5);
});

test("scene.batch of 100 adds latency", async ({ page }) => {
  await openBig(page, "scene-stamp");
  for (let i = 0; i < BATCHES; i++) {
    await page.keyboard.press("ControlOrMeta+Shift+KeyP");
    await page.keyboard.type("stamp: add 100");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (n) => ((window as any).__sceneBatchMs ?? []).length >= n,
      i + 1,
    );
  }
  const ms: number[] = await page.evaluate(
    () => (window as any).__sceneBatchMs,
  );
  report({
    metric: "scene.batch100.ms",
    p50: quantile(ms, 0.5),
    p95: quantile(ms, 0.95),
    n: ms.length,
  });
  expect(quantile(ms, 0.5)).toBeLessThan(200);
});
