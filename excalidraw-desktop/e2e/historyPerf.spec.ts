import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault } from "./helpers";
import {
  BLUE,
  gridScene,
  panel,
  preview,
  RED,
  rectEl,
  rows,
  sceneJson,
  setup,
  type Rgb,
} from "./historyHelpers";

// File history main-thread cost (E2E_PERF=1, chromium for CDP task time).
//   history.mainThread.checkpoint  ms of main-thread task time from pressing Enter
//                                  in the checkpoint dialog until it is confirmed,
//                                  with nothing pending to flush (a save came first).
//   history.mainThread.autoVersion count of history IPC calls during 10 autosaves
//                                  (must be 0).
// H2 panel / preview / restore rows (see the "H2" block at the end of the file).
//   history.panel.open.500v  history.preview.open.{200,5k}  history.scrub.frame.200
//   history.scrub.settle.5k  history.restore.replace.5k    history.thumb.render.{500,1k,2k}
//   history.memory.panelClosed  history.memory.preview.5k
const PERF = process.env.E2E_PERF === "1";
const RUNS = 15;
const AUTOSAVES = 10;

test.skip(!PERF, "set E2E_PERF=1 to run the history measurements");
test.describe.configure({ timeout: 240_000 });

const writeCount = (page: Page) =>
  page.evaluate(() => (window as any).__vaultRepo.writeCalls.length as number);

const drawRectangle = async (page: Page, n: number) => {
  const box = await canvasBox(page);
  await page.locator(".vault-editor [data-testid='toolbar-rectangle']").click();
  const x0 = box.x + box.width * 0.2 + (n % 8) * 30;
  const y0 = box.y + box.height * 0.6 + (n % 5) * 10;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0 + 30, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press("1");
};

const nextSave = async (page: Page, action: () => Promise<void>) => {
  const before = await writeCount(page);
  await action();
  await expect
    .poll(() => writeCount(page), { timeout: 8000 })
    .toBeGreaterThan(before);
};

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: +at(0.5).toFixed(2),
    p95: +at(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    n: values.length,
  };
};

const report = (row: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);

test("history main-thread cost: checkpoint and automatic versions", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP task time is chromium only");
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const task = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === "TaskDuration",
    )!.value * 1000;

  // Automatic versions: zero history IPC while autosaving.
  const callsBefore = await page.evaluate(
    () => (window as any).__historyRepo.calls.length as number,
  );
  for (let i = 0; i < AUTOSAVES; i++) {
    await nextSave(page, () => drawRectangle(page, i));
  }
  const callsAfter = await page.evaluate(
    () => (window as any).__historyRepo.calls.length as number,
  );
  const autoCalls = callsAfter - callsBefore;
  report({
    metric: "history.mainThread.autoVersion",
    unit: "count",
    p50: autoCalls,
    p95: autoCalls,
    max: autoCalls,
    n: AUTOSAVES,
    browser: browserName,
    throttle: 1,
  });
  expect(autoCalls).toBe(0);

  // Checkpoint: nothing is pending, so the flush is a no-op.
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    await page.keyboard.press("Meta+Alt+KeyS");
    const dialog = page.getByRole("dialog", { name: "Create checkpoint" });
    await dialog.getByLabel("Name").fill(`perf ${i}`);
    await page.waitForTimeout(150);
    const before = await task();
    await dialog.getByLabel("Name").press("Enter");
    await expect(page.locator(".vd-toast")).toContainText(`perf ${i}`);
    samples.push((await task()) - before);
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(100);
  }
  const row = stats(samples);
  report({
    metric: "history.mainThread.checkpoint",
    unit: "ms",
    ...row,
    browser: browserName,
    throttle: 1,
  });
});

// ---------------------------------------------------------------- H2 rows
// Numbers taken while other teams use the machine are notes only (see the
// quiet-measurement rules in personal/feature/README.md).

const PROFILE = "e2e-browser";
const THROTTLES = [1, 4] as const;

const h2Report = (
  metric: string,
  unit: string,
  values: number[],
  throttle: number,
  extra: Record<string, unknown> = {},
) =>
  report({
    metric,
    unit,
    ...stats(values),
    browser: "chromium",
    profile: PROFILE,
    throttle,
    ...extra,
  });

/** A big solid rectangle under the grid: probe pixels find it anywhere. */
const sentinelScene = (n: number, color: Rgb, rough = 0) => [
  rectEl("sent", 0, 0, color, 1520, 40 + Math.ceil(n / 50) * 24, 99),
  ...gridScene(n).map((e) => ({ ...e, roughness: rough })),
];

