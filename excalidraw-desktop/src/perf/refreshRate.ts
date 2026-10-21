/**
 * Refresh-rate probe: how many frames per second the editor really shows
 * while zooming and panning, per paper pattern and drawing size.
 *
 * Each pass drives one kind of input at 120 events/s for a fixed time and
 * records every requestAnimationFrame callback, the static-canvas renders and
 * the input events that reached the page in between (see refreshRateStats).
 * Inputs:
 * - zoom.native / pan.native: trackpad pinch (NSEvent magnify) and two-finger
 *   scroll posted by the test build into the WKWebView, the same path a real
 *   trackpad takes (UI process, IPC, WebKit event dispatch, coalescing)
 * - zoom.gesture / zoom.wheel / pan.wheel: the same motions as synthetic DOM
 *   events (Safari gesture events, ctrl+wheel, plain wheel)
 * - zoom.native.out / pan.native.out: pinch out to ~0.3x and back (through
 *   the paper patterns' fade bands), and two-finger pan at 0.5x (dense paper)
 * - idle: no input; shows whether rAF itself runs at the display rate
 *
 * Per pass it also records the script time of each static render (render
 * start to the end of its task) and, in the packaged app, the CPU used by the
 * app, WebContent and GPU processes: high fps loss with little script time
 * points at painting/compositing in the GPU process.
 *
 * Environment-agnostic: native input and display facts come in through
 * `native` (null outside the packaged app).
 */
import { passStats } from "./refreshRateStats";

import type { FrameSample, PassStats } from "./refreshRateStats";

export type RefreshRateInput =
  | "idle"
  | "zoom.native"
  | "zoom.native.out"
  | "pan.native"
  | "pan.native.out"
  | "zoom.gesture"
  | "zoom.wheel"
  | "pan.wheel";

export type RefreshRateDrawing = {
  path: string;
  pattern: string;
  elements: number;
};

export type NativeInputArgs = {
  kind: "scroll" | "magnify";
  x: number;
  y: number;
  durationMs: number;
  hz: number;
  delta: number;
};

export type NativeProbe = {
  displayInfo: () => Promise<Record<string, unknown>>;
  input: (args: NativeInputArgs) => Promise<Record<string, unknown>>;
  /** Cumulative CPU seconds per process role (app, webContent, gpu). */
  processCpu?: () => Promise<Record<string, number>>;
  /** Fills the screen (the user's usual window size). */
  maximize?: () => Promise<unknown>;
};

export type RefreshRatePass = {
  drawing: string;
  pattern: string;
  elements: number;
  input: RefreshRateInput;
  stats: PassStats;
  /** no static render during an input pass: the input never reached the editor */
  noEffect?: boolean;
  native?: Record<string, unknown>;
  /** static canvas size in device px */
  canvas?: string;
  /** CPU % per process role during the pass (100 = one core) */
  cpuPct?: Record<string, number>;
  error?: string;
};

export type RefreshRateContext = {
  win: Window & typeof globalThis;
  root: HTMLElement;
  /** Opens a drawing and resolves once the editor is ready. */
  open: (path: string) => Promise<void>;
  native: NativeProbe | null;
  drawings: RefreshRateDrawing[];
  inputs: RefreshRateInput[];
  passMs?: number;
  /** events per second for every driver */
  inputHz?: number;
  log?: (message: string) => void;
};

export type RefreshRateResult = {
  displayHz: number;
  display: Record<string, unknown> | null;
  passes: RefreshRatePass[];
};

const DEFAULT_PASS_MS = 1200;
const DEFAULT_INPUT_HZ = 120;

