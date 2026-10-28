import { appendFileSync } from "node:fs";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault } from "./helpers";
import { AFTER_AUTOSAVE_MS } from "./constants";

// Re-render counts and main-thread cost of typing, panning and autosave
// (editor render team). Skipped unless E2E_PERF=1. Rows are appended as JSON
// lines to $PERF_OUT. Render counters (window.__rc: app / editor / excal
// commits) only exist in instrumented builds; they are reported when present.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-editor-render.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4").split(",").map(Number);
const KEYS = 40;
const PAN_STEPS = 60;

test.skip(!PERF, "set E2E_PERF=1 to run the editor render measurements");
test.describe.configure({ timeout: 240_000 });

for (const rate of RATES) {
  test(`typing, pan and autosave cost, cpu x${rate}`, async ({
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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metric = async (name: string) =>
      (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === name,
      )!.value;
    const counts = () =>
      page.evaluate(() => ({ ...((window as any).__rc ?? {}) }));
    const diff = (a: Record<string, number>, b: Record<string, number>) =>
      Object.fromEntries(
        Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]),
      );
    const startFrames = () =>
      page.evaluate(() => {
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
    const stopFrames = () =>
      page.evaluate(() => {
        const w = window as any;
        cancelAnimationFrame(w.__raf);
        return (w.__frames as number[]).slice(3);
      });

    const measure = async (
      label: string,
      run: () => Promise<void>,
      n: number,
    ) => {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await startFrames();
      const c0 = await counts();
      const js0 = await metric("ScriptDuration");
      const task0 = await metric("TaskDuration");
      await run();
      const js = ((await metric("ScriptDuration")) - js0) * 1000;
      const task = ((await metric("TaskDuration")) - task0) * 1000;
      const renders = diff(c0, await counts());
      const frames = await stopFrames();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const sorted = [...frames].sort((a, b) => a - b);
      const row = {
        label,
        cpuRate: rate,
        jsMsPerOp: +(js / n).toFixed(2),
        taskMsPerOp: +(task / n).toFixed(2),
        rendersPerOp: Object.fromEntries(
          Object.entries(renders).map(([k, v]) => [k, +(v / n).toFixed(2)]),
        ),
        renders,
        p95Frame: +sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(1),
        over50: frames.filter((f) => f > 50).length,
      };
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      // eslint-disable-next-line no-console
      console.log(`PERF ${JSON.stringify(row)}`);
    };

    const box = await canvasBox(page);
    await page.mouse.dblclick(
      box.x + box.width * 0.6,
      box.y + box.height * 0.7,
    );
    const area = page.locator("textarea.excalidraw-wysiwyg");
    await expect(area).toBeFocused();
    await measure(
      "typing",
      async () => {
        for (let i = 0; i < KEYS; i++) {
          await page.keyboard.type("a");
          await page.waitForTimeout(60);
        }
      },
      KEYS,
    );
    // Autosave: the idle debounce fires, the file is written, the watcher echoes.
    await measure("autosave", () => page.waitForTimeout(AFTER_AUTOSAVE_MS), 1);
    await page.keyboard.press("Escape");
    await expect(area).toHaveCount(0);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await measure(
      "pan",
      async () => {
        for (let i = 0; i < PAN_STEPS; i++) {
          await page.mouse.wheel(i % 2 ? 20 : -20, 12);
          await page.waitForTimeout(16);
        }
      },
      PAN_STEPS,
    );
  });
}
