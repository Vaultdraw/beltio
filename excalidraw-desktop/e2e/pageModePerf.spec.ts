import { appendFileSync } from "node:fs";

import { expect, type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";
import { live, rect, setupOf } from "./pageHelpers";

// Page mode perf, same method as paperZoomPerf.spec.ts (work per committed
// step via flushSync + static canvas read-back, 3024x1964 device-px canvas at
// dpr 2). Skipped unless E2E_PERF=1.
//  1. zoom: continuous ctrl+wheel steps with a lines pattern, page mode
//     (separate and continuous) vs normal mode.
//  2. scroll: wheel scroll for ~2 s (120 steps) over a 2000-element drawing,
//     page mode vs normal; per-step work, rAF frame interval, long tasks.
//  3. drag: per-pointermove handler time dragging one element of the same
//     2000-element drawing, page mode vs normal.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-page-mode.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4,6").split(",").map(Number);
const CANVAS = { width: 1512, height: 982 };
const MODES = ["normal", "separate", "continuous"] as const;
type Mode = typeof MODES[number];

test.skip(!PERF, "set E2E_PERF=1 to run the page mode perf measurements");
test.describe.configure({ timeout: 600_000 });
test.use({ deviceScaleFactor: 2 });

// PERF_NO_SHADOW=1: diagnostic run with canvas shadows disabled, to see how
// much of page mode's per-frame cost is the page shadows.
test.beforeEach(async ({ page }) => {
  if (process.env.PERF_NO_SHADOW === "1") {
    await page.addInitScript(() => {
      Object.defineProperty(CanvasRenderingContext2D.prototype, "shadowBlur", {
        set() {},
        get() {
          return 0;
        },
      });
    });
  }
});

const record = (row: Record<string, unknown>) => {
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);
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

const fitCanvas = async (page: Page) => {
  for (let i = 0; i < 3; i++) {
    const box = (await page
      .locator(".vault-editor canvas.static")
      .boundingBox())!;
    const vp = page.viewportSize()!;
    const dw = CANVAS.width - Math.round(box.width);
    const dh = CANVAS.height - Math.round(box.height);
    if (!dw && !dh) {
      return;
    }
    await page.setViewportSize({
      width: vp.width + dw,
      height: vp.height + dh,
    });
    await page.waitForTimeout(200);
  }
};

/** 2000 filled rectangles in 10 columns (fits an A4 column), 200 rows. */
const bigScene = () =>
  Array.from({ length: 2000 }, (_, i) => ({
    ...rect(`e${i}`, 10 + (i % 10) * 75, 10 + Math.floor(i / 10) * 55, 60, 40),
    backgroundColor: "#ffc9c9",
  }));

const PAGES_FOR_BIG = 10; // 200 rows * 55 + 10 = 11010 px = 9.8 A4 pages

const openMode = async (
  page: Page,
  mode: Mode,
  o: { pattern: boolean; elements: unknown[]; zoom?: number },
) => {
  const name = `Perf ${mode} ${Math.random().toString(36).slice(2, 6)}`;
  await page.evaluate(
    ([n, m, withPattern, elements, setup, zoom]) => {
      const w = window as any;
      const repo = w.__vaultRepo;
      repo.seedDrawing(
        `${n}.excalidraw`,
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements,
          appState: {
            viewBackgroundColor: "#ffffff",
            viewBackgroundPattern: withPattern
              ? w.__paperRenderer.createBackgroundPattern("lines")
              : null,
            ...(m === "normal" ? {} : { pageSetup: setup }),
            ...(zoom && m === "normal" ? { zoom: { value: zoom } } : {}),
          },
          files: {},
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [
      name,
      mode,
      o.pattern,
      o.elements,
      setupOf({
        layout: mode === "continuous" ? "continuous" : "separate",
        pageCount: PAGES_FOR_BIG,
      }),
      o.zoom ?? 0,
    ] as const,
  );
  await expect(
    page.locator(".vault-tree-item__name", { hasText: name }),
  ).toBeVisible();
  await openDrawing(page, name);
  await fitCanvas(page);
  const box = (await page
    .locator(".vault-editor canvas.static")
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
};

/** `steps` wheel events (ctrl = zoom), one per animation frame, committed and read back. */
const wheelSweep = (
  page: Page,
  steps: number,
  deltaY: number,
  ctrl: boolean,
  outAndBack: boolean,
) =>
  page.evaluate(
    ([n, dy, ctrlKey, back]) =>
      new Promise<{ work: number[]; frames: number[]; long: number[] }>(
        (resolve) => {
          const w = window as any;
          const target = document.querySelector<HTMLCanvasElement>(
            ".vault-editor canvas.interactive",
          )!;
          const ctx = document
            .querySelector<HTMLCanvasElement>(".vault-editor canvas.static")!
            .getContext("2d")!;
          const r = target.getBoundingClientRect();
          const work: number[] = [];
          const frames: number[] = [];
          const long: number[] = [];
          let obs: PerformanceObserver | null = null;
          try {
            obs = new PerformanceObserver((l) =>
              l.getEntries().forEach((e) => long.push(e.duration)),
            );
            obs.observe({ entryTypes: ["longtask"] });
          } catch {
            obs = null;
          }
          let i = 0;
          let last = performance.now();
          const total = back ? (n as number) * 2 : (n as number);
          const frame = () => {
            const now = performance.now();
            frames.push(now - last);
            last = now;
            if (i >= total) {
              obs?.disconnect();
              resolve({ work, frames: frames.slice(1), long });
              return;
            }
            const event = new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
              deltaY:
                back && i >= (n as number) ? -(dy as number) : (dy as number),
              ctrlKey: ctrlKey as boolean,
            });
            const t = performance.now();
            w.__flushSync(() => target.dispatchEvent(event));
            ctx.getImageData(0, 0, 1, 1);
            work.push(performance.now() - t);
            i++;
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        },
      ),
    [steps, deltaY, ctrl, outAndBack] as const,
  );

test("zoom frame cost with a lines pattern: page mode vs normal", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const mode of MODES) {
    await openMode(page, mode, {
      pattern: true,
      elements: [rect("a", 100, 100)],
    });
    for (const rate of ratesFor(browserName)) {
      await throttle(page, browserName, rate);
      await wheelSweep(page, 15, 2, true, true); // warm-up
      const work = [
        ...(await wheelSweep(page, 15, 2, true, true)).work,
        ...(await wheelSweep(page, 15, 2, true, true)).work,
        ...(await wheelSweep(page, 15, 2, true, true)).work,
      ];
      await throttle(page, browserName, 1);
      const row = {
        test: "pagemode-zoom-frame",
        browser: browserName,
        mode,
        rate,
        frames: work.length,
        ...stats(work),
      };
      record(row);
      rows.push(row);
    }
  }
  for (const row of rows.filter((r) => r.rate === 1 && r.mode !== "normal")) {
    expect(row.p95, `${row.mode} p95`).toBeLessThan(8.3);
  }
});

test("scroll over 2000 elements: page mode vs normal", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const mode of MODES) {
    await openMode(page, mode, { pattern: false, elements: bigScene() });
    for (const rate of ratesFor(browserName)) {
      await throttle(page, browserName, rate);
      await wheelSweep(page, 20, 40, false, true);
      const a = await wheelSweep(page, 60, 40, false, true); // 120 frames ~ 2 s
      await throttle(page, browserName, 1);
      const row = {
        test: "pagemode-scroll",
        browser: browserName,
        mode,
        rate,
        steps: a.work.length,
        work: stats(a.work),
        frameP95: stats(a.frames).p95,
        frameMean: stats(a.frames).mean,
        longTasks: a.long.length,
        longestTask: Math.round(Math.max(0, ...a.long)),
      };
      record(row);
      rows.push(row);
    }
  }
  for (const rate of ratesFor(browserName)) {
    const base = rows.find((r) => r.mode === "normal" && r.rate === rate)!;
    for (const row of rows.filter(
      (r) => r.mode !== "normal" && r.rate === rate,
    )) {
      record({
        test: "pagemode-scroll-vs-normal",
        browser: browserName,
        mode: row.mode,
        rate,
        p95Ratio: +(row.work.p95 / base.work.p95).toFixed(3),
        meanRatio: +(row.work.mean / base.work.mean).toFixed(3),
      });
      expect(row.longTasks, `${row.mode} long tasks at ${rate}x`).toBe(0);
    }
  }
});