export async function runRefreshRateProbe(
  ctx: RefreshRateContext,
): Promise<RefreshRateResult> {
  const { win, root } = ctx;
  const passMs = ctx.passMs ?? DEFAULT_PASS_MS;
  const inputHz = ctx.inputHz ?? DEFAULT_INPUT_HZ;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => win.setTimeout(resolve, ms));
  const frame = () =>
    new Promise<number>((resolve) => win.requestAnimationFrame(resolve));

  let display: Record<string, unknown> | null = null;
  if (ctx.native) {
    try {
      display = await ctx.native.displayInfo();
    } catch (error) {
      display = { error: String(error) };
    }
  }
  const screenMaxFps = Number(
    (display?.display as Record<string, unknown> | undefined)?.screenMaxFps,
  );
  const displayHz = screenMaxFps > 0 ? screenMaxFps : 60;
  if (ctx.native?.maximize) {
    try {
      const size = await ctx.native.maximize();
      display = { ...display, window: size };
      await sleep(600);
    } catch (error) {
      display = { ...display, maximizeError: String(error) };
    }
  }

  const staticCanvas = () =>
    root.querySelector<HTMLCanvasElement>(".vault-editor canvas.static");
  const interactiveCanvas = () =>
    root.querySelector<HTMLCanvasElement>(".vault-editor canvas.interactive");

  /** Counts static-scene renders: Excalidraw fetches the 2D context once per render. */
  const countRenders = (canvas: HTMLCanvasElement, onRender: () => void) => {
    const original = canvas.getContext;
    canvas.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement["getContext"]>
    ) {
      onRender();
      return original.apply(this, args);
    } as HTMLCanvasElement["getContext"];
    return () => {
      // Drop the instance override; the prototype method shows through again.
      delete (canvas as { getContext?: unknown }).getContext;
    };
  };

  /** Runs `drive` while recording frames; resolves with the per-frame samples. */
  const record = async (drive: () => Promise<unknown>) => {
    const canvas = staticCanvas();
    if (!canvas) {
      throw new Error("No static canvas");
    }
    let renders = 0;
    let inputs = 0;
    let scriptMs = 0;
    let renderStart: number | null = null;
    const onInput = () => {
      inputs++;
    };
    const restore = countRenders(canvas, () => {
      renders++;
      if (renderStart === null) {
        // The render runs synchronously; the microtask fires when its task ends.
        renderStart = win.performance.now();
        win.queueMicrotask(() => {
          scriptMs += win.performance.now() - (renderStart ?? 0);
          renderStart = null;
        });
      }
    });
    const opts = { capture: true, passive: true } as const;
    win.addEventListener("wheel", onInput, opts);
    win.document.addEventListener("gesturechange", onInput, opts);
    const samples: FrameSample[] = [];
    let running = true;
    const tick = (t: number) => {
      if (!running) {
        return;
      }
      samples.push({ t, renders, inputs, scriptMs });
      renders = 0;
      inputs = 0;
      scriptMs = 0;
      win.requestAnimationFrame(tick);
    };
    win.requestAnimationFrame(tick);
    await frame();
    let result: unknown;
    try {
      result = await drive();
    } finally {
      running = false;
      win.removeEventListener("wheel", onInput, opts);
      win.document.removeEventListener("gesturechange", onInput, opts);
      restore();
    }
    return { samples, result };
  };

  /** Calls `step(progress)` at `inputHz` for `passMs` (progress 0..1). */
  const timed = (step: (progress: number) => void) =>
    new Promise<void>((resolve) => {
      const start = win.performance.now();
      const id = win.setInterval(() => {
        const progress = (win.performance.now() - start) / passMs;
        if (progress >= 1) {
          win.clearInterval(id);
          resolve();
          return;
        }
        step(progress);
      }, 1000 / inputHz);
    });

  const drivers = (
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
  ): Record<RefreshRateInput, () => Promise<unknown>> => {
    const wheel = (init: WheelEventInit) =>
      canvas.dispatchEvent(
        new win.WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          ...init,
        }),
      );
    const gesture = (type: string, scale: number) => {
      const event = new win.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "scale", { value: scale });
      Object.defineProperty(event, "clientX", { value: x });
      Object.defineProperty(event, "clientY", { value: y });
      canvas.dispatchEvent(event);
    };
    const native = (kind: NativeInputArgs["kind"], delta: number) => () => {
      // a negative delta runs the first half in the other direction
      if (!ctx.native) {
        throw new Error("native input unavailable");
      }
      return ctx.native.input({
        kind,
        x,
        y,
        durationMs: passMs,
        hz: inputHz,
        delta,
      });
    };
    // In, then back out: the view ends near where it started.
    const there = (p: number) => (p < 0.5 ? 1 : -1);
    return {
      idle: () => sleep(passMs),
      "zoom.native": native("magnify", 0.008),
      "zoom.native.out": native("magnify", -0.01),
      "pan.native": native("scroll", 6),
      "pan.native.out": native("scroll", 6),
      "zoom.wheel": () =>
        timed((p) => wheel({ deltaY: -4 * there(p), ctrlKey: true })),
      "pan.wheel": () =>
        timed((p) => wheel({ deltaX: 6 * there(p), deltaY: 4 * there(p) })),
      "zoom.gesture": async () => {
        gesture("gesturestart", 1);
        // Scale 1 -> 1.8 -> 1, as a pinch out and back in.
        await timed((p) =>
          gesture("gesturechange", 1 + 0.8 * (1 - Math.abs(2 * p - 1))),
        );
        gesture("gestureend", 1);
      },
    };
  };

  /** Sets the zoom to `factor` x the current one with a one-step pinch, then lets the bitmap cache settle. */
  const zoomBy = async (canvas: HTMLCanvasElement, factor: number) => {
    for (const [type, scale] of [
      ["gesturestart", 1],
      ["gesturechange", factor],
      ["gestureend", factor],
    ] as const) {
      const event = new win.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "scale", { value: scale });
      canvas.dispatchEvent(event);
    }
    await sleep(450);
  };

  const cpuSnapshot = async () => {
    try {
      return (await ctx.native?.processCpu?.()) ?? null;
    } catch {
      return null;
    }
  };

  const passes: RefreshRatePass[] = [];
  for (const drawing of ctx.drawings) {
    try {
      await ctx.open(drawing.path);
    } catch (error) {
      for (const input of ctx.inputs) {
        passes.push({
          drawing: drawing.path,
          pattern: drawing.pattern,
          elements: drawing.elements,
          input,
          stats: passStats([], displayHz),
          error: `open failed: ${String(error)}`,
        });
      }
      continue;
    }
    await sleep(300);
    for (const input of ctx.inputs) {
      const pass: RefreshRatePass = {
        drawing: drawing.path,
        pattern: drawing.pattern,
        elements: drawing.elements,
        input,
        stats: passStats([], displayHz),
      };
      try {
        const canvas = interactiveCanvas();
        if (!canvas) {
          throw new Error("No interactive canvas");
        }
        const bounds = canvas.getBoundingClientRect();
        // Right of centre: clear of the left-hand islands, still over the canvas.
        const x = Math.round(bounds.left + bounds.width * 0.6);
        const y = Math.round(bounds.top + bounds.height * 0.5);
        // Excalidraw zooms around the last known pointer position.
        canvas.dispatchEvent(
          new win.PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            clientX: x,
            clientY: y,
          }),
        );
        await frame();
        await frame();
        const zoomedOut = input === "pan.native.out";
        if (zoomedOut) {
          await zoomBy(canvas, 0.5);
        }
        const cpuBefore = await cpuSnapshot();
        const started = win.performance.now();
        const { samples, result } = await record(drivers(canvas, x, y)[input]);
        const seconds = (win.performance.now() - started) / 1000;
        const cpuAfter = await cpuSnapshot();
        if (cpuBefore && cpuAfter && seconds > 0) {
          pass.cpuPct = Object.fromEntries(
            Object.keys(cpuAfter)
              .filter((role) => role in cpuBefore)
              .map((role) => [
                role,
                Math.round(
                  ((cpuAfter[role] - cpuBefore[role]) / seconds) * 1000,
                ) / 10,
              ]),
          );
        }
        const surface = staticCanvas();
        pass.canvas = surface ? `${surface.width}x${surface.height}` : "";
        if (zoomedOut) {
          await zoomBy(canvas, 2);
        }
        pass.stats = passStats(samples, displayHz);
        if (input !== "idle" && pass.stats.rendersPerSec === 0) {
          pass.noEffect = true;
        }
        if (result && typeof result === "object") {
          pass.native = result as Record<string, unknown>;
        }
      } catch (error) {
        pass.error = String(error);
      }
      ctx.log?.(
        `${drawing.path} ${input}: ${pass.stats.fps} fps, ${
          pass.stats.renderHz
        } Hz rendered${pass.error ? ` (${pass.error})` : ""}`,
      );
      passes.push(pass);
      // Let the zoom-cache reset debounce and any trailing work settle between passes.
      await sleep(450);
    }
  }
  return { displayHz, display, passes };
}

