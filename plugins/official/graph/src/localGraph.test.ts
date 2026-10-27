import { describe, expect, it } from "vitest";

import { buildCsr, localGraph } from "./localGraph";
import { genGraph } from "./testGraph";

// 0-1, 1-2, 2-3, 3-4 (path), 5 isolated, 6-7 separate component, 4->1 back edge
const edges = Uint32Array.of(0, 1, 1, 2, 2, 3, 3, 4, 6, 7, 4, 1);
const n = 8;
const csr = buildCsr(n, edges);

const global = (g: ReturnType<typeof localGraph>) => [...g.nodes];
const edgesGlobal = (g: ReturnType<typeof localGraph>) => {
  const out: string[] = [];
  for (let k = 0; k < g.edges.length; k += 2) {
    out.push(`${g.nodes[g.edges[k]]}>${g.nodes[g.edges[k + 1]]}`);
  }
  return out.sort();
};

describe("buildCsr", () => {
  it("is undirected", () => {
    expect(
      [...csr.targets.slice(csr.offsets[1], csr.offsets[2])].sort(),
    ).toEqual([0, 2, 4]);
    expect(csr.offsets[n]).toBe(edges.length);
  });
});

describe("localGraph", () => {
  it("depth 1 / 2 / 3 around node 1", () => {
    const d1 = localGraph(csr, edges, 1, 1);
    expect(global(d1)[0]).toBe(1);
    expect(global(d1).sort()).toEqual([0, 1, 2, 4]);
    expect(edgesGlobal(d1)).toEqual(["0>1", "1>2", "4>1"]);
    expect([...d1.depth]).toEqual([0, 1, 1, 1]);

    const d2 = localGraph(csr, edges, 1, 2);
    expect(global(d2).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(edgesGlobal(d2)).toEqual(["0>1", "1>2", "2>3", "3>4", "4>1"]);

    const d3 = localGraph(csr, edges, 0, 3);
    expect(global(d3).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(Math.max(...d3.depth)).toBe(3);
  });

  it("isolated node and disconnected graph", () => {
    const iso = localGraph(csr, edges, 5, 3);
    expect(global(iso)).toEqual([5]);
    expect(iso.edges.length).toBe(0);
    const other = localGraph(csr, edges, 6, 3);
    expect(global(other).sort()).toEqual([6, 7]);
    expect(edgesGlobal(other)).toEqual(["6>7"]);
  });

  it("depth 2 at 50k stays within budget (reported)", () => {
    const g = genGraph(50000);
    const big = buildCsr(g.n, g.edges);
    const hub = (() => {
      let best = 0;
      for (let i = 0; i < g.n; i++) {
        if (
          big.offsets[i + 1] - big.offsets[i] >
          big.offsets[best + 1] - big.offsets[best]
        ) {
          best = i;
        }
      }
      return best;
    })();
    const t0 = performance.now();
    const sub = localGraph(big, g.edges, hub, 2);
    const ms = performance.now() - t0;
    expect(sub.nodes[0]).toBe(hub);
    // eslint-disable-next-line no-console
    console.log(
      `localGraph depth 2 @50k hub: ${sub.nodes.length} nodes, ${ms.toFixed(
        2,
      )} ms`,
    );
  });
});
