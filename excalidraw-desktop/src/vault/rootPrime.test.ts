import { afterEach, describe, expect, it, vi } from "vitest";

import { settleWithin, startRootPrime, takeRootPrime } from "./rootPrime";

import type { RootPrime } from "./rootPrime";
import type { VaultEntry } from "./types";

const entry: VaultEntry = {
  path: "a.excalidraw",
  name: "a.excalidraw",
  kind: "drawing",
  modifiedAt: 1,
  size: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("rootPrime", () => {
  it("lists the root of the given vault once", async () => {
    const listDirectory = vi.fn(async () => [entry]);
    const prime = startRootPrime({ listDirectory }, "h1", 3);
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledWith("h1", "");
    expect(prime).toMatchObject({ handle: "h1", gen: 3, applied: false });
    await expect(prime.items).resolves.toEqual([entry]);
  });

  it("a failed listing is not an unhandled rejection and settles to null", async () => {
    const prime = startRootPrime(
      { listDirectory: () => Promise.reject(new Error("gone")) },
      "h1",
      0,
    );
    await expect(settleWithin(prime.items, 50)).resolves.toBeNull();
    await expect(prime.items).rejects.toThrow("gone");
  });

  it("settleWithin gives the value in time and null after the wait", async () => {
    vi.useFakeTimers();
    await expect(settleWithin(Promise.resolve(5), 10)).resolves.toBe(5);
    const slow = settleWithin(new Promise<number>(() => {}), 10);
    vi.advanceTimersByTime(10);
    await expect(slow).resolves.toBeNull();
  });

  it("takeRootPrime returns the matching prime once and drops a stale one", () => {
    const prime: RootPrime = {
      handle: "h1",
      gen: 2,
      items: Promise.resolve([]),
      applied: true,
    };
    const ref = { current: prime as RootPrime | null };
    expect(takeRootPrime(ref, "h1", 2)).toBe(prime);
    expect(takeRootPrime(ref, "h1", 2)).toBeNull();
    ref.current = prime;
    expect(takeRootPrime(ref, "h2", 2)).toBeNull();
    expect(ref.current).toBeNull();
    ref.current = prime;
    expect(takeRootPrime(ref, "h1", 3)).toBeNull();
  });
});
