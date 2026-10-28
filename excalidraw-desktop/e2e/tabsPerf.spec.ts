/* eslint-disable no-console */
import { appendFileSync } from "node:fs";
import { loadavg } from "node:os";
import { deflateSync } from "node:zlib";

import { expect } from "@playwright/test";

import { test } from "./fixture";

import { openSeededVault, sceneJson } from "./tabsHelpers";

import type { CDPSession, Page } from "@playwright/test";

// Tabs (F5) performance, PLAN.md section 4. Chromium only (CDP throttling and
// heap numbers). Skipped unless E2E_PERF=1; rows are appended as JSON lines
// to $PERF_OUT and printed as `PERF {json}`.
//
//   E2E_PERF=1 E2E_FULL=1 npx playwright test e2e/tabsPerf.spec.ts --project=chromium
//
// "Painted" = the same signal as the harness' switch.drawing: the target's
// shapes are in the shown editor and its canvases exist, then two frames.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-tabs.jsonl";
const RATES = (process.env.PERF_RATES ?? "1,4").split(",").map(Number);
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 4);
const PER_ROUND = Number(process.env.PERF_PER_ROUND ?? 5);
const RESTORE_RUNS = Number(process.env.PERF_RESTORE_RUNS ?? 15);
const MOD = "Meta";

test.skip(!PERF, "set E2E_PERF=1 to run the tabs measurements");
test.describe.configure({ timeout: 600_000 });

// ---- fixtures: typical drawing = 300 elements + 2 images ------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A noisy RGB PNG (incompressible, like a photo), `size` x `size`. */
const noisePng = (size: number, seed: number) => {
  let s = seed;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let i = 1; i < row.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      row[i] = s >>> 24;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

const el = (id: string, type: string, i: number, extra: object = {}) => ({
  id,
  type,
  x: (i % 20) * 60,
  y: Math.floor(i / 20) * 50,
  width: 50,
  height: 40,
  seed: i + 1,
  ...extra,
});

/** Element ids are `${prefix}-0 ...`; the first is a rectangle. */
const typicalScene = (prefix: string, k: number) => {
  const texts = Array.from({ length: 60 }, (_, i) => {
    const text = `${prefix} note ${i}`;
    return {
      ...el(`${prefix}-t${i}`, "text", 240 + i),
      text,
      originalText: text,
      fontSize: 16,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
    };
  });
  const images = [0, 1].map((n) => ({
    ...el(`${prefix}-img${n}`, "image", 300 + n * 3, {
      width: 120,
      height: 120,
    }),
    fileId: `${prefix}-file${n}`,
    status: "saved",
    scale: [1, 1],
  }));
  const files = Object.fromEntries(
    [0, 1].map((n) => [
      `${prefix}-file${n}`,
      {
        mimeType: "image/png",
        id: `${prefix}-file${n}`,
        dataURL: noisePng(96, k * 2 + n + 1),
        created: 1700000000000,
      },
    ]),
  );
  const shapes = Array.from({ length: 240 }, (_, i) => ({
    id: `${prefix}-${i}`,
    type: (i % 4 === 3 ? "ellipse" : "rectangle") as "rectangle" | "ellipse",
    x: (i % 20) * 60,
    y: Math.floor(i / 20) * 50,
    w: 50,
    h: 40,
  }));
  return sceneJson(shapes, [...texts, ...images].map(withBase), files);
};

// sceneJson merges `extra` verbatim, so give text/image elements the base fields.
const withBase = (e: object) => ({
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: [],
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  index: null,
  updated: 1,
  ...e,
});

const pad = (n: number) => `P${String(n).padStart(2, "0")}`;
const typicalVault = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, k) => [
      `${pad(k)}.excalidraw`,
      typicalScene(pad(k), k),
    ]),
  );

// ---- statistics and reporting -----------------------------------------------------------

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: +pct(xs, 0.5).toFixed(1),
  p95: +pct(xs, 0.95).toFixed(1),
  min: +Math.min(...xs).toFixed(1),
  max: +Math.max(...xs).toFixed(1),
});
const report = (rate: number, metric: string, xs: number[], extra = {}) => {
  const row = { metric, rate, ...stats(xs), ...extra };
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  console.log(`PERF ${JSON.stringify(row)}`);
  return row;
};
const note = (rate: number, metric: string, data: object) => {
  const row = { metric, rate, ...data };
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  console.log(`PERF ${JSON.stringify(row)}`);
};

