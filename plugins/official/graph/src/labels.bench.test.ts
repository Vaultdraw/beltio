/** Report-only: label layout cost at 1k / 10k / 50k nodes (no wall-clock asserts). */
import { describe, it } from "vitest";

import { LabelLayer } from "./labels";

describe("labels bench (report only)", () => {
  it("setGraph + layout", () => {
    for (const n of [1000, 10000, 50000]) {
      let s = 3;
      const rnd = () =>
        (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
      const deg = new Uint32Array(n);
      const pos = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) {
        deg[i] = Math.floor(1 / (rnd() + 0.01));
        pos[2 * i] = (rnd() - 0.5) * 15 * Math.sqrt(n) * 2;
        pos[2 * i + 1] = (rnd() - 0.5) * 15 * Math.sqrt(n) * 2;
      }
      const L = new LabelLayer({ label: (i) => `note-${i}` });
      const t0 = performance.now();
      L.setGraph(n, deg);
      const setMs = performance.now() - t0;
      const ts: number[] = [];
      for (let k = 0; k < 30; k++) {
        const t = performance.now();
        L.layout({
          positions: pos,
          camera: { x: 0, y: 0, scale: 0.6 },
          width: 1200,
          height: 800,
        });
        ts.push(performance.now() - t);
      }
      ts.sort((a, b) => a - b);
      // eslint-disable-next-line no-console
      console.info(
        `labels n=${n}: setGraph ${setMs.toFixed(
          2,
        )} ms, layout p50 ${ts[15].toFixed(3)} ms p95 ${ts[28].toFixed(
          3,
        )} ms, ${L.count} labels`,
      );
    }
  });
});
