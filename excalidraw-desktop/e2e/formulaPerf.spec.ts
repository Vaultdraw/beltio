/* eslint-disable no-eval -- evaluates appHandle (a string) in the page to reach the editor instance */
import { expect, type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  SRC,
  appHandle,
  confirmKey,
  dialog,
  openEmpty,
  preview,
  scene,
  source,
} from "./formulaHelpers";
import { runCommand } from "./pageHelpers";

// Formula perf (E2E_PERF=1). Prints `PERF formula.<name> <value>`.
// WebKit: latency only. Chromium (E2E_FULL=1 --project=chromium): + heap, CPU throttle.

const PERF = process.env.E2E_PERF === "1";
const DEBOUNCE_MS = 120;

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const print = (name: string, v: number, unit = "ms") =>
  // eslint-disable-next-line no-console
  console.log(`PERF formula.${name} ${v.toFixed(1)}${unit}`);
const printStats = (name: string, xs: number[]) => {
  print(`${name}.p50`, pct(xs, 50));
  print(`${name}.p95`, pct(xs, 95));
};

/** Palette command -> first preview, on a freshly loaded page (cold worker). */
const coldRun = async (page: Page, i: number, tag: string) => {
  await openEmpty(page, `Perf${tag}${i}.excalidraw`);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("Formula: Insert formula");
  await expect(
    page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("option")
      .first(),
  ).toContainText("Formula: Insert formula");
  await page.evaluate(() => {
    const w = window as any;
    w.__cold = { t0: null, t1: null, tDialog: null, tInput: null };
    document.addEventListener(
      "input",
      () => (w.__cold.tInput ??= performance.now()),
      true,
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && w.__cold.t0 === null) {
          w.__cold.t0 = performance.now();
        }
      },
      true,
    );
    new MutationObserver(() => {
      const img = document.querySelector<HTMLImageElement>(
        '[role="dialog"] img[alt="Formula preview"]',
      );
      if (
        w.__cold.tDialog === null &&
        document.querySelector('[role="dialog"] textarea#formula-source')
      ) {
        w.__cold.tDialog = performance.now();
      }
      if (img?.getAttribute("src") && w.__cold.t1 === null) {
        w.__cold.t1 = performance.now();
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await source(page).fill(SRC);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cold.t1), {
      timeout: 15000,
    })
    .not.toBeNull();
  const c = await page.evaluate(() => {
    const res = performance
      .getEntriesByType("resource")
      .filter((e) => /FormulaDialog|formula\.worker/.test(e.name))
      .map((e) => {
        const r = e as PerformanceResourceTiming;
        return `${r.name.split("/").pop()}@${r.startTime.toFixed(0)}+${(
          r.responseEnd - r.startTime
        ).toFixed(0)}`;
      });
    return { ...(window as any).__cold, res } as {
      t0: number;
      t1: number;
      tDialog: number;
      tInput: number;
      res: string[];
    };
  });
  // eslint-disable-next-line no-console
  console.log(
    `PERF formula.coldBreakdown enter->dialog ${(c.tDialog - c.t0).toFixed(
      0,
    )} dialog->input ${(c.tInput - c.tDialog).toFixed(0)} input->preview ${(
      c.t1 - c.tInput
    ).toFixed(0)} (t0 ${c.t0.toFixed(0)}; ${c.res.join(" ")})`,
  );
  return c.t1 - c.t0;
};

const coldRuns = async (
  page: Page,
  n: number,
  tag: string,
  before?: () => Promise<void>,
) => {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    await before?.();
    xs.push(await coldRun(page, i, tag));
  }
  return xs;
};

/** input event -> preview src change, in-page (no Playwright round-trips), N sources. */
const warmRuns = async (page: Page, n: number, tag: string) => {
  await openEmpty(page, `PerfWarm${tag}.excalidraw`);
  await runCommand(page, "Formula: Insert formula");
  await source(page).fill(SRC);
  await preview(page).waitFor({ state: "visible" });
  await page.evaluate(() => {
    const w = window as any;
    w.__warm = { t0: 0, laps: [] as number[] };
    document.addEventListener(
      "input",
      () => (w.__warm.t0 = performance.now()),
      true,
    );
    const img = document.querySelector(
      '[role="dialog"] img[alt="Formula preview"]',
    )!;
    new MutationObserver(() =>
      w.__warm.laps.push(performance.now() - w.__warm.t0),
    ).observe(img, { attributes: true, attributeFilter: ["src"] });
  });
  for (let i = 0; i < n; i++) {
    await source(page).fill(
      String.raw`\frac{${i + 2}}{x^{${i + 3}}} + \sqrt{${
        i + 5
      }} + ${tag}_{${i}}`,
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__warm.laps.length), {
        timeout: 10000,
      })
      .toBeGreaterThanOrEqual(i + 1);
  }
  const laps = await page.evaluate(
    () => (window as any).__warm.laps as number[],
  );
  return laps.slice(-n);
};

