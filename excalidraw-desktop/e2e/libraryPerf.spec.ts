import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

// Performance measurements for the persisted library (F10). Skipped unless
// E2E_PERF=1. Results are appended as JSON lines to $PERF_OUT.
// The spec also runs against a checkout without the library feature (baseline):
// everything that needs `window.__libraryRepo` degrades to "n/a".
const PERF = process.env.E2E_PERF === "1";
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const OUT = process.env.PERF_OUT ?? "../.cache/perf-library.jsonl";
const TAG = process.env.PERF_TAG ?? "ours";
const RATES = (process.env.PERF_RATES ?? "1,6").split(",").map(Number);

test.skip(!PERF, "set E2E_PERF=1 to run the library perf measurements");
test.describe.configure({ timeout: 240_000 });

const record = (row: Record<string, unknown>, browserName: string) => {
  const line = JSON.stringify({ tag: TAG, browser: browserName, ...row });
  appendFileSync(OUT, `${line}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${line}`);
};

/** In-page JSON generator: `n` items, each with ~`points` freedraw points. */
const GEN = `(() => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const el = (id, i, type, extra) => ({
    id, type, x: (i % 50) * 3, y: Math.floor(i / 50) * 3, width: 40, height: 30, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
    seed: i + 1, version: 1, versionNonce: i + 1, isDeleted: false, boundElements: null,
    updated: 1, link: null, locked: false, ...extra,
  });
  const item = (prefix, i, points) => {
    if (!points) return { id: prefix + "-" + i, status: "unpublished", created: 1, elements: [el(prefix + "-el-" + i, i, "rectangle", {})] };
    const pts = [], pr = [];
    for (let p = 0; p < points; p++) { pts.push([+(p * 0.5).toFixed(2), +(rnd() * 40).toFixed(2)]); pr.push(+rnd().toFixed(3)); }
    return { id: prefix + "-" + i, status: "unpublished", created: 1, elements: [el(prefix + "-el-" + i, i, "freedraw", {
      points: pts, pressures: pr, simulatePressure: false, lastCommittedPoint: pts[points - 1] })] };
  };
  window.__genLib = (n, points, prefix) => {
    const items = [];
    for (let i = 0; i < n; i++) items.push(item(prefix || "seed", i, points));
    return JSON.stringify({ type: "excalidrawlib", version: 2, source: "perf", libraryItems: items });
  };
  window.__genItems = (n, points, prefix) => JSON.parse(window.__genLib(n, points, prefix)).libraryItems;
  // Items-per-file calibration so a 2,000-item file is ~targetMb.
  window.__calibrate = (n, targetMb) => {
    const probe = window.__genLib(100, 100, "p").length / 100; // bytes/item @100 pts
    const base = window.__genLib(100, 1, "p").length / 100;
    const perPoint = (probe - base) / 99;
    return Math.max(1, Math.round(((targetMb * 1024 * 1024) / n - base) / perPoint));
  };
})()`;

const BIG_ITEMS = 2000;
const BIG_MB = 20;

const setupPage = async (page: Page, opts: { timers?: boolean } = {}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__lt = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__lt.push({ start: e.startTime, dur: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* webkit: no longtask */
    }
    w.__origSetInterval = w.setInterval.bind(w);
    w.__origSetTimeout = w.setTimeout.bind(w);
  });
  if (opts.timers) {
    await page.addInitScript(() => {
      const w = window as any;
      w.__timers = { timeout: 0, interval: 0, raf: 0, ric: 0 };
      const st = w.setTimeout;
      const si = w.setInterval;
      const raf = w.requestAnimationFrame;
      w.setTimeout = (...a: any[]) => {
        w.__timers.timeout++;
        return st.apply(w, a);
      };
      w.setInterval = (...a: any[]) => {
        w.__timers.interval++;
        return si.apply(w, a);
      };
      w.requestAnimationFrame = (cb: any) => {
        w.__timers.raf++;
        return raf.call(w, cb);
      };
    });
  }
  await openVault(page);
  await page.evaluate(GEN);
  const hasLib = await page.evaluate(() => !!(window as any).__libraryRepo);
  return { hasLib };
};

/** Stamps repo reads/writes with performance.now() (no-op without library). */
const instrumentRepo = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const repo = w.__libraryRepo;
    if (!repo) {
      return;
    }
    w.__repoLog = [];
    const read = repo.readLibrary.bind(repo);
    repo.readLibrary = async (...a: any[]) => {
      const t = performance.now();
      const r = await read(...a);
      w.__repoLog.push({
        op: "read",
        t,
        key: a[0],
        unchanged: r.unchanged,
        bytes: r.json ? r.json.length : 0,
      });
      return r;
    };
    const write = repo.writeLibrary.bind(repo);
    repo.writeLibrary = async (...a: any[]) => {
      w.__repoLog.push({
        op: "write",
        t: performance.now(),
        key: a[0],
        bytes: a[2].length,
      });
      return write(...a);
    };
  });

