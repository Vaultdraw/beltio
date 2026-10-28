import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  notesScene,
  openSeeded,
  scanCanvas,
  textElement,
  throttle,
  toggleStyling,
  viewportPoint,
} from "./linkStylingHelpers";

// Per-step cost of pan, zoom sweep and hover on a drawing with 500 text
// elements holding [[links]] (half resolved), link styling ON vs OFF,
// interleaved ON, OFF, ON, OFF in one page. Skipped unless E2E_PERF=1.
// Same method as paperZoomPerf: one input per animation frame, committed with
// flushSync, the static canvas read back so rasterisation is included.
// Chromium runs at each PERF_RATES CPU throttle; WebKit x1 with E2E_FULL=1.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-link-styling.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4").split(",").map(Number);
const COLS = 25;
const ROWS = 20;
const PAN_STEPS = 60;
const ZOOM_STEPS = 40;
// The first ON/OFF pair warms the page up (GPU textures, JIT) and is not
// recorded: without it the first round reads back ~2 ms slower whatever the mode.
const ROUNDS = ["on", "off", "on", "off", "on", "off"] as const;
const WARMUP_ROUNDS = 2;

test.skip(!PERF, "set E2E_PERF=1 to run the link styling perf measurements");
test.describe.configure({ timeout: 600_000 });
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

const ratesFor = (browserName: string) =>
  browserName === "chromium" ? RATES : [1];

const bigScene = () => {
  const elements = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const text = [
      `n${i} [[Notes]]`,
      `n${i} [[Ghost ${i}]]`,
      `[[Notes]] and [[Missing ${i}]]`,
      `[[Alpha]] or [[Gone ${i}]]`,
    ][i % 4];
    elements.push(textElement(`t${i}`, text, col * 330, row * 90));
  }
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-link-styling-perf",
    elements,
    appState: {},
    files: {},
  });
};

const fixture = () => ({
  "Notes.excalidraw": notesScene(),
  "Alpha.excalidraw": notesScene(),
  "Big.excalidraw": bigScene(),
});

/** Toggles styling (palette) and waits for the canvas to show the new state. */
let styled = true; // link styling is on by default
const setStyling = async (page: Page, on: boolean) => {
  if (styled !== on) {
    await toggleStyling(page);
    styled = on;
  }
  await expect
    .poll(async () => (await scanCanvas(page)).saturated > 0, {
      timeout: 20_000,
    })
    .toBe(on);
  await page.waitForTimeout(150);
};

type Sweep = "pan" | "zoom";

/** One wheel per animation frame, committed synchronously, canvas read back. */
const sweep = (page: Page, kind: Sweep) =>
  page.evaluate(
    ({ kind: k, pan, zoom }) =>
      new Promise<number[]>((resolve) => {
        const w = window as any;
        const target = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const ctx = document
          .querySelector<HTMLCanvasElement>(".vault-editor canvas.static")!
          .getContext("2d")!;
        const r = target.getBoundingClientRect();
        const total = k === "pan" ? pan : zoom * 2;
        const half = total / 2;
        const times: number[] = [];
        let i = 0;
        const frame = () => {
          if (i >= total) {
            resolve(times);
            return;
          }
          const dir = i < half ? 1 : -1;
          const event = new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            deltaX: k === "pan" ? 20 * dir : 0,
            deltaY: k === "pan" ? 28 * dir : 2 * dir,
            ctrlKey: k === "zoom",
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
    { kind, pan: PAN_STEPS, zoom: ZOOM_STEPS },
  );

/** pointermove per frame along `points`; dispatch + work until our rAF runs. */
const hoverSweep = (page: Page, points: { x: number; y: number }[]) =>
  page.evaluate(
    (pts) =>
      new Promise<number[]>((resolve) => {
        const w = window as any;
        const target = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const times: number[] = [];
        let i = 0;
        const frame = () => {
          if (i >= pts.length) {
            resolve(times);
            return;
          }
          const p = pts[i];
          const t = performance.now();
          w.__flushSync(() =>
            target.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                cancelable: true,
                clientX: p.x,
                clientY: p.y,
                pointerType: "mouse",
                pointerId: 1,
              }),
            ),
          );
          const sync = performance.now() - t;
          i++;
          // frame work queued by the move (hit test, link boxes) runs before
          // this later-registered callback; measure up to its start
          requestAnimationFrame((frameStart) => {
            times.push(sync + (performance.now() - frameStart));
            frame();
          });
        };
        requestAnimationFrame(frame);
      }),
    points,
  );

/** Longest rAF gap and the summed excess over 16.7 ms in 700 ms after `act`. */
const firstRender = async (page: Page, act: () => Promise<void>) => {
  await page.evaluate(() => {
    const w = window as any;
    w.__gaps = [];
    w.__raf = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gaps.push(t - last);
      last = t;
      if (w.__raf) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const w = window as any;
    w.__raf = false;
    const gaps: number[] = w.__gaps;
    return {
      maxGap: Math.max(...gaps),
      excess: gaps.reduce((a, g) => a + Math.max(0, g - 16.7), 0),
    };
  });
};

