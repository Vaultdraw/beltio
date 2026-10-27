import { describe, expect, it } from "vitest";

import { ALPHA_WARM, DEFAULT_FORCE_SETTINGS, ForceLayout } from "./barnesHut";
import { genGraph, initPositions, rng } from "./testGraph";

function randomLayout(n: number, theta: number, mask?: Uint8Array) {
  const r = rng(5);
  const positions = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) {
    positions[i] = (r() - 0.5) * 400;
  }
  return new ForceLayout({
    nodeCount: n,
    edges: new Uint32Array(0),
    positions,
    params: { theta },
    mask,
  });
}

/** Same kernel as the layout (charge / distance, distance clamped to >= 1), O(n^2). */
function brute(p: Float32Array, n: number, hidden?: Uint8Array) {
  const K = DEFAULT_FORCE_SETTINGS.repel * 3;
  const out = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    if (hidden?.[i]) {
      continue;
    }
    for (let j = 0; j < n; j++) {
      if (i === j || hidden?.[j]) {
        continue;
      }
      const dx = p[2 * j] - p[2 * i];
      const dy = p[2 * j + 1] - p[2 * i + 1];
      const d2 = Math.max(dx * dx + dy * dy, 1);
      out[2 * i] -= (K * dx) / d2;
      out[2 * i + 1] -= (K * dy) / d2;
    }
  }
  return out;
}

function relError(a: Float32Array, b: Float32Array) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - b[i]) ** 2;
    den += b[i] ** 2;
  }
  return Math.sqrt(num / den);
}

function settle(l: ForceLayout, max = 5000) {
  let t = 0;
  while (!l.settled && t++ < max) {
    l.tick();
  }
  return t;
}

describe("barnesHut repulsion", () => {
  const n = 200;

  it("is exact at theta 0 and within tolerance at theta 0.9", () => {
    const out = new Float32Array(2 * n);
    const exact = randomLayout(n, 0);
    exact.repulsionForces(out);
    expect(relError(out, brute(exact.positions, n))).toBeLessThan(1e-4);

    const approx = randomLayout(n, 0.9);
    approx.repulsionForces(out);
    expect(relError(out, brute(approx.positions, n))).toBeLessThan(0.15);
  });

  it("masked nodes exert and receive no force", () => {
    const hidden = new Uint8Array(n);
    for (let i = 0; i < n; i += 3) {
      hidden[i] = 1;
    }
    const l = randomLayout(n, 0, hidden);
    const out = new Float32Array(2 * n);
    l.repulsionForces(out);
    const ref = brute(l.positions, n, hidden);
    expect(relError(out, ref)).toBeLessThan(1e-4);
    for (let i = 0; i < n; i += 3) {
      expect(out[2 * i]).toBe(0);
      expect(out[2 * i + 1]).toBe(0);
    }
  });

  it("masked nodes never move", () => {
    const g = genGraph(300);
    const hidden = new Uint8Array(300);
    for (let i = 0; i < 300; i += 4) {
      hidden[i] = 1;
    }
    const pos = initPositions(g);
    const before = pos.slice();
    const l = new ForceLayout({
      nodeCount: g.n,
      edges: g.edges,
      positions: pos,
      mask: hidden,
    });
    settle(l);
    for (let i = 0; i < 300; i += 4) {
      expect(pos[2 * i]).toBe(before[2 * i]);
      expect(pos[2 * i + 1]).toBe(before[2 * i + 1]);
    }
    l.setMask(null);
    expect(l.settled).toBe(false);
  });
});

describe("barnesHut convergence", () => {
  it("cools, stops, and stays finite with coincident nodes", () => {
    const n = 60;
    const positions = new Float32Array(2 * n); // all at the origin
    const edges = new Uint32Array(2 * (n - 1));
    for (let i = 1; i < n; i++) {
      edges[2 * (i - 1)] = 0;
      edges[2 * (i - 1) + 1] = i;
    }
    const l = new ForceLayout({ nodeCount: n, edges, positions });
    const ticks = settle(l);
    expect(l.settled).toBe(true);
    expect(ticks).toBeLessThan(400);
    expect(l.alpha).toBeGreaterThan(0);
    for (const v of positions) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // jitter separated the stack
    expect(
      Math.hypot(positions[2] - positions[4], positions[3] - positions[5]),
    ).toBeGreaterThan(0);
  });

  it("lays a generated graph out with short links and finishes", () => {
    const g = genGraph(500);
    const l = new ForceLayout({
      nodeCount: g.n,
      edges: g.edges,
      positions: initPositions(g, "random"),
    });
    const ticks = settle(l);
    expect(l.settled).toBe(true);
    expect(ticks).toBeLessThan(400);
    let e = 0;
    for (let k = 0; k < g.edges.length; k += 2) {
      const a = g.edges[k];
      const b = g.edges[k + 1];
      e += Math.hypot(
        l.positions[2 * a] - l.positions[2 * b],
        l.positions[2 * a + 1] - l.positions[2 * b + 1],
      );
    }
    expect(e / g.m).toBeLessThan(150);
  });

  it("handles empty and fully hidden graphs", () => {
    const empty = new ForceLayout({
      nodeCount: 0,
      edges: new Uint32Array(0),
      positions: new Float32Array(0),
    });
    expect(empty.settled).toBe(true);
    empty.tick();
    const l = randomLayout(5, 0.9, new Uint8Array(5).fill(1));
    settle(l);
    expect(l.settled).toBe(true);
  });
});

