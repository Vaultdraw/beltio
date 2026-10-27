/** Report-only (no wall-clock asserts): rebuild + pick cost of the hit grid. */
import { describe, it } from "vitest";

import { HitGrid } from "./hitgrid";

describe("hitgrid bench (report only)", () => {
  it("rebuild and pick at 1k / 10k / 50k", () => {
    for (const n of [1000, 10000, 50000]) {
      const pos = new Float32Array(2 * n);
      const rad = new Float32Array(n).fill(4);
      let s = 1;
      const rnd = () =>
        (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 2 * n; i++) {
        pos[i] = (rnd() - 0.5) * 15 * Math.sqrt(n) * 2;
      }
      const g = new HitGrid();
      g.build(pos, rad, n); // warm (allocates)
      const times: number[] = [];
      for (let k = 0; k < 20; k++) {
        const t = performance.now();
        g.build(pos, rad, n);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      const q = 20000;
      const t0 = performance.now();
      let hit = 0;
      for (let k = 0; k < q; k++) {
        if (g.pick(pos[2 * (k % n)] + 1, pos[2 * (k % n) + 1], 0.5) >= 0) {
          hit++;
        }
      }
      const per = (performance.now() - t0) / q;
      // eslint-disable-next-line no-console
      console.info(
        `hitgrid n=${n}: rebuild p50 ${times[10].toFixed(
          2,
        )} ms, pick ${per.toFixed(4)} ms (${hit} hits)`,
      );
    }
  });
});
