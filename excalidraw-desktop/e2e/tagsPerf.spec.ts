import { appendFileSync } from "node:fs";

import { expect, type CDPSession, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault } from "./helpers";
import {
  editArea,
  openTaggedFolder,
  openTagsVault,
  popup,
  startTyping,
  tagList,
  tagsPanel,
} from "./tagsHelpers";

// Links P2 (tags) latency budgets (PLAN.md): `#` popup keystroke -> rows
// committed (4 ms, low-end <= 16 ms at Chromium 4x), Tags pane render and
// sort toggle at 2,000 tags (<= 16 ms), and plain typing costing the same as
// with the autocomplete off. Skipped unless E2E_PERF=1. Same timing model as
// linksPerf.spec.ts: t0 = capture-phase input event in the page, t1 = the last
// DOM mutation of the surface under test ("commit"); `paint` also waits two
// animation frames and is informational (quantised to the refresh rate).
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-tags.jsonl";
const RUNS = Number(process.env.PERF_RUNS ?? 28);
const TAGS = Number(process.env.PERF_TAGS ?? 2000);
const KEYS = 40;

test.skip(!PERF, "set E2E_PERF=1 to run the tags measurements");
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
  console.log(`TAGS_PERF ${JSON.stringify(row)}`);
};

const ratesFor = (browser: string) => (browser === "chromium" ? [1, 4] : [1]);

const throttle = async (
  page: Page,
  browserName: string,
  rate: number,
): Promise<CDPSession | null> => {
  if (browserName !== "chromium" || rate === 1) {
    return null;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
};

const settle = (page: Page, ms = 350) => page.waitForTimeout(ms);

const installProbe = (
  page: Page,
  opts: { input: "keydown" | "pointerdown"; closest: string },
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
          )
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

test.describe("tags perf", () => {
  for (const rate of [1, 4]) {
    test(`# popup at ${TAGS} tags, cpu x${rate}`, async ({
      page,
      browserName,
    }) => {
      test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
      await openTagsVault(page, `?tagcount=${TAGS}`);
      await openTaggedFolder(page);
      await startTyping(page, "Tag set 00");
      await page.keyboard.type("#");
      await expect(popup(page)).toBeVisible();
      await installProbe(page, { input: "keydown", closest: ".vault-suggest" });
      await throttle(page, browserName, rate);
      const word = "t01234";
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
        test: "tag-popup",
        browser: browserName,
        rate,
        tags: TAGS,
        n: commit.length,
        commitMs: stats(commit),
        paintMs: stats(paint),
      });
      expect(commit.length).toBeGreaterThan(RUNS / 2);
    });
  }

  for (const rate of [1, 4]) {
    for (const action of ["expand", "sort"] as const) {
      test(`tags pane ${action} at ${TAGS} tags, cpu x${rate}`, async ({
        page,
        browserName,
      }) => {
        test.skip(!ratesFor(browserName).includes(rate), "rate not for engine");
        await openTagsVault(page, `?tagcount=${TAGS}`);
        await expect(tagList(page)).toBeVisible();
        await installProbe(page, {
          input: "pointerdown",
          closest: ".vault-tags",
        });
        await throttle(page, browserName, rate);
        const header = tagsPanel(page).getByRole("button", {
          name: "Tags",
          exact: true,
        });
        const sort = tagsPanel(page).getByRole("button", {
          name: /^Sort tags by/,
        });
        const commit: number[] = [];
        const paint: number[] = [];
        for (let i = 0; i < 16; i++) {
          if (action === "expand") {
            // Even clicks collapse; only the expanding (odd) ones are timed.
            await header.click();
            await settle(page, 200);
            if (i % 2 === 1) {
              const m = await readProbe(page);
              if (m.commit >= 0) {
                commit.push(m.commit);
                paint.push(m.paint);
              }
            }
          } else {
            await sort.click();
            await settle(page, 200);
            const m = await readProbe(page);
            if (m.commit >= 0) {
              commit.push(m.commit);
              paint.push(m.paint);
            }
          }
        }
        report({
          test: `tags-pane-${action}`,
          browser: browserName,
          rate,
          tags: TAGS,
          n: commit.length,
          commitMs: stats(commit),
          paintMs: stats(paint),
        });
        expect(commit.length).toBeGreaterThan(3);
      });
    }
  }

  // Plain typing (no `#`, no `[[`) in a text element, 2k tags loaded:
  // autocompletes on vs off.
  for (const rate of [1, 4]) {
    for (const on of [true, false]) {
      test(`typing cost without # (autocomplete ${on}), cpu x${rate}`, async ({
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
            { linkAutocomplete: on, tagAutocomplete: on },
          ] as const,
        );
        await openVault(page, `?tagcount=${TAGS}`);
        await openTaggedFolder(page);
        await startTyping(page, "Tag set 00");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable");
        const metric = async (name: string) =>
          (await cdp.send("Performance.getMetrics")).metrics.find(
            (m) => m.name === name,
          )!.value;
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
        await expect(editArea(page)).toBeFocused();
        report({
          test: "typing-no-hash",
          browser: browserName,
          rate,
          autocomplete: on,
          tags: TAGS,
          n: KEYS,
          jsMsPerKey: r(js / KEYS),
          taskMsPerKey: r(task / KEYS),
        });
      });
    }
  }
});