const seedBig = async (page: Page, n = BIG_ITEMS, mb = BIG_MB) =>
  page.evaluate(
    ([count, target]) => {
      const w = window as any;
      const points = w.__calibrate(count, target);
      const json = w.__genLib(count, points, "big");
      w.__libraryRepo.setFile("personal", json);
      return { points, bytes: json.length };
    },
    [n, mb],
  );

/** click -> canvas interactive (+ next paint), heartbeat gaps, in one page-side probe. */
const armOpenProbe = (page: Page, windowMs: number, fresh = false) =>
  page.evaluate(
    ([win, isSwitch]) => {
      const w = window as any;
      const probe: any = { t0: 0, tCanvas: 0, tPaint: 0, maxGap: 0, gaps: [] };
      w.__probe = probe;
      w.__lt.length = 0;
      // The editor is keyed per document: a switch mounts a new canvas node.
      const old = isSwitch
        ? document.querySelector(".vault-editor canvas.interactive")
        : null;
      document.addEventListener(
        "click",
        () => {
          if (probe.t0) {
            return;
          }
          probe.t0 = performance.now();
          let last = performance.now();
          const id = w.__origSetInterval(() => {
            const now = performance.now();
            const gap = now - last - 10;
            probe.maxGap = Math.max(probe.maxGap, gap);
            if (gap > 50) {
              probe.gaps.push({
                rel: Math.round(last - probe.t0),
                dur: Math.round(gap),
              });
            }
            last = now;
            if (now - probe.t0 > win) {
              clearInterval(id);
            }
          }, 10);
          const mo = new MutationObserver(() => {
            if (probe.tCanvas) {
              return;
            }
            const c = document.querySelector(
              ".vault-editor canvas.interactive",
            );
            if (c && c !== old) {
              probe.tCanvas = performance.now();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => (probe.tPaint = performance.now())),
              );
              mo.disconnect();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
        },
        { capture: true, once: true },
      );
    },
    [windowMs, fresh] as const,
  );

const readProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const p = w.__probe;
    const log = ((w.__repoLog ?? []) as any[]).filter((e) => e.t >= p.t0);
    return {
      openMs: p.tPaint ? p.tPaint - p.t0 : null,
      canvasMs: p.tCanvas ? p.tCanvas - p.t0 : null,
      maxGapMs: Math.round(p.maxGap * 10) / 10,
      gaps: p.gaps as { rel: number; dur: number }[],
      repo: log.map((e) => ({ ...e, rel: Math.round((e.t - p.t0) * 10) / 10 })),
      longTasks: (w.__lt as any[]).map((e) => ({
        rel: Math.round((e.start - p.t0) * 10) / 10,
        dur: Math.round(e.dur),
      })),
    };
  });

