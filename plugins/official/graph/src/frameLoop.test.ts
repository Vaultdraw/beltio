import { describe, expect, it, vi } from "vitest";

import { FrameLoop } from "./frameLoop";

function fakeRaf() {
  const q: Array<(t: number) => void> = [];
  return {
    raf: (cb: (t: number) => void) => q.push(cb),
    caf: vi.fn(),
    flush(t = 16) {
      const cbs = q.splice(0);
      cbs.forEach((cb) => cb(t));
    },
    get pending() {
      return q.length;
    },
  };
}

describe("FrameLoop", () => {
  it("runs nothing until invalidated and coalesces invalidations", () => {
    const f = fakeRaf();
    const render = vi.fn();
    const loop = new FrameLoop(render, f);
    expect(f.pending).toBe(0);
    loop.invalidate();
    loop.invalidate();
    loop.invalidate();
    expect(f.pending).toBe(1);
    f.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(loop.stats).toEqual({ frames: 1, invalidations: 3 });
    expect(f.pending).toBe(0); // idle: no more rAF
    f.flush();
    expect(loop.stats.frames).toBe(1);
  });

  it("keeps going only while render returns true", () => {
    const f = fakeRaf();
    let left = 3;
    const loop = new FrameLoop(() => --left > 0, f);
    loop.invalidate();
    for (let i = 0; i < 10; i++) {
      f.flush();
    }
    expect(loop.stats.frames).toBe(3);
    expect(f.pending).toBe(0);
  });

  it("invalidate during render schedules exactly one more frame", () => {
    const f = fakeRaf();
    let calls = 0;
    const loop: FrameLoop = new FrameLoop(() => {
      if (calls++ === 0) {
        loop.invalidate();
      }
    }, f);
    loop.invalidate();
    f.flush();
    expect(f.pending).toBe(1);
    f.flush();
    expect(loop.stats.frames).toBe(2);
  });

  it("dispose cancels the pending frame", () => {
    const f = fakeRaf();
    const loop = new FrameLoop(() => {}, f);
    loop.invalidate();
    loop.dispose();
    expect(f.caf).toHaveBeenCalledTimes(1);
    f.flush();
    expect(loop.stats.frames).toBe(0);
    loop.invalidate();
    expect(f.pending).toBe(0);
  });
});
