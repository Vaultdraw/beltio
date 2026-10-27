import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { canvasBox, openDrawing, openVault } from "./helpers";

// Cost of the sdk/examples plugins (E2E_PERF=1), for hello-command,
// focus-timer, word-count, stamp and event-logger. The scene plugins
// (word-count, stamp, event-logger) are measured with the DSA > Graphs
// drawing open, against a no-plugin page of the same shape. Rows are printed as `PERF {json}`:
//   examples.<id>.activate      ms, load + activate from the cost marks, cold page per sample
//   examples.<id>.heapDelta     bytes of JS heap after GC, before vs after activation
//                               (focus-timer: also a running session and its open panel); Chromium only
//   examples.<id>.idleCpu       ms of main-thread task / script time per second over 5 s idle,
//                               with the plugin minus the same page with no plugins; Chromium only.
//                               focus-timer is measured with a session running, panel open and closed.
//   examples.<id>.disabledCost  listed but not enabled: 0 module fetches, no command; and
//                               enabled but unused: stub registration ms, 0 module fetches
//                               (event-logger activates at startup: 1 fetch when enabled)
// Plugin-specific rows:
//   examples.word-count.editCost       extra main-thread ms per scene edit, panel open vs closed vs no plugin
//   examples.stamp.flowMs              palette Enter to the scene.onChange that carries the 8 new elements
//   examples.event-logger.startupActivate  load + activate ms of the onStartupFinished activation
const PERF = process.env.E2E_PERF === "1";
const SAMPLES = Number(process.env.PLUGIN_SAMPLES) || 15;
const CPU_SAMPLES = Number(process.env.PLUGIN_CPU_SAMPLES) || 3;
const IDLE_MS = 5_000;

test.skip(!PERF, "set E2E_PERF=1 to run the example plugin measurements");
test.describe.configure({ timeout: 900_000 });

interface Example {
  id: string;
  command: string;
  title: string;
  /** Scene plugin: measured with a drawing open. */
  scene?: boolean;
  /** activation = onStartupFinished: active without being used. */
  startup?: boolean;
  /** Activity-bar button of the panel, if the example has one. */
  panel?: string;
}

const EXAMPLES: Example[] = [
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
  {
    id: "word-count",
    command: "word-count.count",
    title: "Word count: show words",
    scene: true,
    panel: "Drawing stats",
  },
  {
    id: "stamp",
    command: "stamp.flow",
    title: "Stamp: insert flow",
    scene: true,
  },
  {
    id: "event-logger",
    command: "event-logger.clear",
    title: "Event logger: clear",
    scene: true,
    startup: true,
    panel: "Event log",
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
  scene = false,
) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  await openVault(page, query);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  if (scene) {
    await openGraphs(page);
  }
  return page;
};

const openGraphs = async (page: Page) => {
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
};

const togglePanel = (page: Page, name: string) =>
  page.getByRole("button", { name }).click();

const cdpOf = (page: Page): Promise<CDPSession> =>
  page.context().newCDPSession(page);

const heap = async (cdp: CDPSession) => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
};

/** What the example does when used: activate, and open its panel (focus-timer: run a session in it). */
const use = async (page: Page, ex: Pick<Example, "id" | "panel">) => {
  await page.evaluate(
    (pid) => (window as any).__plugins.ensureActive(pid),
    ex.id,
  );
  if (ex.id === "focus-timer") {
    await page.keyboard.press("Meta+Alt+Shift+KeyT");
    await expect(page.getByRole("timer")).toHaveText(/^2[45]:\d\d$/);
  } else if (ex.id === "word-count" && ex.panel) {
    await togglePanel(page, ex.panel);
    await expect(page.getByTestId("stat-total")).toBeVisible();
  }
};

const closePanel = async (page: Page) => {
  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);
};

const waitActivated = (page: Page, id: string) =>
  page.waitForFunction(
    (pid) =>
      (window as any).__plugins
        .getPluginCosts()
        .some((c: any) => c.id === pid && c.activateMs !== null),
    id,
  );

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