const clickTree = async (page: Page, name: string) => {
  await page
    .locator(".vault-tree-item__name", { hasText: name })
    .first()
    .click();
};
const expand = async (page: Page, name: string) => {
  const row = page
    .locator(".vault-tree-item")
    .filter({
      has: page.locator(".vault-tree-item__name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .first();
  await expect(row).toBeVisible();
  const toggle = row.locator(".vault-tree-item__toggle");
  if ((await toggle.getAttribute("aria-label")) === "Expand") {
    await toggle.click();
  }
};
const expandTree = async (page: Page) => {
  await expand(page, "DSA");
  await expand(page, "Dynamic Programming");
};

const throttle = async (page: Page, rate: number) => {
  if (rate === 1) {
    return null;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

const summarize = (probe: Awaited<ReturnType<typeof readProbe>>) => ({
  openMs: probe.openMs,
  canvasMs: probe.canvasMs,
  maxGapMs: probe.maxGapMs,
  gaps: probe.gaps,
  firstReadMs: probe.repo.find((e: any) => e.op === "read")?.rel ?? null,
  fullReads: probe.repo.filter((e: any) => e.op === "read" && !e.unchanged)
    .length,
  longTasks: probe.longTasks.length,
  longTaskMaxMs: Math.max(0, ...probe.longTasks.map((t: any) => t.dur)),
});

// ---------------------------------------------------------------------------
// 1 + 2: open a drawing, then switch with the library loaded.
// ---------------------------------------------------------------------------
for (const variant of ["none", "big"] as const) {
  for (const rate of RATES) {
    for (let run = 1; run <= RUNS; run++) {
      test(`open+switch ${variant} cpu${rate}x run${run}`, async ({
        page,
        browserName,
      }) => {
        test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
        const { hasLib } = await setupPage(page);
        test.skip(variant === "big" && !hasLib, "baseline has no library");
        let seeded: any = null;
        if (variant === "big") {
          seeded = await seedBig(page);
        }
        await expandTree(page);
        await instrumentRepo(page);
        await armOpenProbe(page, 6000);
        const cdp = await throttle(page, rate);
        await clickTree(page, "Graphs");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(rate === 1 ? 6000 : 12_000);
        const open = summarize(await readProbe(page));

        // Switch with the library loaded: second probe window.
        await armOpenProbe(page, 4000, true);
        await clickTree(page, "01 Introduction");
        await page.waitForTimeout(rate === 1 ? 4500 : 9000);
        const swp = await readProbe(page);
        const sw = {
          switchMs: swp.openMs,
          maxGapMs: swp.maxGapMs,
          gaps: swp.gaps,
          reads: swp.repo.filter((e: any) => e.op === "read").length,
          fullReads: swp.repo.filter(
            (e: any) => e.op === "read" && !e.unchanged,
          ).length,
          writes: swp.repo.filter((e: any) => e.op === "write").length,
          longTasks: swp.longTasks.length,
        };
        if (cdp) {
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        }
        record(
          { test: "open", variant, rate, run, seeded, open, switch: sw },
          browserName,
        );
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 3: sidebar open -> first library item visible (2,000 small items).
// modes: store (seed via fake repo), inject (Excalidraw library API via React
// fiber; works on the baseline too). settle = wait for the load to finish
// before opening the sidebar.
// ---------------------------------------------------------------------------
const injectViaFiber = (page: Page, n: number) =>
  page.evaluate((count) => {
    const w = window as any;
    const el = document.querySelector(".excalidraw") as any;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
    let f = el[key];
    while (f) {
      const sn = f.stateNode;
      if (sn && sn.library && typeof sn.library.updateLibrary === "function") {
        const items = w.__genItems(count, 0, "inj");
        void sn.library.updateLibrary({ libraryItems: items, merge: false });
        return true;
      }
      f = f.return;
    }
    return false;
  }, n);

for (const mode of ["store", "inject"] as const) {
  for (const settle of [false, true]) {
    for (const rate of RATES) {
      for (let run = 1; run <= RUNS; run++) {
        test(`sidebar ${mode} settle=${settle} cpu${rate}x run${run}`, async ({
          page,
          browserName,
        }) => {
          test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
          const { hasLib } = await setupPage(page);
          test.skip(mode === "store" && !hasLib, "baseline has no library");
          await expandTree(page);
          await clickTree(page, "Graphs");
          await expect(
            page.locator(".vault-editor canvas.interactive"),
          ).toBeVisible();
          await page.waitForTimeout(1800); // let the idle load of an empty library finish
          const cdp = await throttle(page, rate);
          if (mode === "store") {
            await page.evaluate(() =>
              (window as any).__libraryRepo.setFile(
                "personal",
                (window as any).__genLib(2000, 0, "seed"),
              ),
            );
          } else {
            expect(await injectViaFiber(page, 2000)).toBe(true);
          }
          if (settle) {
            await page.waitForTimeout(rate === 1 ? 2500 : 8000);
          }
          const t0 = Date.now();
          await page.locator(".default-sidebar-trigger").first().click();
          await expect(
            page.locator(".library-unit__dragger").first(),
          ).toBeVisible({ timeout: 60_000 });
          const ms = Date.now() - t0;
          if (cdp) {
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
          }
          record({ test: "sidebar", mode, settle, rate, run, ms }, browserName);
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4: long tasks (chromium): lazy 20 MB load, save burst, external change.
// ---------------------------------------------------------------------------
for (const rate of RATES) {
  for (let run = 1; run <= RUNS; run++) {
    test(`longtasks cpu${rate}x run${run}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "longtask API is chromium-only");
      const { hasLib } = await setupPage(page);
      test.skip(!hasLib, "baseline has no library");
      let crashed = false;
      page.on("crash", () => (crashed = true));
      const seeded = await seedBig(page);
      await expandTree(page);
      await instrumentRepo(page);
      const cdp = await throttle(page, rate);
      const settleMs = rate === 1 ? 6000 : 14_000;
      const tasksSince = (since: number) =>
        page.evaluate(
          (s) =>
            ((window as any).__lt as any[])
              .filter((e) => e.start >= s)
              .map((e) => Math.round(e.dur)),
          since,
        );
      const now = () => page.evaluate(() => performance.now());

      const res: Record<string, unknown> = {};
      try {
        // (a) lazy load of the 20 MB library (idle load after the editor mounts).
        const tLoad = await now();
        await clickTree(page, "Graphs");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible({
          timeout: 60_000,
        });
        await page.waitForTimeout(settleMs);
        res.load = await tasksSince(tLoad);

        // (b) save burst: add 5 items quickly through the Excalidraw library API.
        const tBurst = await now();
        const ok = await page.evaluate(() => {
          const w = window as any;
          const el = document.querySelector(".excalidraw") as any;
          const key = Object.keys(el).find((k) =>
            k.startsWith("__reactFiber$"),
          )!;
          let f = el[key];
          while (f) {
            const sn = f.stateNode;
            if (
              sn &&
              sn.library &&
              typeof sn.library.updateLibrary === "function"
            ) {
              const items = w.__genItems(5, 20, "burst");
              for (const it of items) {
                void sn.library.updateLibrary({
                  libraryItems: [it],
                  merge: true,
                });
              }
              return true;
            }
            f = f.return;
          }
          return false;
        });
        expect(ok).toBe(true);
        await page.waitForTimeout(rate === 1 ? 4000 : 10_000);
        res.burst = await tasksSince(tBurst);
        res.burstWrites = await page.evaluate(
          () =>
            ((window as any).__repoLog as any[]).filter((e) => e.op === "write")
              .length,
        );

        // (c) external change of the 20 MB file.
        const tExt = await now();
        await page.evaluate(() =>
          (window as any).__libraryRepo.setFile(
            "personal",
            (window as any).__genLib(
              2000,
              (window as any).__calibrate(2000, 20),
              "ext",
            ),
          ),
        );
        // generation above is itself a long task: measure from after generation
        const tExtAfterGen = await now();
        await page.waitForTimeout(rate === 1 ? 6000 : 14_000);
        res.ext = await tasksSince(tExtAfterGen);
        void tExt;
      } catch (e) {
        res.error = String(e).slice(0, 160);
        res.crashed = crashed;
      }
      if (cdp) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      }
      record({ test: "longtasks", rate, run, seeded, ...res }, browserName);
    });
  }
}

// ---------------------------------------------------------------------------
// 5: JS heap after loading the 20 MB library vs no library (chromium, CDP).
// ---------------------------------------------------------------------------
for (const variant of ["none", "big", "big-unopened"] as const) {
  for (let run = 1; run <= RUNS; run++) {
    test(`heap ${variant} run${run}`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "CDP heap usage");
      const { hasLib } = await setupPage(page);
      test.skip(variant !== "none" && !hasLib, "baseline has no library");
      let bytes = 0;
      if (variant !== "none") {
        bytes = (await seedBig(page)).bytes;
      }
      await expandTree(page);
      if (variant !== "big-unopened") {
        await clickTree(page, "Graphs");
        await expect(
          page.locator(".vault-editor canvas.interactive"),
        ).toBeVisible();
        await page.waitForTimeout(6000);
      }
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      record(
        {
          test: "heap",
          variant,
          run,
          usedMb: heap.usedSize / 1048576,
          totalMb: heap.totalSize / 1048576,
          fileMb: bytes / 1048576,
        },
        browserName,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// 6: idle for 10 s after everything settled: timers, rAF, repo calls.
// ---------------------------------------------------------------------------
for (const variant of ["none", "big"] as const) {
  test(`idle ${variant}`, async ({ page, browserName }) => {
    const { hasLib } = await setupPage(page, { timers: true });
    test.skip(variant === "big" && !hasLib, "baseline has no library");
    if (variant === "big") {
      await seedBig(page);
    }
    await expandTree(page);
    await instrumentRepo(page);
    await clickTree(page, "Graphs");
    await expect(
      page.locator(".vault-editor canvas.interactive"),
    ).toBeVisible();
    await page.waitForTimeout(8000); // load, debounce, autosave settled
    const snap = () =>
      page.evaluate(() => {
        const w = window as any;
        const log = (w.__repoLog ?? []) as any[];
        return {
          ...w.__timers,
          reads: log.filter((e) => e.op === "read").length,
          writes: log.filter((e) => e.op === "write").length,
        };
      });
    const a = await snap();
    await page.waitForTimeout(10_000);
    const b = await snap();
    const diff = Object.fromEntries(
      Object.keys(a).map((k) => [k, (b as any)[k] - (a as any)[k]]),
    );
    record({ test: "idle", variant, window_s: 10, ...diff }, browserName);
  });
}
