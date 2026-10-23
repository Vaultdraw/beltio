import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useServiceStart } from "./useServiceStart";

import type { StartMode } from "./servicesSettings";

// jsdom has requestAnimationFrame via timers (pretendToBeVisual) or not; the
// stub below makes it deterministic: frames run on a 16 ms timer.
const win = {
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (cb: () => void) =>
    setTimeout(cb, 16) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
} as unknown as Window;

// whenIdle: 2 frames (32 ms) + 1000 ms quiet window.
const IDLE_MS = 1100;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Props = { handle: string | null; mode: StartMode };
const setup = (
  initial: Props,
  start: (h: string) => Promise<void> | void = vi.fn(),
) => {
  const hook = renderHook(
    ({ handle, mode }: Props) => useServiceStart(win, handle, mode, start),
    { initialProps: initial },
  );
  return { start, hook };
};

describe("useServiceStart", () => {
  it("open: starts at once and is started on the first render", () => {
    const seen: boolean[] = [];
    const start = vi.fn();
    renderHook(() => {
      const s = useServiceStart(win, "h1", "open", start);
      seen.push(s.started);
      return s;
    });
    expect(seen[0]).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("h1");
  });

  it("idle: starts only after the idle window", () => {
    const { start, hook } = setup({ handle: "h1", mode: "idle" });
    expect(hook.result.current.started).toBe(false);
    act(() => void vi.advanceTimersByTime(500));
    expect(start).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(IDLE_MS));
    expect(start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.started).toBe(true);
  });

  it("use: never starts by itself; activate() starts it once", () => {
    const { start, hook } = setup({ handle: "h1", mode: "use" });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(start).not.toHaveBeenCalled();
    expect(hook.result.current.started).toBe(false);
    act(() => hook.result.current.activate());
    act(() => hook.result.current.activate());
    expect(start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.started).toBe(true);
  });

  it("use before idle fired: activate() starts once and the idle timer does not start again", () => {
    const { start, hook } = setup({ handle: "h1", mode: "idle" });
    act(() => void vi.advanceTimersByTime(200));
    act(() => hook.result.current.activate());
    expect(start).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("live change use -> open starts it; open -> use keeps it started", () => {
    const { start, hook } = setup({ handle: "h1", mode: "use" });
    expect(start).not.toHaveBeenCalled();
    hook.rerender({ handle: "h1", mode: "open" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.started).toBe(true);
    hook.rerender({ handle: "h1", mode: "use" });
    expect(hook.result.current.started).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("live change use -> idle starts after the idle window", () => {
    const { start, hook } = setup({ handle: "h1", mode: "use" });
    hook.rerender({ handle: "h1", mode: "idle" });
    expect(start).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(IDLE_MS));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a new vault handle resets and applies the mode again", () => {
    const { start, hook } = setup({ handle: "h1", mode: "use" });
    act(() => hook.result.current.activate());
    expect(start).toHaveBeenCalledWith("h1");
    hook.rerender({ handle: "h2", mode: "use" });
    expect(hook.result.current.started).toBe(false);
    hook.rerender({ handle: "h2", mode: "open" });
    expect(start).toHaveBeenLastCalledWith("h2");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("no handle: nothing starts and activate is a no-op", () => {
    const { start, hook } = setup({ handle: null, mode: "open" });
    act(() => hook.result.current.activate());
    expect(start).not.toHaveBeenCalled();
    expect(hook.result.current.started).toBe(false);
  });

  it("a rejecting or throwing start does not throw", async () => {
    const rejecting = setup(
      { handle: "h1", mode: "open" },
      vi.fn(() => Promise.reject(new Error("boom"))),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(rejecting.hook.result.current.started).toBe(true);

    const throwing = setup(
      { handle: "h1", mode: "open" },
      vi.fn(() => {
        throw new Error("sync boom");
      }),
    );
    expect(throwing.hook.result.current.started).toBe(true);
  });

  it("works without a start callback", () => {
    const hook = renderHook(() => useServiceStart(win, "h1", "open"));
    expect(hook.result.current.started).toBe(true);
  });
});