describe("barnesHut drag", () => {
  function pathGraph() {
    // a path 0-1-2-3-4-5-6 plus a distant clique-ish blob
    const n = 40;
    const edgeList: number[] = [];
    for (let i = 0; i < 6; i++) {
      edgeList.push(i, i + 1);
    }
    for (let i = 7; i < n - 1; i++) {
      edgeList.push(i, i + 1);
    }
    const g = { n, edges: Uint32Array.from(edgeList), m: edgeList.length / 2 };
    const r = rng(3);
    const positions = new Float32Array(2 * n);
    for (let i = 0; i < 2 * n; i++) {
      positions[i] = (r() - 0.5) * 200;
    }
    return { n, g, positions };
  }

  it("moves only the 2-hop neighbourhood above globalDragMax", () => {
    const { n, g, positions } = pathGraph();
    const l = new ForceLayout({
      nodeCount: n,
      edges: g.edges,
      positions,
      alpha: 0,
      params: { globalDragMax: 10 },
    });
    const before = positions.slice();
    l.drag(3, 500, 500);
    for (let t = 0; t < 30; t++) {
      l.tick();
    }
    const moved = (i: number) =>
      positions[2 * i] !== before[2 * i] ||
      positions[2 * i + 1] !== before[2 * i + 1];
    const hood = new Set([1, 2, 3, 4, 5]);
    for (let i = 0; i < n; i++) {
      expect(moved(i)).toBe(hood.has(i));
    }
    expect(positions[6]).toBe(500);
    // release: the unpinned hood cools and settles, outside nodes stay put
    l.release();
    settle(l);
    expect(l.settled).toBe(true);
    for (let i = 0; i < n; i++) {
      if (!hood.has(i)) {
        expect(positions[2 * i]).toBe(before[2 * i]);
      }
    }
  });

  it("keeps every visible node live up to globalDragMax and settles after release", () => {
    const { n, g, positions } = pathGraph();
    const l = new ForceLayout({
      nodeCount: n,
      edges: g.edges,
      positions,
      alpha: 0,
    });
    const before = positions.slice();
    l.drag(3, 500, 500);
    for (let t = 0; t < 30; t++) {
      l.tick();
    }
    expect(l.settled).toBe(false);
    expect(positions[6]).toBe(500);
    const far = [20, 30].map(
      (i) =>
        positions[2 * i] !== before[2 * i] ||
        positions[2 * i + 1] !== before[2 * i + 1],
    );
    expect(far).toEqual([true, true]);
    // still hot while held
    for (let t = 0; t < 1000; t++) {
      l.tick();
    }
    expect(l.settled).toBe(false);
    l.release();
    settle(l);
    expect(l.settled).toBe(true);
  });
});

describe("barnesHut warm start", () => {
  it("settles a saved layout plus one new node fast and barely moves the rest", () => {
    const g = genGraph(2000);
    const cold = new ForceLayout({
      nodeCount: g.n,
      edges: g.edges,
      positions: initPositions(g),
    });
    settle(cold);
    // append one new node linked to node 10, placed at that node's position
    const n = g.n + 1;
    const edges = new Uint32Array(g.edges.length + 2);
    edges.set(g.edges);
    edges[g.edges.length] = 10;
    edges[g.edges.length + 1] = g.n;
    const positions = new Float32Array(2 * n);
    positions.set(cold.positions);
    positions[2 * g.n] = cold.positions[20] + 1;
    positions[2 * g.n + 1] = cold.positions[21] + 1;
    const saved = positions.slice();
    const warm = new ForceLayout({
      nodeCount: n,
      edges,
      positions,
      alpha: ALPHA_WARM,
      focus: Uint32Array.of(g.n),
    });
    const ticks = settle(warm);
    expect(warm.settled).toBe(true);
    expect(ticks).toBeLessThanOrEqual(30);
    let maxDisp = 0;
    for (let i = 0; i < g.n; i++) {
      maxDisp = Math.max(
        maxDisp,
        Math.hypot(
          positions[2 * i] - saved[2 * i],
          positions[2 * i + 1] - saved[2 * i + 1],
        ),
      );
    }
    expect(maxDisp).toBeLessThan(30);
  });
});
