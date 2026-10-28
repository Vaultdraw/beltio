import { describe, expect, it, vi } from "vitest";

import {
  ACTION_MS,
  ERROR_MS,
  INFO_MS,
  MAX_VISIBLE,
  dismissToast,
  emptyQueue,
  expireToasts,
  holdToast,
  nextExpiry,
  pushToast,
  releaseToast,
} from "./queue";
import { createToastStore } from "./toastStore";

describe("toast queue", () => {
  it("adds toasts in order with growing ids and kind-based lifetimes", () => {
    let q = pushToast(emptyQueue(), { message: "a" }, 1000);
    q = pushToast(q, { message: "b", kind: "error" }, 1000);
    q = pushToast(
      q,
      { message: "c", action: { label: "Undo", run() {} } },
      1000,
    );
    expect(q.toasts.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(q.toasts.map((t) => t.expiresAt - 1000)).toEqual([
      INFO_MS,
      ERROR_MS,
      ACTION_MS,
    ]);
  });

  it("honours an explicit duration", () => {
    const q = pushToast(emptyQueue(), { message: "a", durationMs: 42 }, 10);
    expect(q.toasts[0].expiresAt).toBe(52);
  });

  it("refreshes a duplicate instead of stacking it", () => {
    const run = vi.fn();
    let q = pushToast(emptyQueue(), { message: "same" }, 0);
    q = pushToast(q, { message: "same", action: { label: "Undo", run } }, 3000);
    expect(q.toasts).toHaveLength(1);
    expect(q.toasts[0].id).toBe(1);
    expect(q.toasts[0].expiresAt).toBe(3000 + ACTION_MS);
    expect(q.toasts[0].action?.label).toBe("Undo");
  });

  it("keeps the same message separate across kinds", () => {
    let q = pushToast(emptyQueue(), { message: "x" }, 0);
    q = pushToast(q, { message: "x", kind: "error" }, 0);
    expect(q.toasts).toHaveLength(2);
  });

  it("drops the oldest beyond the visible limit", () => {
    let q = emptyQueue();
    for (let i = 0; i < MAX_VISIBLE + 2; i++) {
      q = pushToast(q, { message: `m${i}` }, 0);
    }
    expect(q.toasts).toHaveLength(MAX_VISIBLE);
    expect(q.toasts[0].message).toBe("m2");
  });

  it("dismisses by id and ignores unknown ids", () => {
    const q = pushToast(
      pushToast(emptyQueue(), { message: "a" }, 0),
      { message: "b" },
      0,
    );
    expect(dismissToast(q, 1).toasts.map((t) => t.message)).toEqual(["b"]);
    expect(dismissToast(q, 99)).toBe(q);
  });

  it("expires only the toasts whose time is up", () => {
    let q = pushToast(emptyQueue(), { message: "a", durationMs: 100 }, 0);
    q = pushToast(q, { message: "b", durationMs: 500 }, 0);
    expect(expireToasts(q, 50)).toBe(q);
    expect(expireToasts(q, 100).toasts.map((t) => t.message)).toEqual(["b"]);
    expect(expireToasts(q, 500).toasts).toEqual([]);
  });

  it("reports the next wake-up, or null when empty", () => {
    expect(nextExpiry(emptyQueue())).toBeNull();
    let q = pushToast(emptyQueue(), { message: "a", durationMs: 300 }, 0);
    q = pushToast(q, { message: "b", durationMs: 100 }, 0);
    expect(nextExpiry(q)).toBe(100);
  });
});

describe("toast store", () => {
  it("notifies subscribers only when the queue changes", () => {
    let t = 0;
    const store = createToastStore(() => t);
    const spy = vi.fn();
    const off = store.subscribe(spy);
    store.expire();
    store.dismiss(5);
    expect(spy).not.toHaveBeenCalled();
    store.push({ message: "a", durationMs: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
    t = 20;
    store.expire();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().toasts).toEqual([]);
    off();
    store.push({ message: "b" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("toast hold and sticky", () => {
  it("hold stops the countdown and release restarts it with time to read", () => {
    let q = pushToast(emptyQueue(), { message: "a", durationMs: 8000 }, 0);
    q = holdToast(q, 1, 7000);
    expect(q.toasts[0].expiresAt).toBe(Infinity);
    expect(nextExpiry(q)).toBeNull();
    expect(expireToasts(q, 99999)).toBe(q);
    q = releaseToast(q, 1, 20000);
    expect(q.toasts[0].expiresAt).toBe(22000); // 1000 left, raised to 2000
    q = holdToast(q, 1, 20500);
    q = releaseToast(q, 1, 30000);
    expect(q.toasts[0].expiresAt).toBe(32000);
  });

  it("a lifetime of 0 never expires and ignores hold", () => {
    const q = pushToast(emptyQueue(), { message: "a", durationMs: 0 }, 0);
    expect(q.toasts[0].sticky).toBe(true);
    expect(nextExpiry(q)).toBeNull();
    expect(expireToasts(q, 1e12)).toBe(q);
    expect(holdToast(q, 1, 5)).toBe(q);
  });

  it("the store applies the error lifetime to errors only and returns the id", () => {
    const store = createToastStore(() => 0);
    store.setErrorMs(3000);
    const e = store.push({ message: "bad", kind: "error" });
    const i = store.push({ message: "ok" });
    expect(e).toBe(1);
    expect(i).toBe(2);
    expect(store.getSnapshot().toasts.map((t) => t.expiresAt)).toEqual([
      3000,
      INFO_MS,
    ]);
    store.setErrorMs(0);
    store.push({ message: "stuck", kind: "error" });
    expect(store.getSnapshot().toasts[2].sticky).toBe(true);
  });
});
