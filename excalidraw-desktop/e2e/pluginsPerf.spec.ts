import { expect, test, type Page } from "@playwright/test";

import { openVault } from "./helpers";
import { throttle } from "./linkStylingHelpers";

// Plugin host cost (E2E_PERF=1). Cold samples: a fresh page per sample.
//   plugins.loadActivate.{5k,100k,1m}  ms, load + activate from the cost marks
//   plugins.firstCommand.{5k,100k}     ms from palette Enter to the toast being
//                                      pushed (activation + handler), measured in-page
//   plugins.stubs50                    ms to register 50 plugins x (3 commands,
//                                      1 panel, 4 settings); no module may be fetched
// Rates: PERF_RATES (default 1,4); CDP CPU throttle is Chromium only, so the
// WebKit project runs 1x and skips the others.
const PERF = process.env.E2E_PERF === "1";
const SAMPLES = Number(process.env.PLUGIN_SAMPLES) || 25;
const RATES = (process.env.PERF_RATES ?? "1,4").split(",").map(Number);

test.skip(!PERF, "set E2E_PERF=1 to run the plugin measurements");
test.describe.configure({ timeout: 600_000 });

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
  plugins: string,
) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  });
  await openVault(page, `?plugins=${plugins}`);
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  return page;
};

const SIZES = [
  { id: "size5k", label: "5k", budget: 15 },
  { id: "size100k", label: "100k", budget: 50 },
  { id: "size1m", label: "1m", budget: 120 },
];

for (const rate of RATES) {
  test(`load + activate, cold, ${rate}x`, async ({ browser, browserName }) => {
    test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
    for (const { id, label, budget } of SIZES) {
      const samples: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const page = await fresh(browser, id);
        await throttle(page, browserName, rate);
        const ms = await page.evaluate(async (pid) => {
          const p = (window as any).__plugins;
          await p.ensureActive(pid);
          const c = p.getPluginCosts().find((x: any) => x.id === pid);
          return (c.loadMs ?? 0) + (c.activateMs ?? 0);
        }, id);
        samples.push(ms);
        await page.close();
      }
      const row = stats(samples);
      report({ name: `plugins.loadActivate.${label}`, rate, ...row });
      if (rate === 1) {
        // 1 MB is a single p95 budget; 5k is checked on p50.
        expect(label === "5k" ? row.p50 : row.p95).toBeLessThanOrEqual(budget);
      }
    }
  });

  test(`first command run incl. activation, cold, ${rate}x`, async ({
    browser,
    browserName,
  }) => {
    test.skip(rate !== 1 && browserName !== "chromium", "CDP throttle");
    for (const id of ["size5k", "size100k"]) {
      const samples: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const page = await fresh(browser, id);
        await throttle(page, browserName, rate);
        samples.push(await firstCommandMs(page, id));
        await page.close();
      }
      const row = stats(samples);
      report({ name: `plugins.firstCommand.${id.slice(4)}`, rate, ...row });
      if (rate === 1) {
        expect(row.p95).toBeLessThanOrEqual(100);
      }
    }
  });
}

/** Palette Enter -> first toast push, timed in-page (no Playwright round trip inside). */
const firstCommandMs = async (page: Page, id: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type(`${id.replace("size", "Size ")}: run`);
  await expect(palette.getByRole("option").first()).toContainText(": run");
  await page.evaluate(() => {
    const w = window as any;
    w.__firstCommand = new Promise<number>((resolve) => {
      let t0 = 0;
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter") {
            t0 = performance.now();
          }
        },
        { capture: true, once: true },
      );
      const off = w.__vaultToasts.subscribe(() => {
        if (t0) {
          off();
          resolve(performance.now() - t0);
        }
      });
    });
  });
  await page.keyboard.press("Enter");
  const ms = await page.evaluate(
    () => (window as any).__firstCommand as number,
  );
  await expect(page.getByText(`${id} ran`)).toBeVisible();
  return ms;
};

test("50 inactive plugins: stub registration, no module fetched", async ({
  browser,
}) => {
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/e2e-plugins/")) {
        requests.push(r.url());
      }
    });
    await openVault(page, "?plugins=stubs50");
    await page.waitForFunction(() => (window as any).__pluginsReady === true);
    await page.waitForTimeout(300);
    const { ms, registered } = await page.evaluate(() => {
      const p = (window as any).__plugins;
      return {
        ms: p.getStubRegistrationMs() as number,
        registered: (p.getPluginCosts() as any[]).filter(
          (c) => c.registrations.commands > 0,
        ).length,
      };
    });
    expect(registered).toBe(50);
    expect(requests).toEqual([]);
    samples.push(ms);
    await page.close();
  }
  const row = stats(samples);
  report({ name: "plugins.stubs50", ...row });
  expect(row.p95).toBeLessThanOrEqual(5);
});
