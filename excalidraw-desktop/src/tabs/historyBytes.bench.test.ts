import { describe, expect, it } from "vitest";

import { estimateHistoryBytes } from "./historyBytes";
import { estimateBytes } from "./tabMemory";

// Timing check, kept out of the fast tier (wall-clock): run with the bench tier.
const delta = (i: number) => ({
  elements: {
    added: {},
    removed: {},
    updated: {
      [`el${i}`]: { deleted: { x: i, y: i }, inserted: { x: i + 1, y: i + 2 } },
    },
  },
  appState: { delta: { deleted: {}, inserted: { selectedElementIds: {} } } },
});

describe("estimateHistoryBytes speed", () => {
  it("1,000-delta snapshot: repeat capture is fast (cached)", () => {
    const snap = {
      undo: Array.from({ length: 1000 }, (_, i) => delta(i)),
      redo: [],
    };
    estimateHistoryBytes(snap);
    const t1 = performance.now();
    estimateHistoryBytes(snap);
    const again = performance.now() - t1;
    const t2 = performance.now();
    estimateBytes(snap);
    const plain = performance.now() - t2;
    // eslint-disable-next-line no-console
    console.log(
      `cached ${again.toFixed(2)} ms, plain stringify ${plain.toFixed(2)} ms`,
    );
    expect(again).toBeLessThan(5);
  });
});