/** Harness metrics from the passes: zoom/pan fps, rendered Hz, <= 9 ms share (one sample per drawing). */
export function refreshRateSamples(
  result: RefreshRateResult,
): Record<string, number[]> {
  const samples: Record<string, number[]> = {};
  const push = (id: string, value: number) => {
    (samples[id] ??= []).push(value);
  };
  const usable = (p: RefreshRatePass) => !p.error && !p.noEffect;
  const pick = (preferred: RefreshRateInput, fallback: RefreshRateInput) =>
    result.passes.some((p) => p.input === preferred && usable(p))
      ? preferred
      : fallback;
  const zoomInput = pick("zoom.native", "zoom.gesture");
  const panInput = pick("pan.native", "pan.wheel");
  for (const pass of result.passes) {
    const motion =
      pass.input === zoomInput
        ? "zoom"
        : pass.input === panInput
        ? "pan"
        : null;
    if (!motion || !usable(pass)) {
      continue;
    }
    push(`${motion}.fps`, pass.stats.fps);
    push(`${motion}.renderHz`, pass.stats.renderHz);
    // Frames that received input but showed no new render, per second: drawn
    // Hz below inputFrameHz is ours; drawn Hz at inputFrameHz but below the
    // display rate is the injected input's timing (not vsync-locked).
    push(
      `${motion}.missedInputHz`,
      Math.max(
        0,
        Math.round((pass.stats.inputFrameHz - pass.stats.renderHz) * 10) / 10,
      ),
    );
    push(`${motion}.framesLe9msPct`, pass.stats.framesLe9msPct);
  }
  return samples;
}