const sentinelJson = (n: number, color: Rgb) =>
  sceneJson(sentinelScene(n, color));

const throttle = async (cdp: any, rate: number) =>
  cdp.send("Emulation.setCPUThrottlingRate", { rate });

/** Page-side clock, long-task observer and paint probe (installed once). */
const installProbes = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    if (w.__probe) {
      return;
    }
    const probe = { t0: 0, longest: 0, frames: [] as number[], running: false };
    w.__probe = probe;
    const stamp = (e: Event) => {
      probe.t0 = e.timeStamp;
    };
    window.addEventListener("keydown", stamp, true);
    window.addEventListener("pointerdown", stamp, true);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longest = Math.max(probe.longest, entry.duration);
      }
    }).observe({ type: "longtask" });
    w.__framesStart = () => {
      probe.frames = [];
      probe.running = true;
      let last = performance.now();
      const tick = (now: number) => {
        if (!probe.running) {
          return;
        }
        probe.frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    w.__framesStop = () => {
      probe.running = false;
      return probe.frames.slice(1);
    };
    /** ms from the last key/pointer down until `rgb` shows on `scope`. */
    w.__waitPaint = (scope: string, rgb: number[], timeout = 15000) =>
      new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const check = () => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            `${scope} canvas.static`,
          );
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) {
            const cx = Math.floor(canvas.width / 2);
            const cy = Math.floor(canvas.height / 2);
            for (const dx of [-60, 0, 60]) {
              for (const dy of [-60, 0, 60]) {
                const d = ctx.getImageData(cx + dx, cy + dy, 1, 1).data;
                if (
                  Math.abs(d[0] - rgb[0]) <= 12 &&
                  Math.abs(d[1] - rgb[1]) <= 12 &&
                  Math.abs(d[2] - rgb[2]) <= 12 &&
                  d[3] > 240
                ) {
                  resolve(performance.now() - probe.t0);
                  return;
                }
              }
            }
          }
          if (performance.now() - started > timeout) {
            reject(new Error(`no ${rgb} pixel on ${scope}`));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
  });

const paintMs = (page: Page, scope: string, rgb: Rgb) =>
  page.evaluate(
    ({ scope, rgb }) =>
      (window as any).__waitPaint(scope, rgb) as Promise<number>,
    { scope, rgb },
  );

const resetLongest = (page: Page) =>
  page.evaluate(() => {
    (window as any).__probe.longest = 0;
  });
const longest = (page: Page) =>
  page.evaluate(() => (window as any).__probe.longest as number);

const heapMb = async (cdp: any) => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize / 1024 / 1024;
};

const PREVIEW_SCOPE = "[data-testid='history-preview']";
const MAIN_SCOPE = ".vault-editor";
const bigDrawingTimeout = { timeout: 120_000 };