// ---- in-page helpers -------------------------------------------------------------------

/** Capture-phase click/keydown stamp, plus the waiters used by every sample. */
const installProbe = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    if (w.__probe) {
      return;
    }
    w.__probe = { t0: 0 };
    const stamp = () => {
      w.__probe.t0 = performance.now();
    };
    document.addEventListener("click", stamp, true);
    document.addEventListener("keydown", stamp, true);
    const tick = () =>
      new Promise<void>((r) => {
        const c = new MessageChannel();
        c.port1.onmessage = () => r();
        c.port2.postMessage(0);
      });
    // Resolves when `ready()` holds, then after two frames; ms since the stamp.
    w.__painted = async (prefix: string, zoom: number | null) => {
      const ready = () => {
        const api = w.__editorApis()[0];
        if (!api || document.querySelector(".LoadingMessage")) {
          return false;
        }
        const first = api.getSceneElements()[0];
        if (!first || !String(first.id).startsWith(`${prefix}-`)) {
          return false;
        }
        if (
          zoom !== null &&
          Math.abs(api.getAppState().zoom.value - zoom) > 1e-6
        ) {
          return false;
        }
        const c = document.querySelector(".vault-editor canvas.interactive");
        return Boolean(
          c &&
            document.querySelector(".vault-editor canvas.static") &&
            c.getBoundingClientRect().width > 0,
        );
      };
      const start = performance.now();
      while (!ready()) {
        if (performance.now() - start > 20000) {
          throw new Error(`timeout waiting for ${prefix}`);
        }
        await tick();
      }
      await new Promise((r) => requestAnimationFrame(() => r(0)));
      await new Promise((r) => requestAnimationFrame(() => r(0)));
      return performance.now() - w.__probe.t0;
    };
    // Resolves with ms from the stamp to the first mutation matching `kind`.
    w.__armMutation = (kind: "close" | "select") => {
      w.__mutation = new Promise<number>((resolve) => {
        const list = document.querySelector('[role="tablist"]')!;
        const mo = new MutationObserver((records) => {
          const hit =
            kind === "close"
              ? records.some((r) => r.removedNodes.length > 0)
              : records.some((r) => r.attributeName === "aria-selected");
          if (hit) {
            mo.disconnect();
            resolve(performance.now() - w.__probe.t0);
          }
        });
        mo.observe(list, {
          childList: true,
          subtree: kind === "select",
          attributes: kind === "select",
          attributeFilter: kind === "select" ? ["aria-selected"] : undefined,
        });
      });
    };
  });

const painted = (page: Page, prefix: string, zoom: number | null = null) =>
  page.evaluate(([p, z]) => (window as any).__painted(p, z), [prefix, zoom] as [
    string,
    number | null,
  ]);

const row = (page: Page, name: string) =>
  page
    .locator(".vault-tree-item__name")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first();
const tabOf = (page: Page, name: string) =>
  page
    .getByTestId("vault-tab")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first();
const zoomNow = (page: Page) =>
  page.evaluate(
    () => (window as any).__editorApis()[0].getAppState().zoom.value as number,
  );
const zoomIn = async (page: Page, times: number) => {
  for (let i = 0; i < times; i++) {
    await page.locator(".vault-editor .zoom-in-button").click();
  }
};
const throttle = (cdp: CDPSession, rate: number) =>
  cdp.send("Emulation.setCPUThrottlingRate", { rate });

const load = () => loadavg()[0];

// ---- switch / open / close ------------------------------------------------------------

