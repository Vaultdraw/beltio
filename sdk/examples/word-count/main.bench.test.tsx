import { describe, expect, it } from "vitest";

import { stats } from "./main.js";

// Timing check, outside the fast tier (wall-clock).
describe("stats() speed", () => {
  it("is fast over 5,000 elements with text", () => {
    const els = Array.from({ length: 5000 }, (_, i) =>
      i % 2
        ? { type: "text", text: `item ${i} of the quick brown fox` }
        : { type: "rectangle" },
    ) as never[];
    stats(els); // warm up
    const t0 = performance.now();
    stats(els);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(25); // measured ~0.6 ms
  });
});
