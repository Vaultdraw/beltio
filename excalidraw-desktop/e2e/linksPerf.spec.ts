import { appendFileSync } from "node:fs";

import { expect, type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";
import { openRenameDialog, scenePoint, SEED, withMeta } from "./linksHelpers";

// Links P1 latency budgets (PLAN.md "P1 perf budgets"). Skipped unless
// E2E_PERF=1. WebKit at 1x; Chromium at 1x, 4x and 6x CPU throttle. Rows are
// printed as `LINKS_PERF {...}` and appended to $PERF_OUT.
//
// Timing model: t0 = capture-phase input event inside the page, t1 = the last
// DOM mutation of the surface under test ("commit"). `paint` additionally
// waits for the next animation frame, so it is quantised to the display
// refresh (16.7 ms) and reported for information only. The budgets apply to
// the commit time, as in the other latency specs.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-links.jsonl";
const RUNS = Number(process.env.PERF_RUNS ?? 28);
const NAMES = Number(process.env.PERF_NAMES ?? 10_000);
const KEYS = 40;

test.skip(!PERF, "set E2E_PERF=1 to run the links measurements");
test.describe.configure({ timeout: 300_000 });

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r = (n: number) => +n.toFixed(2);
const stats = (xs: number[]) => ({
  p50: r(pct(xs, 50)),
  p95: r(pct(xs, 95)),
  max: r(Math.max(...xs)),
});

const report = (row: Record<string, unknown>) => {
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  // eslint-disable-next-line no-console
  console.log(`LINKS_PERF ${JSON.stringify(row)}`);
};

const ratesFor = (browser: string) =>
  browser === "chromium" ? [1, 4, 6] : [1];

const throttle = async (
  page: Page,
  browserName: string,
  rate: number,
): Promise<CDPSession | null> => {
  if (browserName !== "chromium") {
    return null;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

const settle = (page: Page, ms = 350) => page.waitForTimeout(ms);

/** Installs `window.__lat`: input timestamps + a mutation observer. */
const installProbe = (
  page: Page,
  opts: { observe: string; input: "keydown" | "pointerdown"; closest: string },
) =>
  page.evaluate((o) => {
    const w = window as any;
    w.__t0 = 0;
    w.__last = 0;
    document.addEventListener(
      o.input,
      () => {
        w.__t0 = performance.now();
        w.__last = 0;
      },
      true,
    );
    const mark = (n: Node | null) => {
      const el = n instanceof Element ? n : n?.parentElement;
      return !!el && !!el.closest(o.closest);
    };
    new MutationObserver((records) => {
      for (const rec of records) {
        if (
          mark(rec.target) ||
          [...rec.addedNodes].some(
            (n) => mark(n) || (n as Element).matches?.(o.closest),
          ) ||
          ([...rec.removedNodes].length > 0 && mark(rec.target))
        ) {
          w.__last = performance.now();
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }, opts);

const readProbe = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ commit: number; paint: number }>((res) => {
        const w = window as any;
        requestAnimationFrame(() =>
          requestAnimationFrame((t) =>
            res({
              commit: w.__last ? w.__last - w.__t0 : -1,
              paint: t - w.__t0,
            }),
          ),
        );
      }),
  );

test.describe("links perf", () => {
  for (const rate of [1, 4, 6]) {
    test(`autocomplete popup at ${NAMES} names, cpu x${rate}`, async ({
      page,
      browserName,
    }) => {
      test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
      await openVault(page, `?seed=links&names=${NAMES}`);
      await openDrawing(page, "Hub");
      const names = await page.evaluate(
        () => [...(window as any).__vaultRepo.files.keys()].length,
      );
      expect(names).toBeGreaterThanOrEqual(NAMES);
      const p = await scenePoint(page, 600, 420);
      await page.mouse.dblclick(p.x, p.y);
      await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeFocused();
      await page.keyboard.type("[[");
      await expect(page.locator(".vault-suggest")).toBeVisible();
      await installProbe(page, {
        observe: ".vault-suggest",
        input: "keydown",
        closest: ".vault-suggest",
      });
      await throttle(page, browserName, rate);
      const word = "roadmap";
      const commit: number[] = [];
      const paint: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const k = i % (word.length * 2);
        const key = k < word.length ? word[k] : "Backspace";
        await page.keyboard.press(key);
        await settle(page, 120);
        const m = await readProbe(page);
        if (m.commit >= 0) {
          commit.push(m.commit);
          paint.push(m.paint);
        }
      }
      report({
        test: "autocomplete",
        browser: browserName,
        rate,
        names,
        n: commit.length,
        commitMs: stats(commit),
        paintMs: stats(paint),
      });
      expect(commit.length).toBeGreaterThan(RUNS / 2);
    });
  }

  for (const rate of [1, 4, 6]) {
    test(`dock refresh, cpu x${rate}`, async ({ page, browserName }) => {
      test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
      await openVault(page, "?seed=links");
      await openDrawing(page, "Alpha");
      await page.keyboard.press("Meta+Alt+b");
      await expect(page.locator(".vault-links")).toBeVisible();
      await expect(
        page.locator(".vault-links__row--backlink").first(),
      ).toBeVisible();
      // Time the links() call (the fake index: IPC stand-in) and the render
      // after it resolves.
      await page.evaluate(() => {
        const w = window as any;
        w.__dock = [];
        const l = w.__vaultLinks;
        const orig = l.links.bind(l);
        l.links = async (...a: unknown[]) => {
          const call = performance.now();
          const res = await orig(...a);
          w.__dock.push({ call, ret: performance.now() });
          w.__last = 0;
          return res;
        };
      });
      await installProbe(page, {
        observe: ".vault-links",
        input: "pointerdown",
        closest: ".vault-links",
      });
      await throttle(page, browserName, rate);
      const ipc: number[] = [];
      const render: number[] = [];
      const total: number[] = [];
      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => {
          (window as any).__dock.length = 0;
          (window as any).__last = 0;
        });
        await page
          .locator(".vault-tree-item__name", {
            hasText: i % 2 === 0 ? /^Hub$/ : /^Alpha$/,
          })
          .click();
        await settle(page, 500);
        const m = await page.evaluate(() => {
          const w = window as any;
          const d = w.__dock[w.__dock.length - 1];
          return d && w.__last
            ? { ipc: d.ret - d.call, render: w.__last - d.ret }
            : null;
        });
        if (m && m.render >= 0) {
          ipc.push(m.ipc);
          render.push(m.render);
          total.push(m.ipc + m.render);
        }
      }
      report({
        test: "dock-refresh",
        browser: browserName,
        rate,
        n: total.length,
        ipcMs: stats(ipc),
        renderMs: stats(render),
        totalMs: stats(total),
      });
      expect(total.length).toBeGreaterThan(5);
    });
  }

  for (const rate of [1, 4, 6]) {
    test(`Cmd+click to target visible, cpu x${rate}`, async ({
      page,
      browserName,
    }) => {
      test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
      await openVault(page, "?seed=links");
      await openDrawing(page, "Hub");
      await installProbe(page, {
        observe: ".vault-breadcrumbs",
        input: "pointerdown",
        closest: ".vault-breadcrumbs",
      });
      await throttle(page, browserName, rate);
      const commit: number[] = [];
      const paint: number[] = [];
      for (let i = 0; i < 16; i++) {
        const fromHub = i % 2 === 0;
        const at = fromHub ? SEED.alphaText : { x: 298, y: 231 };
        const pt = await scenePoint(page, at.x, at.y);
        await withMeta(page, async () => {
          await page.mouse.move(pt.x, pt.y);
          await page.waitForTimeout(60);
          await page.mouse.click(pt.x, pt.y);
        });
        await expect(page.locator(".vault-breadcrumbs")).toContainText(
          fromHub ? "Alpha" : "Hub",
        );
        await settle(page, 450);
        const m = await readProbe(page);
        if (m.commit >= 0) {
          commit.push(m.commit);
          paint.push(m.paint);
        }
      }
      report({
        test: "cmd-click-open",
        browser: browserName,
        rate,
        n: commit.length,
        commitMs: stats(commit),
        paintMs: stats(paint),
      });
      expect(commit.length).toBeGreaterThan(8);
    });
  }

  for (const rate of [1, 4, 6]) {
    test(`rename UI returns, cpu x${rate}`, async ({ page, browserName }) => {
      test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
      await openVault(page, "?seed=links");
      await openDrawing(page, "Hub");
      await installProbe(page, {
        observe: ".vault-modal",
        input: "pointerdown",
        closest: "body",
      });
      // Time from the Rename click to the dialog being gone.
      await page.evaluate(() => {
        const w = window as any;
        w.__gone = 0;
        new MutationObserver(() => {
          if (!document.querySelector('[role="dialog"]') && !w.__gone) {
            w.__gone = performance.now();
          }
        }).observe(document.body, { childList: true, subtree: true });
      });
      await throttle(page, browserName, rate);
      const ms: number[] = [];
      let from = "Alpha";
      for (let i = 0; i < 8; i++) {
        const to = i % 2 === 0 ? "Beta" : "Alpha";
        const dialog = await openRenameDialog(page, from);
        await dialog.getByLabel("New name").fill(to);
        await page.evaluate(() => {
          const w = window as any;
          w.__gone = 0;
          w.__t0 = 0;
        });
        await dialog.getByRole("button", { name: "Rename" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await settle(page, 300);
        const v = await page.evaluate(() => {
          const w = window as any;
          return w.__gone && w.__t0 ? w.__gone - w.__t0 : -1;
        });
        if (v >= 0) {
          ms.push(v);
        }
        await page.evaluate(() => (window as any).__vaultLinks.settled());
        from = to;
      }
      report({
        test: "rename-ui-returns",
        browser: browserName,
        rate,
        n: ms.length,
        ms: stats(ms),
      });
      expect(ms.length).toBeGreaterThan(3);
    });
  }

  // Typing in a text element without `[[`: links wiring on vs autocomplete off.
  for (const rate of [1, 4, 6]) {
    for (const autocomplete of [true, false]) {
      test(`typing cost without [[ (autocomplete ${autocomplete}), cpu x${rate}`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName !== "chromium", "CDP metrics are chromium only");
        test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
        await page.addInitScript(
          ([key, value]) => {
            window.localStorage.setItem(key as string, JSON.stringify(value));
          },
          [
            "excalidraw-vault-preferences-v1",
            { linkAutocomplete: autocomplete },
          ] as const,
        );
        await openVault(page, "?seed=links");
        await openDrawing(page, "Hub");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable");
        const metric = async (name: string) =>
          (await cdp.send("Performance.getMetrics")).metrics.find(
            (m) => m.name === name,
          )!.value;
        const p = await scenePoint(page, 600, 420);
        await page.mouse.dblclick(p.x, p.y);
        const area = page.locator("textarea.excalidraw-wysiwyg");
        await expect(area).toBeFocused();
        await page.keyboard.type("warm up", { delay: 20 });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const js0 = await metric("ScriptDuration");
        const task0 = await metric("TaskDuration");
        for (let i = 0; i < KEYS; i++) {
          await page.keyboard.type("a");
          await page.waitForTimeout(60);
        }
        const js = ((await metric("ScriptDuration")) - js0) * 1000;
        const task = ((await metric("TaskDuration")) - task0) * 1000;
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        report({
          test: "typing-no-brackets",
          browser: browserName,
          rate,
          autocomplete,
          n: KEYS,
          jsMsPerKey: r(js / KEYS),
          taskMsPerKey: r(task / KEYS),
        });
      });
    }
  }
});
