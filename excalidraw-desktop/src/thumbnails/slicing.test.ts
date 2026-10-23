import { describe, expect, it } from "vitest";

import {
  RenderCancelled,
  SLICE_BUDGET_MS,
  sceneSlicing,
  yieldToMain,
} from "./slicing";

describe("slicing", () => {
  it("slices of one third of a frame, yielding through yieldToMain", () => {
    const s = sceneSlicing();
    expect(s.budgetMs).toBe(SLICE_BUDGET_MS);
    expect(SLICE_BUDGET_MS).toBeLessThanOrEqual(8);
    expect(s.yieldFn).toBe(yieldToMain);
  });

  it("yields to a new macrotask (MessageChannel), in order", async () => {
    const order: string[] = [];
    queueMicrotask(() => order.push("micro"));
    const a = yieldToMain().then(() => order.push("a"));
    const b = yieldToMain().then(() => order.push("b"));
    await Promise.all([a, b]);
    expect(order).toEqual(["micro", "a", "b"]);
  });

  it("with a cancel check, a yield rejects once cancelled", async () => {
    let stop = false;
    const s = sceneSlicing(() => stop);
    await expect(s.yieldFn()).resolves.toBeUndefined();
    stop = true;
    await expect(s.yieldFn()).rejects.toBeInstanceOf(RenderCancelled);
  });
});