// PERF_PROFILE=1 (Chromium): CPU-profiles a scroll sweep per mode and prints
// the heaviest functions by self time, to see where page mode's extra cost is.
test("profile: scroll sweep top self-time functions", async ({
  page,
  browserName,
}) => {
  test.skip(process.env.PERF_PROFILE !== "1" || browserName !== "chromium");
  await openVault(page);
  for (const mode of ["normal", "separate"] as const) {
    await openMode(page, mode, { pattern: false, elements: bigScene() });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await wheelSweep(page, 20, 40, false, true);
    await cdp.send("Profiler.start");
    await wheelSweep(page, 60, 40, false, true);
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map<number, number>();
    const dt = profile.timeDeltas ?? [];
    profile.samples?.forEach((id: number, i: number) =>
      self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)),
    );
    const byName = new Map<string, number>();
    for (const n of profile.nodes) {
      const cf = n.callFrame;
      const key = `${cf.functionName || "(anon)"} ${cf.url
        .split("/")
        .slice(-2)
        .join("/")}:${cf.lineNumber}`;
      byName.set(key, (byName.get(key) ?? 0) + (self.get(n.id) ?? 0));
    }
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    // eslint-disable-next-line no-console
    console.log(
      `PROFILE ${mode}\n${top
        .map(([k, v]) => `  ${(v / 1000 / 120).toFixed(2)} ms/step  ${k}`)
        .join("\n")}`,
    );
    await cdp.detach();
  }
});

