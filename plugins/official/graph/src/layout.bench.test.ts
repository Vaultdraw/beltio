/**
 * Report-only layout benchmark (no wall-clock assertions): tick p50/p95, ticks and time to settle
 * from a folder-seeded start, warm-start displacement, bytes per node.
 * Run: npx vitest run src/graph/layout.bench.test.ts
 */
import { describe, expect, it } from "vitest";

import { ALPHA_WARM, ForceLayout } from "./barnesHut";
import { genGraph, initPositions, quality } from "./testGraph";

const pct = (a: number[], q: number) =>
  [...a].sort((x, y) => x - y)[
    Math.min(a.length - 1, Math.floor(a.length * q))
  ];

describe("layout bench (report only)", () => {
  for (const n of [1000, 10000, 50000]) {
    it(`n=${n}`, () => {
      const g = genGraph(n);
      const l = new ForceLayout({
        nodeCount: n,
        edges: g.edges,
        positions: initPositions(g, "seeded"),
      });
      const ms: number[] = [];
      let total = 0;
      while (!l.settled && ms.length < 2000) {
        const t = performance.now();
        l.tick();
        const d = performance.now() - t;
        ms.push(d);
        total += d;
      }
      const lines = [
        `n=${n} ticks=${ms.length} tick p50=${pct(ms, 0.5).toFixed(
          2,
        )} p95=${pct(ms, 0.95).toFixed(2)} ms`,
        `  to settle (seeded) ${total.toFixed(0)} ms, quality ${quality(
          g,
          l.positions,
        ).toFixed(3)}`,
        `  layout bytes/node ${(l.byteSize / n).toFixed(
          0,
        )} (+ positions/edges ${(8 + (4 * g.edges.length) / n).toFixed(0)})`,
      ];
      if (n <= 10000) {
        // warm: add one node linked to node 10, relax its 2-hop hood
        const n2 = n + 1;
        const edges = new Uint32Array(g.edges.length + 2);
        edges.set(g.edges);
        edges[g.edges.length] = 10;
        edges[g.edges.length + 1] = n;
        const pos = new Float32Array(2 * n2);
        pos.set(l.positions);
        pos[2 * n] = l.positions[20] + 1;
        pos[2 * n + 1] = l.positions[21] + 1;
        const saved = pos.slice();
        for (const focus of [true, false]) {
          const p = pos.slice();
          const w = new ForceLayout({
            nodeCount: n2,
            edges,
            positions: p,
            alpha: ALPHA_WARM,
            focus: focus ? Uint32Array.of(n) : null,
          });
          const t = performance.now();
          while (!w.settled && w.tickCount < 500) {
            w.tick();
          }
          const wms = performance.now() - t;
          let maxD = 0;
          for (let i = 0; i < n; i++) {
            maxD = Math.max(
              maxD,
              Math.hypot(
                p[2 * i] - saved[2 * i],
                p[2 * i + 1] - saved[2 * i + 1],
              ),
            );
          }
          lines.push(
            `  warm(${focus ? "hood" : "global"}) ticks=${
              w.tickCount
            } ${wms.toFixed(1)} ms maxDisp=${maxD.toFixed(1)} px`,
          );
        }
      }
      // eslint-disable-next-line no-console
      console.log(lines.join("\n"));
      expect(l.settled).toBe(true);
    }, 120000);
  }
});
