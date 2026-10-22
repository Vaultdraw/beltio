import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

import { openDrawing, openVault } from "./helpers";

// What runs after a ctrl+wheel zoom ends on the image-heavy perf drawing
// (perf-large): static renders and long tasks after the last wheel tick,
// at RATE x CPU throttle (default 4). Chromium only (CDP throttle), opt-in
// with E2E_PERF=1 E2E_FULL=1. The crisp re-render 300 ms after the gesture
// used to re-rasterise every visible bitmap in one task (max 541-557 ms at
// 4x); it now does a few per render and the rest in idle slices.
test.skip(
  process.env.E2E_PERF !== "1",
  "set E2E_PERF=1 E2E_FULL=1 to run the post-zoom long task measurement",
);
test.describe.configure({ timeout: 300_000 });

const largeScene = async () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const f = await import(
    pathToFileURL(path.join(here, "..", "perf", "lib", "fixtures.mjs")).href
  );
  const config = (
    await import(
      pathToFileURL(path.join(here, "..", "perf", "fixtures.config.json")).href,
      { with: { type: "json" } }
    )
  ).default;
  const r = f.mulberry32(f.hashSeed(config.seed, "open", "large"));
  const spec = config.openTargetSpecs.large;
  return f.openTargetScene(
    r,
    "large",
    spec,
    config.typingTarget,
    spec.images,
    spec.imageTotalMB,
  ) as string;
};

test("what runs after a zoom ends", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP CPU throttle");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: Number(process.env.RATE ?? 4),
  });
  await openVault(page);
  const json = await largeScene();
  await page.evaluate((json) => {
    const repo = (window as any).__vaultRepo;
    repo.seedDrawing("perf-large.excalidraw", json);
    repo.emit({ handle: repo.handle, paths: [], rescan: true });
  }, json);
  await expect(
    page.locator(".vault-tree-item__name", { hasText: "perf-large" }),
  ).toBeVisible();
  await openDrawing(page, "perf-large");
  await page.waitForTimeout(2000);
  const rounds: { long: { at: number; dur: number }[] }[] = [];
  for (let round = 0; round < 8; round++) {
    const out = await page.evaluate(async () => {
      const tasks: { start: number; dur: number }[] = [];
      const obs = new PerformanceObserver((l) =>
        l
          .getEntries()
          .forEach((e) => tasks.push({ start: e.startTime, dur: e.duration })),
      );
      obs.observe({ type: "longtask", buffered: false });
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.interactive",
      )!;
      const r = canvas.getBoundingClientRect();
      const raf = () => new Promise((res) => requestAnimationFrame(res));
      let renders = 0;
      const renderAt: number[] = [];
      const st = document.querySelector<HTMLCanvasElement>(
        ".vault-editor canvas.static",
      )!;
      const orig = HTMLCanvasElement.prototype.getContext;
      st.getContext = function (this: any, ...a: any) {
        renders++;
        renderAt.push(performance.now());
        return (orig as any).apply(this, a);
      } as any;
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            deltaY: i < 30 ? -10 : 10,
            ctrlKey: true,
          }),
        );
        await raf();
      }
      const zoomEnd = performance.now();
      await new Promise((res) => setTimeout(res, 1500));
      obs.disconnect();
      delete (st as any).getContext;
      return {
        zoomMs: Math.round(zoomEnd - t0),
        renders,
        after: renderAt
          .filter((t) => t > zoomEnd)
          .map((t) => Math.round(t - zoomEnd)),
        long: tasks.map((t) => ({
          at: Math.round(t.start - zoomEnd),
          dur: Math.round(t.dur),
        })),
      };
    });
    // eslint-disable-next-line no-console
    console.log(
      `PERF ${JSON.stringify({ test: "zoom-settle", round, ...out })}`,
    );
    rounds.push(out);
  }
  const post = rounds.flatMap((r) => r.long.filter((t) => t.at > 0));
  // eslint-disable-next-line no-console
  console.log(
    `PERF ${JSON.stringify({
      test: "zoom-settle-summary",
      rate: Number(process.env.RATE ?? 4),
      postZoomLongTasks: post.length,
      postZoomMaxMs: Math.max(0, ...post.map((t) => t.dur)),
      postZoomTotalMs: post.reduce((sum, t) => sum + t.dur, 0),
    })}`,
  );
});