test("drag cost of one element on 2000 elements: page mode vs normal", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const mode of MODES) {
    await openMode(page, mode, { pattern: false, elements: bigScene() });
    for (const rate of ratesFor(browserName)) {
      await throttle(page, browserName, rate);
      const result: number[] = [];
      for (let rep = 0; rep < 3; rep++) {
        // grab element e45 (row 4, col 5): scene (385, 230) + inside the fill
        const point = await page.evaluate(() => {
          const el = document.querySelector(
            ".vault-editor canvas.interactive",
          )!;
          const key = Object.keys(el).find((k) =>
            k.startsWith("__reactFiber"),
          )!;
          let f = (el as any)[key];
          while (f && !(f.stateNode?.scene && f.stateNode?.state?.zoom)) {
            f = f.return;
          }
          const st = f.stateNode.state;
          const box = el.getBoundingClientRect();
          return {
            x: box.left + (400 + st.scrollX) * st.zoom.value,
            y: box.top + (240 + st.scrollY) * st.zoom.value,
          };
        });
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + 3, point.y + 3, { steps: 2 });
        const times = await page.evaluate(
          ([px, py]) =>
            new Promise<number[]>((resolve) => {
              const w = window as any;
              const target = document.querySelector<HTMLCanvasElement>(
                ".vault-editor canvas.interactive",
              )!;
              const ctx = document
                .querySelector<HTMLCanvasElement>(
                  ".vault-editor canvas.static",
                )!
                .getContext("2d")!;
              const out: number[] = [];
              let i = 0;
              const step = () => {
                if (i >= 90) {
                  resolve(out);
                  return;
                }
                const wobble = (i % 2 ? -1 : 1) * 6;
                const ev = new PointerEvent("pointermove", {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 1,
                  pointerType: "mouse",
                  isPrimary: true,
                  buttons: 1,
                  clientX: (px as number) + 3 + wobble + (i % 30),
                  clientY: (py as number) + 3 + (i % 20),
                });
                const t = performance.now();
                w.__flushSync(() => target.dispatchEvent(ev));
                ctx.getImageData(0, 0, 1, 1);
                out.push(performance.now() - t);
                i++;
                requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }),
          [point.x, point.y] as const,
        );
        const moved = (await live(page)).elements.find((e) => e.id === "e45")!;
        // the element really followed the synthetic moves (not a no-op measurement)
        expect(
          Math.abs(moved.x - 385) + Math.abs(moved.y - 230),
        ).toBeGreaterThan(4);
        await page.mouse.up();
        await page.keyboard.press("Meta+z");
        if (rep > 0) {
          result.push(...times);
        }
      }
      await throttle(page, browserName, 1);
      const row = {
        test: "pagemode-drag-move",
        browser: browserName,
        mode,
        rate,
        moves: result.length,
        ...stats(result),
      };
      record(row);
      rows.push(row);
    }
  }
  expect(rows.length).toBeGreaterThan(0);
});

// Fit-width variant: page mode opens at the zoom its view lock installs
// (page fills the width minus margins); normal mode is opened at that same
// zoom value. Not overridden by the test.
const setZoom = async (page: Page, value: number) => {
  await page.evaluate((v) => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let f = (el as any)[key];
    while (f && !(f.stateNode?.scene && f.stateNode?.state?.zoom)) {
      f = f.return;
    }
    f.stateNode.setState({ zoom: { value: v }, scrollX: 0, scrollY: 0 });
  }, value);
  await page.waitForTimeout(300);
};

