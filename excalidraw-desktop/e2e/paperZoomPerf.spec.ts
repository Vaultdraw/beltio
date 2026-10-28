import { appendFileSync } from "node:fs";

import { expect, type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Per-frame cost of a continuous zoom with each notebook background (paper
// zoom perf). Skipped unless E2E_PERF=1. A 120 Hz frame is 8.3 ms for
// everything, so this times the work, not rAF deltas (which are vsync-capped).
//  1. Editor: one ctrl+wheel step per animation frame through the real editor
//     on a 3024x1964 device-px canvas (1512x982 CSS, dpr 2), zooming out
//     through every level-of-detail fade band and back in. Each step is
//     committed with flushSync (React update + static canvas render) and the
//     static canvas is read back so rasterisation is included.
//  2. Renderer: renderBackgroundPattern alone on a 3024x1964 canvas over the
//     same kind of zoom sweep (x1.03 per frame, 0.25 -> 4 -> 0.25).
// Chromium runs at each PERF_RATES CPU throttle (CDP); WebKit (closest to the
// app's WKWebView) runs unthrottled when E2E_FULL=1 adds both projects.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-paper-zoom.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4,6").split(",").map(Number);
const STYLES = ["plain", "grid", "lines", "dots", "graph", "isometric"];
const CANVAS = { width: 1512, height: 982 };
/** Zoom steps out (then the same back in): 0.02 each, 1 -> 0.2 -> 1. */
const STEPS = 40;

test.skip(!PERF, "set E2E_PERF=1 to run the paper zoom perf measurements");
test.describe.configure({ timeout: 300_000 });
test.use({ deviceScaleFactor: 2 });

const record = (row: Record<string, unknown>) => {
  const line = JSON.stringify(row);
  appendFileSync(OUT, `${line}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${line}`);
};

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) =>
    +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2);
  return {
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    p50: at(50),
    p95: at(95),
    max: at(100),
  };
};

/** CDP CPU throttle (Chromium only); a no-op elsewhere. The session stays
 * open: detaching it would drop the emulation. */
const sessions = new WeakMap<Page, CDPSession>();
const throttle = async (page: Page, browserName: string, rate: number) => {
  if (browserName !== "chromium") {
    return;
  }
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
};

const ratesFor = (browserName: string) =>
  browserName === "chromium" ? RATES : [1];

/** Resizes the window so the editor canvas is CANVAS (CSS px). */
const fitCanvas = async (page: Page) => {
  for (let i = 0; i < 3; i++) {
    const box = (await page
      .locator(".vault-editor canvas.static")
      .boundingBox())!;
    const viewport = page.viewportSize()!;
    const dw = CANVAS.width - Math.round(box.width);
    const dh = CANVAS.height - Math.round(box.height);
    if (!dw && !dh) {
      return;
    }
    await page.setViewportSize({
      width: viewport.width + dw,
      height: viewport.height + dh,
    });
    await page.waitForTimeout(200);
  }
};

const openPaper = async (page: Page, style: string) => {
  await page.evaluate((s) => {
    const w = window as any;
    const repo = w.__vaultRepo;
    const pattern =
      s === "plain" ? null : w.__paperRenderer.createBackgroundPattern(s);
    repo.seedDrawing(
      `Paper ${s}.excalidraw`,
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [],
        appState: {
          viewBackgroundColor: "#ffffff",
          viewBackgroundPattern: pattern,
        },
        files: {},
      }),
    );
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, style);
  await expect(
    page.locator(".vault-tree-item__name", { hasText: `Paper ${style}` }),
  ).toBeVisible();
  await openDrawing(page, `Paper ${style}`);
  await fitCanvas(page);
  const box = (await page
    .locator(".vault-editor canvas.static")
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
};

/**
 * One ctrl+wheel zoom step per animation frame (STEPS out, STEPS in), each
 * committed synchronously and read back; returns the per-step work in ms.
 */