test.describe("H2 panel, preview and restore", () => {
  test.describe.configure({ timeout: 480_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP is chromium only",
  );

  test("history.panel.open.500v", async ({ page }) => {
    const small = sceneJson(sentinelScene(20, RED));
    await setup(
      page,
      sentinelScene(20, BLUE),
      Array.from({ length: 500 }, (_, i) => ({
        json: small,
        partial: i % 50 === 0 ? { reason: "checkpoint", name: `cp ${i}` } : {},
      })),
    );
    await installProbes(page);
    const cdp = await page.context().newCDPSession(page);
    for (const rate of THROTTLES) {
      await throttle(cdp, rate);
      const samples: number[] = [];
      const cold: number[] = [];
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => {
          const w = window as any;
          w.__open = new Promise<number>((resolve) => {
            const obs = new MutationObserver(() => {
              if (document.querySelector(".vault-history-row")) {
                obs.disconnect();
                resolve(performance.now() - w.__probe.t0);
              }
            });
            obs.observe(document.body, { childList: true, subtree: true });
          });
        });
        await page.keyboard.press("Meta+Shift+KeyH");
        const ms = await page.evaluate(() => (window as any).__open as number);
        (i === 0 && rate === 1 ? cold : samples).push(ms);
        await page.keyboard.press("Escape");
        await expect(panel(page)).toHaveCount(0);
        await page.waitForTimeout(150);
      }
      if (cold.length) {
        h2Report("history.panel.open.500v.cold", "ms", cold, rate);
      }
      h2Report("history.panel.open.500v", "ms", samples, rate);
    }
    await throttle(cdp, 1);
  });

  for (const [label, n] of [
    ["200", 200],
    ["5k", 5000],
  ] as const) {
    test(`history.preview.open.${label}`, async ({ page }) => {
      await setup(page, sentinelScene(n, RED), [
        { json: sentinelJson(n, BLUE) },
        { json: sentinelJson(n, RED) },
      ]);
      await installProbes(page);
      const cdp = await page.context().newCDPSession(page);
      await page.keyboard.press("Meta+Shift+KeyH");
      await expect(rows(page)).toHaveCount(2);
      for (const rate of THROTTLES) {
        await throttle(cdp, rate);
        const samples: number[] = [];
        for (let i = 0; i < 9; i++) {
          // KNOWN BUG-P1: leaving the preview and selecting again mounts it
          // blank, so after the first (cold, mounting) sample the loop
          // switches between two versions with the preview kept mounted.
          // Row 1 = BLUE (older), row 0 = RED.
          const toBlue = i % 2 === 0;
          await rows(page)
            .nth(toBlue ? 1 : 0)
            .click();
          samples.push(await paintMs(page, PREVIEW_SCOPE, toBlue ? BLUE : RED));
          await page.waitForTimeout(250);
        }
        // The first sample mounts the second editor (lazy chunk, cold).
        h2Report(
          `history.preview.open.${label}.cold`,
          "ms",
          samples.slice(0, 1),
          rate,
        );
        h2Report(`history.preview.open.${label}`, "ms", samples.slice(1), rate);
      }
      await throttle(cdp, 1);
    });
  }

  test("history.scrub.frame.200", async ({ page }) => {
    const versions = Array.from({ length: 80 }, (_, i) => ({
      json: sentinelJson(200, i % 2 ? RED : BLUE),
    }));
    await setup(page, sentinelScene(200, RED), versions);
    await installProbes(page);
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press("Meta+Shift+KeyH");
    await expect(rows(page)).toHaveCount(80);
    await rows(page).nth(0).click();
    await expect(preview(page)).toBeVisible();
    await page.getByRole("slider", { name: "Version timeline" }).focus();
    for (const rate of THROTTLES) {
      await throttle(cdp, rate);
      await page.waitForTimeout(400);
      await resetLongest(page);
      await page.evaluate(() => (window as any).__framesStart());
      // Hold the key: auto-repeat at ~30 Hz for about 2 s.
      for (let i = 0; i < 60; i++) {
        await page.keyboard.down("ArrowLeft");
        await page.waitForTimeout(33);
      }
      await page.keyboard.up("ArrowLeft");
      const frames = await page.evaluate(
        () => (window as any).__framesStop() as number[],
      );
      const lt = await longest(page);
      h2Report("history.scrub.frame.200", "ms", frames, rate, {
        longestTaskMs: +lt.toFixed(1),
      });
      h2Report("history.scrub.longestTask.200", "ms", [lt], rate);
      await page.keyboard.press("End");
      await page.waitForTimeout(300);
      await rows(page).nth(0).click();
      await page.getByRole("slider", { name: "Version timeline" }).focus();
    }
    await throttle(cdp, 1);
  });

  test("history.scrub.settle.5k and history.restore.replace.5k", async ({
    page,
  }) => {
    const blue = sentinelJson(5000, BLUE);
    const red = sentinelJson(5000, RED);
    // Newest first in the list: [red, blue, red, blue].
    await setup(page, sentinelScene(5000, RED), [
      { json: blue },
      { json: red },
      { json: blue },
      { json: red },
    ]);
    await installProbes(page);
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press("Meta+Shift+KeyH");
    await expect(rows(page)).toHaveCount(4);
    const slider = page.getByRole("slider", { name: "Version timeline" });

    for (const rate of THROTTLES) {
      await throttle(cdp, rate);
      // Settle: step to an older version (colour flips every step).
      await rows(page).nth(0).click();
      await page.waitForTimeout(600);
      await slider.focus();
      const settle: number[] = [];
      let color: Rgb = RED;
      for (let i = 0; i < 3; i++) {
        color = color === RED ? BLUE : RED;
        await page.keyboard.press("ArrowLeft");
        settle.push(await paintMs(page, PREVIEW_SCOPE, color));
        await page.waitForTimeout(200);
      }
      h2Report("history.scrub.settle.5k", "ms", settle, rate);
      await page.keyboard.press("Home"); // oldest; keeps the preview mounted
      await page.waitForTimeout(600);
    }
    await throttle(cdp, 1);

    // Replace: main shows RED; restore the BLUE rows, then the RED rows, ...
    const replace: number[] = [];
    let mainColor: Rgb = RED;
    for (let i = 0; i < 6; i++) {
      const want: Rgb = mainColor === RED ? BLUE : RED;
      // Rows (newest first): 0 red, 1 blue, 2 red, 3 blue.
      await rows(page)
        .nth(want === BLUE ? 1 : 0)
        .click();
      await page.waitForTimeout(500); // (a re-mounted preview is blank: BUG-P1)
      await page.getByTestId("history-restore").click();
      const dialog = page.getByRole("dialog", { name: /^Restore / });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(100);
      await dialog
        .getByRole("button", { name: "Replace current drawing" })
        .click();
      replace.push(await paintMs(page, MAIN_SCOPE, want));
      mainColor = want;
      await expect(preview(page)).toHaveCount(0, bigDrawingTimeout);
      await page.waitForTimeout(600);
    }
    h2Report("history.restore.replace.5k", "ms", replace.slice(1), 1);
  });

  for (const [label, n] of [
    ["500", 500],
    ["1k", 1000],
    ["2k", 2000],
  ] as const) {
    test(`history.thumb.render.${label}`, async ({ page }) => {
      const json = sentinelJson(n, BLUE);
      await setup(page, sentinelScene(20, RED), [
        { json, partial: { reason: "checkpoint", name: "thumb" } },
      ]);
      await installProbes(page);
      const cdp = await page.context().newCDPSession(page);
      for (const rate of THROTTLES) {
        await throttle(cdp, rate);
        const samples: number[] = [];
        const tasks: number[] = [];
        for (let i = 0; i < 7; i++) {
          await resetLongest(page);
          await page.evaluate(() => {
            const w = window as any;
            w.__thumb = new Promise<number>((resolve) => {
              let tRow = 0;
              const obs = new MutationObserver(() => {
                if (!tRow && document.querySelector(".vault-history-row")) {
                  tRow = performance.now();
                }
                if (tRow && document.querySelector(".vault-history-row img")) {
                  obs.disconnect();
                  resolve(performance.now() - tRow);
                }
              });
              obs.observe(document.body, { childList: true, subtree: true });
              setTimeout(() => resolve(-1), 20_000);
            });
          });
          await page.keyboard.press("Meta+Shift+KeyH");
          const ms = await page.evaluate(
            () => (window as any).__thumb as number,
          );
          samples.push(ms);
          tasks.push(await longest(page));
          await page.keyboard.press("Escape");
          await expect(panel(page)).toHaveCount(0);
          await page.waitForTimeout(150);
        }
        h2Report(`history.thumb.render.${label}`, "ms", samples, rate, {
          elements: n,
          longestTaskMs: +Math.max(...tasks).toFixed(1),
        });
      }
      await throttle(cdp, 1);
    });
  }

  test("history.memory.panelClosed and history.memory.preview.5k", async ({
    page,
  }) => {
    const big = Array.from({ length: 6 }, (_, i) => ({
      json: sentinelJson(5000, i % 2 ? RED : BLUE),
    }));
    await setup(page, sentinelScene(5000, RED), big);
    await installProbes(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await page.waitForTimeout(1500);

    const before = await heapMb(cdp);
    await page.keyboard.press("Meta+Shift+KeyH");
    await expect(rows(page)).toHaveCount(6);
    await rows(page).nth(0).click();
    await paintMs(page, PREVIEW_SCOPE, BLUE);
    await page.waitForTimeout(500);
    const withPreview = await heapMb(cdp);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(400);
    }
    await page.keyboard.press("Escape");
    await expect(preview(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await page.waitForTimeout(5000);
    const after = await heapMb(cdp);

    const row = (metric: string, v: number, budget: number) =>
      report({
        metric,
        unit: "MB",
        p50: +v.toFixed(2),
        p95: +v.toFixed(2),
        max: +v.toFixed(2),
        n: 1,
        budget,
        browser: "chromium",
        profile: PROFILE,
        throttle: 1,
        heapBeforeMb: +before.toFixed(2),
      });
    row("history.memory.preview.5k", withPreview - before, 80);
    row("history.memory.panelClosed", after - before, 2);
  });
});
