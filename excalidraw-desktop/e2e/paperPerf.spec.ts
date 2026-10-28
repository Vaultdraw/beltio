import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Performance of notebook backgrounds (F20). Skipped unless E2E_PERF=1.
// Chromium only (CDP CPU throttle, longtask API). Results are appended as
// JSON lines to $PERF_OUT and summarised per style vs plain.
//  1. Pan and zoom: rAF frame deltas (p50/p95) and long tasks while synthetic
//     wheel events drive the real editor, one event per frame.
//  2. Micro-benchmark: renderBackgroundPattern on a 2560x1440 device-px
//     canvas (1280x720 CSS at dpr 2), per style.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-paper.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,6").split(",").map(Number);
const FRAMES = Number(process.env.PERF_FRAMES ?? 120);
const STYLES = ["plain", "grid", "lines", "dots", "graph", "isometric"];

test.skip(!PERF, "set E2E_PERF=1 to run the paper perf measurements");
test.describe.configure({ timeout: 240_000 });

const record = (row: Record<string, unknown>) => {
  const line = JSON.stringify(row);
  appendFileSync(OUT, `${line}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${line}`);
};

const throttle = async (page: Page, rate: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

const watchLongTasks = (page: Page) =>
  page.addInitScript(() => {
    const w = window as any;
    w.__lt = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__lt.push({ start: e.startTime, dur: e.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  });

const openPaper = async (page: Page, style: string) => {
  await page.evaluate((s) => {
    const w = window as any;
    const repo = w.__vaultRepo;
    const pattern =
      s === "plain" ? null : w.__paperRenderer.createBackgroundPattern(s);
    repo.seedDrawing(
      "Paper.excalidraw",
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
    page.locator(".vault-tree-item__name", { hasText: "Paper" }),
  ).toBeVisible();
  await openDrawing(page, "Paper");
  await page.waitForTimeout(500);
};

/**
 * Dispatches one wheel event per animation frame on the interactive canvas
 * (pan: plain wheel; zoom: ctrl+wheel, in then out) and returns the frame
 * deltas plus long tasks that started during the run.
 */
const drive = (page: Page, mode: "pan" | "zoom", frames: number) =>
  page.evaluate(
    ([m, n]) =>
      new Promise<{ deltas: number[]; longTasks: number[] }>((resolve) => {
        const w = window as any;
        const canvas = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const r = canvas.getBoundingClientRect();
        const deltas: number[] = [];
        const t0 = performance.now();
        let last = t0;
        let i = 0;
        const step = (now: number) => {
          if (i > 0) {
            deltas.push(now - last);
          }
          last = now;
          if (i >= (n as number)) {
            const longTasks = (w.__lt as { start: number; dur: number }[])
              .filter((t) => t.start >= t0)
              .map((t) => t.dur);
            resolve({ deltas, longTasks });
            return;
          }
          const zoom = m === "zoom";
          const sign = zoom ? (i < (n as number) / 2 ? -1 : 1) : 1;
          canvas.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
              deltaX: zoom ? 0 : 7,
              deltaY: zoom ? sign * 10 : 11,
              ctrlKey: zoom,
            }),
          );
          i++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [mode, frames] as const,
  );

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2)
    : NaN;
};

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== "chromium", "CDP throttle + longtask: chromium");
});

for (const rate of RATES) {
  test(`pan/zoom frames per style cpu${rate}x`, async ({ page }) => {
    await watchLongTasks(page);
    await openVault(page);
    const rows: Record<string, any>[] = [];
    for (const style of STYLES) {
      await openPaper(page, style);
      const cdp = await throttle(page, rate);
      for (const mode of ["pan", "zoom"] as const) {
        await drive(page, mode, 10); // warm-up
        const { deltas, longTasks } = await drive(page, mode, FRAMES);
        const row = {
          test: "paper-frames",
          style,
          mode,
          rate,
          frames: deltas.length,
          p50: pct(deltas, 50),
          p95: pct(deltas, 95),
          longTasks: longTasks.length,
          longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
        };
        record(row);
        rows.push(row);
      }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    // Patterns must not add long tasks over plain at the same rate/mode.
    for (const row of rows) {
      const plain = rows.find(
        (r) => r.style === "plain" && r.mode === row.mode,
      )!;
      record({
        test: "paper-frames-vs-plain",
        style: row.style,
        mode: row.mode,
        rate,
        p95DeltaPct: +((row.p95 / plain.p95 - 1) * 100).toFixed(1),
        extraLongTasks: row.longTasks - plain.longTasks,
      });
      expect(row.longTasks, `${row.style} ${row.mode} long tasks`).toBe(
        plain.longTasks,
      );
    }
  });
}

for (const rate of RATES) {
  test(`renderBackgroundPattern 2560x1440 dpr2 cpu${rate}x`, async ({
    page,
  }) => {
    await openVault(page);
    const cdp = await throttle(page, rate);
    const result = await page.evaluate(
      ([styles, n]) => {
        const { createBackgroundPattern, renderBackgroundPattern } = (
          window as any
        ).__paperRenderer;
        const canvas = document.createElement("canvas");
        canvas.width = 2560;
        canvas.height = 1440;
        const ctx = canvas.getContext("2d")!;
        const out: Record<string, number[]> = {};
        // zoom 1: whole-pixel gaps (dot tile); 1.37: fractional (dot path)
        for (const zoom of [1, 1.37]) {
          for (const style of styles as string[]) {
            const pattern =
              style === "plain" ? null : createBackgroundPattern(style);
            const times: number[] = [];
            for (let i = 0; i < (n as number) + 20; i++) {
              const view = {
                scrollX: -i * 3.7,
                scrollY: -i * 2.3,
                zoom,
                scale: 2,
                width: 2560,
                height: 1440,
                isDarkMode: false,
              };
              const t = performance.now();
              ctx.fillStyle = "#fff";
              ctx.fillRect(0, 0, 2560, 1440);
              if (pattern) {
                renderBackgroundPattern(ctx, pattern, view);
              }
              // Force the GPU/raster work into the measurement.
              ctx.getImageData(0, 0, 1, 1);
              const dt = performance.now() - t;
              if (i >= 20) {
                times.push(dt);
              }
            }
            out[`${style}@${zoom}`] = times;
          }
        }
        return out;
      },
      [STYLES, 200] as const,
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    for (const [key, times] of Object.entries(result)) {
      const [style, zoom] = key.split("@");
      record({
        test: "paper-render",
        style,
        zoom: Number(zoom),
        rate,
        p50: pct(times, 50),
        p95: pct(times, 95),
        max: pct(times, 100),
      });
    }
    // A frame budget is 16.7 ms; the pattern must stay a small share of it.
    for (const [key, times] of Object.entries(result)) {
      expect(pct(times, 95), key).toBeLessThan(rate === 1 ? 4 : 16);
    }
  });
}
