/* eslint-disable no-console */
import { expect, test } from "@playwright/test";

import { scene } from "./thumbnailScenes";
import { buildStep0, cleanupStep0, openStep0 } from "./thumbnailsStep0Page";

import type { Step0Hooks } from "./thumbnailsStep0";

// #46: how long does rendering thumbnails block the main thread? A timer
// heartbeat records the gap between consecutive ticks, minus the idle gap (so a
// gap is the longest task, in every engine; WebKit has no longtask entries).
// Per thumbnail: the longest gap and the wall time; per batch: total wall time
// and the time spent in gaps over one 60 Hz frame. One `THUMBBLOCK_PERF {json}`
// line per case (record.mjs spec ingests `<NAME>_PERF`).
//
//   E2E_PERF=1 E2E_FULL=1 E2E_WORKERS=1 npx playwright test e2e/thumbnailsBlocking.spec.ts
//   (THUMB_BIG=600,2000,2500 big cases; THUMB_RATES=1,4 CPU throttle rates;
//   THUMB_CAP=12000 raises the element cap for the run)
//
// Only `renderScenePng(json, density)` is used, so the spec runs unchanged on
// older checkouts (before/after comparisons).
const PERF = process.env.E2E_PERF === "1" || process.env.THUMB_PERF === "1";
const DENSITY = Number(process.env.THUMB_DENSITY ?? 2);
const ROUNDS = Number(process.env.THUMB_ROUNDS ?? 3);
/** Big single-drawing cases, e.g. THUMB_BIG=600,2000,2500 (positive integers). */
const BIG_RAW = (process.env.THUMB_BIG ?? "600,2000,2500")
  .split(",")
  .map((v) => v.trim());
if (BIG_RAW.length === 0 || BIG_RAW.some((v) => !/^[1-9][0-9]*$/.test(v))) {
  throw new Error(
    `THUMB_BIG must be a comma-separated list of positive integers, got ${JSON.stringify(
      process.env.THUMB_BIG,
    )}`,
  );
}
const BIG = BIG_RAW.map(Number);
/** Element cap for the run (THUMB_CAP=12000); default keeps the shipped cap. */
const CAP = process.env.THUMB_CAP ? Number(process.env.THUMB_CAP) : null;
/** CPU throttle rates, e.g. THUMB_RATES=4,6 (low-end is judged at 4-6x). */
const RATES = (process.env.THUMB_RATES ?? "1,4").split(",").map(Number);
if (RATES.some((r) => !Number.isFinite(r) || r < 1)) {
  throw new Error(
    `THUMB_RATES must list numbers >= 1, got ${process.env.THUMB_RATES}`,
  );
}
/** Element counts of the 20-drawing batch: a realistic vault mix. */
const BATCH = [
  5, 12, 20, 30, 40, 60, 80, 100, 120, 150, 180, 220, 260, 300, 350, 400, 450,
  500, 5, 40,
];

test.skip(!PERF, "set E2E_PERF=1 to run the thumbnail blocking measurements");
test.describe.configure({ timeout: 900_000 });

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
    : 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

const CASES = [
  {
    name: "batch20",
    json: () => BATCH.map((n, i) => scene(n, i % 2, i % 7 === 3)),
  },
  ...BIG.map((n) => ({ name: `big-${n}`, json: () => [scene(n, 1)] })),
];

