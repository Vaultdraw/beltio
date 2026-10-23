/* eslint-disable no-console */
import { expect, test } from "@playwright/test";

import { openVault } from "./helpers";
import { scene } from "./thumbnailScenes";
import { buildStep0, openStep0 } from "./thumbnailsStep0Page";

import type { Step0Hooks } from "./thumbnailsStep0";

// F2 thumbnails, step 0 (gate before the gallery/surfaces): main-thread cost of
// renderScenePng (exportToCanvas + toBlob PNG, the 300x225 CSS box at THUMB_DENSITY, default 2) for 100/500/1500 element
// scenes (rough default roughness and roughness 0) plus a scene with an
// embedded image, at 1x and (Chromium only) 4x CPU throttle. One
// `THUMB_STEP0 {json}` line per case (record.mjs spec ingests `<NAME>_PERF`).
//
//   E2E_PERF=1 E2E_FULL=1 npx playwright test e2e/thumbnailsPerf.spec.ts
//
// The measurement page (e2e/thumbnailsStep0.html) is production-built here with
// the e2e vite config and served through page.route under /__step0/.
const PERF = process.env.E2E_PERF === "1" || process.env.THUMB_PERF === "1";
const RUNS = Number(process.env.THUMB_RUNS ?? 30);
/** Pixel density of the PNG renders (2 = Retina, what most Macs use). */
const DENSITY = Number(process.env.THUMB_DENSITY ?? 2);
const WARMUP = 3;
const SIZES = [100, 500, 600, 1500]; // 600 = the render cap (D12)

test.skip(!PERF, "set E2E_PERF=1 to run the thumbnail render measurements");
test.describe.configure({ timeout: 600_000 });

const CASES = [
  ...SIZES.flatMap((n) => [
    { name: `${n}-rough`, json: () => scene(n, 1) },
    { name: `${n}-flat`, json: () => scene(n, 0) },
  ]),
  { name: "100-image", json: () => scene(100, 1, true) },
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
    : 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

test.describe("render step 0", () => {
  test.beforeAll(buildStep0);

  for (const rate of [1, 4]) {
    test(`render step 0, cpu x${rate}`, async ({
      page,
      browserName,
      baseURL,
    }) => {
      test.skip(
        rate > 1 && browserName !== "chromium",
        "CDP throttling is chromium only",
      );
      await openStep0(page, new URL(baseURL!).origin);
      const cdp = rate > 1 ? await page.context().newCDPSession(page) : null;
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
      for (const c of CASES) {
        const json = c.json();
        const res = await page.evaluate(
          async ({ json, runs, warmup, density }) => {
            const { renderScenePng } = (
              window as unknown as { __step0: Step0Hooks }
            ).__step0;
            const times: number[] = [];
            // Main-thread blocking (the real budget): long tasks during the runs.
            const longTasks: number[] = [];
            let obs: PerformanceObserver | null = null;
            try {
              obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                  longTasks.push(e.duration);
                }
              });
              obs.observe({ type: "longtask", buffered: false });
            } catch {
              obs = null; // WebKit has no longtask entries
            }
            let fails = 0;
            let bytes = 0;
            let reason = "";
            for (let i = 0; i < runs + warmup; i++) {
              const t0 = performance.now();
              const r = await renderScenePng(json, density);
              const dt = performance.now() - t0;
              if (r.kind === "png") {
                bytes = r.blob.size;
              } else {
                fails++;
                reason = r.reason;
              }
              if (i >= warmup) {
                times.push(dt);
              }
            }
            await new Promise((r) => setTimeout(r, 50));
            obs?.disconnect();
            return {
              times,
              fails,
              bytes,
              reason,
              longTasks: obs ? longTasks : null,
            };
          },
          { json, runs: RUNS, warmup: WARMUP, density: DENSITY },
        );
        const row = {
          case: c.name,
          engine: browserName,
          cpuRate: rate,
          density: DENSITY,
          runs: RUNS,
          jsonKB: Math.round(json.length / 1024),
          p50: r1(pct(res.times, 50)),
          p95: r1(pct(res.times, 95)),
          max: r1(Math.max(...res.times)),
          pngKB: Math.round(res.bytes / 102.4) / 10,
          longTasks: res.longTasks?.length ?? null,
          longTaskMax: res.longTasks ? r1(Math.max(0, ...res.longTasks)) : null,
          fails: res.fails,
          reason: res.reason,
        };
        console.log(`THUMB_STEP0 ${JSON.stringify(row)}`);
        if (res.reason !== "too-many") {
          // Over-cap scenes are expected placeholders (D12; cap 2500 since 2026-10-23).
          expect(res.fails, `${c.name}: render failed (${res.reason})`).toBe(0);
        }
      }
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    });
  }
});

