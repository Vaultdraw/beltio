import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whenIdle } from "./whenIdle";

type Stub = Window & {
  fire: (type: string) => void;
  frames: Array<() => void>;
  runFrames: () => void;
  idle?: Array<{ cb: () => void; opts?: { timeout: number } }>;
};

const makeWindow = (withIdle: boolean): Stub => {
  const listeners = new Map<string, Set<() => void>>();
  const win: any = {
    frames: [] as Array<() => void>,
    addEventListener: (t: string, l: () => void) => {
      if (!listeners.has(t)) {
        listeners.set(t, new Set());
      }
      listeners.get(t)!.add(l);
    },
    removeEventListener: (t: string, l: () => void) => {
      listeners.get(t)?.delete(l);
    },
    requestAnimationFrame: (cb: () => void) => {
      win.frames.push(cb);
      return win.frames.length;
    },
    cancelAnimationFrame: vi.fn(),
    fire: (t: string) => listeners.get(t)?.forEach((l) => l()),
    runFrames: () => {
      const f = win.frames.splice(0);
      f.forEach((cb: () => void) => cb());
    },
  };
  if (withIdle) {
    win.idle = [];
    win.requestIdleCallback = (cb: () => void, opts?: { timeout: number }) => {
      win.idle.push({ cb, opts });
      return win.idle.length;
    };
    win.cancelIdleCallback = vi.fn();
  }
  return win;
};

/** Both animation frames, i.e. "first paint done". */
const paint = (win: Stub) => {
  win.runFrames();
  win.runFrames();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("waits for paint and a quiet window, then runs once", () => {
    const win = makeWindow(false);
    const run = vi.fn();
    whenIdle(win, run, { quietMs: 100, deadlineMs: 5000 });
    vi.advanceTimersByTime(5000 - 1);
    expect(run).not.toHaveBeenCalled(); // frames never ran: not painted
    paint(win);
    expect(run).not.toHaveBeenCalled(); // quiet window counts from paint
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("input during the window postpones it", () => {
    const win = makeWindow(false);
    const run = vi.fn();
    whenIdle(win, run, { quietMs: 100, deadlineMs: 5000 });
    paint(win);
    vi.advanceTimersByTime(80);
    win.fire("keydown");
    vi.advanceTimersByTime(80);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fires at the deadline even with continuous input", () => {
    const win = makeWindow(false);
    const run = vi.fn();
    whenIdle(win, run, { quietMs: 100, deadlineMs: 1000 });
    paint(win);
    for (let t = 0; t < 900; t += 50) {
      win.fire("pointerdown");
      vi.advanceTimersByTime(50);
    }
    expect(run).not.toHaveBeenCalled();
    win.fire("wheel");
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses requestIdleCallback when present, with the remaining time as timeout", () => {
    const win = makeWindow(true);
    const run = vi.fn();
    whenIdle(win, run, { quietMs: 100, deadlineMs: 5000 });
    paint(win);
    vi.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
    expect(win.idle).toHaveLength(1);
    expect(win.idle![0].opts!.timeout).toBeGreaterThan(0);
    expect(win.idle![0].opts!.timeout).toBeLessThanOrEqual(5000);
    win.idle![0].cb();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancel before paint, during the window and during the idle callback prevents firing", () => {
    const early = makeWindow(false);
    const r1 = vi.fn();
    whenIdle(early, r1, { quietMs: 100 })();
    paint(early);
    vi.advanceTimersByTime(10_000);
    expect(r1).not.toHaveBeenCalled();

    const mid = makeWindow(false);
    const r2 = vi.fn();
    const cancelMid = whenIdle(mid, r2, { quietMs: 100 });
    paint(mid);
    cancelMid();
    vi.advanceTimersByTime(10_000);
    expect(r2).not.toHaveBeenCalled();

    const idle = makeWindow(true);
    const r3 = vi.fn();
    const cancelIdle = whenIdle(idle, r3, { quietMs: 100 });
    paint(idle);
    vi.advanceTimersByTime(100);
    cancelIdle();
    expect((idle as any).cancelIdleCallback).toHaveBeenCalled();
    idle.idle![0].cb(); // a late callback is ignored
    expect(r3).not.toHaveBeenCalled();
  });

  it("stops listening to input after it ran", () => {
    const win = makeWindow(false);
    const spy = vi.spyOn(win, "removeEventListener");
    whenIdle(win, () => {}, { quietMs: 10 });
    paint(win);
    vi.advanceTimersByTime(10);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
