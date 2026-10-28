/* eslint-disable no-console */
import { appendFileSync } from "node:fs";
import { loadavg } from "node:os";

import { type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import type { GraphHarnessHooks } from "./graphHarness";

// Graph view perf probes (PLAN.md "P3 perf budgets") on the harness page `/e2e.html?graph=N`
// (fake N-node graph, no Rust). Gated by GRAPH_PERF=1 or E2E_PERF=1. WebKit at 1x; Chromium
// (needs E2E_FULL=1) at 1x, 4x and 6x CPU throttle. One `GRAPH_PERF {json}` line per metric
// (`record.mjs spec` ingests `<NAME>_PERF` lines), also appended to $PERF_OUT.
//
// Frame cost = main-thread JS per frame: the session's own render CPU ring (`frameTimes`) and the
// cost of the input call; `raf` = interval between animation frames while the interaction runs.
// GPU time is not visible from the page, so "GPU-synced" budgets are judged on these numbers
// plus the rAF interval.
const ON = process.env.GRAPH_PERF === "1" || process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-graph.jsonl";
const FRAMES = 120;
const SIZES = (process.env.GRAPH_SIZES ?? "1000,10000,50000")
  .split(",")
  .map(Number);

test.skip(!ON, "set GRAPH_PERF=1 (or E2E_PERF=1) to run the graph probes");
test.describe.configure({ timeout: 300_000 });

type W = Window & {
  __graph: GraphHarnessHooks;
  __rafCount: number;
  __workers: { created: number; terminated: number };
  __gl: WebGL2RenderingContext[];
};

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
    : 0;
};
const r = (n: number) => +n.toFixed(2);
const stats = (xs: number[]) => ({ p50: r(pct(xs, 50)), p95: r(pct(xs, 95)) });

const report = (row: Record<string, unknown>) => {
  const full = { ...row, load: r(loadavg()[0]) };
  appendFileSync(OUT, `${JSON.stringify(full)}\n`);
  console.log(`GRAPH_PERF ${JSON.stringify(full)}`);
};

const rates = (browser: string) => (browser === "chromium" ? [1, 4, 6] : [1]);

const throttle = async (page: Page, browserName: string, rate: number) => {
  if (browserName !== "chromium") {
    return null;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

/** Counts rAF callbacks, worker create/terminate and WebGL contexts before the app loads. */
const installProbes = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as W;
    w.__rafCount = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__rafCount++;
        cb(t);
      });
    w.__workers = { created: 0, terminated: 0 };
    const Orig = window.Worker;
    window.Worker = class extends Orig {
      constructor(...a: ConstructorParameters<typeof Worker>) {
        super(...a);
        w.__workers.created++;
        const t = this.terminate.bind(this);
        this.terminate = () => {
          w.__workers.terminated++;
          t();
        };
      }
    };
    w.__gl = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...a: any[]
    ) {
      const ctx = (get as any).apply(this, a);
      if (ctx && a[0] === "webgl2" && !w.__gl.includes(ctx)) {
        w.__gl.push(ctx);
      }
      return ctx;
    } as typeof get;
  });

async function open(page: Page, n: number, extra = "") {
  await page.goto(`/e2e.html?graph=${n}${extra}`);
  await page.waitForFunction(
    () => (window as unknown as W).__graph?.session,
    undefined,
    {
      timeout: 60_000,
    },
  );
  await page.waitForFunction(
    () => (window as unknown as W).__graph.session!.metrics.settledMs > 0,
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(400);
}

/** Drives `kind` for FRAMES animation frames inside the page; returns per-frame costs. */
const drive = (page: Page, kind: "pan" | "zoom" | "drag") =>
  page.evaluate(
    async ([k, frames]) => {
      const s = (window as unknown as W).__graph.session as any;
      const stage = document
        .querySelector('[data-testid="graph-stage"]')!
        .getBoundingClientRect();
      const cx = stage.width / 2;
      const cy = stage.height / 2;
      let node = -1;
      let at = { x: cx, y: cy };
      if (k === "drag") {
        node = s.hintMap().labels.keys().next().value as number;
        at = s.nodeScreen(node);
        s.beginDrag(node);
      }
      const raf: number[] = [];
      const call: number[] = [];
      const frame = () =>
        new Promise<number>((res) => requestAnimationFrame(res));
      let last = await frame();
      const before = s.metrics.frames;
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        if (k === "pan") {
          s.panBy(i % 2 ? -14 : 14, i % 2 ? -6 : 6);
        } else if (k === "zoom") {
          s.zoomAt(cx, cy, i % 2 ? 1 / 1.06 : 1.06);
        } else {
          const a = (i / 12) * Math.PI;
          s.dragTo(at.x + Math.cos(a) * 60, at.y + Math.sin(a) * 60);
        }
        call.push(performance.now() - t0);
        const t = await frame();
        raf.push(t - last);
        last = t;
      }
      if (k === "drag") {
        s.endDrag();
      }
      const rendered = s.metrics.frames - before;
      const render = (s.metrics.frameTimes as number[]).slice(
        -Math.max(1, Math.min(frames, rendered)),
      );
      return { raf, call, render, rendered };
    },
    [kind, FRAMES] as const,
  );

