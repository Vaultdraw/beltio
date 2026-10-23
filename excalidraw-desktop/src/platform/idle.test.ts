import { describe, expect, it, vi } from "vitest";

import { scheduleIdle } from "./idle";

describe("scheduleIdle", () => {
  it("uses requestIdleCallback with the timeout and cancels it", () => {
    const ric = vi.fn(() => 7);
    const cic = vi.fn();
    const host = {
      requestIdleCallback: ric,
      cancelIdleCallback: cic,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    } as never;
    const cancel = scheduleIdle(host, () => {}, { timeout: 1500 });
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 1500 });
    cancel();
    expect(cic).toHaveBeenCalledWith(7);
  });

  it("passes no options when there is no timeout", () => {
    const ric = vi.fn(() => 1);
    scheduleIdle({ requestIdleCallback: ric } as never, () => {});
    expect(ric).toHaveBeenCalledWith(expect.any(Function), undefined);
  });

  it("falls back to setTimeout with the given delay and cancels it", () => {
    const st = vi.fn(() => 9);
    const ct = vi.fn();
    const run = vi.fn();
    const cancel = scheduleIdle(
      { setTimeout: st, clearTimeout: ct } as never,
      run,
      { fallbackMs: 400 },
    );
    expect(st).toHaveBeenCalledWith(run, 400);
    cancel();
    expect(ct).toHaveBeenCalledWith(9);
  });

  it("defaults the fallback to 50 ms", () => {
    const st = vi.fn(() => 1);
    scheduleIdle({ setTimeout: st, clearTimeout: vi.fn() } as never, () => {});
    expect(st).toHaveBeenCalledWith(expect.any(Function), 50);
  });
});
