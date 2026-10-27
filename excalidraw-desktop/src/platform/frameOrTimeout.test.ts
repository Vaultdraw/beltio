import { describe, expect, it, vi } from "vitest";

import { frameOrTimeout } from "./frameOrTimeout";

const fakeWin = () => {
  let frame: (() => void) | null = null;
  let timer: (() => void) | null = null;
  const win = {
    requestAnimationFrame: (f: () => void) => void (frame = f),
    setTimeout: (f: () => void) => {
      timer = f;
      return 1;
    },
    clearTimeout: () => void (timer = null),
  } as unknown as Window;
  return { win, frame: () => frame?.(), timer: () => timer?.() };
};

describe("frameOrTimeout", () => {
  it("runs on the frame, once", () => {
    const { win, frame, timer } = fakeWin();
    const run = vi.fn();
    frameOrTimeout(win, run);
    frame();
    timer();
    frame();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs on the timeout when no frame ever comes (hidden window)", () => {
    const { win, timer, frame } = fakeWin();
    const run = vi.fn();
    frameOrTimeout(win, run);
    expect(run).not.toHaveBeenCalled();
    timer();
    frame();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