for (const rate of RATES) {
  test(`tabs switch, MRU, open, close, baseline, cpu x${rate}`, async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling is chromium only");
    const load0 = load();
    // Baseline page: tabs disabled from boot (today's single-document flow).
    const ctxB = await browser.newContext({
      viewport: { width: 1280, height: 850 },
    });
    const pageB = await ctxB.newPage();
    await pageB.addInitScript(() => {
      window.localStorage.setItem(
        "excalidraw-vault-preferences-v1",
        JSON.stringify({ tabsEnabled: false }),
      );
    });
    try {
      await openSeededVault(page, typicalVault(8));
      await openSeededVault(pageB, typicalVault(8));
      await expect(pageB.getByTestId("vault-tabs")).toHaveCount(0);
      for (const p of [page, pageB]) {
        await installProbe(p);
        await throttle(await p.context().newCDPSession(p), rate);
      }

      const sw: number[] = [];
      const mru: number[] = [];
      const opn: number[] = [];
      const base: number[] = [];
      const baseOpen: number[] = [];
      const closeBg: number[] = [];

      // Tabs page: P00 and P01 open and zoomed (views differ from default).
      await row(page, "P00").click();
      await painted(page, "P00");
      await zoomIn(page, 2);
      await row(page, "P01").click({ modifiers: [MOD] });
      await painted(page, "P01");
      await zoomIn(page, 3);
      const zooms: Record<string, number> = { P01: await zoomNow(page) };
      await tabOf(page, "P00").click();
      await painted(page, "P00");
      zooms.P00 = await zoomNow(page);
      await expect(page.getByTestId("vault-tab")).toHaveCount(2);

      let shown: "P00" | "P01" = "P00";
      const other = () => (shown === "P00" ? "P01" : "P00");
      const switchTo = async (name: "P00" | "P01", how: "click" | "mru") => {
        if (how === "click") {
          await tabOf(page, name).click();
        } else {
          await page.keyboard.press("Control+Tab");
        }
        const ms = await painted(page, name, zooms[name]);
        shown = name;
        return ms;
      };
      let shownB: "P00" | "P01" = "P00";
      const switchB = async () => {
        const t = shownB === "P00" ? "P01" : "P00";
        await row(pageB, t).click();
        const ms = await painted(pageB, t);
        shownB = t;
        return ms;
      };
      await row(pageB, "P00").click();
      await painted(pageB, "P00");

      // 2 warm-ups each
      for (let i = 0; i < 2; i++) {
        await switchTo(other(), "click");
        await switchB();
        await page.waitForTimeout(250);
      }

      for (let r = 0; r < ROUNDS; r++) {
        // tabs block
        for (let i = 0; i < PER_ROUND; i++) {
          await page.waitForTimeout(250);
          sw.push(await switchTo(other(), "click"));
        }
        for (let i = 0; i < PER_ROUND; i++) {
          await page.waitForTimeout(250);
          mru.push(await switchTo(other(), "mru"));
        }
        // open: Cmd+click a drawing that is not open, then close it (unmeasured)
        for (let i = 0; i < PER_ROUND; i++) {
          const name = pad(2 + i);
          await page.waitForTimeout(250);
          await row(page, name).click({ modifiers: [MOD] });
          opn.push(await painted(page, name));
          await page.keyboard.press(`${MOD}+KeyW`);
          await painted(page, shown);
        }
        // closeBackground: open a tab, return to the shown one, close the other
        for (let i = 0; i < PER_ROUND; i++) {
          const name = pad(2 + i);
          await row(page, name).click({ modifiers: [MOD] });
          await painted(page, name);
          await tabOf(page, shown).click();
          await painted(page, shown);
          await page.waitForTimeout(150);
          await tabOf(page, name).hover();
          await page.evaluate(() => (window as any).__armMutation("close"));
          await tabOf(page, name).getByTestId("vault-tab-close").click();
          closeBg.push(await page.evaluate(() => (window as any).__mutation));
        }
        // baseline block (tabs off): navigator click between two drawings
        for (let i = 0; i < PER_ROUND; i++) {
          await pageB.waitForTimeout(250);
          base.push(await switchB());
        }
        for (let i = 0; i < PER_ROUND; i++) {
          const name = pad(2 + i);
          await pageB.waitForTimeout(250);
          await row(pageB, name).click();
          baseOpen.push(await painted(pageB, name));
        }
        await row(pageB, shownB).click();
        await painted(pageB, shownB);
      }

      const rows = {
        sw: report(rate, "tabs.switch", sw),
        mru: report(rate, "tabs.switchMru", mru),
        opn: report(rate, "tabs.open", opn),
        close: report(rate, "tabs.closeBackground", closeBg),
        base: report(rate, "baseline.switch.drawing", base),
        baseOpen: report(rate, "baseline.open", baseOpen),
      };
      note(rate, "tabs.vsBaseline", {
        switchP50Ratio: +(rows.sw.p50 / rows.base.p50).toFixed(3),
        switchP95Ratio: +(rows.sw.p95 / rows.base.p95).toFixed(3),
        mruP50Ratio: +(rows.mru.p50 / rows.base.p50).toFixed(3),
        openP50Ratio: +(rows.opn.p50 / rows.baseOpen.p50).toFixed(3),
        loadStart: +load0.toFixed(2),
        loadEnd: +load().toFixed(2),
      });
    } finally {
      await ctxB.close();
    }
  });
}

