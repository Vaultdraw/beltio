/**
 * Test/bench-only deterministic vault-like graph (ported from the graph-bench spike): folders with
 * Zipf sizes, ~70% intra-folder links, m = 1.5n, ~20% orphans, a few hubs.
 */

export function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TestGraph {
  n: number;
  m: number;
  edges: Uint32Array;
  folder: Uint16Array;
  folderCount: number;
}

export function genGraph(n: number, seed = 1): TestGraph {
  const r = rng(seed * 7919 + n);
  const F = Math.max(5, Math.round(Math.sqrt(n) * 0.8));
  const cum = new Float64Array(F);
  for (let k = 0, s = 0; k < F; k++) {
    cum[k] = s += 1 / Math.pow(k + 1, 0.9);
  }
  const folder = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const x = r() * cum[F - 1];
    let lo = 0;
    let hi = F - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    folder[i] = lo;
  }
  const orphan = new Uint8Array(n);
  for (let c = 0; c < Math.round(n * 0.2); ) {
    const i = (r() * n) | 0;
    if (!orphan[i]) {
      orphan[i] = 1;
      c++;
    }
  }
  const byFolder: number[][] = Array.from({ length: F }, () => []);
  const linked: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!orphan[i]) {
      byFolder[folder[i]].push(i);
      linked.push(i);
    }
  }
  const m = Math.round(n * 1.5);
  const seen = new Set<number>();
  const e: number[] = [];
  const add = (a: number, b: number) => {
    if (a === b) {
      return false;
    }
    const k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    e.push(a, b);
    return true;
  };
  const H = Math.max(3, Math.round(n / 3000));
  const hubDeg = Math.min(
    150 + Math.floor(r() * 250),
    Math.floor((0.15 * m) / H),
  );
  for (let h = 0; h < H; h++) {
    const hub = linked[(r() * linked.length) | 0];
    for (let c = 0; c < hubDeg; ) {
      if (add(hub, linked[(r() * linked.length) | 0])) {
        c++;
      }
    }
  }
  while (e.length / 2 < m) {
    const a = linked[(r() * linked.length) | 0];
    const pool = byFolder[folder[a]];
    const b =
      r() < 0.7 && pool.length > 1
        ? pool[(r() * pool.length) | 0]
        : linked[(r() * linked.length) | 0];
    add(a, b);
  }
  return {
    n,
    m: e.length / 2,
    edges: Uint32Array.from(e),
    folder,
    folderCount: F,
  };
}

/** 'random': uniform square. 'seeded': nodes around a random centre per folder. */
export function initPositions(
  g: TestGraph,
  mode: "random" | "seeded" = "seeded",
  seed = 2,
): Float32Array {
  const r = rng(seed + g.n);
  const n = g.n;
  const side = 15 * Math.sqrt(n);
  const pos = new Float32Array(2 * n);
  if (mode === "random") {
    for (let i = 0; i < 2 * n; i++) {
      pos[i] = (r() - 0.5) * side;
    }
    return pos;
  }
  const cx: number[] = [];
  const cy: number[] = [];
  const size = new Uint32Array(g.folderCount);
  for (let i = 0; i < n; i++) {
    size[g.folder[i]]++;
  }
  for (let f = 0; f < g.folderCount; f++) {
    cx.push((r() - 0.5) * side);
    cy.push((r() - 0.5) * side);
  }
  for (let i = 0; i < n; i++) {
    const f = g.folder[i];
    const rad = 4 * Math.sqrt(size[f]);
    const a = r() * 6.2832;
    const d = Math.sqrt(r()) * rad;
    pos[2 * i] = cx[f] + Math.cos(a) * d;
    pos[2 * i + 1] = cy[f] + Math.sin(a) * d;
  }
  return pos;
}

/** Mean edge length / mean random-pair distance (lower = linked nodes closer). */
export function quality(g: TestGraph, p: Float32Array): number {
  let e = 0;
  for (let k = 0; k < g.edges.length; k += 2) {
    const a = g.edges[k];
    const c = g.edges[k + 1];
    e += Math.hypot(p[2 * a] - p[2 * c], p[2 * a + 1] - p[2 * c + 1]);
  }
  const r = rng(99);
  let q = 0;
  for (let k = 0; k < 20000; k++) {
    const a = (r() * g.n) | 0;
    const c = (r() * g.n) | 0;
    q += Math.hypot(p[2 * a] - p[2 * c], p[2 * a + 1] - p[2 * c + 1]);
  }
  return e / g.m / (q / 20000);
}
