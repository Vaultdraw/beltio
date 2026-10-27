import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScrollSettle, SETTLE_MS } from "../src/scrollSettle";

describe("createScrollSettle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays calm for slow scrolling", () => {
    const changes: boolean[] = [];
    const s = createScrollSettle((f) => changes.push(f));
    for (let i = 0; i < 20; i++) {
      s.note(i * 5, 600, i * 16); // ~300 px/s, half a viewport per second
    }
    expect(changes).toEqual([]);
  });

  it("goes fast on a jump and settles after the idle delay", () => {
    const changes: boolean[] = [];
    const s = createScrollSettle((f) => changes.push(f));
    s.note(0, 600, 0);
    expect(s.note(1200, 600, 16)).toBe(true);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(changes).toEqual([true]);
    s.note(2400, 600, 100); // still flying: the timer restarts
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  it("dispose cancels the pending settle", () => {
    const changes: boolean[] = [];
    const s = createScrollSettle((f) => changes.push(f));
    s.note(0, 600, 0);
    s.note(1200, 600, 16);
    s.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
  });
});