test.describe("thumbnail main-thread blocking", () => {
  test.beforeAll(buildStep0);
  test.afterAll(cleanupStep0);

  for (const rate of RATES) {
    test(`blocking, cpu x${rate}`, async ({ page, browserName, baseURL }) => {
      test.skip(
        rate > 1 && browserName !== "chromium",
        "CDP throttling is chromium only",
      );
      await openStep0(page, new URL(baseURL!).origin);
      if (CAP) {
        await page.evaluate((cap) => {
          (window as any).__step0.setThumbMaxElements?.(cap);
        }, CAP);
      }
      const cdp = rate > 1 ? await page.context().newCDPSession(page) : null;
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate });
      // Warm the editor chunk, fonts and JIT with one throw-away render.
      await page.evaluate(
        async ({ json, density }) => {
          await (window as any).__step0.renderScenePng(json, density);
        },
        { json: scene(30, 1), density: DENSITY },
      );
      // Heap after a forced GC (Chromium only): no lasting growth per case.
      const heapMb = async () => {
        if (browserName !== "chromium") {
          return null;
        }
        const heapCdp = await page.context().newCDPSession(page);
        await heapCdp.send("HeapProfiler.collectGarbage");
        const { usedSize } = await heapCdp.send("Runtime.getHeapUsage");
        await heapCdp.detach();
        return r1(usedSize / 1048576);
      };
      const heapBefore = await heapMb();
      for (const c of CASES) {
        const jsons = c.json();
        const perThumb = { longest: [] as number[], wall: [] as number[] };
        let totalWall = 0;
        let over16 = 0;
        let over50 = 0;
        let fails = 0;
        for (let round = 0; round < ROUNDS; round++) {
          const res = await page.evaluate(
            async ({ jsons, density }) => {
              const { renderScenePng } = (
                window as unknown as { __step0: Step0Hooks }
              ).__step0;
              const ticks: { end: number; gap: number }[] = [];
              let last = performance.now();
              let running = true;
              // A 1 ms timer chain (clamped to ~4 ms by the engine), not a
              // MessageChannel flood: a flood starves Chromium's toBlob
              // completion and inflates the render's wall time.
              const beat = () => {
                const now = performance.now();
                ticks.push({ end: now, gap: now - last });
                last = now;
                if (running) {
                  setTimeout(beat, 1);
                }
              };
              setTimeout(beat, 1);
              await new Promise((r) => setTimeout(r, 200));
              // Idle gap of the timer chain: subtracted, so a gap is task time.
              const idle = ticks.map((t) => t.gap).sort((x, y) => x - y)[
                Math.floor(ticks.length / 2)
              ];
              ticks.length = 0;
              const out: { longest: number; wall: number; ok: boolean }[] = [];
              const allGaps: number[] = [];
              for (const json of jsons) {
                const t0 = performance.now();
                const r = await renderScenePng(json, density);
                const wall = performance.now() - t0;
                await new Promise((r2) => setTimeout(r2, 30));
                const t1 = performance.now();
                const mine = ticks
                  .filter((t) => t.end > t0 && t.end <= t1)
                  .map((t) => Math.max(0, t.gap - idle));
                out.push({
                  longest: mine.reduce((m, g) => Math.max(m, g), 0),
                  wall,
                  ok: r.kind === "png",
                });
                for (const g of mine) {
                  allGaps.push(g);
                }
                ticks.length = 0;
              }
              running = false;
              return { out, allGaps };
            },
            { jsons, density: DENSITY },
          );
          for (const o of res.out) {
            perThumb.longest.push(o.longest);
            perThumb.wall.push(o.wall);
            totalWall += o.wall;
            fails += o.ok ? 0 : 1;
          }
          over16 += res.allGaps
            .filter((g) => g > 16)
            .reduce((a, g) => a + g, 0);
          over50 += res.allGaps.filter((g) => g > 50).length;
        }
        const row = {
          case: c.name,
          engine: browserName,
          cpuRate: rate,
          density: DENSITY,
          thumbs: perThumb.wall.length,
          // Longest single main-thread task while one thumbnail rendered.
          longestP50: r1(pct(perThumb.longest, 50)),
          longestP95: r1(pct(perThumb.longest, 95)),
          longestMax: r1(perThumb.longest.reduce((m, g) => Math.max(m, g), 0)),
          wallP50: r1(pct(perThumb.wall, 50)),
          wallP95: r1(pct(perThumb.wall, 95)),
          wallTotalPerRound: r1(totalWall / ROUNDS),
          // Per round: time in tasks longer than one 60 Hz frame, and count over 50 ms.
          blockedOver16PerRound: r1(over16 / ROUNDS),
          tasksOver50PerRound: r1(over50 / ROUNDS),
          fails,
        };
        console.log(`THUMBBLOCK_PERF ${JSON.stringify(row)}`);
        const heapAfter = await heapMb();
        if (heapAfter !== null) {
          console.log(
            `THUMBMEM ${JSON.stringify({
              case: c.name,
              cpuRate: rate,
              heapBeforeMb: heapBefore,
              heapAfterMb: heapAfter,
            })}`,
          );
        }
        expect(fails).toBe(0);
      }
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    });
  }
});