for (const ex of EXAMPLES) {
  const { id, command, title, scene, startup } = ex;
  test(`${id}: activation, cold`, async ({ browser }) => {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const page = await fresh(browser, `?plugins=${id}`);
      if (startup) {
        await waitActivated(page, id);
      }
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
      const page = await fresh(browser, `?plugins=${id}`, scene);
      const cdp = await cdpOf(page);
      await page.waitForTimeout(500);
      if (startup) {
        // Active from startup: compare against the same page with no plugin.
        await waitActivated(page, id);
        await page.waitForTimeout(300);
        const withPlugin = await heap(cdp);
        await page.close();
        const base = await fresh(browser, "?plugins=", scene);
        const baseCdp = await cdpOf(base);
        await base.waitForTimeout(800);
        deltas.push(withPlugin - (await heap(baseCdp)));
        await base.close();
        continue;
      }
      const before = await heap(cdp);
      await use(page, ex);
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
                await use(p, ex);
                await closePanel(p);
              },
            },
            { shape: "session-panel-open", run: (p) => use(p, ex) },
          ]
        : id === "word-count"
        ? [
            { shape: "active-panel-closed", run: (p) => use(p, { id }) },
            { shape: "panel-open", run: (p) => use(p, ex) },
          ]
        : id === "event-logger"
        ? [
            { shape: "startup-active", run: (p) => waitActivated(p, id) },
            {
              shape: "panel-open",
              run: async (p) => {
                await waitActivated(p, id);
                await togglePanel(p, ex.panel!);
              },
            },
          ]
        : [{ shape: "active", run: (p) => use(p, ex) }];
    const measure = async (query: string, run?: (p: Page) => Promise<void>) => {
      const task: number[] = [];
      const script: number[] = [];
      for (let i = 0; i < CPU_SAMPLES; i++) {
        const page = await fresh(browser, query, scene);
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
      await page.waitForTimeout(startup ? 1000 : 500);
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
      expect(b.fetched).toBe(startup ? 1 : 0);
      expect(b.hasCommand).toBe(true);
      unused.push(b.ms);
    }
    report({
      name: `examples.${id}.disabledCost`,
      command: title,
      disabledStubMs: stats(off),
      enabledUnusedStubMs: stats(unused),
      moduleFetches: startup ? "0 disabled, 1 at startup" : 0,
    });
  });
}

const EDITS = Number(process.env.PLUGIN_EDITS) || 30;
const EDIT_REPEATS = Number(process.env.PLUGIN_EDIT_REPEATS) || 5;

/** Main-thread task ms accumulated by `run`, per edit. */
const taskMsPerEdit = async (cdp: CDPSession, run: () => Promise<void>) => {
  const task = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === "TaskDuration",
    )!.value;
  const a = await task();
  await run();
  await new Promise((r) => setTimeout(r, 300));
  return ((await task()) - a) * (1000 / EDITS);
};

test("word-count: cost per scene edit, panel open vs closed vs no plugin", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP metrics");
  type Arm = "none" | "panel-closed" | "panel-open";
  const ARMS: Arm[] = ["none", "panel-closed", "panel-open"];
  const KINDS = {
    // Selection moves: the stats numbers do not change, so this is the selector
    // plus isEqual per edit, with no panel re-render.
    nudge: async (page: Page) => {
      const box = await canvasBox(page);
      await page.mouse.click(box.x + 40, box.y + box.height - 60);
      await page.keyboard.press("Meta+KeyA");
      for (let i = 0; i < EDITS; i++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(40);
      }
    },
    // New rectangles: the totals change, so the panel re-renders every time.
    add: async (page: Page) => {
      const box = await canvasBox(page);
      const x = box.x + 60;
      const y = box.y + box.height - 120;
      for (let i = 0; i < EDITS; i++) {
        await page.keyboard.press("r");
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 50, y + 30, { steps: 2 });
        await page.mouse.up();
        await page.waitForTimeout(40);
      }
    },
  };
  const samples: Record<string, Record<Arm, number[]>> = {
    nudge: { none: [], "panel-closed": [], "panel-open": [] },
    add: { none: [], "panel-closed": [], "panel-open": [] },
  };
  for (let r = 0; r < EDIT_REPEATS; r++) {
    for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
      for (const arm of ARMS) {
        const page = await fresh(
          browser,
          arm === "none" ? "?plugins=" : "?plugins=word-count",
          true,
        );
        if (arm !== "none") {
          await use(page, { id: "word-count", panel: "Drawing stats" });
          if (arm === "panel-closed") {
            await togglePanel(page, "Drawing stats");
            await expect(page.getByTestId("stat-total")).toHaveCount(0);
          }
        }
        const cdp = await cdpOf(page);
        await cdp.send("Performance.enable");
        await page.waitForTimeout(500);
        samples[kind][arm].push(
          await taskMsPerEdit(cdp, () => KINDS[kind](page)),
        );
        await page.close();
      }
    }
  }
  for (const kind of Object.keys(KINDS)) {
    const m = (arm: Arm) => median(samples[kind][arm]);
    report({
      name: "examples.word-count.editCost",
      kind,
      edits: EDITS,
      noneMsPerEdit: +m("none").toFixed(3),
      closedMsPerEdit: +m("panel-closed").toFixed(3),
      openMsPerEdit: +m("panel-open").toFixed(3),
      deltaClosedMs: +(m("panel-closed") - m("none")).toFixed(3),
      deltaOpenMs: +(m("panel-open") - m("none")).toFixed(3),
      deltaOpenVsClosedMs: +(m("panel-open") - m("panel-closed")).toFixed(3),
      samples: samples[kind],
    });
  }
});