// ---------------------------------------------------------------------------
// F2 thumbnails, QA E: gallery / startup / save-path measurements. One
// `THUMBS_PERF {json}` line per row (record.mjs spec: object {p50,p95,max}
// leaves become timings, numeric leaves single values; heap fields only on
// Chromium).
//
//   E2E_PERF=1 E2E_FULL=1 E2E_WORKERS=1 npx playwright test e2e/thumbnailsPerf.spec.ts -g "gallery 5k|startup|save path" --project=chromium

const emit = (row: Record<string, unknown>) =>
  console.log(`THUMBS_PERF ${JSON.stringify(row)}`);
const stats = (xs: number[]) => ({
  p50: r1(pct(xs, 50)),
  p95: r1(pct(xs, 95)),
  max: r1(xs.length ? Math.max(...xs) : 0),
});

const CYCLES = Number(process.env.THUMB_CYCLES ?? 10);
const DRAWINGS = Number(process.env.THUMB_DRAWINGS ?? 5000);

for (const rate of [1, 4]) {
  test(`gallery ${DRAWINGS} scroll, cpu x${rate}`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      rate > 1 && browserName !== "chromium",
      "CDP throttling is chromium only",
    );
    await openVault(page, `?seed=bigfolder&n=${DRAWINGS}&el=1&thumbs=1`);
    const cdp =
      browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null;
    const heap = async () => {
      if (!cdp) {
        return null;
      }
      await cdp.send("HeapProfiler.collectGarbage");
      return page.evaluate(
        () => (performance as any).memory.usedJSHeapSize / 1048576,
      );
    };
    const heap0 = await heap();
    if (rate > 1) {
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
    }

    // Open the gallery at the vault root, move to the big folder and enter it:
    // time from that Enter to the first tile image and to every visible tile ready.
    await page.keyboard.press("ControlOrMeta+Alt+KeyE");
    const grid = page.getByRole("grid", { name: /Gallery/ });
    await expect(grid).toBeFocused();
    await page.evaluate(() => {
      const w = window as any;
      w.__t = { enter: 0, first: 0, ready: 0 };
      addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter" && !w.__t.enter) {
            w.__t.enter = performance.now();
          }
        },
        true,
      );
      const visibleCells = () => {
        const sc = document.querySelector("[role=grid]");
        if (!sc) {
          return [];
        }
        const r = sc.getBoundingClientRect();
        return [...sc.querySelectorAll("[role=gridcell]")].filter((c) => {
          const b = c.getBoundingClientRect();
          return b.bottom > r.top && b.top < r.bottom;
        });
      };
      const tick = () => {
        const t = w.__t;
        if (t.enter) {
          if (
            !t.first &&
            document.querySelector("[role=grid] img.vault-thumb")
          ) {
            t.first = performance.now();
          }
          const cells = visibleCells();
          const settled =
            cells.length > 15 &&
            cells.every(
              (c) => c.querySelector(".vault-thumb")?.tagName === "IMG",
            );
          if (!t.ready && settled) {
            t.ready = performance.now();
          }
        }
        if (!t.ready) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("gallery-count")).toHaveText(
      `${DRAWINGS} items`,
    );
    await page.waitForFunction(() => (window as any).__t.ready, undefined, {
      timeout: 60_000,
    });
    const t = await page.evaluate(() => (window as any).__t);
    const putsAfterOpen = await page.evaluate(
      () => (window as any).__thumbStore.calls.put as number,
    );

    // 10 x (top -> bottom -> top), one scroll step per frame.
    const res = await page.evaluate(
      async ({ cycles }) => {
        const sc = document.querySelector<HTMLElement>("[role=grid]")!;
        const max = sc.scrollHeight - sc.clientHeight;
        const step = 1200;
        const frames: number[] = [];
        let mountedMax = 0;
        let imgMax = 0;
        let f = 0;
        const sample = () => {
          mountedMax = Math.max(
            mountedMax,
            sc.querySelectorAll("[role=gridcell]").length,
          );
          imgMax = Math.max(
            imgMax,
            document.querySelectorAll("img.vault-thumb").length,
          );
        };
        await new Promise<void>((resolve) => {
          let dir = 1;
          let legs = 0;
          let last = performance.now();
          const frame = (now: number) => {
            if (f++ > 3) {
              frames.push(now - last);
            }
            last = now;
            sc.scrollTop = Math.min(
              max,
              Math.max(0, sc.scrollTop + dir * step),
            );
            if (f % 4 === 0) {
              sample();
            }
            if (
              (dir > 0 && sc.scrollTop >= max) ||
              (dir < 0 && sc.scrollTop <= 0)
            ) {
              dir = -dir;
              legs++;
            }
            if (legs >= cycles * 2) {
              resolve();
            } else {
              requestAnimationFrame(frame);
            }
          };
          requestAnimationFrame(frame);
        });
        sample();
        return { frames, mountedMax, imgMax };
      },
      { cycles: CYCLES },
    );
    // Renders started by tiles that only flashed by (the fast-scroll deferral
    // should keep this at about the visible tiles per settle point).
    const putsScroll = await page.evaluate(
      () => (window as any).__thumbStore.calls.put as number,
    );
    // Let the queue drain, then measure the heap after everything settled.
    await page.waitForTimeout(1500);
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const heap1 = await heap();
    const putsTotal = await page.evaluate(
      () => (window as any).__thumbStore.calls.put as number,
    );
    const row = {
      name: `gallery${DRAWINGS}`,
      browser: browserName,
      cpuRate: rate,
      cycles: CYCLES,
      frame: stats(res.frames),
      frameOver16: res.frames.filter((d) => d > 16.7 * 1.5).length,
      frameOver8: res.frames.filter((d) => d > 8.3 * 1.5).length,
      mountedTilesMax: res.mountedMax,
      imgMax: res.imgMax,
      firstTileMs: r1(t.first - t.enter),
      allVisibleReadyMs: r1(t.ready - t.enter),
      putsAfterOpen,
      putsDuringScroll: putsScroll - putsAfterOpen,
      putsTotal,
      ...(heap0 !== null && heap1 !== null
        ? {
            heapBeforeMB: r1(heap0),
            heapAfterMB: r1(heap1),
            heapGrowthMB: r1(heap1 - heap0),
          }
        : {}),
    };
    emit(row);
    expect(res.mountedMax).toBeLessThanOrEqual(120);
    if (rate === 1) {
      expect(row.firstTileMs).toBeLessThan(300);
      if (heap0 !== null && heap1 !== null) {
        expect(heap1 - heap0).toBeLessThan(20);
      }
    }
  });
}