type Row = ReturnType<typeof stats>;

const compare = (
  name: string,
  browser: string,
  rate: number,
  on: Row,
  off: Row,
) => {
  record({
    test: `${name}-vs-off`,
    browser,
    rate,
    extraP50: +(on.p50 - off.p50).toFixed(2),
    extraP95: +(on.p95 - off.p95).toFixed(2),
    extraMean: +(on.mean - off.mean).toFixed(2),
  });
};

test("link styling: pan, zoom and hover per-step cost, on vs off", async ({
  page,
  browserName,
}) => {
  styled = true;
  await openSeeded(page, fixture(), "Big");
  // styling is on by default: wait for the first styled paint
  await expect
    .poll(async () => (await scanCanvas(page)).saturated)
    .toBeGreaterThan(0);
  const scan = await scanCanvas(page);
  // pointer targets: columns of link-coloured pixels spread over the canvas
  const points: { x: number; y: number }[] = [];
  const rowsWithInk = scan.rows
    .map((n, y) => (n > 0 ? y : -1))
    .filter((y) => y >= 0);
  for (let k = 0; k < rowsWithInk.length && points.length < 120; k += 7) {
    const y = rowsWithInk[k];
    const xs = scan.cols.map((_, x) => x).filter((x) => scan.cols[x] > 0);
    const x = xs[(k * 13) % xs.length];
    points.push(await viewportPoint(page, scan, x, y));
  }
  expect(points.length).toBeGreaterThan(20);
  await page.mouse.move(points[0].x, points[0].y);

  for (const rate of ratesFor(browserName)) {
    const samples: Record<string, Record<string, number[]>> = {
      on: { pan: [], zoom: [], hover: [] },
      off: { pan: [], zoom: [], hover: [] },
    };
    const raster: Record<string, number[]> = { on: [], off: [] };
    const rasterExcess: Record<string, number[]> = { on: [], off: [] };
    // start plain, so every round (ON, OFF, ON, OFF) begins with a toggle
    await setStyling(page, false);
    for (const [round, mode] of ROUNDS.entries()) {
      const keep = round >= WARMUP_ROUNDS;
      // (d) one-off raster: toggle and watch the frames that follow
      await throttle(page, browserName, rate);
      const r = await firstRender(page, () => setStyling(page, mode === "on"));
      if (keep) {
        raster[mode].push(r.maxGap);
        rasterExcess[mode].push(r.excess);
      }
      for (const kind of ["pan", "zoom"] as const) {
        await sweep(page, kind); // warm-up
        const times = await sweep(page, kind);
        if (keep) {
          samples[mode][kind].push(...times);
        }
      }
      await hoverSweep(page, points); // warm-up
      const hover = await hoverSweep(page, points);
      if (keep) {
        samples[mode].hover.push(...hover);
      }
      await throttle(page, browserName, 1);
    }
    const rows: Record<string, Row> = {};
    for (const mode of ["on", "off"] as const) {
      for (const kind of ["pan", "zoom", "hover"] as const) {
        const s = stats(samples[mode][kind]);
        rows[`${kind}-${mode}`] = s;
        record({
          test: `link-styling-${kind}-${mode}`,
          browser: browserName,
          rate,
          styling: mode,
          frames: samples[mode][kind].length,
          ...s,
        });
      }
      record({
        test: `link-styling-first-render-${mode}`,
        browser: browserName,
        rate,
        styling: mode,
        n: raster[mode].length,
        maxGapMean: +(
          raster[mode].reduce((a, b) => a + b, 0) / raster[mode].length
        ).toFixed(1),
        maxGapMax: +Math.max(...raster[mode]).toFixed(1),
        excessMean: +(
          rasterExcess[mode].reduce((a, b) => a + b, 0) /
          rasterExcess[mode].length
        ).toFixed(1),
      });
    }
    for (const kind of ["pan", "zoom", "hover"]) {
      compare(
        `link-styling-${kind}`,
        browserName,
        rate,
        rows[`${kind}-on`],
        rows[`${kind}-off`],
      );
    }
    // Budget: at full speed styling costs at most max(5%, 0.5 ms) at p95.
    // WebKit timers tick in whole milliseconds, so its tolerance is 1 ms.
    if (rate === 1) {
      const slack = browserName === "webkit" ? 1 : 0.5;
      for (const kind of ["pan", "zoom"]) {
        const on = rows[`${kind}-on`].p95;
        const off = rows[`${kind}-off`].p95;
        expect(on, `${kind} p95 on=${on} off=${off}`).toBeLessThanOrEqual(
          off + Math.max(off * 0.05, slack),
        );
      }
    }
  }
});
