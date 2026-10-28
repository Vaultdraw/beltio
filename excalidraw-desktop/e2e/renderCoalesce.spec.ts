import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault } from "./helpers";

// E2E_PERF=1 adds the 2,000-element drawing.
const PERF = process.env.E2E_PERF === "1";

// Static renders per displayed frame while zooming and panning. Input arrives
// at 120 events/s from timer tasks (like a trackpad: not aligned to vsync);
// every animation frame records how many static-canvas renders happened since
// the previous one. Two or more = the scene was drawn twice for one frame
// (wasted work: only the last one is ever shown). Counts, not timings, so it
// holds under load. Rows go to the log (PERF ...) for the record.
test.describe.configure({ timeout: 120_000 });

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
    (s) =>
      s.pattern === "plain" &&
      (s.elements === 200 || (PERF && s.elements >= 200)),
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

const MODES = ["zoom.wheel", "pan.wheel", "zoom.gesture"] as const;

const pass = (page: Page, mode: typeof MODES[number]) =>
  page.evaluate(
    ({ mode }) =>
      new Promise<{
        frames: number;
        renders: number;
        framesWithRender: number;
        multi: number;
        inputs: number;
      }>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.static",
        )!;
        const target = document.querySelector<HTMLCanvasElement>(
          ".vault-editor canvas.interactive",
        )!;
        const r = target.getBoundingClientRect();
        const x = r.left + r.width * 0.6;
        const y = r.top + r.height / 2;
        let renders = 0;
        const original = canvas.getContext;
        canvas.getContext = function (this: HTMLCanvasElement, ...args: any) {
          renders++;
          return (original as any).apply(this, args);
        } as any;
        const perFrame: number[] = [];
        let running = true;
        const tick = () => {
          if (!running) {
            return;
          }
          perFrame.push(renders);
          renders = 0;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const gesture = (type: string, scale: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "scale", { value: scale });
          Object.defineProperty(event, "clientX", { value: x });
          Object.defineProperty(event, "clientY", { value: y });
          target.dispatchEvent(event);
        };
        const wheel = (init: WheelEventInit) =>
          target.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              ...init,
            }),
          );
        const PASS_MS = 1200;
        let inputs = 0;
        if (mode === "zoom.gesture") {
          gesture("gesturestart", 1);
        }
        const start = performance.now();
        const id = setInterval(() => {
          const p = (performance.now() - start) / PASS_MS;
          if (p >= 1) {
            clearInterval(id);
            if (mode === "zoom.gesture") {
              gesture("gestureend", 1);
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                running = false;
                delete (canvas as any).getContext;
                const counted = perFrame.slice(1);
                resolve({
                  frames: counted.length,
                  renders: counted.reduce((a, b) => a + b, 0),
                  framesWithRender: counted.filter((n) => n > 0).length,
                  multi: counted.filter((n) => n > 1).length,
                  inputs,
                });
              }),
            );
            return;
          }
          const there = p < 0.5 ? 1 : -1;
          inputs++;
          if (mode === "zoom.wheel") {
            wheel({ deltaY: -4 * there, ctrlKey: true });
          } else if (mode === "pan.wheel") {
            wheel({ deltaX: 6 * there, deltaY: 4 * there });
          } else {
            gesture("gesturechange", 1 + 0.8 * (1 - Math.abs(2 * p - 1)));
          }
        }, 1000 / 120);
      }),
    { mode },
  );

test("zoom and pan draw the static scene at most once per frame", async ({
  page,
  browserName,
}) => {
  await openVault(page);
  const rows: Record<string, unknown>[] = [];
  for (const scene of await loadScenes()) {
    await openScene(page, scene);
    for (const mode of MODES) {
      await pass(page, mode); // warm-up
      await page.waitForTimeout(400);
      const result = await pass(page, mode);
      await page.waitForTimeout(400);
      const row = { browser: browserName, drawing: scene.rel, mode, ...result };
      // eslint-disable-next-line no-console
      console.log(`PERF ${JSON.stringify(row)}`);
      rows.push(row);
    }
  }
  for (const row of rows) {
    expect(row.multi, `${row.drawing} ${row.mode} multi-draw frames`).toBe(0);
  }
});