test("startup: thumbnails on vs off, no IPC and no gallery chunk before a surface", async ({
  browser,
  browserName,
}) => {
  const ROUNDS = Number(process.env.THUMB_ROUNDS ?? 8);
  const homeMs: Record<string, number[]> = { on: [], off: [] };
  const tileMs: number[] = [];
  let lookupsAtHome = -1;
  let lookupsLater = 0;
  let galleryBefore = 0;
  let jsAfterOpen = 0;
  let galleryChunkLoaded = false;
  for (let i = 0; i < ROUNDS; i++) {
    for (const mode of ["on", "off"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 850 },
      });
      const page = await ctx.newPage();
      const js: string[] = [];
      page.on("request", (r) => {
        if (/\.js(\?|$)/.test(r.url())) {
          js.push(r.url());
        }
      });
      await page.addInitScript(() => {
        const w = window as any;
        w.__m = { nav: 0, home: 0, lookupsAtHome: -1, tile: 0 };
        new MutationObserver(() => {
          const m = w.__m;
          if (
            !m.nav &&
            document.querySelector('[aria-label="Vault File Navigator"]')
          ) {
            m.nav = performance.now();
          }
          if (
            !m.home &&
            document.querySelector('[aria-label="Recent drawings"]')
          ) {
            m.home = performance.now();
            m.lookupsAtHome = w.__thumbStore?.calls.lookup ?? -1;
          }
          if (!m.tile && document.querySelector("img.vault-thumb")) {
            m.tile = performance.now();
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await openVault(page, `?seed=search${mode === "on" ? "&thumbs=1" : ""}`);
      await expect(page.getByLabel("Recent drawings")).toBeVisible();
      if (mode === "on") {
        await expect(page.locator("img.vault-thumb").first()).toBeVisible({
          timeout: 15_000,
        });
      }
      const m = await page.evaluate(() => (window as any).__m);
      homeMs[mode].push(m.home);
      if (mode === "on") {
        tileMs.push(m.tile - m.home);
        lookupsAtHome = m.lookupsAtHome;
        lookupsLater = await page.evaluate(
          () => (window as any).__thumbStore.calls.lookup as number,
        );
        galleryBefore = js.filter((u) => /gallery/i.test(u)).length;
        const before = js.length;
        await page.keyboard.press("ControlOrMeta+Alt+KeyE");
        await expect(page.getByTestId("gallery-view")).toBeVisible();
        jsAfterOpen = js.length - before;
        galleryChunkLoaded ||= js.some((u) => /gallery/i.test(u));
      }
      await ctx.close();
    }
  }
  emit({
    name: "startup",
    browser: browserName,
    rounds: ROUNDS,
    homeOnMs: stats(homeMs.on),
    homeOffMs: stats(homeMs.off),
    tileAfterHomeMs: stats(tileMs),
    lookupsAtFirstHomePaint: lookupsAtHome,
    lookupsAfterTiles: lookupsLater,
    galleryChunksBeforeOpen: galleryBefore,
    jsRequestsOnGalleryOpen: jsAfterOpen,
  });
  expect(lookupsAtHome).toBe(0);
  expect(galleryBefore).toBe(0);
  expect(jsAfterOpen).toBeGreaterThan(0); // the lazy chunk loads on demand
  expect(galleryChunkLoaded || jsAfterOpen > 0).toBe(true);
});

test("save path: dirty -> saved with thumbnails on vs off", async ({
  browser,
  browserName,
}) => {
  const ROUNDS = Number(process.env.THUMB_ROUNDS ?? 12);
  const ms: Record<string, number[]> = { on: [], off: [] };
  for (let i = 0; i < ROUNDS; i++) {
    for (const mode of ["on", "off"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 850 },
      });
      const page = await ctx.newPage();
      await openVault(page, `?seed=search${mode === "on" ? "&thumbs=1" : ""}`);
      if (mode === "on") {
        await expect(page.locator("img.vault-thumb").first()).toBeVisible({
          timeout: 15_000,
        });
      }
      await page.locator("button.vault-recent__item").first().click();
      await expect(
        page.locator(".vault-editor canvas.interactive"),
      ).toBeVisible();
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const w = window as any;
        w.__s = { dirty: 0, saved: 0 };
        new MutationObserver(() => {
          const s = w.__s;
          if (
            !s.dirty &&
            document.querySelector(
              ".vault-status--dirty, .vault-status--saving",
            )
          ) {
            s.dirty = performance.now();
          }
          if (
            s.dirty &&
            !s.saved &&
            document.querySelector(".vault-status--saved")
          ) {
            s.saved = performance.now();
          }
        }).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      const box = (await page
        .locator(".vault-editor canvas.interactive")
        .boundingBox())!;
      await page
        .locator(".vault-editor [data-testid='toolbar-rectangle']")
        .click();
      await page.mouse.move(box.x + 300, box.y + 250);
      await page.mouse.down();
      await page.mouse.move(box.x + 420, box.y + 330, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() => (window as any).__s.saved, undefined, {
        timeout: 5000,
      });
      const s = await page.evaluate(() => (window as any).__s);
      ms[mode].push(s.saved - s.dirty);
      await ctx.close();
    }
  }
  const on = stats(ms.on);
  const off = stats(ms.off);
  emit({
    name: "savePath",
    browser: browserName,
    rounds: ROUNDS,
    onMs: on,
    offMs: off,
    deltaP50Ms: r1(on.p50 - off.p50),
  });
  // Autosave debounce dominates (100 ms in e2e); the hook must not add noticeable time.
  expect(on.p50 - off.p50).toBeLessThan(15);
});
