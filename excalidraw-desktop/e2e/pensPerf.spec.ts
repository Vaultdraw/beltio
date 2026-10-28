import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, readScene } from "./helpers";

// Laser / freedraw frame times and long tasks (F17). Skipped unless E2E_PERF=1.
// Results are appended as JSON lines to $PERF_OUT. CPU throttle via CDP
// (chromium only).
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-laser.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4,6").split(",").map(Number);
const DRAWING = "DSA/Graphs.excalidraw";
const BASE = { laserSize: 2, laserDecayMs: 1000, laserLength: 50 };
const CASES = [
  { tool: "laser", key: "k", look: "default", prefs: {} },
  {
    tool: "laser",
    key: "k",
    look: "max",
    prefs: { laserSize: 24, laserDecayMs: 5000, laserLength: 200 },
  },
  { tool: "freedraw", key: "p", look: "default", prefs: {} },
] as const;

test.skip(!PERF, "set E2E_PERF=1 to run the laser frame-time measurements");
test.describe.configure({ timeout: 240_000 });

const liveCount = async (page: Page) =>
  (await readScene(page, DRAWING)).elements.filter((el: any) => !el.isDeleted)
    .length;

for (const { tool, key, look, prefs } of CASES) {
  for (const rate of RATES) {
    test(`${tool} frame times, ${look} look, cpu x${rate}`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "CDP throttling is chromium only");
      await openVault(page);
      await page
        .locator(".vault-tree-item__name", { hasText: "DSA" })
        .first()
        .click();
      await openDrawing(page, "Graphs");
      await page.evaluate((p) => (window as any).__updatePreferences(p), {
        ...BASE,
        ...prefs,
      });
      const before = await liveCount(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      // Main-thread busy time: frames saturate at vsync, so this shows headroom.
      await cdp.send("Performance.enable");
      const metric = async (name: string) =>
        (await cdp.send("Performance.getMetrics")).metrics.find(
          (m) => m.name === name,
        )!.value;

      await page.locator(".vault-editor canvas.interactive").hover();
      await page.keyboard.press(key);
      await page.evaluate(() => {
        const w = window as any;
        w.__frames = [];
        w.__long = [];
        w.__lto = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__long.push(e.duration);
          }
        });
        w.__lto.observe({ type: "longtask" });
        let last = performance.now();
        const loop = (t: number) => {
          w.__frames.push(t - last);
          last = t;
          w.__raf = requestAnimationFrame(loop);
        };
        w.__raf = requestAnimationFrame(loop);
      });

      const box = await canvasBox(page);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      let trailSeen = false;
      const task0 = await metric("TaskDuration");
      const wall0 = Date.now();
      // Four slow 1.5 s circles, about 120 pointer events per second.
      for (let stroke = 0; stroke < 4; stroke++) {
        await page.mouse.move(cx + 150, cy);
        await page.mouse.down();
        for (let i = 0; i <= 180; i++) {
          const a = (i / 180) * Math.PI * 2;
          await page.mouse.move(cx + Math.cos(a) * 150, cy + Math.sin(a) * 150);
          await page.waitForTimeout(8);
        }
        if (stroke === 0) {
          trailSeen =
            (await page.locator(".vault-editor .SVGLayer path").count()) > 0;
        }
        await page.mouse.up();
      }
      const busyPct = Math.round(
        ((await metric("TaskDuration")) - task0) / ((Date.now() - wall0) / 1e5),
      );
      await page.waitForTimeout(1000);

      const { frames, longTasks } = await page.evaluate(() => {
        const w = window as any;
        cancelAnimationFrame(w.__raf);
        w.__lto.disconnect();
        return {
          frames: (w.__frames as number[]).slice(5),
          longTasks: w.__long as number[],
        };
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const sorted = [...frames].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
      const row = {
        tool,
        look,
        cpuRate: rate,
        frames: frames.length,
        p50: +q(0.5).toFixed(1),
        p95: +q(0.95).toFixed(1),
        p99: +q(0.99).toFixed(1),
        max: +sorted[sorted.length - 1].toFixed(1),
        over50: frames.filter((f) => f > 50).length,
        busyPct,
        longTasks: longTasks.length,
        longestTask: +Math.max(0, ...longTasks).toFixed(1),
      };
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      // eslint-disable-next-line no-console
      console.log(`PERF ${JSON.stringify(row)}`);

      expect(frames.length).toBeGreaterThan(30);
      if (tool === "laser") {
        // The laser draws an SVG trail and adds nothing to the scene.
        expect(trailSeen).toBe(true);
        await page.waitForTimeout(600);
        expect(await liveCount(page)).toBe(before);
      } else {
        await expect.poll(() => liveCount(page)).toBe(before + 4);
      }
      if (rate === 1) {
        expect(longTasks).toEqual([]);
      }
    });
  }
}
