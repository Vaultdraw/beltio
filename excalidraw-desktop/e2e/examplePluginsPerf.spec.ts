import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { openVault } from "./helpers";

// Cost of the sdk/examples plugins (E2E_PERF=1), for hello-command and
// focus-timer. Rows are printed as `PERF {json}`:
//   examples.<id>.activate      ms, load + activate from the cost marks, cold page per sample
//   examples.<id>.heapDelta     bytes of JS heap after GC, before vs after activation
//                               (focus-timer: also a running session and its open panel); Chromium only
//   examples.<id>.idleCpu       ms of main-thread task / script time per second over 5 s idle,
//                               with the plugin minus the same page with no plugins; Chromium only.
//                               focus-timer is measured with a session running, panel open and closed.
//   examples.<id>.disabledCost  listed but not enabled: 0 module fetches, no command; and
//                               enabled but unused: stub registration ms, 0 module fetches
const PERF = process.env.E2E_PERF === "1";
const SAMPLES = Number(process.env.PLUGIN_SAMPLES) || 15;
const CPU_SAMPLES = Number(process.env.PLUGIN_CPU_SAMPLES) || 3;
const IDLE_MS = 5_000;

test.skip(!PERF, "set E2E_PERF=1 to run the example plugin measurements");
test.describe.configure({ timeout: 900_000 });

const EXAMPLES = [
  {
    id: "hello-command",
    command: "hello-command.hello",
    title: "Hello: say hello",
  },
  {
    id: "focus-timer",
    command: "focus-timer.start",
    title: "Focus timer: start",
  },
];

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

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

const fresh = async (
  browser: import("@playwright/test").Browser,
  query: string,
) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  await openVault(page, query);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  return page;
};

const cdpOf = (page: Page): Promise<CDPSession> =>
  page.context().newCDPSession(page);

const heap = async (cdp: CDPSession) => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
};

/** What the example does when used: activate, and for focus-timer run a session with its panel open. */
const use = async (page: Page, id: string) => {
  await page.evaluate((pid) => (window as any).__plugins.ensureActive(pid), id);
  if (id === "focus-timer") {
    await page.keyboard.press("ControlOrMeta+Alt+Shift+KeyT");
    await expect(page.getByRole("timer")).toHaveText(/^2[45]:\d\d$/);
  }
};

const closePanel = async (page: Page) => {
  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);
};

/** Main-thread task and script ms per second over IDLE_MS. */
const idleCpu = async (page: Page, cdp: CDPSession) => {
  const read = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const at = (n: string) => metrics.find((m) => m.name === n)!.value;
    return { task: at("TaskDuration"), script: at("ScriptDuration") };
  };
  await page.waitForTimeout(500);
  const a = await read();
  await page.waitForTimeout(IDLE_MS);
  const b = await read();
  const s = IDLE_MS / 1000;
  return {
    taskMsPerS: ((b.task - a.task) * 1000) / s,
    scriptMsPerS: ((b.script - a.script) * 1000) / s,
  };
};

for (const { id, command, title } of EXAMPLES) {
  test(`${id}: activation, cold`, async ({ browser }) => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const page = await fresh(browser, `?plugins=${id}`);
      samples.push(
        await page.evaluate(async (pid) => {
          const p = (window as any).__plugins;
          await p.ensureActive(pid);
          const c = p.getPluginCosts().find((x: any) => x.id === pid);
          return (c.loadMs ?? 0) + (c.activateMs ?? 0);
        }, id),
      );
      await page.close();
    }
    const row = stats(samples);
    report({ name: `examples.${id}.activate`, rate: 1, ...row });
    expect(row.p95).toBeLessThanOrEqual(50);
  });

  test(`${id}: heap delta`, async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "CDP heap usage");
    const deltas: number[] = [];
    for (let i = 0; i < Math.min(SAMPLES, 7); i++) {
      const page = await fresh(browser, `?plugins=${id}`);
      const cdp = await cdpOf(page);
      await page.waitForTimeout(500);
      const before = await heap(cdp);
      await use(page, id);
      await page.waitForTimeout(300);
      deltas.push((await heap(cdp)) - before);
      await page.close();
    }
    report({
      name: `examples.${id}.heapDelta`,
      bytes: median(deltas),
      samples: deltas,
    });
  });

  test(`${id}: idle cpu`, async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "CDP metrics");
    const shapes: { shape: string; run: (p: Page) => Promise<void> }[] =
      id === "focus-timer"
        ? [
            {
              shape: "session-panel-closed",
              run: async (p) => {
                await use(p, id);
                await closePanel(p);
              },
            },
            { shape: "session-panel-open", run: (p) => use(p, id) },
          ]
        : [{ shape: "active", run: (p) => use(p, id) }];
    const measure = async (query: string, run?: (p: Page) => Promise<void>) => {
      const task: number[] = [];
      const script: number[] = [];
      for (let i = 0; i < CPU_SAMPLES; i++) {
        const page = await fresh(browser, query);
        const cdp = await cdpOf(page);
        await cdp.send("Performance.enable");
        await run?.(page);
        const r = await idleCpu(page, cdp);
        task.push(r.taskMsPerS);
        script.push(r.scriptMsPerS);
        await page.close();
      }
      return { task: median(task), script: median(script) };
    };
    const base = await measure("?plugins=");
    for (const { shape, run } of shapes) {
      const withPlugin = await measure(`?plugins=${id}`, run);
      report({
        name: `examples.${id}.idleCpu`,
        shape,
        taskMsPerS: +withPlugin.task.toFixed(3),
        scriptMsPerS: +withPlugin.script.toFixed(3),
        baseTaskMsPerS: +base.task.toFixed(3),
        baseScriptMsPerS: +base.script.toFixed(3),
        deltaTaskMsPerS: +(withPlugin.task - base.task).toFixed(3),
        deltaScriptMsPerS: +(withPlugin.script - base.script).toFixed(3),
      });
    }
  });

  test(`${id}: disabled and unused cost`, async ({ browser }) => {
    const probe = async (query: string) => {
      const page = await browser.newPage();
      const fetched: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes(`/e2e-plugins/${id}/main.js`)) {
          fetched.push(r.url());
        }
      });
      await openVault(page, query);
      await page.waitForFunction(() => (window as any).__pluginsReady === true);
      await page.waitForTimeout(500);
      const info = await page.evaluate((cid) => {
        const p = (window as any).__plugins;
        return {
          ms: p.getStubRegistrationMs() as number,
          hasCommand: p.hasCommand(cid) as boolean,
        };
      }, command);
      await page.close();
      return { ...info, fetched: fetched.length };
    };
    const off: number[] = [];
    const unused: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = await probe(`?plugins=&pluginsOff=${id}`);
      expect(a.fetched).toBe(0);
      expect(a.hasCommand).toBe(false);
      off.push(a.ms);
      const b = await probe(`?plugins=${id}`);
      expect(b.fetched).toBe(0);
      expect(b.hasCommand).toBe(true);
      unused.push(b.ms);
    }
    report({
      name: `examples.${id}.disabledCost`,
      command: title,
      disabledStubMs: stats(off),
      enabledUnusedStubMs: stats(unused),
      moduleFetches: 0,
    });
  });
}
