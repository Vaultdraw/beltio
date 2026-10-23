import { describe, expect, it, vi } from "vitest";

import { createBusyCounter } from "./busyCounter";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("createBusyCounter", () => {
  it("stays busy until the last overlapping call ends", async () => {
    const setBusy = vi.fn();
    const busy = createBusyCounter(setBusy);
    const a = deferred();
    const b = deferred();
    const first = busy(() => a.promise);
    const second = busy(() => b.promise);
    expect(setBusy.mock.calls).toEqual([[true]]);
    a.resolve();
    await first;
    expect(setBusy.mock.calls).toEqual([[true]]);
    b.resolve();
    await second;
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("clears after a failure and returns results", async () => {
    const setBusy = vi.fn();
    const busy = createBusyCounter(setBusy);
    await expect(busy(() => Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
    expect(setBusy).toHaveBeenLastCalledWith(false);
    await expect(busy(async () => 7)).resolves.toBe(7);
    expect(setBusy.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
