import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";

// Idle memory of installed-but-inactive plugins (E2E_PERF=1, chromium only).
// Per variant: JS heap, DOM nodes and listeners after load + 2 s settle + GC,
// median of 5 fresh pages. Budget: 50 inactive plugins <= 1 MB, 20 KB each.
const PERF = process.env.E2E_PERF === "1";
const SAMPLES = Number(process.env.PLUGIN_SAMPLES) || 5;

test.skip(!PERF, "set E2E_PERF=1 to run the plugin memory measurements");
test.describe.configure({ timeout: 600_000 });

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

const VARIANTS = [
  { name: "none", query: "" },
  { name: "all50", query: "?plugins=stubs50" },
  { name: "commands50", query: "?plugins=stubs50:commands" },
  // host code + one manifest, nothing registered: the fixed cost
  { name: "host1", query: "?plugins=hello&enabled=none" },
  { name: "manifestsOnly50", query: "?plugins=stubs50&enabled=none" },
  { name: "panels50", query: "?plugins=stubs50:panels" },
  { name: "settings50", query: "?plugins=stubs50:settings" },
  { name: "none-barOff", query: "?bar=off" },
  { name: "all50-barOff", query: "?plugins=stubs50&bar=off" },
];

test("inactive plugin idle memory", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "CDP metrics");
  const rows: Record<string, { heap: number; nodes: number; lis: number }> = {};
  for (const { name, query } of VARIANTS) {
    const heap: number[] = [];
    const nodes: number[] = [];
    const lis: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 850 },
      });
      await openVault(page, query);
      if (query.includes("plugins=")) {
        await page.waitForFunction(() => (window as any).__pluginsReady);
      }
      await page.waitForTimeout(2000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const m = (k: string) => metrics.find((x) => x.name === k)?.value ?? 0;
      heap.push(m("JSHeapUsedSize"));
      nodes.push(m("Nodes"));
      lis.push(m("JSEventListeners"));
      await page.close();
    }
    rows[name] = {
      heap: median(heap),
      nodes: median(nodes),
      lis: median(lis),
    };
  }
  const base = rows.none;
  for (const [name, r] of Object.entries(rows)) {
    const ref = name.endsWith("barOff") ? rows["none-barOff"] : base;
    // eslint-disable-next-line no-console
    console.log(
      `PERF ${JSON.stringify({
        name: `plugins.memory.${name}`,
        heapMB: +(r.heap / 1048576).toFixed(3),
        dHeapKB: +((r.heap - ref.heap) / 1024).toFixed(0),
        dNodes: r.nodes - ref.nodes,
        dListeners: r.lis - ref.lis,
        perPluginKB: +((r.heap - rows.host1.heap) / 1024 / 49).toFixed(1),
      })}`,
    );
  }
  // per-plugin cost is measured against the host with one plugin, not 0
  expect(rows.all50.heap - rows.host1.heap).toBeLessThanOrEqual(49 * 20 * 1024);
  expect(rows.all50.heap - base.heap).toBeLessThanOrEqual(1048576);
  // the activity bar caps the plugin buttons it renders
  expect(rows.all50.nodes - base.nodes).toBeLessThanOrEqual(400);
});
