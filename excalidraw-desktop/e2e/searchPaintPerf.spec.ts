import { appendFileSync } from "node:fs";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

// Search-results paint latency (keystroke -> last result DOM change painted)
// on the searchheavy seed (50 drawings x 5 snippets). Skipped unless E2E_PERF=1.
const PERF = process.env.E2E_PERF === "1";
const RUNS = Number(process.env.PERF_RUNS ?? 24);
const RATE = Number(process.env.PERF_RATE ?? 6);
const OUT = process.env.PERF_OUT ?? "../.cache/perf-search-paint.jsonl";
const TAG = process.env.PERF_TAG ?? "ours";

test.skip(!PERF, "set E2E_PERF=1 to run the search paint measurements");
test.describe.configure({ timeout: 240_000 });

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// Runtime CSS variants so before/after run in one session (one lock hold).
const VARIANTS: Record<string, string> = {
  base: "",
  // content-visibility on every row (rejected: layout 8 -> 97 ms at 6x)
  cvrow:
    ".vault-search-row{content-visibility:auto;contain-intrinsic-block-size:auto 26px}",
};
const SEL = (process.env.PERF_VARIANTS ?? "base,cv").split(",");

SEL.forEach((variant, round) => {
  test(`search results paint latency [${variant}#${round}]`, async ({
    page,
    browserName,
  }) => {
    await openVault(page, "?seed=searchheavy");
    if (VARIANTS[variant]) {
      await page.addStyleTag({ content: VARIANTS[variant] });
    }
    const box = page.getByPlaceholder("Search drawings and text…");
    await box.fill("meeting");
    await expect(
      page.locator('.vault-search-row[data-kind="snippet"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('.vault-search-row[data-kind="snippet"]'),
    ).toHaveCount(250);
    await page.evaluate(() => {
      const w = window as any;
      w.__last = 0;
      w.__t0 = 0;
      const list = document.querySelector(".vault-search-results")!;
      new MutationObserver(() => {
        w.__last = performance.now();
      }).observe(list, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      document.addEventListener(
        "keydown",
        () => {
          w.__t0 = performance.now();
        },
        true,
      );
      w.__paint = () =>
        new Promise<number>((res) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => res(performance.now())),
          ),
        );
    });
    const cdp =
      browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null;
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    let traceStarted = false;
    const browser = page.context().browser()!;
    if (browserName === "chromium") {
      await browser.startTracing(page, { categories: ["devtools.timeline"] });
      traceStarted = true;
    }
    const m0 = cdp
      ? await cdp.send("Performance.getMetrics").catch(() => null)
      : null;
    void m0;
    await cdp?.send("Performance.enable");
    const a = cdp ? (await cdp.send("Performance.getMetrics")).metrics : [];
    const lat: number[] = [];
    const echo: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate(() => {
        (window as any).__last = 0;
      });
      await box.press(i % 2 === 0 ? "Backspace" : "g");
      const echoMs = await page.evaluate(async () => {
        const w = window as any;
        const t = await w.__paint();
        return t - w.__t0;
      });
      // wait until results settle (no mutation for 250 ms, after 60 ms debounce)
      await page.waitForTimeout(450);
      const r = await page.evaluate(async () => {
        const w = window as any;
        const painted = await w.__paint();
        return { last: w.__last, t0: w.__t0, painted };
      });
      echo.push(echoMs);
      // painted time of the last mutation is within ~16 ms after r.last
      lat.push(r.last - r.t0 + 8);
      void r.painted;
    }
    const b = cdp ? (await cdp.send("Performance.getMetrics")).metrics : [];
    const metric = (ms: { name: string; value: number }[], n: string) =>
      ms.find((x) => x.name === n)?.value ?? 0;
    const per = (n: string) =>
      cdp ? ((metric(b, n) - metric(a, n)) * 1000) / RUNS : null;
    let trace: Record<string, number> | null = null;
    if (traceStarted) {
      const buf = await browser.stopTracing();
      const events = JSON.parse(buf.toString()).traceEvents as any[];
      trace = {};
      for (const e of events) {
        if (
          e.ph === "X" &&
          e.dur !== undefined &&
          [
            "Layout",
            "UpdateLayoutTree",
            "PrePaint",
            "Paint",
            "Layerize",
            "Commit",
            "RunTask",
            "FunctionCall",
            "EvaluateScript",
            "FireAnimationFrame",
            "HitTest",
          ].includes(e.name)
        ) {
          trace[e.name] = (trace[e.name] ?? 0) + e.dur / 1000 / RUNS;
        }
      }
      for (const k of Object.keys(trace)) {
        trace[k] = +trace[k].toFixed(2);
      }
    }
    await page.mouse.move(0, 0);
    const shot = await page.locator(".vault-search-results").screenshot();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("../.cache/e2e-shots", { recursive: true });
    writeFileSync(
      `../.cache/e2e-shots/searchpaint-${variant}-${browserName}.png`,
      shot,
    );
    const row = {
      tag: `${TAG}:${variant}`,
      browser: browserName,
      rate: RATE,
      runs: RUNS,
      shotBytes: shot.length,
      resultsMedian: +pct(lat, 50).toFixed(1),
      resultsP95: +pct(lat, 95).toFixed(1),
      echoMedian: +pct(echo, 50).toFixed(1),
      echoP95: +pct(echo, 95).toFixed(1),
      perKeyMs: cdp
        ? {
            script: per("ScriptDuration"),
            layout: per("LayoutDuration"),
            recalc: per("RecalcStyleDuration"),
            task: per("TaskDuration"),
          }
        : null,
      trace,
    };
    appendFileSync(OUT, `${JSON.stringify(row)}\n`);
    // eslint-disable-next-line no-console
    console.log(`PERF ${JSON.stringify(row)}`);
  });
});