const insertCost = async (page: Page, n: number) => {
  await page.evaluate(() => {
    const w = window as any;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          w.__tIns = performance.now();
        }
      },
      true,
    );
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!(await dialog(page).isVisible())) {
      await runCommand(page, "Formula: Insert formula");
    }
    await source(page).fill(String.raw`x_{${i}} + y^{${i}}`);
    await expect
      .poll(() =>
        preview(page)
          .getAttribute("src")
          .then((s) => !!s),
      )
      .toBe(true);
    await page.waitForTimeout(150);
    await page.evaluate((code) => {
      const app = (0, eval)(code);
      const w = window as any;
      w.__ins = null;
      const n0 = app.scene.getNonDeletedElements().length;
      const tick = () => {
        if (app.scene.getNonDeletedElements().length > n0) {
          w.__ins = performance.now() - w.__tIns;
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }, appHandle);
    await confirmKey(page);
    await expect
      .poll(() => page.evaluate(() => (window as any).__ins))
      .not.toBeNull();
    out.push(await page.evaluate(() => (window as any).__ins as number));
    await expect(dialog(page)).toHaveCount(0);
  }
  return out;
};

test.describe("formula perf", () => {
  test.skip(!PERF, "set E2E_PERF=1");

  test("no mathjax/formula chunk is requested before the first formula command", async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openEmpty(page, "PerfStartup.excalidraw");
    await page.waitForTimeout(1500);
    const isFormula = (u: string) => /mathjax|formula|tex-svg/i.test(u);
    const early = urls.filter(isFormula);
    // eslint-disable-next-line no-console
    console.log(
      `PERF formula.startupFormulaRequests ${early.length} (of ${urls.length} requests)`,
    );
    expect(early).toEqual([]);
    const n0 = urls.length;
    await runCommand(page, "Formula: Insert formula");
    await source(page).fill(SRC);
    await preview(page).waitFor({ state: "visible" });
    const later = urls.slice(n0).filter(isFormula);
    // eslint-disable-next-line no-console
    console.log(
      `PERF formula.chunksAfterFirstCommand ${later.length} ${later
        .map((u) => u.split("/").pop())
        .join(",")}`,
    );
    expect(later.length).toBeGreaterThan(0);
  });

  test("cold first formula, warm render, insert cost, hash+base64", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const cold = await coldRuns(page, 7, "c");
    printStats("firstFormulaCold", cold);

    const warm = await warmRuns(page, 50, "w");
    printStats("warmInputToPreview", warm);
    printStats(
      "warmMinusDebounce",
      warm.map((x) => x - DEBOUNCE_MS),
    );
    // pure worker round-trip is not importable in the built e2e bundle: skipped.

    const ins = await insertCost(page, 6);
    printStats("insertCost", ins);

    // hash + base64 on a real formula SVG (same algorithm as svgPost.ts)
    const s = await scene(page);
    const file = Object.values(s.files)[0];
    const bench = await page.evaluate(async (dataURL) => {
      const svg = atob(dataURL.split(",")[1]);
      const enc = new TextEncoder();
      const b64 = () => {
        const bytes = enc.encode(svg);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
      };
      const hash = async () =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-1", enc.encode(svg))),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
      const lap = async (f: () => unknown) => {
        const xs: number[] = [];
        for (let i = 0; i < 200; i++) {
          const t = performance.now();
          await f();
          xs.push(performance.now() - t);
        }
        return xs;
      };
      return { bytes: svg.length, b64: await lap(b64), hash: await lap(hash) };
    }, file.dataURL as string);
    print("svgBytes", bench.bytes, "B");
    printStats("base64", bench.b64);
    printStats("hashSha1", bench.hash);
  });

  test("chromium: JS heap before/after first formula and after 100 renders", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "performance.memory / CDP are Chromium-only",
    );
    test.setTimeout(180_000);
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
      const { metrics } = await cdp.send("Performance.getMetrics");
      return metrics.find((m) => m.name === "JSHeapUsedSize")!.value / 1048576;
    };
    await openEmpty(page, "PerfHeap.excalidraw");
    await page.waitForTimeout(1000);
    print("mainHeapBeforeFirstFormula", await heap(), "MB");
    await runCommand(page, "Formula: Insert formula");
    await source(page).fill(SRC);
    await preview(page).waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    print("mainHeapAfterFirstFormula", await heap(), "MB");
    const workers = page.workers();
    const wheap = async () =>
      workers.length
        ? ((await workers[0].evaluate(
            () => (performance as any).memory?.usedJSHeapSize ?? 0,
          )) as number) / 1048576
        : 0;
    print("workerCount", workers.length, "");
    print("workerHeapAfterFirstFormula", await wheap(), "MB");
    for (let i = 0; i < 100; i++) {
      await source(page).fill(
        String.raw`\frac{${i + 2}}{x^{${i + 3}}} + \sqrt{${i + 5}}`,
      );
      await page.waitForTimeout(DEBOUNCE_MS + 60);
    }
    await page.waitForTimeout(500);
    print("mainHeapAfter100Renders", await heap(), "MB");
    print("workerHeapAfter100Renders", await wheap(), "MB");
  });

  test("chromium low-end: 4x CPU throttle", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP throttling is Chromium-only");
    test.setTimeout(300_000);
    const cdp = await page.context().newCDPSession(page);
    const throttle = () =>
      cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await throttle();
    const cold = await coldRuns(page, 7, "t", throttle);
    printStats("throttle4x.firstFormulaCold", cold);
    await throttle();
    const warm = await warmRuns(page, 50, "t");
    printStats("throttle4x.warmInputToPreview", warm);
    printStats(
      "throttle4x.warmMinusDebounce",
      warm.map((x) => x - DEBOUNCE_MS),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
});
