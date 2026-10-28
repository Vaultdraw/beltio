import { mkdirSync, writeFileSync } from "node:fs";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Tool-switch latency with and without tool defaults. Skipped unless
// E2E_PERF=1. Chromium only (CDP CPU throttle, longtask observer).
const PERF = process.env.E2E_PERF === "1";
const OUT_DIR = "test-results/tool-defaults";
const RATES = (process.env.PERF_RATES ?? "1,4").split(",").map(Number);
const KEYS = ["r", "a", "l", "t"] as const;
const TOOL_OF: Record<string, string> = {
  r: "rectangle",
  a: "arrow",
  l: "line",
  t: "text",
};
const SWITCHES = 200;
const CONFIGURED = {
  toolRectangle: { stroke_color: "#e03131", stroke_style: "dashed" },
  toolArrow: { stroke_color: "#f08c00", stroke_width: 3 },
  toolLine: { stroke_style: "dotted", stroke_width: 3 },
};
const EMPTY = { toolRectangle: {}, toolArrow: {}, toolLine: {} };

test.skip(!PERF, "set E2E_PERF=1 to run the tool-switch measurements");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const results: Record<string, any>[] = [];
const quantile = (sorted: number[], p: number) =>
  sorted[Math.floor((sorted.length - 1) * p)];

for (const rate of RATES) {
  for (const mode of ["unconfigured", "configured"] as const) {
    test(`tool switch, ${mode}, cpu x${rate}`, async ({
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
      await page.evaluate(
        (p) => (window as any).__updatePreferences(p),
        mode === "configured" ? CONFIGURED : EMPTY,
      );
      await page.mouse.move(1000, 800);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await page.evaluate(() => {
        const w = window as any;
        w.__long = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__long.push(e.duration);
          }
        }).observe({ type: "longtask" });
      });

      const times: number[] = [];
      for (let i = 0; i < SWITCHES + 8; i++) {
        const key = KEYS[i % KEYS.length];
        // Keydown dispatch (CDP) -> next animation frame once the toolbar
        // shows the new tool as active.
        const t0 = await page.evaluate(() => performance.now());
        await page.keyboard.press(key);
        const dt = await page.evaluate(
          ([tool, start]) =>
            new Promise<number>((resolve) => {
              const btn = document.querySelector(
                `.vault-editor [data-testid='toolbar-${tool}']`,
              ) as any;
              const active = () =>
                (btn.querySelector("input")?.checked ??
                  btn.checked ??
                  btn.getAttribute("aria-pressed") === "true") === true;
              const tick = () => {
                if (active()) {
                  requestAnimationFrame(() =>
                    resolve(performance.now() - (start as number)),
                  );
                } else {
                  requestAnimationFrame(tick);
                }
              };
              tick();
            }),
          [TOOL_OF[key], t0] as const,
        );
        if (i >= 8) {
          times.push(dt);
        }
      }
      const long: number[] = await page.evaluate(() => (window as any).__long);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const sorted = [...times].sort((a, b) => a - b);
      const row = {
        mode,
        cpuRate: rate,
        n: times.length,
        p50: +quantile(sorted, 0.5).toFixed(2),
        p95: +quantile(sorted, 0.95).toFixed(2),
        max: +sorted[sorted.length - 1].toFixed(2),
        longTasks: long.filter((d) => d > 50).length,
        longestTask: +Math.max(0, ...long).toFixed(1),
      };
      results.push(row);
      // eslint-disable-next-line no-console
      console.log(`PERF ${JSON.stringify(row)}`);
      expect(times.length).toBe(SWITCHES);
      await page.evaluate((p) => (window as any).__updatePreferences(p), EMPTY);
    });
  }
}

test.afterAll(() => {
  if (results.length === 0) {
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const verdicts: Record<string, any> = {};
  for (const rate of RATES) {
    const off = results.find(
      (r) => r.cpuRate === rate && r.mode === "unconfigured",
    );
    const on = results.find(
      (r) => r.cpuRate === rate && r.mode === "configured",
    );
    if (off && on) {
      const allowed = Math.max(off.p95 * 1.05, off.p95 + 1);
      verdicts[`x${rate}`] = {
        unconfiguredP95: off.p95,
        configuredP95: on.p95,
        allowedP95: +allowed.toFixed(2),
        withinBudget: on.p95 <= allowed,
      };
    }
  }
  writeFileSync(
    `${OUT_DIR}/perf.json`,
    JSON.stringify({ results, verdicts }, null, 2),
  );
  const lines = [
    "mode          cpu  n    p50    p95    max   long>50  longest",
  ];
  for (const r of results) {
    lines.push(
      `${r.mode.padEnd(13)} x${String(r.cpuRate).padEnd(3)} ${r.n}  ${String(
        r.p50,
      ).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.max).padStart(
        6,
      )}  ${String(r.longTasks).padStart(6)}  ${r.longestTask}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\n${lines.join("\n")}\n${JSON.stringify(verdicts)}`);
});
