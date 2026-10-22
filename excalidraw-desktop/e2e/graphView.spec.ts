/* eslint-disable no-console */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { personalPath } from "./mainCheckout";

import type { GraphHarnessHooks } from "./graphHarness";

// Graph view smoke (fake N-node graph, no Rust): open, hover card, keyboard, Canvas2D fallback and
// light/dark screenshots. `GRAPH_PERF=1` also prints open and frame numbers at 10k and 50k.
const SHOTS =
  process.env.GRAPH_SHOTS_DIR ??
  personalPath("feature/links-graph/screenshots/p3");

type W = Window & { __graph: GraphHarnessHooks };

const url = (n: number, extra = "") => `/e2e.html?graph=${n}${extra}`;

async function openGraph(page: Page, n: number, extra = "") {
  await page.goto(url(n, extra));
  await page.waitForFunction(
    () => (window as unknown as W).__graph?.session,
    undefined,
    {
      timeout: 30_000,
    },
  );
  await waitSettled(page);
}

async function waitSettled(page: Page) {
  await page.waitForFunction(
    () => (window as unknown as W).__graph.session!.metrics.settledMs > 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(350); // the 200 ms fit tween
}

const metrics = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as W).__graph.session!.metrics;
    const t = [...m.frameTimes].sort((a, b) => a - b);
    return {
      dataMs: +m.dataMs.toFixed(1),
      firstFrameMs: +m.firstFrameMs.toFixed(1),
      settledMs: +m.settledMs.toFixed(0),
      warm: m.warm,
      backend: m.backend,
      frames: m.frames,
      layoutMessages: m.layoutMessages,
      frameP50: +(t[Math.floor(t.length * 0.5)] ?? 0).toFixed(2),
      frameP95: +(t[Math.floor(t.length * 0.95)] ?? 0).toFixed(2),
    };
  });

/** Page coordinates of the busiest visible drawing (tags are shown by default and don't open). */
async function busiestNode(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as W).__graph.session!;
    const node = [...s.hintMap().labels.keys()].find(
      (i) => s.pathOf(i) !== null,
    )!;
    const p = s.nodeScreen(node);
    const r = document
      .querySelector('[data-testid="graph-stage"]')!
      .getBoundingClientRect();
    return { node, x: r.left + p.x, y: r.top + p.y };
  });
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("graph view", () => {
  test("opens, shows the hover card, opens with Enter and closes with Esc", async ({
    page,
  }) => {
    await openGraph(page, 1000);
    console.log("graph 1k", JSON.stringify(await metrics(page)));
    const p = await busiestNode(page);
    await page.mouse.move(p.x - 40, p.y - 40);
    await page.mouse.move(p.x, p.y);
    const card = page.getByTestId("graph-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("↵ open");
    await expect(card).toContainText("backlinks");
    await page.keyboard.press("Enter");
    const opened = await page.evaluate(
      () => (window as unknown as W).__graph.opened,
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/\.excalidraw$/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("graph-view")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as W).__graph.closed),
    ).toBe(1);
  });

  test("keyboard: l moves focus, f hints open a node, / focuses the filter", async ({
    page,
  }) => {
    await openGraph(page, 1000);
    await page.keyboard.press("l");
    await expect(page.getByTestId("graph-card")).toBeVisible();
    await page.keyboard.press("f");
    await expect(page.locator(".vd-graph__hint").first()).toBeVisible();
    // hint letters of the busiest on-screen drawing (tag nodes don't open)
    const label = await page.evaluate(() => {
      const s = (window as unknown as W).__graph.session!;
      for (const [node, l] of s.hintMap().labels) {
        if (s.pathOf(node) !== null) {
          return l.toLowerCase();
        }
      }
      return "";
    });
    for (const ch of label) {
      await page.keyboard.press(ch);
    }
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as W).__graph.opened.length),
      )
      .toBe(1);
    await page.keyboard.press("/");
    await expect(page.getByLabel("Filter graph")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("graph-view")).toBeVisible();
  });

  test("warm reopen reuses the saved layout", async ({ page }) => {
    await openGraph(page, 1000);
    await page.waitForFunction(
      () => (window as unknown as W).__graph.saves > 0,
      undefined,
      {
        timeout: 5000,
      },
    );
    await page.evaluate(() => (window as unknown as W).__graph.toggle());
    await expect(page.getByTestId("graph-view")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as W).__graph.session),
    ).toBeNull();
    await page.evaluate(() => (window as unknown as W).__graph.toggle());
    await page.waitForFunction(() => (window as unknown as W).__graph.session);
    const m = await metrics(page);
    console.log("graph 1k warm reopen", JSON.stringify(m));
    expect(m.warm).toBe(true);
  });

  test("canvas2d fallback renders a non-blank frame", async ({ page }) => {
    await openGraph(page, 1000, "&canvas2d=1");
    const info = await page.evaluate(() => {
      const c = document.querySelector(
        '[data-testid="graph-stage"] canvas:not(.vd-graph__overlay)',
      ) as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 97) {
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return {
        colours: seen.size,
        backend: (window as unknown as W).__graph.session!.metrics.backend,
      };
    });
    expect(info.backend).toBe("canvas2d");
    expect(info.colours).toBeGreaterThan(5);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`screenshots ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openGraph(page, 1000, theme === "dark" ? "&theme=dark" : "");
      await page.screenshot({ path: `${SHOTS}/graph-${theme}.png` });
      const p = await busiestNode(page);
      await page.mouse.move(p.x - 30, p.y - 30);
      await page.mouse.move(p.x, p.y);
      await expect(page.getByTestId("graph-card")).toBeVisible();
      await page.waitForTimeout(250); // dim fade
      await page.screenshot({ path: `${SHOTS}/graph-${theme}-hover.png` });
      await page.mouse.move(5, 5);
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: "Local" }).click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `${SHOTS}/graph-${theme}-local-settings.png`,
      });
    });
  }

  test("canvas2d screenshot", async ({ page }) => {
    await openGraph(page, 1000, "&canvas2d=1&theme=dark");
    await page.screenshot({ path: `${SHOTS}/graph-dark-canvas2d.png` });
  });
});

test.describe("graph perf numbers (GRAPH_PERF=1)", () => {
  test.skip(process.env.GRAPH_PERF !== "1", "set GRAPH_PERF=1");
  for (const n of [5000, 10_000, 50_000]) {
    test(`open ${n}`, async ({ page }) => {
      test.setTimeout(180_000);
      await openGraph(page, n);
      console.log(`graph ${n} cold`, JSON.stringify(await metrics(page)));
      await page.waitForFunction(
        () => (window as unknown as W).__graph.saves > 0,
        undefined,
        {
          timeout: 10_000,
        },
      );
      await page.evaluate(() => (window as unknown as W).__graph.toggle());
      await page.evaluate(() => (window as unknown as W).__graph.toggle());
      await page.waitForFunction(
        () => (window as unknown as W).__graph.session,
      );
      console.log(`graph ${n} warm`, JSON.stringify(await metrics(page)));
    });
  }
});