// ---- strip commit with 50 tabs ----------------------------------------------------------

for (const rate of RATES) {
  test(`tabs strip commit with 50 tabs, cpu x${rate}`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling is chromium only");
    await openSeededVault(page);
    await installProbe(page);
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < 49; i++) {
      await page.getByTestId("vault-tab-new").click();
    }
    await expect(page.getByTestId("vault-tab")).toHaveCount(50);
    await throttle(cdp, rate);
    const xs: number[] = [];
    for (let i = 0; i < 25; i++) {
      const target = page.getByTestId("vault-tab").nth((i * 7) % 49);
      await page.waitForTimeout(80);
      await page.evaluate(() => (window as any).__armMutation("select"));
      await target.click();
      const ms = (await page.evaluate(
        () => (window as any).__mutation,
      )) as number;
      if (i >= 2) {
        xs.push(ms);
      }
    }
    report(rate, "tabs.stripCommit50", xs);
  });
}

// ---- phase 3 UI: 50 tabs with a pinned tab and the menu closed, menu and list open -------

/** Stamps contextmenu / click / keydown, resolves ms to the first DOM insertion of `selector`. */
const armOpen = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const w = window as any;
    const stamp = () => {
      w.__open0 = performance.now();
    };
    if (!w.__openStamped) {
      w.__openStamped = true;
      for (const t of ["contextmenu", "click", "keydown"]) {
        document.addEventListener(t, stamp, true);
      }
    }
    w.__opened = new Promise<{ commit: number; frame: number }>((resolve) => {
      const mo = new MutationObserver(() => {
        if (document.querySelector(sel)) {
          mo.disconnect();
          const commit = performance.now() - w.__open0;
          requestAnimationFrame(() =>
            resolve({ commit, frame: performance.now() - w.__open0 }),
          );
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }, selector);

const opened = (page: Page) =>
  page.evaluate(
    () =>
      (window as any).__opened as Promise<{ commit: number; frame: number }>,
  );

for (const rate of RATES) {
  test(`tabs phase 3 UI with 50 tabs (pinned, menu closed), menu and list open, cpu x${rate}`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling is chromium only");
    await openSeededVault(page);
    await installProbe(page);
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < 49; i++) {
      await page.getByTestId("vault-tab-new").click();
    }
    await expect(page.getByTestId("vault-tab")).toHaveCount(50);
    // Pin the first tab through its menu, then dismiss nothing else: menu closed.
    await page.getByTestId("vault-tab").first().click({ button: "right" });
    await page.getByTestId("vault-tab-menu-pin").click();
    await expect(page.getByTestId("vault-tab-menu")).toHaveCount(0);
    await expect(page.locator(".vault-tabs__tab--pinned")).toHaveCount(1);
    await throttle(cdp, rate);

    // Strip commit (activation) with the new UI mounted.
    const commit: number[] = [];
    for (let i = 0; i < 25; i++) {
      const target = page.getByTestId("vault-tab").nth(1 + ((i * 7) % 48));
      await page.waitForTimeout(80);
      await page.evaluate(() => (window as any).__armMutation("select"));
      await target.click();
      const ms = (await page.evaluate(
        () => (window as any).__mutation,
      )) as number;
      if (i >= 2) {
        commit.push(ms);
      }
    }
    report(rate, "tabs.stripCommit50.pinned", commit);

    // Context menu open: right click on a tab -> menu in the DOM (and painted).
    const menuCommit: number[] = [];
    const menuFrame: number[] = [];
    for (let i = 0; i < 20; i++) {
      const target = page.getByTestId("vault-tab").nth(2 + ((i * 5) % 40));
      await page.waitForTimeout(80);
      await armOpen(page, '[data-testid="vault-tab-menu"]');
      await target.click({ button: "right" });
      const r = await opened(page);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("vault-tab-menu")).toHaveCount(0);
      if (i >= 2) {
        menuCommit.push(r.commit);
        menuFrame.push(r.frame);
      }
    }
    report(rate, "tabs.menuOpen50.commit", menuCommit);
    report(rate, "tabs.menuOpen50.frame", menuFrame);

    // Tab list open: chevron click -> list in the DOM with 50 rows.
    const listCommit: number[] = [];
    const listFrame: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(80);
      await armOpen(page, '[data-testid="vault-tab-list-item"]:nth-child(50)');
      await page.getByTestId("vault-tab-overflow").click();
      const r = await opened(page);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("vault-tab-list")).toHaveCount(0);
      if (i >= 2) {
        listCommit.push(r.commit);
        listFrame.push(r.frame);
      }
    }
    report(rate, "tabs.listOpen50.commit", listCommit);
    report(rate, "tabs.listOpen50.frame", listFrame);
    note(rate, "tabs.phase3.load", { load: +load().toFixed(2) });
  });
}