const zoomSweep = (page: Page) =>
  page.evaluate(
    (steps) =>
      new Promise<number[]>((resolve) => {
        const w = window as any;
        const target = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const ctx = document
          .querySelector<HTMLCanvasElement>(".vault-editor canvas.static")!
          .getContext("2d")!;
        const r = target.getBoundingClientRect();
        const times: number[] = [];
        let i = 0;
        const frame = () => {
          if (i >= steps * 2) {
            resolve(times);
            return;
          }
          const event = new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            deltaY: i < steps ? 2 : -2,
            ctrlKey: true,
          });
          const t = performance.now();
          w.__flushSync(() => target.dispatchEvent(event));
          ctx.getImageData(0, 0, 1, 1);
          times.push(performance.now() - t);
          i++;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    STEPS,
  );

test("continuous zoom: per-frame editor cost per style", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const style of STYLES) {
    await openPaper(page, style);
    const canvas = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      )!;
      return `${c.width}x${c.height}`;
    });
    for (const rate of ratesFor(browserName)) {
      await throttle(page, browserName, rate);
      await zoomSweep(page); // warm-up (also returns to zoom ~1)
      const times = [...(await zoomSweep(page)), ...(await zoomSweep(page))];
      await throttle(page, browserName, 1);
      const row = {
        test: "paper-zoom-frame",
        browser: browserName,
        style,
        rate,
        canvas,
        frames: times.length,
        ...stats(times),
      };
      record(row);
      rows.push(row);
    }
  }
  for (const row of rows) {
    const plain = rows.find((r) => r.style === "plain" && r.rate === row.rate)!;
    record({
      test: "paper-zoom-frame-vs-plain",
      browser: browserName,
      style: row.style,
      rate: row.rate,
      extraP50: +(row.p50 - plain.p50).toFixed(2),
      extraP95: +(row.p95 - plain.p95).toFixed(2),
    });
  }
  // Budget: at full speed a zoom frame with any paper stays well inside a
  // 120 Hz frame and close to plain.
  for (const row of rows.filter((r) => r.rate === 1)) {
    expect(row.p95, `${row.style} p95`).toBeLessThan(8.3);
  }
});

test("continuous zoom: renderBackgroundPattern 3024x1964", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const rate of ratesFor(browserName)) {
    await throttle(page, browserName, rate);
    const result = await page.evaluate((styles) => {
      const { createBackgroundPattern, renderBackgroundPattern } = (
        window as any
      ).__paperRenderer;
      const W = 3024;
      const H = 1964;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const zooms: number[] = [];
      for (let z = 0.25; z < 4; z *= 1.03) {
        zooms.push(z);
      }
      zooms.push(...[...zooms].reverse());
      const out: Record<string, number[]> = {};
      for (const style of styles) {
        const pattern =
          style === "plain" ? null : createBackgroundPattern(style);
        const times: number[] = [];
        for (let pass = 0; pass < 2; pass++) {
          for (const zoom of zooms) {
            // zoom around the canvas centre, like a pinch
            const view = {
              scrollX: W / 4 / zoom - 500,
              scrollY: H / 4 / zoom - 300,
              zoom,
              scale: 2,
              width: W,
              height: H,
              isDarkMode: false,
            };
            const t = performance.now();
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, W, H);
            if (pattern) {
              renderBackgroundPattern(ctx, pattern, view);
            }
            ctx.getImageData(0, 0, 1, 1);
            if (pass) {
              times.push(performance.now() - t);
            }
          }
        }
        out[style] = times;
      }
      return out;
    }, STYLES);
    await throttle(page, browserName, 1);
    for (const [style, times] of Object.entries(result)) {
      const row = {
        test: "paper-zoom-render",
        browser: browserName,
        style,
        rate,
        frames: times.length,
        ...stats(times),
      };
      record(row);
      rows.push(row);
    }
  }
  for (const row of rows) {
    const plain = rows.find((r) => r.style === "plain" && r.rate === row.rate)!;
    record({
      test: "paper-zoom-render-vs-plain",
      browser: browserName,
      style: row.style,
      rate: row.rate,
      extraMean: +(row.mean - plain.mean).toFixed(2),
      extraP95: +(row.p95 - plain.p95).toFixed(2),
    });
  }
  // Budget: the pattern adds about 1 ms or less per zoom frame at full speed.
  for (const row of rows.filter((r) => r.rate === 1)) {
    const plain = rows.find((r) => r.style === "plain" && r.rate === 1)!;
    expect(row.p95 - plain.p95, `${row.style} extra p95`).toBeLessThan(1.5);
  }
});