const readZoom = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let f = (el as any)[key];
    while (f && !(f.stateNode?.scene && f.stateNode?.state?.zoom)) {
      f = f.return;
    }
    return f.stateNode.state.zoom.value as number;
  });

for (const kind of ["scroll", "zoom"] as const) {
  test(`fit-width ${kind}: page mode vs normal at the same zoom`, async ({
    page,
    browserName,
  }) => {
    await openVault(page);
    const rows: Record<string, any>[] = [];
    let fitZoom = 0;
    for (const mode of ["separate", "continuous", "normal"] as const) {
      await openMode(page, mode, {
        pattern: kind === "zoom",
        elements: kind === "zoom" ? [rect("a", 100, 100)] : bigScene(),
        zoom: mode === "normal" ? fitZoom : undefined,
      });
      if (mode === "normal") {
        await setZoom(page, fitZoom);
      }
      const zoom = await readZoom(page);
      if (mode === "separate") {
        fitZoom = zoom;
      }
      for (const rate of ratesFor(browserName).filter((r) => r !== 4)) {
        await throttle(page, browserName, rate);
        let work: number[];
        let extra = {};
        if (kind === "zoom") {
          await wheelSweep(page, 15, 2, true, true);
          work = [
            ...(await wheelSweep(page, 15, 2, true, true)).work,
            ...(await wheelSweep(page, 15, 2, true, true)).work,
            ...(await wheelSweep(page, 15, 2, true, true)).work,
          ];
        } else {
          await wheelSweep(page, 20, 40, false, true);
          const a = await wheelSweep(page, 60, 40, false, true);
          work = a.work;
          extra = {
            longTasks: a.long.length,
            longestTask: Math.round(Math.max(0, ...a.long)),
          };
        }
        await throttle(page, browserName, 1);
        const row = {
          test: `pagemode-fit-${kind}`,
          browser: browserName,
          mode,
          rate,
          zoom: +zoom.toFixed(3),
          steps: work.length,
          ...stats(work),
          ...extra,
        };
        record(row);
        rows.push(row);
      }
    }
    for (const row of rows.filter((r) => r.mode !== "normal")) {
      const base = rows.find(
        (r) => r.mode === "normal" && r.rate === row.rate,
      )!;
      record({
        test: `pagemode-fit-${kind}-vs-normal`,
        browser: browserName,
        mode: row.mode,
        rate: row.rate,
        zoom: row.zoom,
        normalZoom: base.zoom,
        p95Ratio: +(row.p95 / base.p95).toFixed(3),
        meanRatio: +(row.mean / base.mean).toFixed(3),
      });
    }
  });
}

// PERF_PROFILE=1 (Chromium): CPU profile of a fit-width zoom sweep, per mode.
test("profile: fit-width zoom sweep top self-time functions", async ({
  page,
  browserName,
}) => {
  test.skip(process.env.PERF_PROFILE !== "1" || browserName !== "chromium");
  await openVault(page);
  let fitZoom = 0;
  for (const mode of ["separate", "normal"] as const) {
    await openMode(page, mode, {
      pattern: true,
      elements: [rect("a", 100, 100)],
    });
    if (mode === "normal") {
      await setZoom(page, fitZoom);
    } else {
      fitZoom = await readZoom(page);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 50 });
    await wheelSweep(page, 15, 2, true, true);
    await cdp.send("Profiler.start");
    const res = [];
    for (let i = 0; i < 3; i++) {
      res.push(await wheelSweep(page, 15, 2, true, true));
    }
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map<number, number>();
    const dt = profile.timeDeltas ?? [];
    profile.samples?.forEach((id: number, i: number) =>
      self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)),
    );
    const byName = new Map<string, number>();
    for (const n of profile.nodes) {
      const cf = n.callFrame;
      const key = `${cf.functionName || "(anon)"} ${cf.url
        .split("/")
        .slice(-2)
        .join("/")}:${cf.lineNumber}`;
      byName.set(key, (byName.get(key) ?? 0) + (self.get(n.id) ?? 0));
    }
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    // eslint-disable-next-line no-console
    console.log(
      `PROFILE ${mode} zoomAfter=${await readZoom(page)} fit=${fitZoom}\n${top
        .map(([k, v]) => `  ${(v / 1000 / 90).toFixed(3)} ms/step  ${k}`)
        .join("\n")}`,
    );
    await cdp.detach();
  }
});