test("stamp: flow from palette Enter to the scene carrying the 8 new elements", async ({
  browser,
}) => {
  // scene-watch (a fixture plugin) timestamps every scene.onChange; stamp's
  // flow is ONE batch, so the first change after Enter carries all 8 elements.
  const cold: number[] = [];
  const warm: number[] = [];
  const flow = async (page: Page) => {
    await page.evaluate(() => {
      const w = window as any;
      w.__flowT0 = 0;
      w.__flowT1 = 0;
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter" && !w.__flowT0) {
            w.__flowT0 = performance.now();
          }
        },
        { capture: true, once: false },
      );
      let calls = w.__sceneWatchCalls;
      Object.defineProperty(w, "__sceneWatchCalls", {
        configurable: true,
        get: () => calls,
        set: (v) => {
          calls = v;
          if (w.__flowT0 && !w.__flowT1) {
            w.__flowT1 = performance.now();
          }
        },
      });
    });
    await page.keyboard.press("Meta+Shift+KeyP");
    await page.keyboard.type("stamp: insert flow");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }).getByRole("option"),
    ).not.toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window as any).__flowT1 > 0);
    return page.evaluate(() => {
      const w = window as any;
      const ms = w.__flowT1 - w.__flowT0;
      w.__flowT0 = 0;
      w.__flowT1 = 0;
      return ms as number;
    });
  };
  for (let i = 0; i < SAMPLES; i++) {
    const page = await fresh(browser, "?plugins=stamp,scene-watch", true);
    await page.evaluate(() =>
      (window as any).__plugins.ensureActive("scene-watch"),
    );
    cold.push(await flow(page));
    await page.keyboard.press("Meta+KeyZ");
    await page.waitForTimeout(300);
    warm.push(await flow(page));
    await page.close();
  }
  report({
    name: "examples.stamp.flowMs",
    note: "cold = first run (loads + activates stamp), warm = second run",
    cold: stats(cold),
    warm: stats(warm),
  });
});

test("event-logger: startup activation cost and per-event handler cost", async ({
  browser,
}) => {
  const load: number[] = [];
  const activate: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const page = await fresh(browser, "?plugins=event-logger", true);
    await waitActivated(page, "event-logger");
    const c = await page.evaluate(() =>
      (window as any).__plugins
        .getPluginCosts()
        .find((x: any) => x.id === "event-logger"),
    );
    load.push(c.loadMs ?? 0);
    activate.push(c.activateMs ?? 0);
    total.push((c.loadMs ?? 0) + (c.activateMs ?? 0));
    await page.close();
  }
  const row = {
    loadMs: stats(load),
    activateMs: stats(activate),
    loadPlusActivateMs: stats(total),
  };
  report({ name: "examples.event-logger.startupActivate", ...row });
  // Budget: plugins DECISIONS #11, startup activation <= 5 ms main thread.
  expect(row.activateMs.p95).toBeLessThanOrEqual(5);
});
