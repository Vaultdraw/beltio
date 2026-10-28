import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// Per-step cost of pinch zoom, wheel zoom and pan on real drawings (the
// refresh-rate probe's 200 and 2,000-element scenes, plain and dots paper).
// Skipped unless E2E_PERF=1. Headless twin of perf/refresh-rate.mjs (which
// measures real fps in the packaged app): each input step is committed with
// flushSync (React update + static canvas render) and the static canvas is
// read back so rasterisation is included. A 120 Hz frame is 8.3 ms.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-refresh-rate.jsonl";
const STEPS = 30;
const MODES = ["pinch", "wheel-zoom", "pan"] as const;
type Mode = typeof MODES[number];

test.skip(!PERF, "set E2E_PERF=1 to run the refresh-rate step measurements");
test.describe.configure({ timeout: 300_000 });
test.use({ deviceScaleFactor: 2 });

const record = (row: Record<string, unknown>) => {
  const line = JSON.stringify(row);
  appendFileSync(OUT, `${line}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${line}`);
};

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) =>
    +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2);
  return { p50: at(50), p95: at(95), max: at(100) };
};

type Scene = { rel: string; json: string; pattern: string; elements: number };

const loadScenes = async (): Promise<Scene[]> => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const fixtures = await import(
    pathToFileURL(path.join(here, "..", "perf", "lib", "fixtures.mjs")).href
  );
  const config = (
    await import(
      pathToFileURL(path.join(here, "..", "perf", "fixtures.config.json")).href,
      { with: { type: "json" } }
    )
  ).default;
  return (fixtures.refreshRateScenes(config) as Scene[]).filter(
    (s) => s.elements > 0 && (s.pattern === "plain" || s.pattern === "dots"),
  );
};

const openScene = async (page: Page, scene: Scene) => {
  const name = scene.rel.replace(/\.excalidraw$/, "");
  await page.evaluate(
    ({ rel, json }) => {
      const repo = (window as any).__vaultRepo;
      repo.seedDrawing(rel, json);
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    { rel: scene.rel, json: scene.json },
  );
  await expect(
    page.locator(".vault-tree-item__name", { hasText: name }),
  ).toBeVisible();
  await openDrawing(page, name);
  const box = (await page
    .locator(".vault-editor canvas.static")
    .boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.waitForTimeout(300);
};

/**
 * One input step per animation frame, each committed and read back; per-step
 * ms, plus canvases created per step (element bitmaps re-rasterised).
 */
const sweep = (page: Page, mode: Mode) =>
  page.evaluate(
    ({ steps, mode }) =>
      new Promise<{ times: number[]; canvases: number[] }>((resolve) => {
        const w = window as any;
        let created = 0;
        const createElement = document.createElement;
        document.createElement = function (
          this: Document,
          tag: string,
          options?: ElementCreationOptions,
        ) {
          if (String(tag).toLowerCase() === "canvas") {
            created++;
          }
          return createElement.call(this, tag, options);
        } as typeof document.createElement;
        const canvases: number[] = [];
        const target = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const ctx = document
          .querySelector<HTMLCanvasElement>(".vault-editor canvas.static")!
          .getContext("2d")!;
        const r = target.getBoundingClientRect();
        const x = r.left + r.width * 0.6;
        const y = r.top + r.height / 2;
        const gesture = (type: string, scale: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "scale", { value: scale });
          return event;
        };
        const wheel = (init: WheelEventInit) =>
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            ...init,
          });
        if (mode === "pinch") {
          w.__flushSync(() => target.dispatchEvent(gesture("gesturestart", 1)));
        }
        const times: number[] = [];
        let i = 0;
        const frame = () => {
          if (i >= steps * 2) {
            if (mode === "pinch") {
              target.dispatchEvent(gesture("gestureend", 1));
            }
            document.createElement = createElement;
            resolve({ times, canvases });
            return;
          }
          const out = i < steps;
          const k = out ? i + 1 : steps * 2 - i - 1;
          const event =
            mode === "pinch"
              ? gesture("gesturechange", 1 - 0.015 * k)
              : mode === "wheel-zoom"
              ? wheel({ deltaY: out ? 2 : -2, ctrlKey: true })
              : wheel({ deltaX: out ? 6 : -6, deltaY: out ? 4 : -4 });
          const t = performance.now();
          created = 0;
          w.__flushSync(() => target.dispatchEvent(event));
          ctx.getImageData(0, 0, 1, 1);
          times.push(performance.now() - t);
          canvases.push(created);
          i++;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { steps: STEPS, mode },
  );

test("pinch, wheel zoom and pan: per-step editor cost on real drawings", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, any>[] = [];
  for (const scene of await loadScenes()) {
    await openScene(page, scene);
    for (const mode of MODES) {
      await sweep(page, mode); // warm-up
      await page.waitForTimeout(400); // zoom-cache reset debounce
      const { times, canvases } = await sweep(page, mode);
      await page.waitForTimeout(400);
      const row = {
        test: "refresh-rate-step",
        browser: browserName,
        drawing: scene.rel,
        mode,
        steps: times.length,
        ...stats(times),
        canvasesPerStep: stats(canvases),
      };
      record(row);
      rows.push(row);
    }
  }
  // Budget (WebKit, the app's engine): on a typical drawing every navigation
  // step fits a 120 Hz frame. Chromium is report-only: its GPU-canvas
  // readback alone costs several ms per step.
  if (browserName !== "webkit") {
    return;
  }
  for (const row of rows.filter((r) => r.drawing.includes("-200."))) {
    expect(row.p95, `${row.drawing} ${row.mode} p95`).toBeLessThan(8.3);
  }
});