// ---- session restore: 20 saved tabs vs 1 ------------------------------------------------

for (const rate of RATES) {
  test(`tabs restore, 20 saved tabs vs 1, cpu x${rate}`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP throttling is chromium only");
    const query = "?seed=bigfolder&n=30&el=300";
    const KEY = "vaultdraw.tabs.session:/fake/My Vault";
    await page.addInitScript(() => {
      const t: Record<string, number> = {};
      (window as any).__marks = t;
      const want = Number(localStorage.getItem("e2e.expectTabs") ?? 1);
      new MutationObserver(() => {
        const now = performance.now();
        if (!t.tree && document.querySelector(".vault-tree-item")) {
          t.tree = now;
        }
        const n = document.querySelectorAll('[data-testid="vault-tab"]').length;
        if (
          !t.strip &&
          n >= want &&
          document.querySelector(".vault-tree-item")
        ) {
          t.strip = now;
        }
        if (
          !t.editor &&
          document.querySelector(".vault-editor canvas.static")
        ) {
          t.editor = now;
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto(`/e2e.html${query}`);
    await expect(page.getByLabel("Vault File Navigator")).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await throttle(cdp, rate);
    const session = (n: number) =>
      JSON.stringify({
        v: 1,
        tabs: Array.from({ length: n }, (_, i) => ({
          path: `Zbig/note ${String(i).padStart(3, "0")}.excalidraw`,
          pinned: false,
        })),
        active: 0,
        mru: Array.from({ length: n }, (_, i) => i),
      });
    const samples: Record<number, Record<string, number[]>> = {
      1: { tree: [], strip: [], editor: [] },
      20: { tree: [], strip: [], editor: [] },
    };
    const load0 = load();
    for (let i = 0; i < RESTORE_RUNS + 2; i++) {
      for (const n of [1, 20]) {
        await page.evaluate(
          ([key, value, count]) => {
            localStorage.setItem(key, value);
            localStorage.setItem("e2e.expectTabs", count);
          },
          [KEY, session(n), String(n)],
        );
        await page.goto(`/e2e.html${query}`);
        await page.waitForFunction(() => (window as any).__marks?.editor);
        await page.waitForFunction(() => (window as any).__marks?.strip);
        const marks = (await page.evaluate(() => ({
          ...(window as any).__marks,
        }))) as Record<string, number>;
        expect(await page.getByTestId("vault-tab").count()).toBe(n);
        if (i >= 2) {
          for (const k of ["tree", "strip", "editor"]) {
            samples[n][k].push(marks[k]);
          }
        }
      }
    }
    for (const n of [1, 20]) {
      for (const k of ["tree", "strip", "editor"]) {
        report(rate, `tabs.restore.${k}.${n}tabs`, samples[n][k]);
      }
    }
    note(rate, "tabs.restore.delta", {
      treeP50: +(
        pct(samples[20].tree, 0.5) - pct(samples[1].tree, 0.5)
      ).toFixed(1),
      stripP50: +(
        pct(samples[20].strip, 0.5) - pct(samples[1].strip, 0.5)
      ).toFixed(1),
      editorP50: +(
        pct(samples[20].editor, 0.5) - pct(samples[1].editor, 0.5)
      ).toFixed(1),
      loadStart: +load0.toFixed(2),
      loadEnd: +load().toFixed(2),
    });
  });
}

// ---- memory, canvases and idle: 20 tabs vs 1 --------------------------------------------

test("tabs memory, canvases and idle: 20 tabs vs 1", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP heap numbers are chromium only");
  await page.addInitScript(() => {
    const w = window as any;
    const log = {
      set: 0,
      fired: 0,
      raf: 0,
      rafFired: 0,
      interval: 0,
      intervalFired: 0,
    };
    w.__timers = log;
    w.__timerWho = {} as Record<string, number>;
    w.__trackTimers = false;
    const who = () =>
      (new Error().stack ?? "").split("\n")[2]?.trim().slice(0, 120) ?? "?";
    const st = w.setTimeout.bind(w);
    w.setTimeout = (fn: any, ms?: number, ...a: unknown[]) => {
      if (w.__trackTimers) {
        w.__timers.set++;
        const key = `timeout ${who()}`;
        w.__timerWho[key] = (w.__timerWho[key] ?? 0) + 1;
      }
      return st(
        (...args: unknown[]) => {
          if (w.__trackTimers) {
            w.__timers.fired++;
          }
          return typeof fn === "function" ? fn(...args) : undefined;
        },
        ms,
        ...a,
      );
    };
    const si = w.setInterval.bind(w);
    w.setInterval = (fn: any, ms?: number, ...a: unknown[]) => {
      if (w.__trackTimers) {
        w.__timers.interval++;
        const key = `interval ${who()}`;
        w.__timerWho[key] = (w.__timerWho[key] ?? 0) + 1;
      }
      return si(
        (...args: unknown[]) => {
          if (w.__trackTimers) {
            w.__timers.intervalFired++;
          }
          return typeof fn === "function" ? fn(...args) : undefined;
        },
        ms,
        ...a,
      );
    };
    const raf = w.requestAnimationFrame.bind(w);
    w.requestAnimationFrame = (fn: FrameRequestCallback) => {
      if (w.__trackTimers) {
        w.__timers.raf++;
        const key = `raf ${who()}`;
        w.__timerWho[key] = (w.__timerWho[key] ?? 0) + 1;
      }
      return raf((t) => {
        if (w.__trackTimers) {
          w.__timers.rafFired++;
        }
        fn(t);
      });
    };
  });
  await openSeededVault(page, typicalVault(20));
  await installProbe(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  const metric = async (name: string) =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === name,
    )!.value;
  const snapshot = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(500);
    return {
      heapMB: +((await metric("JSHeapUsedSize")) / 1048576).toFixed(2),
      domNodes: await metric("Nodes"),
      canvases: await page.locator("canvas").count(),
      editors: await page.evaluate(() => (window as any).__editorApis().length),
      tabs: await page.getByTestId("vault-tab").count(),
    };
  };
  const idle = async () => {
    const zero = () => {
      const w = window as any;
      w.__timers = {
        set: 0,
        fired: 0,
        raf: 0,
        rafFired: 0,
        interval: 0,
        intervalFired: 0,
      };
      w.__timerWho = {};
      w.__trackTimers = true;
    };
    await page.evaluate(zero);
    // Self-check: the wrapper must see one timeout and one frame we schedule.
    await page.evaluate(() => {
      setTimeout(() => {}, 1);
      requestAnimationFrame(() => {});
    });
    await page.waitForTimeout(150);
    const probe = await page.evaluate(() => ({ ...(window as any).__timers }));
    expect(probe.fired).toBeGreaterThanOrEqual(1);
    expect(probe.rafFired).toBeGreaterThanOrEqual(1);
    await page.evaluate(zero);
    const task0 = await metric("TaskDuration");
    await page.waitForTimeout(5000);
    const out = await page.evaluate(() => {
      const w = window as any;
      w.__trackTimers = false;
      const top = Object.entries(w.__timerWho as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      return { ...w.__timers, top };
    });
    return {
      ...out,
      taskMs5s: +(((await metric("TaskDuration")) - task0) * 1000).toFixed(1),
    };
  };

  await row(page, "P00").click();
  await painted(page, "P00");
  await page.waitForTimeout(800);
  const one = await snapshot();
  const idleOne = await idle();

  for (let k = 1; k < 20; k++) {
    await row(page, pad(k)).click({ modifiers: [MOD] });
    await painted(page, pad(k));
  }
  await tabOf(page, "P00").click();
  await painted(page, "P00");
  await page.waitForTimeout(800);
  const twenty = await snapshot();
  const idleTwenty = await idle();

  note(1, "tabs.memory", {
    one,
    twenty,
    heapDeltaMB: +(twenty.heapMB - one.heapMB).toFixed(2),
    canvasDelta: twenty.canvases - one.canvases,
    domDelta: twenty.domNodes - one.domNodes,
  });
  note(1, "tabs.idle", { one: idleOne, twenty: idleTwenty });
  expect(twenty.tabs).toBe(20);
  expect(twenty.editors).toBe(1);
});