for (const n of SIZES) {
  test.describe(`graph ${n}`, () => {
    for (const rate of [1, 4, 6]) {
      test(`frames, hover, idle at cpu x${rate}`, async ({
        page,
        browserName,
      }) => {
        test.skip(!rates(browserName).includes(rate), "rate not for engine");
        await installProbes(page);
        await open(page, n);
        const cdp: CDPSession | null = await throttle(page, browserName, rate);
        const base = { browser: browserName, rate, n };

        for (const kind of ["pan", "zoom", "drag"] as const) {
          const d = await drive(page, kind);
          report({
            test: kind,
            ...base,
            frames: d.rendered,
            renderMs: stats(d.render),
            callMs: stats(d.call),
            rafMs: stats(d.raf),
            // dropped = frames that took more than 2 display intervals (33 ms)
            dropped: d.raf.filter((x) => x > 33.4).length,
          });
        }

        // Hover: real pointer move -> card committed to the DOM / painted (next rAF).
        const targets: { x: number; y: number }[] = await page.evaluate(() => {
          const s = (window as unknown as W).__graph.session as any;
          const rect = document
            .querySelector('[data-testid="graph-stage"]')!
            .getBoundingClientRect();
          return [...s.hintMap().labels.keys()]
            .slice(0, 24)
            .map((i: number) => {
              const p = s.nodeScreen(i);
              return { x: rect.left + p.x, y: rect.top + p.y };
            });
        });
        await page.evaluate(() => {
          const w = window as any;
          w.__hover = { t0: 0, commit: [], paint: [] };
          document.addEventListener(
            "pointermove",
            () => {
              w.__hover.t0 = performance.now();
            },
            true,
          );
          let lastText = "";
          new MutationObserver(() => {
            const card = document.querySelector('[data-testid="graph-card"]');
            const text = card?.textContent ?? "";
            if (w.__hover.t0 && text && text !== lastText) {
              lastText = text;
              const t1 = performance.now();
              const t0 = w.__hover.t0;
              w.__hover.commit.push(t1 - t0);
              requestAnimationFrame(() =>
                w.__hover.paint.push(performance.now() - t0),
              );
              w.__hover.t0 = 0;
            }
          }).observe(document.querySelector('[data-testid="graph-stage"]')!, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        });
        for (const t of targets) {
          await page.mouse.move(t.x + 80, t.y + 80);
          await page.mouse.move(t.x, t.y);
          await page.waitForTimeout(60);
        }
        const hov = await page.evaluate(
          () =>
            (window as any).__hover as { commit: number[]; paint: number[] },
        );
        report({
          test: "hover",
          ...base,
          samples: hov.commit.length,
          commitMs: stats(hov.commit),
          paintMs: stats(hov.paint),
        });
        await page.mouse.move(2, 2);

        // Idle: after settle nothing may schedule animation frames.
        await page.waitForTimeout(800);
        const c0 = await page.evaluate(
          () => (window as unknown as W).__rafCount,
        );
        await page.waitForTimeout(2000);
        const c1 = await page.evaluate(
          () => (window as unknown as W).__rafCount,
        );
        report({ test: "idle", ...base, rafCallbacks2s: c1 - c0 });
        if (cdp) {
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        }
      });

      test(`local depth 2 open at cpu x${rate}`, async ({
        page,
        browserName,
      }) => {
        test.skip(!rates(browserName).includes(rate), "rate not for engine");
        await installProbes(page);
        const cdp = await throttle(page, browserName, rate);
        await page.goto(`/e2e.html?graph=${n}&mode=local`);
        const samples: {
          first: number;
          settled: number;
          nodes: number;
          warm: boolean;
        }[] = [];
        for (let i = 0; i < 5; i++) {
          await page.waitForFunction(
            () => (window as unknown as W).__graph.session,
            undefined,
            {
              timeout: 120_000,
            },
          );
          await page.waitForFunction(
            () =>
              (window as unknown as W).__graph.session!.metrics.settledMs > 0,
            undefined,
            { timeout: 120_000 },
          );
          samples.push(
            await page.evaluate(() => {
              const s = (window as unknown as W).__graph.session as any;
              return {
                first: s.metrics.firstFrameMs,
                settled: s.metrics.settledMs,
                nodes: s.nodeCount,
                warm: s.metrics.warm,
              };
            }),
          );
          await page.evaluate(() => (window as unknown as W).__graph.toggle());
          await page.waitForTimeout(150);
          await page.evaluate(() => (window as unknown as W).__graph.toggle());
        }
        report({
          test: "local-open",
          browser: browserName,
          rate,
          n,
          localNodes: samples[0].nodes,
          firstFrameMs: stats(samples.map((s) => s.first)),
          settledMs: stats(samples.map((s) => s.settled)),
          first: r(samples[0].first),
        });
        if (cdp) {
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        }
      });
    }

    test("memory and teardown", async ({ page, browserName }) => {
      await installProbes(page);
      const cdp =
        browserName === "chromium"
          ? await page.context().newCDPSession(page)
          : null;
      const heap = async () => {
        if (cdp) {
          await cdp.send("HeapProfiler.collectGarbage");
        }
        await page.waitForTimeout(200);
        if (cdp) {
          return (
            ((await cdp.send("Runtime.getHeapUsage")).usedSize as number) /
            1048576
          );
        }
        return null;
      };
      await page.goto(`/e2e.html?graph=${n}&shown=0`);
      await page.waitForSelector('[data-testid="reopen"]');
      const before = await heap();
      await page.evaluate(() => (window as unknown as W).__graph.toggle());
      await page.waitForFunction(
        () => (window as unknown as W).__graph.session?.metrics.settledMs! > 0,
        undefined,
        { timeout: 120_000 },
      );
      await page.waitForTimeout(500);
      const during = await heap();
      await page.evaluate(() => (window as unknown as W).__graph.toggle());
      await page.waitForSelector('[data-testid="reopen"]');
      await page.waitForTimeout(500);
      const after = await heap();
      const teardown = await page.evaluate(() => {
        const w = window as unknown as W;
        return {
          workersCreated: w.__workers.created,
          workersTerminated: w.__workers.terminated,
          glContexts: w.__gl.length,
          glLost: w.__gl.filter((g) => g.isContextLost()).length,
        };
      });
      report({
        test: "memory",
        browser: browserName,
        rate: 1,
        n,
        heapBeforeMb: before === null ? null : r(before),
        heapOpenMb: during === null ? null : r(during),
        heapAfterMb: after === null ? null : r(after),
        openDeltaMb:
          before === null || during === null ? null : r(during - before),
        afterDeltaMb:
          before === null || after === null ? null : r(after - before),
        ...teardown,
      });
    });
  });
}

// The graph costs nothing while closed: the app harness never opened vs opened and closed.
test("closed graph costs nothing (app harness: never opened vs opened then closed)", async ({
  browser,
  browserName,
}) => {
  const probe = async (openFirst: boolean) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const chunks: string[] = [];
    page.on("request", (req) => {
      if (/graph/i.test(req.url()) && /\.(js|css)(\?|$)/.test(req.url())) {
        chunks.push(req.url().split("/").pop()!);
      }
    });
    await installProbes(page);
    await page.goto("/e2e.html?seed=links");
    await page.getByLabel("Vault file navigator").waitFor();
    await page
      .locator(".vault-tree-item__name", { hasText: "Hub" })
      .first()
      .click();
    await page.locator(".vault-editor canvas.interactive").waitFor();
    await page.waitForTimeout(1000);
    const chunksBefore = chunks.length;
    if (openFirst) {
      await page.keyboard.press("Meta+Alt+g");
      await page.waitForFunction(
        () => (window as any).__graphApp?.metrics.settledMs > 0,
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape");
      await page.getByTestId("graph-view").waitFor({ state: "detached" });
    }
    await page.waitForTimeout(1000);
    const cdp =
      browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null;
    if (cdp) {
      await cdp.send("HeapProfiler.collectGarbage");
    }
    const heap = cdp
      ? ((await cdp.send("Runtime.getHeapUsage")).usedSize as number) / 1048576
      : null;
    const c0 = await page.evaluate(() => (window as unknown as W).__rafCount);
    await page.waitForTimeout(2000);
    const c1 = await page.evaluate(() => (window as unknown as W).__rafCount);
    const workers = await page.evaluate(() => {
      const w = (window as unknown as W).__workers;
      return { created: w.created, alive: w.created - w.terminated };
    });
    await context.close();
    return {
      heapMb: heap === null ? null : r(heap),
      raf2s: c1 - c0,
      workersCreated: workers.created,
      workersAlive: workers.alive,
      graphChunksBeforeOpen: chunksBefore,
      graphChunksLoaded: chunks.length,
    };
  };
  const never = await probe(false);
  const reopened = await probe(true);
  report({
    test: "closed-cost",
    browser: browserName,
    rate: 1,
    never,
    openedThenClosed: reopened,
    heapDeltaMb:
      never.heapMb === null || reopened.heapMb === null
        ? null
        : r(reopened.heapMb - never.heapMb),
  });
});
