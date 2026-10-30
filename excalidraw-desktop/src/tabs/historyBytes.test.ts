import { describe, expect, it } from "vitest";

import { estimateHistoryBytes } from "./historyBytes";
import { estimateBytes } from "./tabMemory";

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

describe("estimateHistoryBytes", () => {
  it("matches the plain JSON estimate", () => {
    const snap = {
      undo: Array.from({ length: 10 }, (_, i) => delta(i)),
      redo: [delta(99)],
    };
    const sum =
      snap.undo.reduce((n, d) => n + estimateBytes(d), 0) +
      estimateBytes(snap.redo[0]);
    expect(estimateHistoryBytes(snap)).toBe(sum);
  });

  it("falls back for unknown shapes", () => {
    expect(estimateHistoryBytes({ a: 1 })).toBe(estimateBytes({ a: 1 }));
  });
});
